/**
 * Fixtures for the shadow box's checks (`shadow-box.long-test.ts` at the spots of issue #89,
 * `shadow-box.map-test.ts` at spots found by the terrain's shape): a sky host's view turned or zoomed
 * frame by frame, and what its key light's shadow box did.
 *
 * @module render/__tests__/shadow-turns
 */
import assert from "node:assert/strict"

import { Group, Vector2, Vector3 } from "three"

import { coarseHeightAt } from "../../sim/map/coarse.ts"
import { MAP } from "../../sim/map/index.ts"
import { TILE } from "../../sim/map/kinds.ts"
import { isListed } from "../../sim/map/tiles.ts"
import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { initialWeather, setWeather } from "../../sim/sky/weather.ts"
import { QUARTER } from "../../sim/view.ts"
import { farTerrainY } from "../ground.ts"
import { viewAxes } from "../pipeline.ts"
import { shadowFit } from "../shadow-box.ts"
import { SkyHost } from "../sky/host.ts"
import { makePost } from "../sky/post.ts"
import { followToward, turnToward } from "../swing.ts"
import { residentAround } from "../testing.ts"

/** 08:00 in Rome on 4 November 2026, the playtest of issue #89: the sun 8.9° up, cast from SHADOW_FLOOR's 20°. */
const MORNING = utcFromRome(daysFromCivil(2026, 11, 4) * DAY + 8 * 3600)
/** A 1280 × 720 screen's view, texels. */
const SCREEN = new Vector2(427, 240)
/** A frame at 60 fps, s. */
const FRAME = 1 / 60
/** The box's steps: × √2 from the zoom's flat fit up to the 300 m cap, which a step landing within a tenth of it gives way to (docs/architecture.md). */
const STEP = Math.SQRT2,
  LEAST = 1.1,
  CAP = 300

/** A map point to turn the view at. */
interface Spot {
  readonly name: string
  readonly x: number
  readonly y: number
}

/** The view in one frame: its yaw, rad to the left of the home seat, and its zoom, texels per metre. */
interface Pose {
  readonly yaw: number
  readonly texelsPerMetre: number
}

/** One frame: the shadow box's half size and what `shadowFit` asked for, m. */
interface Frame {
  readonly held: number
  readonly need: number
}

/** The box over flat ground at `texelsPerMetre` on a 1280 × 720 screen, m: the view's ground rectangle's circumscribed circle plus 10 m (50.2 m on foot). */
export const flatHalf = (texelsPerMetre: number): number =>
  Math.hypot(SCREEN.x / texelsPerMetre, SCREEN.y / texelsPerMetre / Math.sin(Math.PI / 6)) / 2 + 10

/** The step above `half`. */
const nextStep = (half: number): number => (half * STEP * LEAST > CAP ? CAP : half * STEP)

/** The smallest step from `base` that holds `need`. */
const stepFor = (base: number, need: number): number => {
  let half = base
  while (half < need && half < CAP) half = nextStep(half)
  return half
}

/** A whole turn, one degree a frame, `dir` 1 to the left or −1 to the right, at `texelsPerMetre`, then `settle` s at home. */
export const wholeTurn = (texelsPerMetre: number, dir: 1 | -1, settle = 2): Array<Pose> =>
  Array.from({ length: 361 + Math.round(settle / FRAME) }, (_, k) => ({
    yaw: (dir * Math.min(k, 360) * Math.PI) / 180,
    texelsPerMetre,
  }))

/**
 * Half a second at home, then a quarter turn eased as Q (`dir` 1) or E (−1) eases it
 * (`turnToward`, about a third of a second, 16° in its first frame), then 2 s at the new seat.
 */
export const quarterTurn = (texelsPerMetre: number, dir: 1 | -1): Array<Pose> => {
  let yaw = 0
  return Array.from({ length: Math.round(3 / FRAME) }, (_, k) => {
    if (k > 30) yaw = turnToward(yaw, dir * QUARTER, FRAME)
    return { yaw, texelsPerMetre }
  })
}

