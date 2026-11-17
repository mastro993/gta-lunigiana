// Issue #13's checks of the shore on the coast test region (`magra-coast`, region.ts) as built: the
// beaches free of walk walls, the piers walked from the beach or the quay, the breakwaters and
// groynes walled for vehicles but not for walkers, no parked car or tree on the sand or in the
// sea, the coast's places named, and its outline closed, read through the game's own lookups. This
// process loads the coast (`useDiskMap`) from test-maps/, which `pnpm maps` builds; without the
// build every check here is skipped, but in CI, which builds it, a missing build fails.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { Vec2 } from "@typeonce/ritmo-math"

import { MEAN } from "../../sim/__tests__/flows.ts"
import { useDiskMap } from "../../sim/map/source.ts"
import { segDist2, segIndex } from "../geometry.ts"
import { readWholeMap } from "../map-file.ts"
import { inAreas, inWater } from "../water-areas.ts"
import { intoSea } from "./coast-map.ts"
import { assertOutlineWalls, edgesOf, walkFlood } from "./outline-checks.ts"
import { skipUnbuilt, TEST_MAPS } from "./test-maps.ts"

const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const sim = skip === false ? await import("../../sim/map/index.ts") : undefined
const ground = skip === false ? await import("../../sim/map/ground.ts") : undefined
const cover = skip === false ? await import("../../sim/map/cover.ts") : undefined
const rivers = skip === false ? await import("../../sim/water/rivers.ts") : undefined
const body = skip === false ? await import("../../sim/body.ts") : undefined
const footing = skip === false ? await import("../../sim/footing.ts") : undefined
/** The coast whole: its walls, trees, land cover and vectors joined back from its tiles. */
const WHOLE = skip === false ? readWholeMap(URL_COAST) : undefined

test(
  "beaches: no walk wall stands on the sand but a house's or a wall's, so nothing of the ground (a slope, the sea's edge) shuts a beach",
  { skip },
  () => {
    const { cell, cols, rows, x0, y0 } = WHOLE!.heightmap
    const { coverName } = cover!
    // The houses' outlines, traced on a finer raster and simplified (walls.ts), and the barriers'
    // lines, as lookups of what lies within their walls' reach.
    const made = segIndex<null>()
    for (const { outer, holes } of WHOLE!.buildings)
      for (const ring of [outer, ...(holes ?? [])])
        made.addLine([...ring, ring[0]!, ring[1]!], 2, null)
    for (const { kind, pts } of WHOLE!.barriers) if (kind === "wall") made.addLine(pts, 0.5, null)
    const sand = Array.from({ length: 256 }, (_, v) => v).find((v) => coverName(v) === "sand")
    const onSand = (x: number, y: number) => {
      const i = Math.floor((x - x0) / cell),
        j = Math.floor((y - y0) / cell)
      return (
        i >= 0 &&
        j >= 0 &&
        i < cols - 1 &&
        j < rows - 1 &&
        WHOLE!.cover[j * (cols - 1) + i] === sand
      )
    }
    const walls = WHOLE!.walls.walk
    let over = 0
    for (let w = 0; w < walls.length; w += 4) {
      const ax = walls[w]!,
        ay = walls[w + 1]!,
        bx = walls[w + 2]!,
        by = walls[w + 3]!,
        n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
      // Every metre along it, and its ends.
      const pts = Array.from({ length: n + 1 }, (_, q) => [
        ax + ((bx - ax) * q) / n,
        ay + ((by - ay) * q) / n,
      ])
      if (!pts.some(([x, y]) => onSand(x!, y!))) continue
      over++
      assert.ok(
        pts.every(([x, y]) => made.covers(x!, y!)),
        `the walk wall ${ax}, ${ay} to ${bx}, ${by} stands on the sand`,
      )
    }
    // 921 walls over sand cells: 915 the beach houses', 6 a wall's (measured 2026-11-17)
    assert.ok(over > 500, `${over} walls over the sand`)
  },
)

/** A walker's step, m: about what `FindFooting` sees it move in one step at a walk. */
const STEP = 0.05
/**
 * A pier's end is on dry ground, on the beach or the quay, when the ground this far past it lies
 * out of the water areas, m (`PAST_END` in shore.ts, which stands it on that ground).
 */
