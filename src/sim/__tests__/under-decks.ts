/**
 * The checks the under-decks map tests run on every road bridge of a built map, with the map loaded (issue #87): a walker on the
 * ground under a deck, where there is room to stand, never comes up onto it, walking toward the ground under it that reaches near
 * its top (`deckClimbs`); and along each road meeting each of its ends, a walker and a car meet no wall with a level on their way
 * onto it (`deckEndsShut`). They read the decks' lines from the map joined back from its tiles and walk the game's own lookups:
 * `footZ` as `FindFooting` steps a body, `walkBy` and `moveCar` with the walls the body meets on its level.
 *
 * @module sim/__tests__/under-decks
 */
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { segIndex } from "../../tools/geometry.ts"
import type { JoinedMap } from "../../tools/map-file.ts"
import { moveCar, standClear, walkBy, wallsAlong } from "../body.ts"
import { moveCircles, segDist2 } from "../collide.ts"
import { atGrade, footZ, groundZ } from "../map/ground.ts"
import { DECK_SLAB, footReach, isDrivable, isRoadClass, ROAD_LIFT } from "../map/kinds.ts"
import { PERSON_HEIGHT, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"

/** How far apart the check reads the ground under a deck's slab, along and across it, m. */
const SAMPLE = 1
/** A walker's step, m: about what `FindFooting` sees it move in one step at a walk. */
const STEP = 0.05
/** Room to stand under a deck: its underside (DECK_SLAB.depth under its top) PERSON_HEIGHT or more over the ground, m under its top. */
const ROOM = DECK_SLAB.depth + PERSON_HEIGHT
/** Ground this near a deck's top (m) is where a walker under it would come up onto it: within the game's `ON_DECK` of it. */
const NEAR = 0.45
/** How far in from a deck's ends the ground near its top is, at least, m: nearer, a road or a path coming onto the deck there leads up to it (the issue's measure). */
const IN_FROM_ENDS = 4
/** A footing this near a deck's surface (m) is on it. */
const ON = 0.02

/** A road bridge as shipped: its index in the map's roads, its line, its surface over its profile and its walkers' reach, m. */
interface Deck {
  readonly index: number
  readonly name: string
  readonly cls: string
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly lift: number
  readonly half: number
  readonly reach: number
}

/** Every road bridge of `map`. */
const decksOf = (map: JoinedMap): Array<Deck> =>
  map.roads.flatMap((r, index) => {
    if (r.bridge !== true) return []
    const cls = isRoadClass(r.cls) ? r.cls : "path"
    return [
      {
        index,
        name: `${r.cls} bridge ${r.id}`,
        cls,
        pts: r.pts,
        z: r.z,
        lift: ROAD_LIFT[cls],
        half: r.w / 2,
        reach: footReach(cls, r.w, r.verge),
      },
    ]
  })

/** `deck`'s surface at the point of its line nearest (x, y), and whether (x, y) lies abeam of that point (not past an end). */
const surfaceOf = (deck: Deck, x: number, y: number) => {
  const { pts, z } = deck
  let best = Infinity,
    level = z[0]!,
    abeam = false
  for (let k = 0; k + 1 < z.length; k++) {
    const ax = pts[2 * k]!,
      ay = pts[2 * k + 1]!,
      bx = pts[2 * k + 2]!,
      by = pts[2 * k + 3]!
    const { d2, t } = segDist2(x, y, ax, ay, bx, by)
    if (d2 >= best) continue
    best = d2
    level = z[k]! + (z[k + 1]! - z[k]!) * t + deck.lift
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2,
      u = l2 > 0 ? ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2 : 0
    abeam = (k > 0 || u >= 0) && (k + 2 < z.length || u <= 1)
  }
  return { level, abeam, d: Math.sqrt(best) }
}

/** A point under `deck`'s slab: where, and its ground's room under the deck's top, m. */
interface Under {
  readonly x: number
  readonly y: number
  readonly ground: number
  readonly room: number
  /** How far along the deck from its nearer end, m. */
  readonly fromEnd: number
}

/**
 * The points under `deck`'s slab every SAMPLE m along and across each segment, by segment, row (along) and column (across), and
 * each one's ground at the terrain's level (`atGrade`).
 */
const underOf = (deck: Deck): Array<Array<Array<Under>>> => {
  const { pts, z } = deck,
    half = deck.half + DECK_SLAB.margin
  const lengths = z
      .slice(1)
      .map((_, k) => Ops.hypot(pts[2 * k + 2]! - pts[2 * k]!, pts[2 * k + 3]! - pts[2 * k + 1]!)),
    total = lengths.reduce((sum, l) => sum + l, 0)
  const out: Array<Array<Array<Under>>> = []
  for (let k = 0, s = 0; k + 1 < z.length; s += lengths[k]!, k++) {
    const ax = pts[2 * k]!,
      ay = pts[2 * k + 1]!,
      len = lengths[k]!
    if (len === 0) continue
    const ux = (pts[2 * k + 2]! - ax) / len,
      uy = (pts[2 * k + 3]! - ay) / len,
      along = Math.ceil(len / SAMPLE),
      across = Math.ceil((2 * half) / SAMPLE)
    const rows: Array<Array<Under>> = []
    for (let a = 0; a <= along; a++) {
      const d = (len * a) / along,
        top = z[k]! + ((z[k + 1]! - z[k]!) * d) / len + deck.lift
      const row: Array<Under> = []
      for (let c = 0; c <= across; c++) {
        const o = -half + (2 * half * c) / across,
          x = ax + ux * d - uy * o,
          y = ay + uy * d + ux * o,
          ground = atGrade(x, y)
        row.push({ x, y, ground, room: top - ground, fromEnd: Math.min(s + d, total - s - d) })
      }
      rows.push(row)
    }
    out.push(rows)
  }
  return out
}

/**
 * Where a walker under `deck` comes up onto it: from each point under its slab with ROOM to stand, on the ground (`onLifted`
 * says where it would stand on another deck instead), clear of the walls it meets there and next to a point with less room (its
 * edge), it walks straight toward the nearest point under the slab whose ground stands within NEAR of the deck's top and
 * IN_FROM_ENDS or more from its ends, STEP m at a time, keeping to its level (`footZ`), until it gets there, a walk wall it meets
 * on its footing stops it (`walkBy`: sliding along one, it would be on another walk, round the wall), or it steps onto another
 * deck (that deck's walls and ends are its own). It comes up onto the deck where its footing turns to the deck's surface at a
 * point abeam of the deck: past either end it is on the road carrying on. The first such walk, or undefined.
 */
const climbOf = (
  deck: Deck,
  onLifted: (p: { readonly x: number; readonly y: number; readonly ground: number }) => boolean,
): string | undefined => {
  const under = underOf(deck)
  const targets = under.flat(2).filter((p) => p.room <= NEAR && p.fromEnd >= IN_FROM_ENDS)
  if (targets.length === 0) return undefined
  for (const rows of under)
    for (let a = 0; a < rows.length; a++)
      for (let c = 0; c < rows[a]!.length; c++) {
        const start = rows[a]![c]!
        if (start.room < ROOM) continue
        let edge = false
        for (let da = -1; da <= 1; da++)
          for (let dc = -1; dc <= 1; dc++) {
            const n = rows[a + da]?.[c + dc]
            if (n !== undefined && n.room < ROOM) edge = true
          }
        if (!edge || onLifted(start) || !standClear(start, start.ground)) continue
        let target = targets[0]!
        for (const t of targets)
          if (Vec2.distanceSquared(t, start) < Vec2.distanceSquared(target, start)) target = t
        let at: Vec2.Vec2 = start,
          footing = start.ground
        const steps = Math.ceil((2 * Vec2.distance(start, target)) / STEP)
        for (let s = 0; s < steps; s++) {
          const way = Vec2.subtract(target, at),
            d = Vec2.length(way)
          if (d < STEP) break
          const moved = walkBy(at, Vec2.scale(way, STEP / d), PERSON_RADIUS, footing)
          at = moved.position
          footing = footZ(at.x, at.y, footing)
          const on = surfaceOf(deck, at.x, at.y)
          // On another deck now, it walks along that one: its own walls and ends are its business.
          if (Math.abs(footing - on.level) >= ON && onLifted({ ...at, ground: footing })) break
          if (on.abeam && on.d <= deck.reach && Math.abs(footing - on.level) < ON)
            return `${deck.name}: a walker ${start.room.toFixed(2)} m under its top at (${start.x.toFixed(2)}, ${start.y.toFixed(2)}) comes up onto it at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}), ${footing.toFixed(2)} m, walking to (${target.x.toFixed(2)}, ${target.y.toFixed(2)})`
          // Stopped by a wall, it stays where it is: going round one is another walk.
          if (moved.blocked) break
        }
      }
  return undefined
}

/**
 * Where a walker under a road deck of `map` (the map loaded) comes up onto it from where there is room to stand on the ground
 * (not on another deck or in a tunnel under it, out of the ground's reach): one line per deck (`climbOf`).
 */
export const deckClimbs = (map: JoinedMap): Array<string> => {
  // Every lifted road's segments out to its walkers' reach, with its surface along them.
  const lifted = segIndex<{ readonly za: number; readonly zb: number }>()
  for (const r of map.roads) {
    if (r.bridge !== true && r.tunnel !== true) continue
    const cls = isRoadClass(r.cls) ? r.cls : "path",
      reach = footReach(cls, r.w, r.verge)
    for (let k = 0; k + 1 < r.z.length; k++)
      lifted.add(r.pts[2 * k]!, r.pts[2 * k + 1]!, r.pts[2 * k + 2]!, r.pts[2 * k + 3]!, reach, {
        za: r.z[k]! + ROAD_LIFT[cls],
        zb: r.z[k + 1]! + ROAD_LIFT[cls],
      })
  }
  const onLifted = (p: { readonly x: number; readonly y: number; readonly ground: number }) => {
    let on = false
    lifted.within(p.x, p.y, ({ data: { za, zb } }, _, t) => {
      if (Math.abs(za + (zb - za) * t - p.ground) < ON) on = true
    })
    return on
  }
  return decksOf(map).flatMap((deck) => climbOf(deck, onLifted) ?? [])
}

/** How far along a road meeting a deck's end the walk and the drive onto it start, and how far onto the deck they run, m. */
const RUN_UP = 6

/** The points of the flat line `pts` from its vertex `k` on, `toward` +1 or −1, as far as `most` m along it. */
const alongFrom = (
  pts: ReadonlyArray<number>,
  k: number,
  toward: 1 | -1,
  most: number,
): Array<Vec2.Vec2> => {
  const out: Array<Vec2.Vec2> = [{ x: pts[2 * k]!, y: pts[2 * k + 1]! }]
  let left = most
  for (let j = k + toward; left > 0 && j >= 0 && 2 * j < pts.length; j += toward) {
    const a = out.at(-1)!,
      b = { x: pts[2 * j]!, y: pts[2 * j + 1]! },
      d = Vec2.distance(a, b)
    out.push(d <= left ? b : Vec2.add(a, Vec2.scale(Vec2.subtract(b, a), left / d)))
    left -= d
  }
  return out
}

/** Points every STEP m or less along the polyline `path`. */
const stepsAlong = (path: ReadonlyArray<Vec2.Vec2>): Array<Vec2.Vec2> =>
  path.slice(1).flatMap((b, k) => {
    const a = path[k]!,
      n = Math.max(1, Math.ceil(Vec2.distance(a, b) / STEP))
    return Array.from({ length: n }, (_, q) =>
      Vec2.add(a, Vec2.scale(Vec2.subtract(b, a), (q + 1) / n)),
    )
  })

/**
 * Where the road at an end of a road deck of `map` (the map loaded) no longer leads onto it: along each road meeting the end (one
 * with a vertex there), from RUN_UP m back along it to RUN_UP m onto the deck, a walker (`walkBy`) and, along a drivable road onto a
 * drivable deck, a Panda (`moveCar`) that keep to their level (`footZ`, `groundZ`), and that with nothing to stop them are on the
 * deck as they cross its end and still at the last, meet a wall with a level on their way: before the walls under the decks only
 * the parapets had one, and they line the deck. A road meeting the deck's end off its level (a profile at odds with the deck's)
 * leads onto it with no wall either, and is left out.
 * One line per deck end.
 */
export const deckEndsShut = (map: JoinedMap): Array<string> => {
  const vertices = new Map<string, Array<readonly [number, number]>>()
  map.roads.forEach((r, i) => {
    for (let k = 0; 2 * k < r.pts.length; k++) {
      const key = `${r.pts[2 * k]},${r.pts[2 * k + 1]}`
      vertices.set(key, [...(vertices.get(key) ?? []), [i, k]])
    }
  })
  return decksOf(map).flatMap((deck) => {
    const n = deck.z.length
    return ([0, n - 1] as const).flatMap((end) => {
      const onto = alongFrom(deck.pts, end, end === 0 ? 1 : -1, RUN_UP)
      const at = `${deck.pts[2 * end]},${deck.pts[2 * end + 1]}`
      const where = `${deck.name}: its ${end === 0 ? "first" : "last"} end, at (${onto[0]!.x.toFixed(1)}, ${onto[0]!.y.toFixed(1)}),`
      const onDeck = (p: Vec2.Vec2, z: number) => Math.abs(surfaceOf(deck, p.x, p.y).level - z) < ON
      for (const [road, k] of vertices.get(at) ?? []) {
        if (road === deck.index) continue
        const { pts, cls } = map.roads[road]!
        for (const toward of [1, -1] as const) {
          if (2 * (k + toward) < 0 || 2 * (k + toward) >= pts.length) continue
          const back = alongFrom(pts, k, toward, RUN_UP).reverse(),
            path = [...back, ...onto.slice(1)],
            steps = stepsAlong(path),
            from = path[0]!,
            // The step that crosses onto the deck's end.
            across = stepsAlong(back).length
          // On foot, where nothing stops the walker on its way and it is on the deck at its end.
          let free = footZ(from.x, from.y),
            onto0 = false
          steps.forEach((p, q) => {
            free = footZ(p.x, p.y, free)
            if (q === across) onto0 = onDeck(p, free)
          })
          if (onto0 && onDeck(steps.at(-1)!, free)) {
            let p: Vec2.Vec2 = from,
              footing = footZ(from.x, from.y)
            for (const q of steps) {
              const step = Vec2.subtract(q, p)
              const walls = wallsAlong(
                "walk",
                p.x,
                p.y,
                step.x,
                step.y,
                PERSON_RADIUS + 0.5,
                footing,
              )
              const moved = moveCircles(
                p,
                [Vec2.zero],
                step,
                PERSON_RADIUS,
                walls.filter((w) => w.level !== undefined),
              )
              if (moved.blocked)
                return [
                  `${where} a walker along ${map.roads[road]!.cls} ${map.roads[road]!.id} meets a wall at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), ${footing.toFixed(2)} m`,
                ]
              p = moved.position
              footing = footZ(p.x, p.y, footing)
            }
          }
          if (!isDrivable(deck.cls) || !isDrivable(cls)) continue
          // By car, likewise.
          let wheelsFree = groundZ(from.x, from.y),
            wheelsOnto = false
          steps.forEach((p, q) => {
            wheelsFree = groundZ(p.x, p.y, wheelsFree)
            if (q === across) wheelsOnto = onDeck(p, wheelsFree)
          })
          if (!wheelsOnto || !onDeck(steps.at(-1)!, wheelsFree)) continue
          let pose = { ...from, angle: 0 },
            wheels = groundZ(from.x, from.y)
          for (const q of steps) {
            const step = Vec2.subtract(q, pose),
              angle = Ops.atan2(step.y, step.x)
            const walls = wallsAlong(
              "drive",
              pose.x,
              pose.y,
              step.x,
              step.y,
              VEHICLES.panda.length / 2 + 0.5,
              wheels,
            )
            const moved = moveCar(
              "panda",
              { ...pose, angle },
              angle,
              step,
              walls.filter((w) => w.level !== undefined),
            )
            if (moved === undefined || moved.blocked)
              return [
                `${where} a Panda along ${map.roads[road]!.cls} ${map.roads[road]!.id} meets a wall at (${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}), its wheels at ${wheels.toFixed(2)} m`,
              ]
            pose = { ...moved.position, angle }
            wheels = groundZ(pose.x, pose.y, wheels)
          }
        }
      }
      return []
    })
  })
}