/**
 * Half a second at rest, then the follow spring's half turn (`followToward`, as when the car turns
 * round; up to 4.4° a frame), the spring's fastest from rest, then rest again: 4 s in all.
 */
export const followTurn = (texelsPerMetre: number, dir: 1 | -1): Array<Pose> => {
  let spin = { yaw: 0, rate: 0 }
  return Array.from({ length: Math.round(4 / FRAME) }, (_, k) => {
    if (k > 30) spin = followToward(spin, dir * Math.PI, FRAME)
    return { yaw: spin.yaw, texelsPerMetre }
  })
}

/** Two seconds at `from` texels per metre and yaw `yaw`, then the zoom eased to `to` as the host eases it (main.ts), 4 s in all. */
export const zoomEase = (yaw: number, from: number, to: number): Array<Pose> => {
  let zoom = from
  return Array.from({ length: Math.round(6 / FRAME) }, (_, k) => {
    if (k > 120)
      zoom += Math.abs(to - zoom) < 0.01 ? to - zoom : (to - zoom) * (1 - Math.exp(-3 * FRAME))
    return { yaw, texelsPerMetre: zoom }
  })
}

/**
 * The frames of a fresh sky host (08:00, a clear sky) whose view at `spot` takes each of `poses`,
 * a 60 fps frame apart. Reads the tiles within 600 m of the spot, as the host holds round the
 * player (farther, the terrain is the coarse grid's).
 */
export const framesAt = (spot: Spot, poses: ReadonlyArray<Pose>): Array<Frame> => {
  residentAround([spot], 600)
  const host = new SkyHost(new Group(), { reduced: () => false }),
    renderer = {
      shadowMap: { autoUpdate: true, needsUpdate: false },
      setClearColor: () => undefined,
    }
  const weather = setWeather(
    initialWeather(MORNING, 1),
    { regime: "clear", settle: true },
    MORNING,
  )!
  const focus = new Vector3(spot.x, farTerrainY(spot.x, spot.y), -spot.y),
    groundAt = (x: number, z: number) => farTerrainY(x, -z),
    post = makePost()
  return poses.map(({ yaw, texelsPerMetre }, k) => {
    host.sky(MORNING + k * FRAME, 1, weather, 10 + k * FRAME, 0.04)
    host.draw({ focus, yaw, texelsPerMetre, view: SCREEN, post }, renderer)
    const width = SCREEN.x / texelsPerMetre,
      height = SCREEN.y / texelsPerMetre
    return {
      held: host.key.shadow.camera.right,
      need: shadowFit(focus, viewAxes(yaw), width, height, host.toKey, groundAt).half,
    }
  })
}

/** The frames on which the box changed size. */
export const changesOf = (frames: ReadonlyArray<Frame>): Array<number> =>
  frames.flatMap((f, k) => (k > 0 && f.held !== frames[k - 1]!.held ? [k] : []))

/**
 * Checks the frames of a turn at a fixed zoom: the box changes size at most `most` times; on two
 * frames in a row at most `pairs` times, and each such second change only where the view forced it
 * (its ground outgrew the box, or the box stood more than a step above it); never back on the frame
 * after to the size it held two frames before (a strobe); never holds less than `shadowFit` asks
 * for nor more than one step above the step that holds it; and starts and ends at rest on that
 * step. Returns how many times it changed.
 */
