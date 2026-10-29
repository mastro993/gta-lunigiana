// Per comune, how much of a part's play area each source maps: the runbook's step 2 table (issue
// #3), pasted in the part's PR. Run: node src/tools/coverage.ts <part> [--refresh]
// (pnpm coverage <part>). Needs .research/<part>/index.json (`rt-index`) and the part's manifest,
// data/parts/<part>.json, with its picks (`pick-sheets`, `pick-lidar`): it throws without them, and
// on a mistyped flag. The rows are the comuni, OSM boundary=administrative admin_level=8
// relations meeting the part's box (one Overpass query); the columns:
// - CTR 2019: the AZR mapped areas of the manifest's sheets (the archives `fetch-rt` caches);
// - LiDAR <lot>: the manifest's tiles in order, on the index's footprints; a cell takes the lot of
//   the first tile holding it, as `fetch-rt`'s mosaic keeps the first value;
// - no LiDAR: the cells no tile holds, which `fetch-rt` fills from the 10 m DTM;
// - forest: the UCS 2019 woods (311–313, 324; WFS, box + 500 m), OSM forest (landuse=forest,
//   natural=wood; Overpass), and the share of the woods OSM also marks as forest.
// Measured on 10 m cells, a cell counted when its centre lies in the play area (the union of the
// part's rectangles). Prints the table and the picture's legend; writes .research/<part>/coverage.md
// and coverage.png. The Overpass and WFS answers are cached in .research/<part>/ (comuni.osm,
// forest.osm, ucs.gml), each once it reads as complete; --refresh asks again.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import { UCS, ctrUrl, parseGml, wfsUrl } from "./cartoteca.ts"
import {
  LEGEND,
  type Polygon,
  coverageImage,
  coverageTable,
  gridOver,
  mask,
  paint,
  playMask,
  tally,
} from "./coverage-grid.ts"
import { gaussBoagaToLatLon, utm32ToLatLon } from "./crs.ts"
import { fromLocal, gaussBoagaBox, toLocal } from "./geometry.ts"
import { type Manifest, readManifest } from "./manifest.ts"
import { getText, overpass, pool } from "./net.ts"
import { type Osm, assembleRings, readOsm } from "./osm.ts"
import { encodePngRgb } from "./png.ts"
import { type Part, partOf, rectsBox } from "./region.ts"
import { fetchZip, mustFind } from "./rt-cache.ts"
import { readIndex } from "./rt-index-file.ts"
import { parseShp } from "./shp.ts"

/** Cell size, m: 0.01 ha cells keep a 78 km² part under a million cells. */
const RES = 10
/** UCS 2019 classes that are woods: broadleaf, conifer and mixed woods, and woodland in regrowth. */
const WOODS: ReadonlySet<string> = new Set(["311", "312", "313", "324"])
/** Archives downloaded at once. */
const LIMIT = 4

/** An OSM ring of node ids (first id repeated last) as a flat local ring. */
const localRing = (osm: Osm, nds: ReadonlyArray<string>): Array<number> =>
  nds.slice(0, -1).flatMap((id) => {
    const n = osm.nodes.get(id)
    if (n === undefined) throw new Error(`OSM node ${id} missing`)
    return toLocal(n.lat, n.lon)
  })

/** A multipolygon or boundary relation's rings in local metres: the outer rings assembled from its member ways, then the inner ones. */
export const osmPolygon = (osm: Osm, rel: Parameters<typeof assembleRings>[1]): Polygon =>
  ["outer", "inner"].flatMap((role) =>
    assembleRings(osm, rel, role).map((ring) => localRing(osm, ring)),
  )

const isForest = (tags: Readonly<Record<string, string>>): boolean =>
  tags.landuse === "forest" || tags.natural === "wood"

