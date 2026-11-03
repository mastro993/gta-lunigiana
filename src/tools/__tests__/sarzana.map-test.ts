// Issue #12's checks of Regione Liguria's sources on the Sarzana test region (`sarzana-town`,
// region.ts), over its raw inputs alone, as no map is built for it: the NC5 read through adapter (c)
// (`readNc5`) stands on the terrain fetch-rt's chain wrote from the LiDAR and Liguria's DTM ed. 2023
// (`loadDtm`), at least 90% of its buildings 1.5–45 m over their ground, the cathedral a church, and
// every NC5 building in the play area one building of the map's. `fetch-lig sarzana-town` wrote
// data/raw/lig/sarzana-town, `fetch-rt --region sarzana-town` data/raw/rt/sarzana-town, and
// `pnpm fetch-raw` restores both, as it does the Bagnone ridge's terrain for terrain-seams.map-test.ts.
// A map test: it walks every building.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { type TestContext, test } from "node:test"
import { gunzipSync } from "node:zlib"

import { latLonToGaussBoaga } from "../crs.ts"
import { local } from "../ctr.ts"
import { loadDtm } from "../dtm.ts"
import { centroid, flatRing, fromLocal, type P, pointInRing, toLocal } from "../geometry.ts"
import { dtmTiles, ligFolders, NC5_LAYERS, type Nc5LayerFile } from "../liguria.ts"
import { readNc5, referenceOf } from "../nc5.ts"
import { dtmDir, inRects, ligDir, type Rect, rectsBox, regionFromArgs } from "../region.ts"
import { localOf, SOURCES, surveyId } from "../survey-ids.ts"
import { geoTiffRaster, ligRaster, MAX_SWEEPS, sample, unround } from "../terrain-sources.ts"
import { readUcs } from "../ucs.ts"

const ROOT = join(import.meta.dirname, "../../..")
const REGION = regionFromArgs(["--region", "sarzana-town"])
const [PART] = REGION.parts
const RECTS = PART!.rects
const NC5 = join(ROOT, ligDir(PART!), "nc5")
/** The NC5's buildings, clipped to the region: this process's REGION is Lunigiana, whose box is not. */
const BUILDINGS = readNc5([NC5], rectsBox(RECTS)).buildings
if (BUILDINGS.length === 0)
  throw new Error(`no NC5 buildings under ${relative(ROOT, NC5)}: pnpm fetch-raw restores them`)
const DEM = loadDtm(join(ROOT, dtmDir(REGION)), REGION)

/** A layer's file as fetch-lig wrote it. */
const layerFile = (layer: string) =>
  JSON.parse(gunzipSync(readFileSync(join(NC5, `${layer}.json.gz`))).toString()) as Nc5LayerFile

/** Asserts that `hit` of `all` is at least the share `min`, and prints it. */
const atLeast = (t: TestContext, what: string, hit: number, all: number, min: number): void => {
  t.diagnostic(`${what}: ${hit} of ${all}, ${((100 * hit) / all).toFixed(1)}%`)
  assert.ok(all > 0 && hit >= min * all, `${what}: ${hit} of ${all}, under ${100 * min}%`)
}

/** Whether a building is a minor building's (L6870): their local ids start at 1e9 (nc5.ts). */
const minor = (id: number) => -id % 2 ** 32 >= 1e9

/** The whole plane: the outlines unclipped, for their centroids. */
const PLANE: Rect = [-Infinity, -Infinity, Infinity, Infinity]

test("every NC5 building and minor building in the play area is one building, by its id", (t) => {
  const unclipped = readNc5([NC5], PLANE).buildings
  for (const [layer, base] of [
    [NC5_LAYERS.buildings, 0],
    [NC5_LAYERS.minor, 1e9],
  ] as const) {
    const file = layerFile(layer)
    // fetch-lig checked the pages against the server's count; the file keeps every feature.
    assert.equal(file.features.length, file.numberMatched, layer)
    // Each polygon of a feature whose outline's centroid lies in the play area (the build keeps a
    // building by its centroid, play-area.ts), but a sliver under 0.5 m², which every survey's
    // reader drops (`flatRing`).
    let slivers = 0
    const expected = file.features.flatMap(({ properties, polygons }) => {
      const { section, serial } = referenceOf(String(properties.classref))
      return polygons.flatMap((rings, k) => {
        const outer: Array<P> = []
        for (let i = 0; i + 2 < rings[0]!.length; i += 3)
          outer.push(local([rings[0]![i]!, rings[0]![i + 1]!]))
        const ring = flatRing(outer, true)
        if (ring === undefined) slivers++
        return ring !== undefined && inRects(RECTS, ...centroid(ring))
          ? [surveyId("nc5", section, base + localOf(serial, k))]
          : []
      })
    })
    const built = unclipped
      .filter((b) => minor(b.id) === base > 0 && inRects(RECTS, ...centroid(b.outer)))
      .map((b) => b.id)
    t.diagnostic(`${layer}: ${expected.length} in play, ${slivers} slivers in the file`)
    assert.deepEqual(
      built.sort((a, b) => a - b),
      expected.sort((a, b) => a - b),
      layer,
    )
    assert.equal(new Set(built).size, built.length, `${layer}: an id twice`)
  }
})

