// Regione Toscana's orthophoto WMS services for `ortho.ts`: the two endpoints, which layers may be
// traced (the licence table), a reader for their WMS 1.3.0 GetCapabilities, and the GetMap
// requests that cover a local rectangle, split into tiles no wider than the server takes.

import { RT_WMS } from "./cartoteca.ts"
import { fromLocal } from "./geometry.ts"
import type { Rect } from "./region.ts"

/** The orthophoto services: `map=wmsofc` (the 1954–2017 flights) and `map=owsofc_rt` (the 20 cm 2021–2025 flights). */
export const ORTHO_SERVICES: ReadonlyArray<string> = [
  `${RT_WMS}?map=wmsofc`,
  "https://www502.regione.toscana.it/ows_ofc/com.rt.wms.RTmap/wms?map=owsofc_rt",
]

/** What may be done with an orthophoto layer: traced when `licence` is set, else only looked at. */
export interface OrthoLicence {
  readonly owner: string
  /** The licence Regione Toscana's metadata record grants; absent: look only, never trace. */
  readonly licence?: string
  /** The evidence: the layer's abstract or attribution, and the metadata record it links. */
  readonly why: string
}

const rows = (names: string, licence: OrthoLicence): Array<[string, OrthoLicence]> =>
  names.split(" ").map((name) => [`rt_ofc.${name}`, licence])

const RT_2K = '1:2000, "proprieta\' RT"; RT record bb0bc75a (Orto2K 2006–2017): CC BY'
const NO_RECORD = 'no RT metadata record (it links "dataset non RT")'

/**
 * Every orthophoto layer of both services (GetCapabilities read 2026-10-29) and whether it may be
 * traced: only layers whose abstract names no owner but Regione Toscana (or IGM-RT) and whose RT
 * metadata record grants CC BY (issue #3, "Licences": AGEA flights and Blom's 2011 Aulla flight are
 * look only). Only a band variant (`VARIANTS`) takes its base layer's row.
 */
const ORTHO_LICENCES: ReadonlyMap<string, OrthoLicence> = new Map([
  ...rows(
    "2k09 2k10 2k11 2k11.fipo 2k12.24bit 2k12.32bit 2k13.32bit 2k15.32bit 2k16.32bit 2k17.32bit 2k17_apuane.32bit",
    { owner: "Regione Toscana", licence: "CC BY", why: RT_2K },
  ),
  ...rows("5k21.32bit", {
    owner: "Regione Toscana",
    licence: "CC BY 4.0",
    why: '20 cm, "di proprietà di Regione Toscana"; RT record 763cc2f1 (2021): CC BY 4.0',
  }),
  ...rows("5k23.32bit 5k24.32bit", {
    owner: "Regione Toscana",
    licence: "CC BY 4.0",
    why: '20 cm, "di proprietà di Regione Toscana"; RT record 66ca3807 (2023): CC BY 4.0',
  }),
  ...rows("10k75", {
    owner: "Regione Toscana",
    licence: "CC BY",
    why: '1975–76, "di proprietà della Regione Toscana"; RT record 8366cf42: CC BY',
  }),
  ...rows("10k78", {
    owner: "Regione Toscana",
    licence: "CC BY",
    why: '1978, "propr. RT"; RT record add8bcf0: CC BY',
  }),
  ...rows("10k54", {
    owner: "IGM-RT",
    licence: "CC BY",
    why: '1954, "propr. IGM-RT"; RT record e0eb1209: CC BY',
  }),
  ...rows("10k63 10k65 10k68", { owner: "IGM-RT", why: `"propr. IGM-RT", ${NO_RECORD}` }),
  ...rows("10k88 2k06 5k12", { owner: "Regione Toscana", why: `"propr. RT" but ${NO_RECORD}` }),
  ...rows("10k96 10k99 10k00 10k01 10k02 10k03 10k04 10k05 10k06 10k0304 10k08 10k09 10k10 10k13", {
    owner: "AGEA",
    why: '"propr. AGEA": AGEA flights carry no licence',
  }),
  ...rows("10k07", { owner: "BLOM-CGR", why: `"propr. BLOM-C.G.R.", ${NO_RECORD}` }),
  ...rows("2k11.aulla", {
    owner: "Blom",
    why: 'the 2011 Aulla flood flight, "OFC11 BLOM_CGR_RT": Blom owns it',
  }),
  ...rows("5k25.32bit", {
    owner: "AGEA",
    why: '"realizzate a partire da fotogrammi di proprietà AGEA", and no metadata record of its own',
  }),
])

/**
 * The suffixes the services give a flight's other renderings of the same photos (GetCapabilities
 * read 2026-10-29): false colour, near infrared, grey and the sheet index. Any other suffix may be
 * another flight (`2k11.aulla` is Blom's, `2k11` RT's), so it takes no row.
 */
const VARIANTS = [".4R1G2B", ".4R2G3B", ".1R4G2B", ".nir", ".grey.rt", ".qu"]

/** The licence row of `layer`, or of the base layer it is a band variant of; undefined (look only) for any other layer. */
export const licenceOf = (layer: string): OrthoLicence | undefined => {
  const variant = VARIANTS.find((suffix) => layer.endsWith(suffix))
  return (
    ORTHO_LICENCES.get(layer) ??
    (variant === undefined ? undefined : ORTHO_LICENCES.get(layer.slice(0, -variant.length)))
  )
}

