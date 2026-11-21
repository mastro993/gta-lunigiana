// The water's checks over the whole of Lunigiana's map: each river's width and bed by reach, its
// catchment along its course and from beyond the box's edge, and the walls by the water.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { pointInRing as inRing } from "../../../tools/geometry.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { PARTS } from "../../../tools/region.ts"
import { PERCH } from "../../../tools/water.ts"
import { MEAN } from "../../__tests__/flows.ts"
import { meets } from "../../body.ts"
import { fillPolygon, segDist2, segmentDistance } from "../../collide.ts"
import { SEA_LEVEL, STAGE } from "../../water/channel.ts"
import { waterIndex } from "../../water/rivers.ts"
import { terrainZ } from "../ground.ts"
import { MAP, outlineDistance, wallsNear } from "../index.ts"
import { isWaterArea } from "../kinds.ts"

/** The dense layers and the vectors live in the tiles: these checks read them all, joined in the whole map's order. */
const WHOLE = wholeMap()

test("water: the Lucido is 8 m on the valley floor and 4 m above Vinca", () => {
  const w = (id: number) => WHOLE.water.find((o) => o.id === id)?.w
  assert.deepEqual([w(254825035), w(140780317), w(696231807), w(687230881)], [8, 4, 8, 14])
})

// Issue #17: the Aulella's valley row keeps lucido's ways; its gorge above the Tassonaro's mouth, the
// Rosaro above Fivizzano and the Mommio below 775 m are wooded torrents; the Rosaro's river part has
// its own bed; their heads are named streams. Issue #18: below the Lombardello's mouth the Bardine
// runs in its valley bed; from the Bardinello's mouth, and the Bardinello below the Pesciola's, they
// run in the Rosaro's bed; up to the Caldia's mouth the Bardinello is a wooded torrent, and so is the
// Pesciola, all its course. Each pair is the two ways either side of a threshold of water-sizes.ts,
// with its mean ground.
test("water: the Aulella, Rosaro, Mommio, Bardine, Bardinello and Pesciola take their measured widths by reach", () => {
  const w = (id: number) => WHOLE.water.find((o) => o.id === id)?.w
  // Aulella: lucido's 788520105 (205 m), the gorge's 788514364 (294 m), the head's 788514391 (363 m).
  assert.deepEqual([w(788520105), w(788514364), w(788514391)], [12, 6, 4])
  // Rosaro: its river part 687230888, a stream above Fivizzano 790403608.
  assert.deepEqual([w(687230888), w(790403608)], [7, 6])
  // Mommio: 788514606 (303 m) and 788514696 (766 m) wooded, 788514702 (782 m) a named stream.
  assert.deepEqual([w(788514606), w(788514696), w(788514702)], [6, 6, 4])
  // Bardine: 790365291 (88 m) above the Lombardello's mouth, 790365292 (82 m) below it.
  assert.deepEqual([w(790365291), w(790365292)], [7, 12])
  // Bardine: 797861302 (141 m) below the Bardinello's mouth, its head 797861301 (150 m).
  assert.deepEqual([w(797861302), w(797861301)], [7, 4])
  // Bardinello: 797861257 (150 m) below the Pesciola's mouth, 797861254 (157 m) above it.
  assert.deepEqual([w(797861257), w(797861254)], [7, 6])
  // Bardinello: 797860930 (266 m) below the Caldia's mouth, 797860907 (269 m) above it.
  assert.deepEqual([w(797860930), w(797860907)], [6, 4])
  // Regression: the Pesciola, the larger branch where it joins the Bardinello (18 km² to its 15),
  // was a named stream's 4 m: its head 797860953 (234 m, 8.9 km²) and its last way 797861233 (158 m).
  assert.deepEqual([w(797860953), w(797861233)], [6, 6])
})