/** OSM forest: closed ways and multipolygon relations tagged landuse=forest or natural=wood. */
export const forestPolygons = (osm: Osm): Array<Polygon> => [
  ...[...osm.ways.values()]
    .filter((w) => isForest(w.tags) && w.nds.length > 3 && w.nds[0] === w.nds.at(-1))
    .map((w) => [localRing(osm, w.nds)]),
  ...[...osm.relations.values()]
    .filter((r) => isForest(r.tags) && r.tags.type === "multipolygon")
    .map((r) => osmPolygon(osm, r)),
]

/** The comuni: admin_level 8 boundary relations, by relation id, each its name and rings. */
const comuniOf = (osm: Osm): Array<{ readonly name: string; readonly polygon: Polygon }> =>
  [...osm.relations.values()]
    .filter((r) => r.tags.boundary === "administrative" && r.tags.admin_level === "8")
    .toSorted((a, b) => Number(a.id) - Number(b.id))
    .map((r) => ({ name: r.tags.name ?? `relation ${r.id}`, polygon: osmPolygon(osm, r) }))

/** The text cached at `path`, or `ask()`'s answer (which throws on a bad one), cached, when there is none or `refresh` is set. */
const cached = async (
  path: string,
  refresh: boolean,
  ask: () => Promise<string>,
): Promise<string> => {
  if (!refresh && existsSync(path)) return readFileSync(path, "utf8")
  const name = relative(join(import.meta.dirname, "../.."), path),
    start = performance.now()
  console.log(`asking for ${name}`)
  const text = await ask()
  writeFileSync(path, text)
  console.log(`cached ${name} in ${Math.round((performance.now() - start) / 1000)} s`)
  return text
}

/** The UCS features of the WFS answer at `url`, cached at `path`: an answer that does not parse throws and is never cached. */
export const readUcs = async (
  path: string,
  refresh: boolean,
  url: string,
): Promise<ReturnType<typeof parseGml>> =>
  parseGml(await cached(path, refresh, () => getText(url).then((t) => (parseGml(t), t))))

/** Part `key`'s `manifest` when it picks CTR sheets or LiDAR tiles (a part without one reads as empty); throws saying to pick them otherwise. */
export const checkPicks = (key: string, manifest: Manifest): Manifest => {
  if (manifest.ctr.length === 0 && manifest.lidar.length === 0)
    throw new Error(
      `no picks in data/parts/${key}.json: run pnpm pick-sheets ${key} --write and pnpm pick-lidar ${key} --write first`,
    )
  return manifest
}

/** The part's box as an Overpass bbox, south,west,north,east (local axes run along lat and lon). */
const overpassBox = (part: Part): string => {
  const [x0, y0, x1, y1] = rectsBox(part.rects)
  const [s, w] = fromLocal(x0, y0),
    [n, e] = fromLocal(x1, y1)
  return [s, w, n, e].map((v) => v.toFixed(6)).join(",")
}

/** The mapped area (AZR) of each 2019 CTR sheet, EPSG:6707, as local polygons. */
const ctrMapped = async (sheets: ReadonlyArray<string>): Promise<Array<Polygon>> =>
  (
    await pool(sheets, LIMIT, async (sheet) => {
      const dir = await fetchZip(ctrUrl(sheet))
      const file = (ext: string) => readFileSync(mustFind(dir, `S_${sheet}_2019_AZR.${ext}`))
      return parseShp(file("shp"), file("dbf"), `${sheet} AZR`).map((rec) =>
        rec.parts.map((part) => part.flatMap(([e, n]) => toLocal(...utm32ToLatLon(e, n)))),
      )
    })
  ).flat()