/** One layer of a GetCapabilities answer. */
export interface WmsLayer {
  readonly title: string
  /** The `<Attribution><Title>`, when the layer has one. */
  readonly attribution?: string
  /** [west, south, east, north], degrees; NaN where the layer inherits its parent's. */
  readonly box: Rect
}

/** What `ortho.ts` reads from a WMS 1.3.0 GetCapabilities answer. */
export interface Capabilities {
  readonly maxWidth: number
  readonly maxHeight: number
  /** The GetMap formats. */
  readonly formats: ReadonlyArray<string>
  readonly crs: ReadonlyArray<string>
  readonly layers: ReadonlyMap<string, WmsLayer>
}

const unescapeXml = (s: string): string =>
  s
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")

/** The first `<tag>` text in `xml`, unescaped and trimmed. */
const tagText = (xml: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)
  return m === null ? undefined : unescapeXml(m[1]!).trim()
}

/** Reads a WMS 1.3.0 GetCapabilities answer; a missing MaxWidth or MaxHeight reads as no limit, and an answer that lists no layer (a WMS error) throws. */
export const parseCapabilities = (xml: string): Capabilities => {
  const getMap = /<GetMap>([\s\S]*?)<\/GetMap>/.exec(xml)?.[1] ?? ""
  const layers = new Map<string, WmsLayer>()
  // A layer's own elements come before its first child layer, so each chunk starts with its own.
  for (const chunk of xml.split(/<Layer[\s>]/).slice(1)) {
    const name = tagText(chunk, "Name")
    if (name === undefined) continue
    const num = (tag: string) => Number(tagText(chunk, tag))
    const attribution = /<Attribution>\s*<Title>([^<]*)<\/Title>/.exec(chunk)?.[1]
    layers.set(name, {
      title: tagText(chunk, "Title") ?? name,
      ...(attribution === undefined ? {} : { attribution: unescapeXml(attribution).trim() }),
      box: [
        num("westBoundLongitude"),
        num("southBoundLatitude"),
        num("eastBoundLongitude"),
        num("northBoundLatitude"),
      ],
    })
  }
  // A WMS error comes back as XML with HTTP 200.
  if (layers.size === 0)
    throw new Error(`no layer in the GetCapabilities answer: ${xml.slice(0, 400)}`)
  return {
    maxWidth: Number(tagText(xml, "MaxWidth") ?? Infinity),
    maxHeight: Number(tagText(xml, "MaxHeight") ?? Infinity),
    formats: [...getMap.matchAll(/<Format>([^<]*)<\/Format>/g)].map(([, f]) => f!.trim()),
    crs: [...new Set([...xml.matchAll(/<CRS>([^<]*)<\/CRS>/g)].map(([, c]) => c!.trim()))],
    layers,
  }
}

/** A crop: the local rectangle and the pixel grid laid over it, `w` × `h`, row 0 at the north edge. */
export interface Frame {
  readonly rect: Rect
  readonly w: number
  readonly h: number
}

/** The frame of `rect` at about `px` metres per pixel (whole pixels, at least one a side). */
export const frameOf = (rect: Rect, px: number): Frame => ({
  rect,
  w: Math.max(1, Math.round((rect[2] - rect[0]) / px)),
  h: Math.max(1, Math.round((rect[3] - rect[1]) / px)),
})

/** Local (x, y) in the frame's pixels: x grows east, rows grow south, so north is up. */
export const toPx = (
  { rect: [x0, y0, x1, y1], w, h }: Frame,
  x: number,
  y: number,
): [number, number] => [((x - x0) * w) / (x1 - x0), ((y1 - y) * h) / (y1 - y0)]

/** One GetMap request: its pixel offset (`i`, `j`) and size in the frame, and its EPSG:4326 box [lon0, lat0, lon1, lat1]. */
export interface Tile {
  readonly i: number
  readonly j: number
  readonly w: number
  readonly h: number
  readonly bbox: readonly [number, number, number, number]
}

/** `n` pixels in ceil(n / max) near-equal runs: [start, length] each. */
const runs = (n: number, max: number): Array<[number, number]> => {
  const k = Math.ceil(n / max)
  return Array.from({ length: k }, (_, t) => {
    const a = Math.round((t * n) / k)
    return [a, Math.round(((t + 1) * n) / k) - a]
  })
}

/**
 * The GetMap tiles that cover the frame, none over `max` pixels a side. A WMS box is the outer edge
 * of its pixels, and the local frame and EPSG:4326 are both linear in longitude and latitude, so
 * each tile's box is its pixel edges taken through `fromLocal`: neighbours share edges exactly.
 */
export const tilesOf = (f: Frame, max: number): Array<Tile> => {
  const [x0, y0, x1, y1] = f.rect
  const mx = (x1 - x0) / f.w,
    my = (y1 - y0) / f.h
  return runs(f.h, max).flatMap(([j, h]) =>
    runs(f.w, max).map(([i, w]): Tile => {
      const [lat0, lon0] = fromLocal(x0 + i * mx, y1 - (j + h) * my)
      const [lat1, lon1] = fromLocal(x0 + (i + w) * mx, y1 - j * my)
      return { i, j, w, h, bbox: [lon0, lat0, lon1, lat1] }
    }),
  )
}

/** The WMS 1.1.1 GetMap of `layer` on `service` for one tile, as JPEG (1.1.1 takes EPSG:4326 boxes as lon, lat). */
export const getMapUrl = (service: string, layer: string, t: Tile): string =>
  `${service}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=${t.bbox.map((v) => v.toFixed(9)).join(",")}&WIDTH=${t.w}&HEIGHT=${t.h}&FORMAT=image/jpeg`