// Issue #19: the Taverone runs in the Rosaro's bed all its course on the map; the Osca and the
// Penolo are named streams down to a tributary's mouth, wooded torrents down to their gravel fans,
// and fans to the Magra; the Aulella keeps its valley bed down to Aulla; the Magra's line takes its
// water's width. Each pair is the two ways either side of a threshold of water-sizes.ts, with its mean
// ground; a fan is told from a named stream by its bed.
test("water: the Taverone, the Osca, the Penolo, the lower Aulella and the Magra take their measured widths by reach", () => {
  const size = (id: number) => {
    const o = WHOLE.water.find((v) => v.id === id)
    return [o?.w, o?.bed]
  }
  // Taverone: 700556145 (141 m) from the map's north edge, 1161664524 (65 m) to the Magra.
  assert.deepEqual(
    [size(700556145), size(1161664524)],
    [
      [7, 7],
      [7, 7],
    ],
  )
  // Osca: 789355154 (269.3 m) above the Canale di Borra Grande's mouth, 789355149 (253.5 m) below.
  assert.deepEqual(
    [size(789355154), size(789355149)],
    [
      [4, 3],
      [6, 4],
    ],
  )
  // Osca: 789355086 (110.9 m) its last in the woods, 789355090 (109.0 m) its first on the fan.
  assert.deepEqual(
    [size(789355086), size(789355090)],
    [
      [6, 4],
      [4, 13],
    ],
  )
  // Penolo: 789354800 (204.3 m) above an unnamed stream's mouth, 789354799 (199.3 m) below it.
  assert.deepEqual(
    [size(789354800), size(789354799)],
    [
      [4, 3],
      [6, 4],
    ],
  )
  // Penolo: 789355011 (95.8 m) its last rocky way, 789354987 (89.6 m) its first on the fan.
  assert.deepEqual(
    [size(789355011), size(789354987)],
    [
      [6, 4],
      [4, 13],
    ],
  )
  // The Aulella's last way 172808472 (79.7 m) and the Magra's 86161807.
  assert.deepEqual(
    [size(172808472), size(86161807)],
    [
      [12, 13],
      [25, 13.5],
    ],
  )
})

// Issue #20: the Vara's line runs in its river polygons all its course on the map and takes the
// Magra's water; the Amola is a named stream in its hills, a fan across the plain and a named stream
// again in its banked channel to the Magra; the Durasca is a wooded torrent; the Canale Lunense is
// 5 m all its course. Each pair is the two ways either side of a threshold of water-sizes.ts, with
// its mean ground.
test("water: the Vara, the Amola, the Durasca and the Canale Lunense take their measured widths by reach", () => {
  const size = (id: number) => {
    const o = WHOLE.water.find((v) => v.id === id)
    return [o?.w, o?.bed]
  }
  // Vara: 135716629, from the play area's north edge to Fornola.
  assert.deepEqual(size(135716629), [25, 13.5])
  // Amola: 206634001 (117.7 m) from its source to the foot of its hills, 917637857 (36.9 m) its
  // first on the fan.
  assert.deepEqual(
    [size(206634001), size(917637857)],
    [
      [4, 3],
      [4, 13],
    ],
  )
  // Amola: 238383122 (29.3 m) its last on the fan, 238383121 (14.6 m) its channel to the Magra.
  assert.deepEqual(
    [size(238383122), size(238383121)],
    [
      [4, 13],
      [4, 3],
    ],
  )
  // Durasca: 157849907, its one way on the map, 11.0 km² across the west edge.
  assert.deepEqual(size(157849907), [6, 4])
  // Canale Lunense: 206635895 by Albiano, 843063273 above Sarzana.
  assert.deepEqual(
    [size(206635895), size(843063273)],
    [
      [5, 3.5],
      [5, 3.5],
    ],
  )
})

