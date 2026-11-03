// What Regione Toscana's cartoteca holds over a part: the first step of the runbook's data
// coverage (issue #3). Run: node src/tools/rt-index.ts <part>  (pnpm rt-index <part>).
// - WFS GetFeature over the part's EPSG:3003 box + 500 m on five index layers: rt_cartoteca.ctr2k
//   (CTR 1:2000 sheet frames by year), ctr10k (CTR 1:10 000 section frames by edition), lidar2k
//   (LiDAR tiles by lot), dbt.2k (the DBT 1:2000 blocks, a comune's survey each, the comune's
//   polygon) and lidar2k_DSM_autocorrelazione_2021 (the 2021 surface model's elements).
// - A text/html GetFeatureInfo inside each LiDAR tile's footprint, each 2010 CTR 1:10 000 frame and
//   each DBT comune: the index has no archive names, the answers have them with their MD5, and the
//   tile's owner, whose licence the answer states, or the licence itself. The server answers
//   nothing on a corner polygons share, so it is asked inside (`insidePoints`).
// - HEAD on every 2009 and 2019 CTR sheet, CTR 1:10 000 section, LiDAR DTM tile, DBT comune and
//   DSM element archive: its status and size.
// Writes .research/<part>/index.json, which `pick-sheets`, `pick-lidar` and `coverage` read.

import { mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import {
  WFS_PAD,
  ctr10kUrl,
  ctrUrl,
  dbt2kUrl,
  dsm2021Url,
  gfiUrl,
  insidePoints,
  lidarLicence,
  lidarUrl,
  parseCtr10kGfi,
  parseDbtGfi,
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
const [ctrIndex, ctr10kIndex, lidarIndex, dbtIndex, dsmIndex] = await Promise.all(
  ["ctr2k", "ctr10k", "lidar2k", "dbt.2k", "lidar2k_DSM_autocorrelazione_2021"].map(layer),
)
console.log(
  `${part.key}: box ${box.join(",")}: ${ctrIndex!.length} CTR frames, ${ctr10kIndex!.length} CTR 1:10 000 frames, ${lidarIndex!.length} LiDAR tiles, ${dbtIndex!.length} DBT blocks, ${dsmIndex!.length} DSM elements`,
)

const status = (h: Head) => ({
  status: h.status,
  ...(h.bytes === undefined ? {} : { bytes: h.bytes }),
})

/** The CTR 1:2000 editions `ctrUrl` names the archives of: 2019's and the old schema's of 2009. */
const CTR_YEARS: ReadonlySet<number> = new Set([2009, 2019])
const ctr = await pool(ctrIndex!, LIMIT, async ({ attrs, polygons }) => {
  const sheet = attrs.foglio!,
    year = Number(attrs.anno)
  const url = CTR_YEARS.has(year) ? ctrUrl(sheet, year) : undefined
  if (url !== undefined && !url.endsWith(`/${attrs.fileshp}`))
    console.log(`${sheet} of ${year}: the index names ${attrs.fileshp}, not ${url}`)
  return {
    sheet,
    year,
    ...(url === undefined ? {} : { url, ...status(await head(url)) }),
    polygons,
  }
})

/** Points inside a polygon a GetFeatureInfo is asked at, at most. */
const TRIES = 16
/** What `pick` finds in a GetFeatureInfo on `layer` inside `polygons`, asked at up to TRIES points until it finds one. */
const ask = async <T>(
  layer: string,
  polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  pick: (html: string) => T | undefined,
): Promise<T | undefined> => {
  for (const [e, n] of insidePoints(polygons).slice(0, TRIES)) {
    const hit = pick(await getText(gfiUrl(layer, ...gaussBoagaToLatLon(e, n))))
    if (hit !== undefined) return hit
  }
  return undefined
}

// The 2010 edition of each CTR 1:10 000 section, its EPSG:6707 archive named inside its frame.
const ctr10k = await pool(
  ctr10kIndex!.filter(({ attrs }) => attrs.data_vol?.endsWith("2010")),
  LIMIT,
  async ({ attrs, polygons }) => {
    const section = attrs.numero_f!
    const info = await ask("rt_cartoteca.ctr10k", polygons, (html) =>
      parseCtr10kGfi(html).find(
        (i) => i.section === section && i.shp?.startsWith(`S_${section}_2010_6707_`),
      ),
    )
    const url = info?.shp === undefined ? undefined : ctr10kUrl(info.shp)
    return {
      section,
      title: attrs.nome_fog ?? "",
      flight: attrs.data_vol!,
      ...(info?.shp === undefined ? {} : { archive: info.shp, licence: info.licence }),
      ...(url === undefined ? {} : { url, ...status(await head(url)) }),
      polygons,
    }
  },
)

const infos = await pool(lidarIndex!, LIMIT, ({ attrs, polygons }) => {
  const sheet = attrs.foglio!.toLowerCase()
  return ask("rt_cartoteca.lidar2k", polygons, (html) =>
    parseLidarGfi(html).find((i) => i.sheet === sheet && i.lot === attrs.lotto),
  )
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

// Each DBT block's archive, named inside its comune with the comune's every survey: the one of
// its ISTAT code and years.
const dbt = await pool(dbtIndex!, LIMIT, async ({ attrs, polygons }) => {
  const info = await ask("rt_cartoteca.dbt.2k", polygons, (html) =>
    parseDbtGfi(html).find(
      (i) =>
        i.archive?.startsWith(`DBT2K_${attrs.codistat}_`) &&
        i.from === Number(attrs.da_anno) &&
        i.to === Number(attrs.a_anno),
    ),
  )
  const url = info?.archive === undefined ? undefined : dbt2kUrl(info.archive)
  return {
    attrs,
    ...(info?.archive === undefined ? {} : { archive: info.archive, licence: info.licence }),
    ...(url === undefined ? {} : { url, ...status(await head(url)) }),
    polygons,
  }
})
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

const index: RtIndex = { part: part.key, box, ctr, ctr10k, lidar, dbt, dsm2021 }
const out = indexPath(part.key)
mkdirSync(join(out, ".."), { recursive: true })
writeFileSync(out, `${JSON.stringify(index)}\n`)

const missing = [
  ...lidar.filter((t) => t.dtm === undefined).map((t) => `${t.sheet} lot ${t.lot}`),
  ...ctr10k.filter((s) => s.archive === undefined).map((s) => `CTR 1:10 000 ${s.section}`),
  ...dbt
    .filter((b) => b.archive === undefined)
    .map((b) => `DBT ${b.attrs.nomecom} ${b.attrs.da_anno}–${b.attrs.a_anno}`),
]
const notOk = (e: { readonly status?: number }) => e.status !== undefined && e.status !== 200
const failed = [
  ...[...ctr, ...ctr10k, ...dbt, ...dsm2021].filter(notOk).map((e) => e.url),
  ...lidar.filter(notOk).map((t) => lidarUrl(t.dtm!)),
]
const lots = Object.groupBy(
  lidar,
  (t) => `${t.lot} ${t.year} ${t.owner ?? "?"} (${t.licence ?? "?"})`,
)
console.log({
  ctr2019: ctr.filter((c) => c.year === 2019).length,
  ctr2009: ctr.filter((c) => c.year === 2009).length,
  ctr10k: ctr10k.map((s) => s.archive ?? s.section),
  dbt: dbt.map((b) => b.archive ?? `${b.attrs.nomecom} ${b.attrs.da_anno}–${b.attrs.a_anno}`),
  lidarLots: Object.fromEntries(Object.entries(lots).map(([k, v]) => [k, v!.length])),
  dsm2021: dsm2021.length,
  noArchiveInGfi: missing,
  notOk: failed,
  wrote: relative(join(import.meta.dirname, "../.."), out),
})