const PAST = 0.5
/** A pier's walker starts this far past its landward end, m: on the ground, off the deck's verges (`footReach`). */
const RUN_UP = 2
/** A footing this near a deck's surface (m) is on it. */
const ON = 0.02
/** A walk toward a pier's end on the play area's outline stops this short of it (m), before the outline's walls. */
const SHORT = 1

test(
  "piers: from the dry ground at each pier's landward end (on the beach or the quay) the game's walker steps onto its deck and walks it to its far end, no wall between, and on along every pier that meets it",
  { skip },
  () => {
    const { inPlay, outlineDistance } = sim!
    const { footZ, roadLevel } = ground!
    const { walkBy } = body!
    const { settleFooting } = footing!
    // In the sea's pieces, a lake or a river polygon.
    const water = inWater(WHOLE!.areas)
    // Every path deck over the water: the piers (shore.ts cuts each where it leaves the water).
    const piers = WHOLE!.roads.flatMap((r, index) => {
      if (r.bridge !== true || r.cls !== "path") return []
      const n = r.pts.length / 2,
        wet = Array.from({ length: n - 1 }, (_, k) =>
          water(
            (r.pts[2 * k]! + r.pts[2 * k + 2]!) / 2,
            (r.pts[2 * k + 1]! + r.pts[2 * k + 3]!) / 2,
          ),
        )
      return wet.some(Boolean) ? [{ index, id: r.id, pts: r.pts, n }] : []
    })
    type Pier = (typeof piers)[number]
    const vertex = (p: Pier, k: number): Vec2.Vec2 => ({ x: p.pts[2 * k]!, y: p.pts[2 * k + 1]! })
    /**
     * The walker from `from` (its footing `z`) to `p`'s vertices `path` in turn, a STEP at a time
     * (`walkBy` with the walk walls on its level, `settleFooting`): it must never be stopped and, from
     * `onFrom` m on, stand on the deck. A last vertex on the play area's outline it walks to SHORT
     * of it, clear of the outline's walls.
     */
    const walk = (
      p: Pier,
      from: Vec2.Vec2,
      z: number,
      path: ReadonlyArray<number>,
      onFrom: number,
    ) => {
      const targets = path.map((k) => vertex(p, k)),
        last = targets.at(-1)!,
        before = targets.at(-2) ?? from
      if (outlineDistance(last.x, last.y) < SHORT) {
        const len = Math.hypot(last.x - before.x, last.y - before.y)
        targets[targets.length - 1] = {
          x: last.x + ((before.x - last.x) / len) * SHORT,
          y: last.y + ((before.y - last.y) / len) * SHORT,
        }
      }
      let at = from,
        walked = 0
      for (const to of targets)
        for (;;) {
          const dx = to.x - at.x,
            dy = to.y - at.y,
            d = Math.hypot(dx, dy)
          if (d < 1e-6) break
          const s = Math.min(STEP, d),
            moved = walkBy(at, { x: (dx / d) * s, y: (dy / d) * s }, undefined, z)
          assert.ok(
            !moved.blocked,
            `pier ${p.id}: a wall stops the walker at ${at.x.toFixed(1)}, ${at.y.toFixed(1)}`,
          )
          at = moved.position
          z = settleFooting(at.x, at.y, z)
          walked += s
          const deck = roadLevel(p.index, at.x, at.y)!
          assert.ok(
            walked < onFrom || Math.abs(z - deck) < ON,
            `pier ${p.id}: the walker at ${at.x.toFixed(1)}, ${at.y.toFixed(1)} stands at ${z.toFixed(2)} m, off its deck's ${deck.toFixed(2)}`,
          )
        }
    }
    const walked = new Set<Pier>()
    let landward = 0
    for (const p of piers)
      for (const [end, next] of [
        [0, 1],
        [p.n - 1, p.n - 2],
      ] as const) {
        const e = vertex(p, end),
          u = vertex(p, next),
          len = Math.hypot(e.x - u.x, e.y - u.y),
          path =
            end === 0
              ? Array.from({ length: p.n }, (_, k) => k)
              : Array.from({ length: p.n }, (_, k) => p.n - 1 - k)
        // An end the outline cuts leads on beyond the play area: the walker starts on the deck there.
        if (outlineDistance(e.x, e.y) < SHORT) {
          const at = { x: e.x + ((u.x - e.x) / len) * SHORT, y: e.y + ((u.y - e.y) / len) * SHORT }
          walk(p, at, roadLevel(p.index, at.x, at.y)!, path.slice(1), 0)
          walked.add(p)
          continue
        }
        const past = (by: number) => ({
            x: e.x + ((e.x - u.x) / len) * by,
            y: e.y + ((e.y - u.y) / len) * by,
          }),
          start = past(RUN_UP)
        if ([past(PAST), start].some((q) => water(q.x, q.y)) || !inPlay(start.x, start.y, SHORT))
          continue
        landward++
        walk(p, start, footZ(start.x, start.y), path, RUN_UP + 0.5)
        walked.add(p)
      }
    // A pier with no landward end (a pontoon in a marina) is walked on from where a pier walked
    // meets it, standing on its deck there, to each of its ends.
    for (let more = true; more;) {
      more = false
      for (const p of piers) {
        if (walked.has(p)) continue
        const k = Array.from({ length: p.n }, (_, k) => k).find((k) => {
          const v = vertex(p, k)
          return [...walked].some((q) =>
            Array.from({ length: q.n }, (_, m) => vertex(q, m)).some(
              (w) => w.x === v.x && w.y === v.y,
            ),
          )
        })
        if (k === undefined) continue
        const at = vertex(p, k)
        for (const path of [
          Array.from({ length: k }, (_, m) => k - 1 - m),
          Array.from({ length: p.n - 1 - k }, (_, m) => k + 1 + m),
        ])
          if (path.length > 0) walk(p, at, roadLevel(p.index, at.x, at.y)!, path, 0)
        walked.add(p)
        more = true
      }
    }
    assert.deepEqual(
      piers.filter((p) => !walked.has(p)).map((p) => p.id),
      [],
      "piers no walker reaches",
    )
    // 14 piers' decks, 10 landward ends and 2 the outline cuts (measured 2026-11-17)
    assert.ok(
      piers.length >= 10 && landward >= 8,
      `${piers.length} piers, ${landward} landward ends`,
    )
  },
)