test("water: catchments grow downstream; the Lucido drains 47 km² where it meets the Aulella, the Rosaro brings its 14.7 km² of heads, the Aulella drains 199 at Fivizzano's west edge and 313 at its mouth, the Bardine 65 at its", () => {
  for (const w of WHOLE.water)
    w.area.forEach((a, k) =>
      assert.ok(k === 0 || a >= w.area[k - 1]!, `water ${w.id} shrinks at ${k}`),
    )
  // Regression: a tributary's mouth read the receiving river's node, so a trickle's last vertex took
  // the river's 45 km². A jump over the last segment is that fault where the water it joins reads
  // as much there or more (none joined, it reads 0); one it reads less than can be no area of its,
  // but a D8 path crossing the last segment on a plain: the ditch 812989995 by Santo Stefano di Magra
  // gathers 1.47 km² 86 m before its end, on a last segment of 105 m, where the ditch 896202894 it
  // joins reads 0.
  const joined = new Map<string, number>()
  for (const w of WHOLE.water)
    for (let k = 0; k + 1 < w.area.length; k++) {
      const key = `${w.pts[2 * k]},${w.pts[2 * k + 1]}`
      joined.set(key, Math.max(joined.get(key) ?? 0, w.area[k]!))
    }
  for (const w of WHOLE.water) {
    const [before, mouth] = w.area.slice(-2)
    const receiver = joined.get(`${w.pts.at(-2)},${w.pts.at(-1)}`) ?? 0
    if (before !== undefined)
      assert.ok(
        mouth! <= 1.5 * before + 1 || receiver < mouth!,
        `water ${w.id}: ${before} km² jumps to ${mouth} at its mouth, the water it joins ${receiver}`,
      )
  }
  const lucido = WHOLE.water.filter((w) => w.name === "Torrente Lucido" && w.kind === "river")
  const mouth = Math.max(...lucido.map((w) => w.area.at(-1)!))
  assert.ok(Math.abs(mouth - 47) < 2, `the Lucido drains ${mouth} km²`)
  // Regression: the Rosaro's heads beyond y 13000 were sized as the Soliera gauge's 208 km² less
  // what the map's D8 gathers, 26.2 km², near twice the 14.7 a D8 on the MS 10 m DTM gives them.
  const head = Math.max(
    ...WHOLE.water
      .filter((w) => w.name === "Torrente Rosaro")
      .flatMap((w) => w.area.filter((_, k) => w.pts[2 * k + 1]! > 12900)),
  )
  assert.ok(Math.abs(head - 14.7) < 0.5, `the Rosaro brings ${head} km² in`)
  // ARPAL gives the gauge 208 km²; the DTMs' own basins are smaller (the MS 10 m DTM's 200.7 at
  // Soliera), and the map's ground and the Rosaro's heads give 196.8 there, and 199 where it crosses
  // Fivizzano's west edge, by which it left the play area before Aulla's part (issue #19).
  const aulella = WHOLE.water.filter((w) => w.name === "Torrente Aulella")
  const seam = PARTS.find((p) => p.key === "fivizzano")!.rects[0]![0]
  const crossing = Math.max(
    ...aulella.flatMap((w) =>
      w.area.filter((_, k) => k > 0 && w.pts[2 * k - 2]! >= seam && w.pts[2 * k]! < seam),
    ),
  )
  assert.ok(Math.abs(crossing - 199) < 3, `the Aulella crosses x ${seam} with ${crossing} km²`)
  // A D8 on the MS 10 m DTM gives it 319.3 km² 100 m above its mouth in the Magra at Aulla, and
  // 200.7 at Soliera: the map reads 1.9 % under it at both (313.1 and 196.8), so the gap is the 4 m
  // grid's divides against the 10 m DTM's, grown with the basin, not a tributary lost on the way.
  const atMagra = Math.max(...aulella.map((w) => w.area.at(-1)!))
  assert.ok(Math.abs(atMagra - 313) < 3, `the Aulella meets the Magra with ${atMagra} km²`)
  // Regression: fosdinovo's north edge cut the Bardine 100 m short of the notch, and its basin
  // drained out up the Canale del Torchio to the box's west edge: the Bardine left with 117.3 km²,
  // its own 58.1 twice and the Torchio's 0.8 (issue #18). It left with 59.0; whole to its mouth in
  // the Aulella (Aulla's part, issue #19), it gains its last 0.4 km of valley and the heads of the
  // Canale del Torchio, the Fosso Acqua Chiara and the Fosso di Faeta west of x −11500, which the
  // grown box holds. Sarzana's part (issue #20) brings the ground west of x −11500 south of y 3900, a
  // notch before whose outlet drained the ground beside it, and the Bardine 2.3 km² of its heads.
  const bardine = Math.max(
    ...WHOLE.water.filter((w) => w.name === "Torrente Bardine").map((w) => w.area.at(-1)!),
  )
  assert.ok(Math.abs(bardine - 65.3) < 2, `the Bardine meets the Aulella with ${bardine} km²`)
  // Regression: fivizzano's west edge cut the Aulella 700 m short of the notch, the fill made its
  // trench a lake for 10 km, and D8 ran the river across it down a 2 m side stream by Soliera (way
  // 140780331, 108.5 km²) and, by Gragnola, Il Canalaccio (55.4); the Torchio drained the Bardine's
  // 59.2 out to the box's west edge.
  const most = (keep: (w: (typeof WHOLE.water)[number]) => boolean) =>
    Math.max(...WHOLE.water.filter(keep).flatMap((w) => w.area))
  assert.ok(most((w) => w.id === 140780331) < 1, "the side stream by Soliera")
  assert.ok(most((w) => w.name === "Il Canalaccio") < 6, "Il Canalaccio")
  // Loosened from 2: the Torchio's head and the Fosso Acqua Chiara's west of x −11500, 1.6 km² the
  // grown box brought in with Aulla's part, take it from 0.82 to 2.45, and the notch south of it,
  // ground since Sarzana's part, to 4.39: still far from the Bardine's.
  assert.ok(most((w) => w.name === "Canale del Torchio") < 5, "the Canale del Torchio")
})