/** An EPSG:3003 polygon (flat rings) in local metres. */
const gbPolygon = (rings: ReadonlyArray<ReadonlyArray<number>>): Polygon =>
  rings.map((ring) =>
    ring.flatMap((v, i) => (i % 2 === 1 ? [] : toLocal(...gaussBoagaToLatLon(v, ring[i + 1]!)))),
  )

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    strict: true,
    allowPositionals: true,
    options: { refresh: { type: "boolean" } },
  })
  const part = partOf(positionals[0])
  const refresh = values.refresh === true
  const manifest = checkPicks(part.key, readManifest(part.key)),
    index = readIndex(part.key)
  const dir = join(import.meta.dirname, "../../.research", part.key)
  mkdirSync(dir, { recursive: true })

  // The LiDAR tiles in the manifest's order, each on its index footprint.
  const footprints = new Map(index.lidar.flatMap((t) => (t.dtm === undefined ? [] : [[t.dtm, t]])))
  const tiles = manifest.lidar.map((name) => {
    const tile = footprints.get(name)
    if (tile === undefined) throw new Error(`${name} not in the index: run rt-index ${part.key}`)
    return tile
  })
  const lots = [...new Set(tiles.map((t) => t.lot))]

  const bbox = overpassBox(part)
  const comuniQuery = `[out:xml][timeout:180];relation["boundary"="administrative"]["admin_level"="8"](${bbox});(._;>;);out body qt;`
  const forestQuery = `[out:xml][timeout:180];(way["landuse"="forest"](${bbox});way["natural"="wood"](${bbox});relation["landuse"="forest"](${bbox});relation["natural"="wood"](${bbox}););(._;>;);out body qt;`
  const comuniPath = join(dir, "comuni.osm"),
    forestPath = join(dir, "forest.osm")
  await cached(comuniPath, refresh, () => overpass(comuniQuery))
  await cached(forestPath, refresh, () => overpass(forestQuery))
  const ucs = await readUcs(
    join(dir, "ucs.gml"),
    refresh,
    wfsUrl(UCS.map, UCS.layer, gaussBoagaBox(part.rects, UCS.pad)),
  )

  const comuni = comuniOf(readOsm(comuniPath))
  const woods = ucs.flatMap(({ attrs, polygons }) =>
    WOODS.has(attrs.ucs2019 ?? "") ? polygons.map(gbPolygon) : [],
  )
  const grid = gridOver(part.rects, RES)
  const layers = {
    play: playMask(grid, part.rects),
    comune: paint(
      grid,
      comuni.map((c, i) => ({ value: i + 1, polygons: [c.polygon] })),
    ),
    ctr: mask(grid, await ctrMapped(manifest.ctr)),
    lot: paint(
      grid,
      tiles.map((t) => ({ value: lots.indexOf(t.lot) + 1, polygons: t.polygons.map(gbPolygon) })),
    ),
    ucs: mask(grid, woods),
    osm: mask(grid, forestPolygons(readOsm(forestPath))),
  }
  const rows = tally(
    layers,
    comuni.map((c) => c.name),
    lots.length,
  )
  const table = coverageTable(rows, lots, RES * RES)
  console.log(`${table}\n\n${LEGEND}`)
  const legend = LEGEND.split("\n")
    .map((l) => `- ${l}`)
    .join("\n")
  const notes = [
    `${RES} m cells, counted when their centre lies in the play area.`,
    `CTR 2019: the AZR of ${manifest.ctr.length} sheets. LiDAR: ${tiles.length} tiles, first wins in lot order ${lots.join(", ")}.`,
    `no LiDAR: filled from ${manifest.dtm10.join(", ") || "nothing yet"}.`,
    "Source columns: km² (share of the comune's play area).",
  ]
  const md = [
    `# Coverage of ${part.key} (${part.title})`,
    notes.join(" "),
    table,
    `coverage.png:\n\n${legend}`,
  ]
  writeFileSync(join(dir, "coverage.md"), `${md.join("\n\n")}\n`)
  writeFileSync(
    join(dir, "coverage.png"),
    encodePngRgb(grid.cols, grid.rows, coverageImage(grid, layers, lots)),
  )
  console.log(
    `wrote .research/${part.key}/coverage.md, coverage.png (${grid.cols} × ${grid.rows} px, ${RES} m per px)`,
  )
}

if (import.meta.main) await main()