test(
  "breakwaters and groynes: a drive wall all along their outline keeps vehicles off, and a walker crosses it, but where a tree or a house stands on it",
  { skip },
  () => {
    const { inPlay, treesIn, wallsNear } = sim!
    const { footZ } = ground!
    const { walkBy } = body!
    const { settleFooting } = footing!
    const houses = segIndex<null>()
    for (const { outer } of WHOLE!.buildings)
      houses.addLine([...outer, outer[0]!, outer[1]!], 1.5, null)
    const outlines = WHOLE!.barriers.filter((b) => b.kind === "breakwater")
    let samples = 0,
      kept = 0
    for (const { pts } of outlines)
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k]!,
          ay = pts[k + 1]!,
          len = Math.hypot(pts[k + 2]! - ax, pts[k + 3]! - ay),
          ux = (pts[k + 2]! - ax) / len,
          uy = (pts[k + 3]! - ay) / len
        // Every 4 m along each side, in play.
        for (let d = 1; d < len; d += 4) {
          const x = ax + ux * d,
            y = ay + uy * d
          if (!inPlay(x, y, 2)) continue
          samples++
          assert.ok(
            wallsNear("drive", x - 0.5, y - 0.5, x + 0.5, y + 0.5).some(
              (w) => segDist2(x, y, w.ax, w.ay, w.bx, w.by).d2 <= 0.15 * 0.15,
            ),
            `no drive wall on the breakwater at ${x.toFixed(1)}, ${y.toFixed(1)}`,
          )
          // Across it, from 1.5 m on one side to 1.5 m on the other: stopped only by a tree's
          // trunk or a house's walls.
          let at = { x: x + uy * 1.5, y: y - ux * 1.5 },
            z = footZ(at.x, at.y)
          for (let s = 0; s < 3 / STEP; s++) {
            const moved = walkBy(at, { x: -uy * STEP, y: ux * STEP }, undefined, z)
            if (moved.blocked) {
              let tree = false
              treesIn(x - 1.5, y - 1.5, x + 1.5, y + 1.5, () => (tree = true))
              assert.ok(
                tree || houses.covers(x, y),
                `a wall stops a walker crossing the breakwater at ${x.toFixed(1)}, ${y.toFixed(1)}`,
              )
              kept++
              break
            }
            at = moved.position
            z = settleFooting(at.x, at.y, z)
          }
        }
      }
    // 20 outlines, 846 places along them, 2 stopped by a tree or a house (measured 2026-11-17)
    assert.ok(
      outlines.length >= 15 && samples > 600,
      `${outlines.length} outlines, ${samples} places`,
    )
    assert.ok(kept < samples / 50, `${kept} places stopped by a tree or a house`)
  },
)