/** The pieces of the water named `name`. */
const named = (name: string) => WHOLE.water.filter((w) => w.name === name)

/** The most the pieces of `name` read where they cross y = `y` southward, km². */
const crossing = (name: string, y: number) =>
  Math.max(
    ...named(name).flatMap((w) =>
      w.area.filter((_, k) => k > 0 && w.pts[2 * k - 1]! > y && w.pts[2 * k + 1]! <= y),
    ),
  )

// Regression: the Magra and the Taverone came in over the box's north edge with nothing, so the
// Magra left the play area with 412.6 km² and the Taverone met it with 33.9 (issue #19).
test("water: the Magra and the Taverone bring their heads beyond y 13000; the Taverone drains 82 km² 1.3 km above its mouth, the Magra 915 at y 3900", () => {
  /** The piece of `name` that comes in over the box's north edge. */
  const entering = (name: string) => named(name).find((w) => w.pts[1] === MAP.bounds.maxY)!
  /** What `w` reads at its first vertex 12 m inside the edge, where the build adds its heads (D8 drains no edge node). */
  const brings = (w: (typeof WHOLE.water)[number]) =>
    w.area[w.area.findIndex((_, k) => w.pts[2 * k + 1]! < MAP.bounds.maxY - 12)]!
  // A D8 on the MS 10 m DTM over the ground north of the edge (build-terrain.ts's OFF_MAP).
  const magra = brings(entering("Fiume Magra")),
    taverone = entering("Torrente Taverone")
  assert.ok(Math.abs(magra - 420.9) < 0.5, `the Magra brings ${magra} km²`)
  assert.ok(Math.abs(brings(taverone) - 69.1) < 0.5, `the Taverone brings ${brings(taverone)}`)
  // The 10 m DTM's D8 gives 86.7 km² where its way from the edge ends: the map's 4 m grid drains
  // 3.4 km² of the land by its entry out across the box's edge, which on the DTM comes back in with it.
  assert.ok(
    Math.abs(taverone.area.at(-1)! - 82.5) < 3,
    `the Taverone drains ${taverone.area.at(-1)} km² 1.3 km above its mouth`,
  )
  // The 10 m DTM's D8 gives 930.5 km² at y 3900, where the Magra left the play area before
  // Sarzana's part made it a seam (issue #20; the gauge at Calamazza, a little downstream, 932 by
  // sources not checked): the map leaves out 4.9 km² of rivulets beyond the edge and loses the 6.8
  // that leave the box and come back, as by the Taverone's entry.
  const seam = crossing("Fiume Magra", 3900)
  assert.ok(Math.abs(seam - 915) < 5, `the Magra crosses y 3900 with ${seam} km²`)
})

type Piece = (typeof WHOLE.water)[number]

/** The vertex of `w` at (x, y), −1 where none is. */
const vertexAt = (w: Piece, x: number, y: number) =>
  w.z.findIndex((_, k) => w.pts[2 * k] === x && w.pts[2 * k + 1] === y)

/** Where the Vara meets the Magra at Fornola: its last piece, ending on vertex `k` of the Magra's `into`. */
const fornola = () => {
  const ends = named("Fiume Vara").flatMap((mouth) =>
    named("Fiume Magra").flatMap((into) => {
      const k = vertexAt(into, mouth.pts.at(-2)!, mouth.pts.at(-1)!)
      return k > 0 ? [{ mouth, into, k }] : []
    }),
  )
  assert.equal(ends.length, 1, "the Vara meets the Magra once")
  return ends[0]!
}

