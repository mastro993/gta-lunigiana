// Issue #11's check of the DBT 1:2000 (adapter (c), dbt.ts) on the Pontremoli test region
// (`pontremoli-town`, region.ts), over its raw inputs alone, as no map is built for it: the DBT's
// buildings hold at least 90% of OSM's building centroids in the town, and at least 90% of its units
// standing on the ground are 1.5–45 m tall. `fetch-rt --region pontremoli-town` wrote the DBT's
// layers (data/raw/rt/pontremoli-town/dbt2k), `fetch-osm pontremoli-town` OSM's buildings
// (data/raw/osm/pontremoli-town.osm.gz), and `pnpm fetch-raw` restores both, as it does the Bagnone
// ridge's terrain for terrain-seams.map-test.ts. A map test: it walks every building of both.
import assert from "node:assert/strict"
import { join, relative } from "node:path"
import { type TestContext, test } from "node:test"

import { staticGrid } from "../../sim/collide.ts"
import { DBT_RESIDUAL, gaussBoagaToLatLon } from "../crs.ts"
import { ctrRecords, polygonsOf, specOf } from "../ctr.ts"
import { readDbt } from "../dbt.ts"
import { isBuilding } from "../features.ts"
import { centroid, type P, pointInRing, ringBox, toLocal } from "../geometry.ts"
import { assembleRings, readOsms } from "../osm.ts"
import { inRects, osmFiles, type Rect, rectsBox, regionFromArgs, surveyDir } from "../region.ts"
import { comune, SOURCES } from "../survey-ids.ts"

const ROOT = join(import.meta.dirname, "../../..")
const REGION = regionFromArgs(["--region", "pontremoli-town"])
const RECTS = REGION.parts.flatMap((p) => p.rects)
const DIR = join(ROOT, surveyDir(REGION), "dbt2k")
/** The DBT's buildings, clipped to the region: this process's REGION is Lunigiana, whose box is not. */
const DBT = readDbt(DIR, rectsBox(RECTS)).buildings
if (DBT.length === 0)
  throw new Error(`no DBT buildings under ${relative(ROOT, DIR)}: pnpm fetch-raw restores them`)

/** Asserts that `hit` of `all` is at least the share `min`, and prints it. */
const atLeast = (t: TestContext, what: string, hit: number, all: number, min: number): void => {
  t.diagnostic(`${what}: ${hit} of ${all}, ${((100 * hit) / all).toFixed(1)}%`)
  assert.ok(all > 0 && hit >= min * all, `${what}: ${hit} of ${all}, under ${100 * min}%`)
}

/**
 * OSM's building outlines as features.ts reads them (`osmBuildings`), flat in local metres: the
 * closed building ways in no building multipolygon, and each multipolygon's outer rings.
 */
const osmOutlines = (): Array<Array<number>> => {
  const osm = readOsms(osmFiles(REGION).map((file) => join(ROOT, file)))
  const ring = (nds: ReadonlyArray<string>) =>
    nds.slice(0, -1).flatMap((id) => {
      const node = osm.nodes.get(id)
      assert.ok(node !== undefined, `the OSM extract lacks node ${id} of a building`)
      return toLocal(node.lat, node.lon)
    })
  const rels = [...osm.relations.values()].filter(
    (r) => r.tags.type === "multipolygon" && isBuilding(r.tags),
  )
  const inRel = new Set(rels.flatMap((r) => r.members.map((m) => m.ref)))
  return [
    ...[...osm.ways.values()]
      .filter(
        (w) =>
          isBuilding(w.tags) && !inRel.has(w.id) && w.nds.length > 3 && w.nds[0] === w.nds.at(-1),
      )
      .map((w) => ring(w.nds)),
    ...rels.flatMap((r) => assembleRings(osm, r, "outer").map(ring)),
  ]
}

test("at least 90% of OSM's building centroids in Pontremoli's town lie in a DBT building", (t) => {
  const grid = staticGrid(DBT.length, (k) => ringBox(DBT[k]!.outer), 32)
  const inBuilding = ([x, y]: P) => {
    let hit = false
    grid(x, y, x, y, (k) => {
      const { outer, holes = [] } = DBT[k]!
      hit ||= pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h))
    })
    return hit
  }
  const centroids = osmOutlines()
    .map(centroid)
    .filter(([x, y]) => inRects(RECTS, x, y))
  atLeast(
    t,
    "OSM building centroids in a DBT building",
    centroids.filter(inBuilding).length,
    centroids.length,
    0.9,
  )
})

/** The whole plane: a unit's outline unclipped, for its centroid. */
const PLANE: Rect = [-Infinity, -Infinity, Infinity, Infinity]

test("at least 90% of the DBT's units standing on the ground in the town are 1.5–45 m tall", (t) => {
  const local = ([e, n]: readonly [number, number]) =>
    toLocal(...gaussBoagaToLatLon(e, n, DBT_RESIDUAL))
  const units = ctrRecords(DIR, "un_vol", "utf8").filter(
    ({ rec }) =>
      rec.attrs.un_vol_por === "01" &&
      polygonsOf(rec, local, PLANE).some(([outer]) => inRects(RECTS, ...centroid(outer!))),
  )
  const tall = units.filter(({ rec }) => {
    const av = Number(rec.attrs.un_vol_av)
    return av >= 1.5 && av <= 45
  })
  atLeast(t, "units on the ground 1.5–45 m tall (un_vol_av)", tall.length, units.length, 0.9)
})

test("each DBT building in the town has an id of its own, Pontremoli's DBT's", () => {
  const ids = DBT.map((b) => b.id)
  assert.equal(new Set(ids).size, ids.length)
  // An id is −(local + 2^32 · slot), its slot the DBT's block plus Pontremoli's code (survey-ids.ts).
  const slot = SOURCES.dbt2k * 2 ** 16 + comune("045014")
  for (const id of ids)
    assert.ok(
      Number.isSafeInteger(id) && Math.floor(-id / 2 ** 32) === slot,
      `id ${id} is not in the DBT's slot for Pontremoli`,
    )
})

test("each DBT building in the town is of a kind and style a CTR building code gives", (t) => {
  // BUILDING_CODES (ctr.ts) are 0201–0244: the kinds the 2019 CTR brings, which the game knows.
  const known = new Set(
    Array.from({ length: 100 }, (_, k) => specOf(`02${String(k).padStart(2, "0")}`))
      .filter((s) => s !== undefined)
      .map((s) => `${s.kind} ${s.style ?? ""}`),
  )
  const kinds = new Map<string, number>()
  for (const b of DBT) {
    assert.ok(known.has(`${b.kind} ${b.style ?? ""}`), `building ${b.id}: ${b.kind} ${b.style}`)
    kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1)
  }
  t.diagnostic(
    [...kinds]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind} ${n}`)
      .join(", "),
  )
  // The town's landmarks come through: its churches, its towers and its station.
  for (const kind of ["church", "tower", "train_station"]) assert.ok(kinds.has(kind), `no ${kind}`)
})
