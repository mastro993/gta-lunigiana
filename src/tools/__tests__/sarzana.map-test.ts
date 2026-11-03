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

import { local, specOf } from "../ctr.ts"
import { loadDtm } from "../dtm.ts"
import { centroid, flatRing, type P, pointInRing, toLocal } from "../geometry.ts"
import { NC5_LAYERS } from "../liguria.ts"
import { readNc5, referenceOf } from "../nc5.ts"
import { dtmDir, inRects, ligDir, type Rect, rectsBox, regionFromArgs } from "../region.ts"
import { localOf, SOURCES, surveyId } from "../survey-ids.ts"

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
  JSON.parse(gunzipSync(readFileSync(join(NC5, `${layer}.json.gz`))).toString()) as {
    readonly numberMatched: number
    readonly features: ReadonlyArray<{
      readonly properties: Readonly<Record<string, string | number | null>>
      readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
    }>
  }

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
  // Liguria's DTM runs over the minor buildings' eaves (docs/map.md): most take their default height.
  const sheds = BUILDINGS.filter((b) => minor(b.id))
  t.diagnostic(
    `minor buildings 1.5–45 m over their ground: ${sheds.filter(plausible).length} of ${sheds.length}`,
  )
})

test("Sarzana's cathedral is a church, and every building of the NC5 is of a kind and style a CTR building code gives", (t) => {
  // OSM's relation 14443127, the Basilica Cattedrale di Santa Maria Assunta, at its Nominatim point.
  const [x, y] = toLocal(44.1121353, 9.9623806)
  const nave = BUILDINGS.filter((b) => pointInRing(x, y, b.outer))
  assert.deepEqual(
    nave.map((b) => [b.kind, b.style]),
    [["church", "church"]],
  )
  const known = new Set(
    Array.from({ length: 100 }, (_, k) => specOf(`02${String(k).padStart(2, "0")}`))
      .filter((s) => s !== undefined)
      .map((s) => `${s.kind} ${s.style ?? ""}`),
  )
  const kinds = new Map<string, number>()
  const slot = SOURCES.nc5 * 2 ** 16
  for (const b of BUILDINGS) {
    assert.ok(known.has(`${b.kind} ${b.style ?? ""}`), `building ${b.id}: ${b.kind} ${b.style}`)
    assert.ok(
      Number.isSafeInteger(b.id) && Math.floor(-b.id / 2 ** 32) - slot < 2 ** 16,
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
  for (const kind of ["church", "train_station", "industrial", "shed"])
    assert.ok(kinds.has(kind), `no ${kind}`)
})