// Issue #20: the Vara comes in from beyond the box's west edge (build-terrain.ts's OFF_MAP) and
// meets the Magra at Fornola, which leaves the play area across the box's south edge at y −8500,
// 4.8 km above its mouth, where it left the box at y 3900 before.
test("water: the Vara brings its 552 km² over the west edge and meets the Magra with 603; the Magra leaves the play area at y −8500 with 1,619 of its 1,700", () => {
  // The Vara's first piece starts where the play area's outline cuts it, inside the box: the
  // 552.4 km² a D8 on Liguria's DTM gives it at the box's edge, and the ground in between.
  const first = named("Fiume Vara").find((w) => outlineDistance(w.pts[0]!, w.pts[1]!) < 1)
  assert.ok(first !== undefined, "a piece of the Vara starts on the play area's outline")
  assert.ok(Math.abs(first.area[0]! - 552.4) < 2, `the Vara brings ${first.area[0]} km²`)
  // The Autorità di bacino del Magra's PGRA gives the Vara about 600 km² at the Magra, and the
  // D8 on Liguria's DTM 605.6: its last piece ends on a vertex of the Magra's, which adds it.
  const { mouth, into, k } = fornola()
  const varaIn = mouth.area.at(-1)!
  assert.ok(Math.abs(varaIn - 605.6) < 5, `the Vara meets the Magra with ${varaIn} km²`)
  assert.ok(
    Math.abs(into.area[k + 1]! - (into.area[k - 1]! + varaIn)) < 1,
    `the Magra ${into.area[k - 1]} km² above Fornola, ${into.area[k + 1]} below`,
  )
  // The Autorità di bacino gives the Magra about 1,700 km² at its mouth, 1,000 of them Tuscan and
  // 700 Ligurian (the Vara's and the lower Magra's). The box's south edge cuts it 4.8 km above its
  // mouth, and the coast test region's own ground below y −11000 brings 6.06 km² to it there: the
  // map reads 4.8 % under the basin, as it reads the Magra 1.3 % under the 10 m DTM's D8 at y 3900
  // and leaves out the rivulets beyond the north edge.
  const out = crossing("Fiume Magra", MAP.bounds.minY)
  assert.ok(
    Math.abs(out - 1618.8) < 5 && out < 1700,
    `the Magra leaves the play area with ${out} km²`,
  )
})

/** How far round Fornola the confluence's water is read, m: the plain from Ceparana to Santo Stefano di Magra and Arcola. */
const CONFLUENCE = 3000

// Issue #20's acceptance: the Vara meets the Magra on a plain at 2–10 m (Liguria's DTM, whole
// metres the build's unround smooths), where the water falls a few decimetres a kilometre.
// Regression: a braid of the Vara at (−21347, 1960), rejoining it over the end of the way it
// continues, stood 0.5 m over its first vertex (24.9 m after 24.4).
test("water: the Vara–Magra confluence at Fornola is monotone, each water meeting the one it joins at its level, with no perched water", () => {
  const { mouth, into, k } = fornola()
  assert.equal(mouth.z.at(-1), into.z[k], "the Vara meets the Magra at its level")
  const cx = into.pts[2 * k]!,
    cy = into.pts[2 * k + 1]!
  const round = (x: number, y: number) => Ops.hypot(x - cx, y - cy) <= CONFLUENCE
  // The water round it, and the Vara's down its whole course in the box, its braids too.
  const here = WHOLE.water.filter(
    (w) => w.name === "Fiume Vara" || w.z.some((_, v) => round(w.pts[2 * v]!, w.pts[2 * v + 1]!)),
  )
  // Perched is the build's rule (`dropPerched` in tools/water.ts): a surface more than PERCH over
  // its bed's top, where it runs on the plain's own ground. In a river polygon or a lake their carve
  // sets the ground under it, and a vertex in a wider water's channel is that water's.
  const areas = WHOLE.areas.filter((a) => isWaterArea(a.kind))
  const onPlain = (w: Piece, x: number, y: number) =>
    !areas.some((a) => a.rings.filter((r) => inRing(x, y, r)).length % 2 === 1) &&
    !here.some(
      (o) =>
        o.w > w.w &&
        o.z.some(
          (_, v) =>
            v + 1 < o.z.length &&
            segmentDistance(
              {
                ax: o.pts[2 * v]!,
                ay: o.pts[2 * v + 1]!,
                bx: o.pts[2 * v + 2]!,
                by: o.pts[2 * v + 3]!,
              },
              x,
              y,
            ) <=
              o.w / 2 + 1,
        ),
    )
  const faults: Array<string> = []
  for (const w of here) {
    w.z.forEach((z, v) => {
      if (v > 0 && z > w.z[v - 1]!) faults.push(`${w.id} rises to ${z} at vertex ${v}`)
      const x = w.pts[2 * v]!,
        y = w.pts[2 * v + 1]!
      if (round(x, y) && z > w.floor[v]! + w.depth / 2 + PERCH && onPlain(w, x, y))
        faults.push(
          `${w.id} perched at (${x}, ${y}): ${z} over its bed at ${w.floor[v]!.toFixed(2)}`,
        )
    })
    // Each water ending on another's vertex meets it at its level, in whole decimetres.
    for (const o of WHOLE.water) {
      const v = o === w ? -1 : vertexAt(o, w.pts.at(-2)!, w.pts.at(-1)!)
      if (v >= 0 && v + 1 < o.z.length && Math.abs(o.z[v]! - w.z.at(-1)!) > 0.1 + 1e-9)
        faults.push(`${w.id} meets ${o.id} at ${w.z.at(-1)}, ${o.z[v]} there`)
    }
  }
  assert.deepEqual(faults, [])
  assert.ok(here.length > 5, `${here.length} pieces round the confluence`)
})