export const assertTurn = (
  frames: ReadonlyArray<Frame>,
  texelsPerMetre: number,
  limits: { readonly most: number; readonly pairs: number },
  label: string,
): number => {
  const base = flatHalf(texelsPerMetre),
    above = (need: number) => nextStep(stepFor(base, need))
  const changed = changesOf(frames)
  assert.ok(
    changed.length <= limits.most,
    `${label}: the box changed size ${changed.length} times (at most ${limits.most})`,
  )
  const twice = changed.filter((k, n) => n > 0 && changed[n - 1] === k - 1)
  assert.ok(
    twice.length <= limits.pairs,
    `${label}: the box changed size on two frames in a row ${twice.length} times, at frames ${twice.join(", ")} (at most ${limits.pairs})`,
  )
  for (const k of twice) {
    const was = frames[k - 1]!.held,
      need = frames[k]!.need
    assert.ok(
      need > was || was > above(need),
      `${label}: the box changed size on frames ${k - 1} and ${k}, where ${was} m still held the ${need} m asked`,
    )
    assert.notEqual(
      frames[k]!.held,
      frames[k - 2]!.held,
      `${label}: the box strobed ${frames[k - 2]!.held} → ${was} → ${frames[k]!.held} m on frames ${k - 2}–${k}`,
    )
  }
  frames.forEach(({ held, need }, k) => {
    assert.ok(held >= need, `${label} frame ${k}: ${held} m holds less than the ${need} m asked`)
    assert.ok(
      held <= above(need),
      `${label} frame ${k}: ${held} m is more than a step above the ${need} m asked (${above(need)} m)`,
    )
  })
  for (const k of [0, frames.length - 1])
    assert.equal(
      frames[k]!.held,
      stepFor(base, frames[k]!.need),
      `${label}: at rest, frame ${k}, the view's own step`,
    )
  return changed.length
}

const { cell, cols, rows, x0, y0 } = MAP.coarse
/** The coarse lattice's node (i, j) as a map point. */
const nodeAt = (i: number, j: number) => ({ x: x0 + i * cell, y: y0 + j * cell })
/** Whether node (i, j) lies on a listed tile, at least `margin` m inside the lattice. */
const onMap = (i: number, j: number, margin: number): boolean => {
  const { x, y } = nodeAt(i, j),
    m = Math.ceil(margin / cell)
  return (
    i >= m &&
    j >= m &&
    i < cols - m &&
    j < rows - m &&
    isListed(Math.floor(x / TILE), Math.floor(y / TILE))
  )
}

/**
 * Three spots of the loaded map found by the terrain's shape on the coarse 64 m lattice: the top of
 * its steepest fall over 192 m along a lattice axis (a slope falling away shows ground far past the
 * view), the floor of its deepest gully (both sides 128 m off along an axis rising the most), and its
 * flattest ground (the least relief within a 384 m square). Only nodes on listed tiles at least
 * 600 m inside the lattice count. They are not where the fit leaps most (docs/architecture.md).
 */
export const shapedSpots = (): Array<Spot> => {
  const h = (i: number, j: number) => coarseHeightAt(x0 + i * cell, y0 + j * cell)
  const AXES = [
    [1, 0],
    [0, 1],
  ] as const
  let slope = { fall: -Infinity, i: 0, j: 0 },
    gully = { depth: -Infinity, i: 0, j: 0 },
    flat = { relief: Infinity, i: 0, j: 0 }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!onMap(i, j, 600)) continue
      const here = h(i, j)
      let low = here,
        high = here
      for (const [a, b] of AXES) {
        for (const s of [1, -1]) {
          const fall = here - h(i + 3 * s * a, j + 3 * s * b)
          if (fall > slope.fall) slope = { fall, i, j }
        }
        const depth = Math.min(h(i + 2 * a, j + 2 * b), h(i - 2 * a, j - 2 * b)) - here
        if (depth > gully.depth) gully = { depth, i, j }
      }
      for (let dj = -3; dj <= 3; dj++)
        for (let di = -3; di <= 3; di++) {
          const z = h(i + di, j + dj)
          low = Math.min(low, z)
          high = Math.max(high, z)
        }
      if (high - low < flat.relief) flat = { relief: high - low, i, j }
    }
  return [
    {
      name: `the steepest fall (${slope.fall.toFixed(0)} m over 192 m)`,
      ...nodeAt(slope.i, slope.j),
    },
    { name: `the deepest gully (${gully.depth.toFixed(0)} m)`, ...nodeAt(gully.i, gully.j) },
    {
      name: `the flattest ground (${flat.relief.toFixed(1)} m of relief)`,
      ...nodeAt(flat.i, flat.j),
    },
  ]
}