/**
 * How far into an area a tree may stand, m: the scatter reads the area's 2 m mask pixel under a
 * point, whose centre lies out of it (the point √2 m in at most), then rounds the point to the
 * metre (√0.5 m more), as olives.map-test.ts allows past a grove's outline.
 */
const TREE_REACH = Math.SQRT2 + Math.SQRT1_2

test(
  "no parked car stands on the sand or in the water, and no tree in a sand or sea area farther in than its mask's reach",
  { skip },
  () => {
    const { MAP } = sim!
    const { atGrade } = ground!
    const { coverAt } = cover!
    const { waterAt } = rivers!
    for (const { x, y } of MAP.spawns.parked) {
      const on = coverAt(x, y)
      assert.ok(on !== "sand" && on !== "sea", `the parked spot at ${x}, ${y} is on ${on}`)
      assert.equal(
        waterAt(x, y, atGrade(x, y), MEAN),
        undefined,
        `the parked spot at ${x}, ${y} is in the water`,
      )
    }
    const open = (kind: string) => kind === "sand" || kind === "sea",
      inOpen = inAreas(WHOLE!.areas, open)
    const edges = segIndex<null>()
    for (const { kind, rings } of WHOLE!.areas)
      if (open(kind)) for (const r of rings) edges.addLine([...r, r[0]!, r[1]!], TREE_REACH, null)
    const { trees } = WHOLE!
    let checked = 0
    for (let k = 0; k < trees.length; k += 3) {
      const x = trees[k]!,
        y = trees[k + 1]!
      checked++
      assert.ok(
        !inOpen(x, y) || edges.covers(x, y),
        `the tree at ${x}, ${y} stands in the sand or the sea`,
      )
    }
    // 538 parked spots and 91,376 trees (measured 2026-11-17)
    assert.ok(MAP.spawns.parked.length > 400 && checked > 80_000, `${checked} trees`)
  },
)

test(
  "the coast's places: its five villages and Punta Bianca name their own districts, and the Magra's mouth is the Foce del Magra",
  { skip },
  () => {
    const { MAP, districtAt } = sim!
    const villages = MAP.pois.filter((p) => p.kind === "place=village")
    assert.deepEqual(
      villages.map((p) => p.name ?? "").sort((a, b) => a.localeCompare(b)),
      ["Bocca di Magra", "Fiumaretta", "Luni Mare", "Marinella di Sarzana", "Montemarcello"],
    )
    for (const p of villages) assert.equal(districtAt(p.x, p.y).name, p.name)
    const tip = MAP.pois.find((p) => p.kind === "place=locality" && p.name === "Punta Bianca")!
    assert.equal(districtAt(tip.x, tip.y).name, "Punta Bianca")
    // The Magra's last vertex, where it meets the sea.
    const magra = intoSea(WHOLE!).find((w) => w.name === "Fiume Magra")!
    assert.equal(districtAt(magra.pts.at(-2)!, magra.pts.at(-1)!).name, "Foce del Magra")
  },
)

/** The flood's cell side, m: the coast's outline edges lie on whole kilometres, between two cells' centres, and 4 m keeps the flood over its 24 km² under a second. */
const FLOOD = 4

test(
  "the coast's outline: its walls, walk and drive, run end to end along every edge, the sea's too, and a walker's flood from the start never leaves the play area and reaches every edge",
  { skip },
  () => {
    const { MAP, inPlay, wallsNear } = sim!
    assert.equal(MAP.outline.length, 1, "one ring")
    const edges = edgesOf(MAP.outline[0]!)
    assertOutlineWalls(WHOLE!.walls, edges, wallsNear)
    const { reached, near } = walkFlood({
      bounds: MAP.bounds,
      start: MAP.spawns.player,
      edges,
      wallsNear,
      inPlay,
      step: FLOOD,
    })
    // 24 km², 11.1 of them sea: the flood swims it and walks most of the land, 23.0 km² (measured 2026-11-17)
    assert.ok(reached * FLOOD * FLOOD > 18e6, `${reached} cells reached`)
    assert.deepEqual(
      near,
      edges.map((_, k) => k),
    )
  },
)