/** The Magra's and the Vara's water under this level lies on the plain they meet on, m: Fornola's 12.3 m and on down. */
const PLAIN = 15
/** The lattice the plain's polygons are read on, m. */
const STEP = 16

/** The nearest of `reaches` to (x, y) (one at least), and where along it. */
const nearestReach = <R extends { ax: number; ay: number; bx: number; by: number }>(
  reaches: ReadonlyArray<R>,
  x: number,
  y: number,
) => {
  let best = { reach: reaches[0]!, t: 0, d2: Number.MAX_VALUE }
  for (const reach of reaches) {
    const { d2, t } = segDist2(x, y, reach.ax, reach.ay, reach.bx, reach.by)
    if (d2 < best.d2) best = { reach, t, d2 }
  }
  return best
}

// Issue #20's acceptance, over the river polygons the Magra and the Vara run in (OSM's relation
// 1328370 and the Vara's own): their water is that of the nearest of their waterways where they run
// in them (`insideOf` in water/rivers.ts, as `nearestOn` in tools/water-areas.ts carves them).
// Regression: read on the whole course of a ditch on the terrace beside the Magra's plain
// (1070845492), 259 m off outside the polygon, the Magra's polygon held its water at (−15744, −4608)
// at 8.6 m, 7.3 m over the Magra's and 2.6 m deep.
test("water: on the plain the Magra's and the Vara's polygons hold their waterways' water where they run in them, over the rivers' by more than 1 m only a tributary's that meets them", () => {
  const index = waterIndex(WHOLE.water, WHOLE.areas)
  const rivers = new Set(
    WHOLE.water.flatMap((w, i) => (w.name === "Fiume Magra" || w.name === "Fiume Vara" ? [i] : [])),
  )
  // The waters that meet them: ending on a vertex of theirs, or of a water that does.
  const at = new Map<string, Array<number>>()
  WHOLE.water.forEach((w, i) =>
    w.z.forEach((_, v) => {
      const key = `${w.pts[2 * v]},${w.pts[2 * v + 1]}`
      at.set(key, [...(at.get(key) ?? []), i])
    }),
  )
  const meet = new Set(rivers)
  for (let size = 0; size !== meet.size;) {
    size = meet.size
    WHOLE.water.forEach((w, i) => {
      const on = at.get(`${w.pts.at(-2)},${w.pts.at(-1)}`) ?? []
      if (on.some((j) => j !== i && meet.has(j))) meet.add(i)
    })
  }
  /** The level of the water of `reach` `t` along it at the mean flow, as `waterAt` reads it. */
  const levelOn = (r: (typeof index.pools)[number]["reaches"][number], t: number) =>
    Math.max(
      SEA_LEVEL,
      r.bedA +
        (r.bedB - r.bedA) * t +
        (r.stageA + (r.stageB - r.stageA) * t) * Ops.pow(MEAN, STAGE),
    )
  const faults: Array<string> = []
  let wet = 0,
    over = 0
  for (const pool of index.pools) {
    const own = pool.reaches.filter((r) => rivers.has(r.piece))
    // The plain's part of the polygon: round the rivers' reaches under PLAIN, as far as its width.
    const low = own.filter((r) => Math.min(r.bedA, r.bedB) < PLAIN)
    if (pool.level !== undefined || low.length === 0) continue
    const [x0, y0, x1, y1] = pool.box
    const c0 = Math.floor(x0 / STEP),
      r0 = Math.floor(y0 / STEP),
      cols = Math.ceil(x1 / STEP) - c0 + 1
    fillPolygon(
      pool.rings,
      -STEP / 2,
      -STEP / 2,
      STEP,
      { c0, r0, cols, rows: Math.ceil(y1 / STEP) - r0 + 1 },
      (k) => {
        const x = (c0 + (k % cols)) * STEP,
          y = (r0 + Math.floor(k / cols)) * STEP
        const river = nearestReach(own, x, y),
          base = levelOn(river.reach, river.t)
        if (base >= PLAIN) return
        const here = index.at(x, y, terrainZ(x, y), MEAN)
        if (here === undefined) return
        wet++
        const { reach: r } = nearestReach(pool.reaches, x, y),
          id = WHOLE.water[r.piece]!.id
        const mx = (r.ax + r.bx) / 2,
          my = (r.ay + r.by) / 2
        if (pool.rings.filter((ring) => inRing(mx, my, ring)).length % 2 === 0)
          faults.push(`(${x}, ${y}) holds ${id}'s water from outside its polygon`)
        if (here.level <= base + PERCH) return
        over++
        if (!meet.has(r.piece))
          faults.push(
            `(${x}, ${y}) holds ${id}'s water at ${here.level.toFixed(2)}, the rivers' ${base.toFixed(2)}, and it meets neither`,
          )
      },
    )
  }
  assert.deepEqual(faults, [])
  // 5,173 wet points, 8 of them over the rivers by more than 1 m, at most 2.24: the Calcandola's,
  // 375205186's and 238380857's water where they fall into the Magra's polygon (2026-11-21)
  assert.ok(wet > 5000, `${wet} wet points on the plain, ${over} over the rivers by more than 1 m`)
})

