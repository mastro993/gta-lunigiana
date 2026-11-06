/**
 * Fixtures for the shadow box's turn checks (`shadow-box.long-test.ts` at the spots of issue #89,
 * `shadow-box.map-test.ts` at spots found by the terrain's shape): a sky host's view turned through
 * a whole turn, one degree a frame, and what its key light's shadow box did.
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
import { farTerrainY } from "../ground.ts"
import { viewAxes } from "../pipeline.ts"
import { shadowFit } from "../shadow-box.ts"
import { SkyHost } from "../sky/host.ts"
import { makePost } from "../sky/post.ts"
import { residentAround } from "../testing.ts"

/** 08:00 in Rome on 4 November 2026, the playtest of issue #89: the sun 8.9° up, cast from SHADOW_FLOOR's 20°. */
const MORNING = utcFromRome(daysFromCivil(2026, 11, 4) * DAY + 8 * 3600)
/** A 1280 × 720 screen's view, texels. */
const SCREEN = new Vector2(427, 240)
/** A frame, s: one degree a frame at 60 fps is the follow camera's fastest turn (0.017 rad a frame). */
const FRAME = 1 / 60
/** The box's steps: ×√2 from the zoom's flat fit up to the 300 m cap (docs/architecture.md). */
const STEP = Math.SQRT2,
  CAP = 300

/** A map point to turn the view at. */
export interface Spot {
  readonly name: string
  readonly x: number
  readonly y: number
}

/** One frame of a turn: the shadow box's half size and what `shadowFit` asked for, m. */
export interface Frame {
  readonly held: number
  readonly need: number
}

/** The box over flat ground at `texelsPerMetre` on a 1280 × 720 screen, m: the view's ground rectangle's circumscribed circle plus 10 m (50.2 m on foot). */
export const flatHalf = (texelsPerMetre: number): number =>
  Math.hypot(SCREEN.x / texelsPerMetre, SCREEN.y / texelsPerMetre / Math.sin(Math.PI / 6)) / 2 + 10

/** The smallest step from `base` that holds `need`. */
const stepFor = (base: number, need: number): number => {
  let half = base
  while (half < need && half < CAP) half = Math.min(CAP, half * STEP)
  return half
}

/**
 * The frames of a fresh sky host (08:00, a clear sky) whose view at `spot` turns from the home seat
 * through a whole turn, `dir` 1 to the left or −1 to the right, one degree a frame at
 * `texelsPerMetre`, then rests at home for `settle` s. Reads the tiles within 600 m of the spot, as
 * the host holds round the player (farther, the terrain is the coarse grid's).
 */
export const turnAt = (
  spot: Spot,
  texelsPerMetre: number,
  dir: 1 | -1,
  settle = 2,
): Array<Frame> => {
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
  const frames: Array<Frame> = []
  const turn = 360,
    rest = Math.round(settle / FRAME)
  for (let k = 0; k <= turn + rest; k++) {
    const yaw = (dir * Math.min(k, turn) * Math.PI) / 180,
      axes = viewAxes(yaw),
      width = SCREEN.x / texelsPerMetre,
      height = SCREEN.y / texelsPerMetre
    host.sky(MORNING + k * FRAME, 1, weather, 10 + k * FRAME, 0.04)
    host.draw({ focus, yaw, texelsPerMetre, view: SCREEN, post }, renderer)
    frames.push({
      held: host.key.shadow.camera.right,
      need: shadowFit(focus, axes, width, height, host.toKey, groundAt).half,
    })
  }
  return frames
}

/**
 * Checks a turn's frames: the box changes size at most `most` times and never on two frames in a
 * row (with `forced`, only when the view forces the second: its ground outgrew the box, or the box
 * stood more than a step above it), never holds less than `shadowFit` asks for nor more than one
 * step above the step that holds it, and starts and ends on that step at the home seat. Returns how
 * many times it changed.
 */
export const assertTurn = (
  frames: ReadonlyArray<Frame>,
  texelsPerMetre: number,
  most: number,
  label: string,
  forced = false,
): number => {
  const base = flatHalf(texelsPerMetre),
    above = (need: number) => Math.min(CAP, stepFor(base, need) * STEP)
  const changed = frames.flatMap((f, k) => (k > 0 && f.held !== frames[k - 1]!.held ? [k] : []))
  assert.ok(
    changed.length <= most,
    `${label}: the box changed size ${changed.length} times in a turn (at most ${most})`,
  )
  const twice = changed.find((k, n) => {
    if (n === 0 || changed[n - 1] !== k - 1) return false
    const was = frames[k - 1]!.held,
      need = frames[k]!.need
    return !forced || (need <= was && was <= above(need))
  })
  assert.equal(
    twice,
    undefined,
    `${label}: the box changed size on frames ${twice! - 1} and ${twice}`,
  )
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
      `${label}: the home view's own step`,
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
 * Three spots of the loaded map found by the terrain's shape on the coarse 64 m lattice, so the turn
 * checks cover any map's ground: the top of its steepest fall over 192 m along a lattice axis (a
 * slope falling away shows ground far past the view), the floor of its deepest gully (both sides
 * 128 m off along an axis rising the most), and its flattest ground (the least relief within a
 * 384 m square). Only nodes on listed tiles at least 600 m inside the lattice count.
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