test("at least 90% of the NC5's buildings in the town stand 1.5–45 m over their lowest ground", (t) => {
  // The eave over the lowest ground at the outline, as the build measures it (build-output.ts),
  // on the terrain the chain wrote.
  const rise = (b: (typeof BUILDINGS)[number]) => {
    let z0 = Infinity
    for (let i = 0; i < b.outer.length; i += 2)
      z0 = Math.min(z0, DEM.at(b.outer[i]!, b.outer[i + 1]!))
    return b.eave! - z0
  }
  const plausible = (b: (typeof BUILDINGS)[number]) => {
    const r = rise(b)
    return r >= 1.5 && r <= 45
  }
  const buildings = BUILDINGS.filter((b) => !minor(b.id) && b.eave !== undefined)
  atLeast(
    t,
    "buildings 1.5–45 m over their ground",
    buildings.filter(plausible).length,
    buildings.length,
    0.9,
  )
  // A shed's eave stands about a metre over Liguria's DTM (docs/map.md): most take their default 2.5 m.
  const sheds = BUILDINGS.filter((b) => minor(b.id))
  t.diagnostic(
    `minor buildings 1.5–45 m over their ground: ${sheds.filter(plausible).length} of ${sheds.length}`,
  )
})

test("Sarzana's cathedral is a church, its station a station, and every id in the NC5's slot", (t) => {
  // OSM's relation 14443127, the Basilica Cattedrale di Santa Maria Assunta, at its Nominatim point;
  // the station's passenger building, between its forecourt and its platforms.
  for (const [what, [x, y], kind] of [
    ["the cathedral's nave", toLocal(44.1121353, 9.9623806), "church"],
    ["the station", [-13564, -5850], "train_station"],
  ] as const)
    assert.deepEqual(
      BUILDINGS.filter((b) => pointInRing(x, y, b.outer)).map((b) => b.kind),
      [kind],
      what,
    )
  const kinds = new Map<string, number>()
  const slot = SOURCES.nc5 * 2 ** 16
  for (const b of BUILDINGS) {
    const section = Math.floor(-b.id / 2 ** 32) - slot
    assert.ok(
      Number.isSafeInteger(b.id) && section >= 0 && section < 2 ** 16,
      `id ${b.id} is not in the NC5's slot`,
    )
    kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1)
  }
  t.diagnostic(
    [...kinds]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind} ${n}`)
      .join(", "),
  )
})

test("the land use's kept classes in the town are the Magra plain's basins and quarries", () => {
  const [lig] = ligFolders(ROOT, REGION.parts)
  const areas = readUcs([join(lig!, "uds.json.gz")], rectsBox(RECTS))
  assert.deepEqual(areas.map((a) => a.kind).sort(), [
    ...Array.from({ length: 8 }, () => "lake"),
    "quarry",
    "quarry",
  ])
  // All on the plain south of the old town.
  assert.ok(areas.every((a) => centroid(a.rings[0]!)[1] < -6800))
})

test("away from the LiDAR the terrain is Liguria's DTM itself: its bend onto the LiDAR fades", async () => {
  const dir = join(ROOT, ligDir(PART!), "dtm")
  const crops = dtmTiles(RECTS).map(({ i, j }) => readFileSync(join(dir, `${i}_${j}.tif`)))
  const { raster } = (await ligRaster(crops))!
  // South of y −6000, 2 km and more from the LiDAR on the hills at the region's north-east corner.
  const off: Array<number> = []
  for (let y = -8000; y <= -6000; y += 50)
    for (let x = -14400; x <= -12800; x += 50) {
      const [e, n] = latLonToGaussBoaga(...fromLocal(x, y))
      const v = DEM.at(x, y) - sample(raster, e, n)
      if (DEM.source!(x, y) === "lig" && !Number.isNaN(v)) off.push(Math.abs(v))
    }
  off.sort((a, b) => a - b)
  const median = off[Math.floor(off.length / 2)]!
  assert.ok(off.length > 1000 && median < 0.1, `${median.toFixed(2)} m off at the median`)
})

test("unround settles on Liguria's crops, raised 1,500 m too, where 32 bits never did", async () => {
  const crop = await geoTiffRaster(
    readFileSync(join(ROOT, ligDir(PART!), "dtm", "-7_-3.tif")),
    3003,
  )
  for (const lift of [0, 1500]) {
    const { sweeps } = unround({ ...crop, z: crop.z.map((v) => v + lift) })
    assert.ok(sweeps < MAX_SWEEPS, `${sweeps} sweeps ${lift} m up`)
  }
})
