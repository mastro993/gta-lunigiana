// What Regione Toscana's cartoteca holds over a part: the first step of the runbook's data
// coverage (issue #3). Run: node src/tools/rt-index.ts <part>  (pnpm rt-index <part>).
// - WFS GetFeature over the part's EPSG:3003 box + 500 m on four index layers: rt_cartoteca.ctr2k
//   (CTR 1:2000 sheet frames by year), lidar2k (LiDAR tiles by lot), dbt.2k (the DBT 1:2000
//   blocks) and lidar2k_DSM_autocorrelazione_2021 (the 2021 surface model's elements).
// - A text/html GetFeatureInfo inside each LiDAR tile's footprint: the index has no archive names,
//   the answer has them with their MD5, and the owner, whose licence the answer states.
// - HEAD on every 2019 CTR sheet, LiDAR DTM tile and DSM element archive: its status and size.
// Writes .research/<part>/index.json, which `pick-sheets`, `pick-lidar` and `coverage` read.

import { mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import {
  WFS_PAD,
  ctrUrl,
  dsm2021Url,
  insidePoints,
  lidarLicence,
  lidarUrl,
  lidarGfiUrl,
  parseGml,
  parseLidarGfi,
  wfsUrl,
} from "./cartoteca.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import { gaussBoagaBox } from "./geometry.ts"
import { type Head, getText, head, pool } from "./net.ts"
import { partOf } from "./region.ts"
import { type RtIndex, indexPath } from "./rt-index-file.ts"

/** Requests in flight at once. */
const LIMIT = 4

const { positionals } = parseArgs({ allowPositionals: true, strict: true })
if (positionals.length !== 1) throw new Error("usage: node src/tools/rt-index.ts <part>")
const part = partOf(positionals[0])
const [e0, n0, e1, n1] = gaussBoagaBox(part.rects, WFS_PAD)
const box: [number, number, number, number] = [
  Math.floor(e0),
  Math.floor(n0),
  Math.ceil(e1),
  Math.ceil(n1),
]
const layer = async (name: string) =>
  parseGml(await getText(wfsUrl("wmscartoteca", `rt_cartoteca.${name}`, box)))
const [ctrIndex, lidarIndex, dbtIndex, dsmIndex] = await Promise.all(
  ["ctr2k", "lidar2k", "dbt.2k", "lidar2k_DSM_autocorrelazione_2021"].map(layer),
)
console.log(
  `${part.key}: box ${box.join(",")}: ${ctrIndex!.length} CTR frames, ${lidarIndex!.length} LiDAR tiles, ${dbtIndex!.length} DBT blocks, ${dsmIndex!.length} DSM elements`,
)

const status = (h: Head) => ({
  status: h.status,
  ...(h.bytes === undefined ? {} : { bytes: h.bytes }),
})

const ctr = await pool(ctrIndex!, LIMIT, async ({ attrs, polygons }) => {
  const sheet = attrs.foglio!,
    year = Number(attrs.anno)
  const url = year === 2019 ? ctrUrl(sheet) : undefined
  return {
    sheet,
    year,
    ...(url === undefined ? {} : { url, ...status(await head(url)) }),
    polygons,
  }
})

// A GetFeatureInfo inside each tile's own footprint, at up to TRIES points, until it names the tile.
const TRIES = 16
const infos = await pool(lidarIndex!, LIMIT, async ({ attrs, polygons }) => {
  const sheet = attrs.foglio!.toLowerCase()
  for (const [e, n] of insidePoints(polygons).slice(0, TRIES)) {
    const hit = parseLidarGfi(await getText(lidarGfiUrl(...gaussBoagaToLatLon(e, n)))).find(
      (i) => i.sheet === sheet && i.lot === attrs.lotto,
    )
    if (hit !== undefined) return hit
  }
  return undefined
})
const lidar = await pool(lidarIndex!, LIMIT, async ({ attrs, polygons }, i) => {
  const info = infos[i]
  const url = info?.dtm === undefined ? undefined : lidarUrl(info.dtm)
  return {
    sheet: attrs.foglio!.toLowerCase(),
    lot: attrs.lotto!,
    year: Number(attrs.anno),
    survey: info?.survey ?? "",
    ...(info === undefined ? {} : { owner: info.owner, licence: lidarLicence(info.owner) }),
    ...(info?.dtm === undefined ? {} : { dtm: info.dtm }),
    ...(url === undefined ? {} : status(await head(url))),
    polygons,
  }
})

const dbt = dbtIndex!.map(({ attrs, polygons }) => ({ attrs, polygons }))
const dsm2021 = await pool(dsmIndex!, LIMIT, async ({ attrs, polygons }) => {
  const url = dsm2021Url(attrs.elemento!)
  return {
    element: attrs.elemento!,
    owner: attrs.PROPRIETA ?? "",
    survey: attrs.RILIEVO ?? "",
    url,
    ...status(await head(url)),
    polygons,
  }
})

const index: RtIndex = { part: part.key, box, ctr, lidar, dbt, dsm2021 }
const out = indexPath(part.key)
mkdirSync(join(out, ".."), { recursive: true })
writeFileSync(out, `${JSON.stringify(index)}\n`)

const missing = lidar.filter((t) => t.dtm === undefined).map((t) => `${t.sheet} lot ${t.lot}`)
const failed = [...ctr, ...lidar, ...dsm2021]
  .filter((e) => "status" in e && e.status !== 200)
  .map((e) => ("url" in e ? e.url : e.sheet))
const lots = Object.groupBy(
  lidar,
  (t) => `${t.lot} ${t.year} ${t.owner ?? "?"} (${t.licence ?? "?"})`,
)
console.log({
  ctr2019: ctr.filter((c) => c.year === 2019).length,
  lidarLots: Object.fromEntries(Object.entries(lots).map(([k, v]) => [k, v!.length])),
  dsm2021: dsm2021.length,
  noArchiveInGfi: missing,
  notOk: failed,
  wrote: relative(join(import.meta.dirname, "../.."), out),
})