test("walls: water stops neither feet nor wheels; the shore walls ring it, and people and animals keep to them", () => {
  // The middle of every wide river's reach away from the roads and the map's edge: no walk or drive wall within 2 m, a shore wall
  // within its bed, or within 5 m past the nearest ground in no lake or river polygon, whose edge
  // the shore walls ring (the Aulella runs 17–51 m from its polygon's outline from x −8390 to its
  // mouth in the Magra).
  const { minX, minY, maxX, maxY } = MAP.bounds
  const areas = WHOLE.areas.filter((a) => isWaterArea(a.kind))
  const wet = (x: number, y: number) =>
    areas.some((a) => a.rings.filter((r) => inRing(x, y, r)).length % 2 === 1)
  /** How far the nearest ground in no water area lies from (x, y), to the metre, 64 ways round; Infinity past 400 m. */
  const dry = (x: number, y: number) => {
    for (let r = 0; r <= 400; r++)
      for (let t = 0; t < 64; t++)
        if (!wet(x + r * Ops.cos((t * Math.PI) / 32), y + r * Ops.sin((t * Math.PI) / 32))) return r
    return Number.POSITIVE_INFINITY
  }
  let checked = 0
  for (const w of WHOLE.water.filter((o) => o.w >= 12))
    for (let k = 0; k < w.pts.length / 2; k += 5) {
      const x = w.pts[2 * k]!,
        y = w.pts[2 * k + 1]!
      if (
        Math.min(x - minX, maxX - x, y - minY, maxY - y) < 30 ||
        outlineDistance(x, y) < 30 ||
        WHOLE.roads.some((r) =>
          r.pts.some((v, i) => i % 2 === 0 && Ops.hypot(v - x, r.pts[i + 1]! - y) < 30),
        )
      )
        continue
      checked++
      // A wall a body in the water meets (`meets`): one with no level, or one on the water's level.
      // A bridge's parapet stands at its deck's top and stops no swimmer under it: the A15's over the
      // Magra by Caprigliola, at 69.8 m, passes 0.005 m from a vertex of the river at 41.5 m.
      const near = (kind: "walk" | "land" | "drive", r: number) =>
        wallsNear(kind, x - r, y - r, x + r, y + r).some(
          (s) => segmentDistance(s, x, y) < r && meets(s, w.z[k]!),
        )
      assert.ok(!near("walk", 2) && !near("drive", 2), `a wall in the water at ${x}, ${y}`)
      assert.ok(
        near("land", w.bed + 5) || near("land", dry(x, y) + 5),
        `no shore wall by the water at ${x}, ${y}`,
      )
    }
  assert.ok(checked > 20, `${checked} river points checked`)
})
