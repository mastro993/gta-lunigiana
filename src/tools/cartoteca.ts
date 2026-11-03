// Regione Toscana's Geoscopio services: the WMS/WFS endpoint, the download tree, readers for the
// answers the map tools parse, a WFS 1.0.0 GetFeature (GML 2, EPSG:3003 polygons) and the text/html
// GetFeatureInfo of the LiDAR, CTR 1:10 000 and DBT 1:2000 layers (the archive names with their
// MD5, the owner or the licence), and the cuts `fetch-rt` makes of the survey layers it pins.

import { subsetShp } from "./shp.ts"

/** The WMS and WFS endpoint; `map=` picks the service (`wmscartoteca`, `wmsucs`, `wmsofc`…). */
export const RT_WMS = "https://www502.regione.toscana.it/wmsraster/com.rt.wms.RTmap/wms"
/** The root of the download tree (`ctr2k/SHP/…`, `altimetria/lidar/dtm/…`). */
export const RT_DOWNLOAD = "https://www502.regione.toscana.it/geoscopio/download"

/** A CTR 1:2000 sheet's shapefile archive (`sheet` like `23D11`) of `year`'s edition, 2019 or 2009 (the old schema), in EPSG:6707. */
export const ctrUrl = (sheet: string, year = 2019): string =>
  `${RT_DOWNLOAD}/ctr2k/SHP/S_${sheet}_${year}_6707.zip`
/**
 * A CTR 1:10 000 section's shapefile archive, by its name with the MD5 (`S_249020_2010_6707_a797…`,
 * as the manifests list it), under its 1:50 000 sheet (the section's first three digits).
 */
export const ctr10kUrl = (name: string): string => {
  const fog50k = /^S_(\d{3})\d{3}_\d{4}_\d{4}_[\da-f]*$/.exec(name)?.[1]
  if (fog50k === undefined) throw new Error(`not a CTR 1:10 000 archive name: ${name}`)
  return `${RT_DOWNLOAD}/ctr10k/SHP/${fog50k}/${name}.zip`
}
/** A comune's DBT 1:2000 archive, by its name with the MD5 (`DBT2K_045014_PONTREMOLI_2010_2010_3003_21f4…`). */
export const dbt2kUrl = (name: string): string => {
  if (!/^DBT2K_\d{6}_\w+_[\da-f]{32}$/.test(name))
    throw new Error(`not a DBT 1:2000 archive name: ${name}`)
  return `${RT_DOWNLOAD}/dbtopografico/dbt2k/7z/${name}.7z`
}
/** A LiDAR DTM tile's archive, by its name with the MD5 (as the manifests list it). */
export const lidarUrl = (name: string): string => `${RT_DOWNLOAD}/altimetria/lidar/dtm/${name}.zip`
/** A 10 m DTM's archive, by its name with the MD5. */
export const dtm10Url = (name: string): string =>
  `${RT_DOWNLOAD}/altimetria/da_ctr10k/gb/dtm10x10/${name}.zip`
/** An element of the 2021 surface model. */
export const dsm2021Url = (element: string): string =>
  `${RT_DOWNLOAD}/altimetria/DSM_autocorrelazione_2021/DSM_${element}.zip`
/** Padding of a box asked of the WFS, m: the server's box filter sometimes loses features near the box's edge. */
export const WFS_PAD = 500
/** The land cover 1:10 000 of 2019 on its WFS, and the padding of a box asked of it. */
export const UCS = {
  map: "wmsucs",
  layer: "ms:rt_ucs.iducs.10k.2019.rt.full",
  pad: WFS_PAD,
} as const

/** A WFS 1.0.0 GetFeature of `layer` from service `map` over the EPSG:3003 `box`. */
export const wfsUrl = (map: string, layer: string, box: ReadonlyArray<number>): string =>
  `${RT_WMS}?map=${map}&service=WFS&version=1.0.0&request=GetFeature&typeName=${layer}&BBOX=${box.join(",")}`

/** One GML feature: its flat `ms:` attributes and its polygons, each outer ring then holes, flat [e0, n0, e1, n1…]. */
interface GmlFeature {
  readonly attrs: Record<string, string>
  readonly polygons: Array<Array<Array<number>>>
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
}
const unescape = (s: string): string =>
  s.replaceAll(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e]!)

/** The features of a WFS GetFeature answer; throws when the answer stops short of its end tag. */
export const parseGml = (gml: string): Array<GmlFeature> => {
  if (!gml.includes("</wfs:FeatureCollection>"))
    throw new Error(`WFS: truncated or failed answer: ${gml.slice(0, 200)}`)
  return gml
    .split("<gml:featureMember>")
    .slice(1)
    .map((f) => ({
      attrs: Object.fromEntries(
        [...f.matchAll(/<ms:(\w+)>([^<]*)<\/ms:\1>/g)].map(([, k, v]) => [k!, unescape(v!).trim()]),
      ),
      polygons: [...f.matchAll(/<gml:Polygon[\s\S]*?<\/gml:Polygon>/g)].map(([poly]) =>
        [...poly.matchAll(/<gml:coordinates>([^<]*)</g)].map(([, cs]) =>
          cs!
            .trim()
            .split(/\s+/)
            .flatMap((p) => p.split(",").map(Number)),
        ),
      ),
    }))
}

/**
 * A text/html GetFeatureInfo on the cartoteca's index `layer` (`rt_cartoteca.lidar2k`) at (lat, lon):
 * the features whose polygons hold the point, with no tolerance, so one asks inside a polygon, never
 * on a corner it shares (`insidePoints`). The LiDAR index's polygons are the tiles' data
 * footprints, the CTR 1:10 000's the sections' frames, the DBT's the comuni.
 */
export const gfiUrl = (layer: string, lat: number, lon: number): string => {
  const d = 0.0005
  return `${RT_WMS}?map=wmscartoteca&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&SRS=EPSG:4326&BBOX=${lon - d},${lat - d},${lon + d},${lat + d}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=text/html&FEATURE_COUNT=50&STYLES=`
}

/** Below a footprint's top, m, where GetFeatureInfo answers: it is blank 50–70 m below a tile's north edge. */
const NORTH_BAND = 100

/**
 * Points inside a footprint (outer rings and holes, flat EPSG:3003) to ask GetFeatureInfo at, best
 * first: on each of `lines` scanlines clear of the north band, the middle of every inside span,
 * widest first, then its quarters, then 2 m in from its ends. The server's footprints do not always
 * match the WFS's to the metre: a sliver may answer only near one edge.
 */
export const insidePoints = (
  polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  lines = 9,
): Array<[number, number]> => {
  const rings = polygons.flat()
  const ns = rings.flatMap((r) => r.filter((_, i) => i % 2 === 1))
  const bottom = Math.min(...ns),
    north = Math.max(...ns),
    top = north - bottom > NORTH_BAND ? north - NORTH_BAND : north
  const spans: Array<{ readonly a: number; readonly b: number; readonly n: number }> = []
  for (let k = 0; k < lines; k++) {
    const n = bottom + ((top - bottom) * (k + 0.5)) / lines
    // Even-odd crossings of every ring with the scanline: inside spans lie between pairs.
    const xs = rings
      .flatMap((r) =>
        r.flatMap((_, i) => {
          if (i % 2 === 1) return []
          const j = (i + 2) % r.length,
            [e0, n0, e1, n1] = [r[i]!, r[i + 1]!, r[j]!, r[j + 1]!]
          return n0 > n === n1 > n ? [] : [e0 + ((e1 - e0) * (n - n0)) / (n1 - n0)]
        }),
      )
      .toSorted((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) spans.push({ a: xs[i]!, b: xs[i + 1]!, n })
  }
  const widest = spans.toSorted((p, q) => q.b - q.a - (p.b - p.a))
  return [0.5, 0.25, 0.75, -2, 2].flatMap((t) =>
    widest.map(({ a, b, n }): [number, number] => [
      t < 0
        ? a + Math.min(-t, (b - a) / 2)
        : t > 1
          ? b - Math.min(t, (b - a) / 2)
          : a + (b - a) * t,
      n,
    ]),
  )
}

/** The licence of each LiDAR owner, as the GetFeatureInfo answer states it under the tiles. */
const LIDAR_LICENCES: Readonly<Record<string, string>> = {
  RT: "CC BY 4.0",
  MATTM: "CC BY-SA 3.0 IT",
}

/** The licence of a LiDAR tile from its owner: RT's are CC BY 4.0, MATTM's CC BY-SA 3.0 IT, any other "unknown". */
export const lidarLicence = (owner: string): string => LIDAR_LICENCES[owner] ?? "unknown"

/** One LiDAR tile in a GetFeatureInfo answer. */
interface LidarInfo {
  /** `Proprieta'`: RT, or MATTM (see `lidarLicence`). */
  readonly owner: string
  /** The 1:2000 sheet, lower case (`23d42`). */
  readonly sheet: string
  readonly lot: string
  readonly survey: string
  /** The DTM archive's name, MD5 suffix included, without `.zip`; absent when the tile offers none. */
  readonly dtm?: string
}

/** The features of a GetFeatureInfo answer, one block each, in the server's order. */
const blocksOf = (html: string): Array<string> => html.split("<!-- rt_found -->").slice(1)
/** The value a block gives after `label:` in bold, trimmed; empty when it gives none. */
const field = (block: string, label: string): string =>
  new RegExp(`${label}:<b>([^<]*)</b>`).exec(block)?.[1]?.trim() ?? ""
/** The Creative Commons licence a block links (`…/licenses/by/3.0/it` is `CC BY 3.0 IT`), or "unknown". */
const licenceOf = (block: string): string => {
  const path =
    /rel=["']license["'] href=["']https:\/\/creativecommons\.org\/licenses\/([^"']+)["']/.exec(
      block,
    )?.[1]
  return path === undefined
    ? "unknown"
    : `CC ${path.replace(/\/$/, "").replaceAll("/", " ").toUpperCase()}`
}

/** The LiDAR tiles in a GetFeatureInfo answer, in the server's order. */
export const parseLidarGfi = (html: string): Array<LidarInfo> =>
  blocksOf(html).map((block) => {
    const dtm = /href=\S*\/lidar\/dtm\/([^/>\s]+)\.zip>/.exec(block)?.[1]
    return {
      owner: field(block, "Proprieta'"),
      sheet: field(block, "Foglio").toLowerCase(),
      lot: field(block, "Lotto"),
      survey: field(block, "Rilievo"),
      ...(dtm === undefined ? {} : { dtm }),
    }
  })

/** One edition of a CTR 1:10 000 section in a GetFeatureInfo answer. */
interface Ctr10kInfo {
  /** The section (`249020`). */
  readonly section: string
  /**
   * The shapefile archive in RDN2008 (EPSG:6707; 7791 for the 2021 editions), its name with the
   * MD5 (the 2021 editions' have none) without `.zip`; absent when the edition offers none.
   */
  readonly shp?: string
  /** The licence the edition states: CC BY 4.0 for 2010 and 2021, CC BY 3.0 IT for 1995 and 1998. */
  readonly licence: string
}

/** The editions in a CTR 1:10 000 GetFeatureInfo answer (`rt_cartoteca.ctr10k`), oldest first as the server gives them. */
export const parseCtr10kGfi = (html: string): Array<Ctr10kInfo> =>
  blocksOf(html).map((block) => {
    // Its links are single-quoted, unlike the LiDAR's.
    const shp =
      /href='[^']*\/ctr10k\/SHP\/\d{3}\/(S_\d{6}_\d{4}_(?:6707|7791)_[\da-f]*)\.zip'/.exec(
        block,
      )?.[1]
    return {
      section: field(block, "Sezione"),
      ...(shp === undefined ? {} : { shp }),
      licence: licenceOf(block),
    }
  })

/** One block of the DBT 1:2000 in a GetFeatureInfo answer: a comune's archive of one survey. */
interface DbtInfo {
  /** The survey's first and last flight years (the WFS's `da_anno`, `a_anno`). */
  readonly from: number
  readonly to: number
  /** The archive's name, MD5 included, without `.7z`; absent when the block offers none. */
  readonly archive?: string
  readonly licence: string
}

/** The blocks in a DBT 1:2000 GetFeatureInfo answer (`rt_cartoteca.dbt.2k`): every survey of the comune holding the point, its archive named after its ISTAT code. */
export const parseDbtGfi = (html: string): Array<DbtInfo> =>
  blocksOf(html).map((block) => {
    const [, from = "", to = ""] = /Anni volo da (\d{4}) a (\d{4})<\/b>/.exec(block) ?? []
    // Its link is double-quoted.
    const archive = /href="[^"]*\/dbtopografico\/dbt2k\/7z\/([^"/]+)\.7z"/.exec(block)?.[1]
    return {
      from: Number(from),
      to: Number(to),
      ...(archive === undefined ? {} : { archive }),
      licence: licenceOf(block),
    }
  })

/**
 * The fields of the old schema's mapped area (`AC_a`, CTR 1:2000 2009 and CTR 1:10 000) that name
 * the people who led the work and did its survey, photography and drawing: a pinned copy, which is
 * published, leaves them blank. Its survey firm (`Ditta_es`) stays.
 */
export const SURVEYORS = ["Dir_lav", "Coll_top", "Coll_fot", "Coll_inf"] as const

/** An old-schema `AC_a` layer (main file and table) as `fetch-rt` pins it: every record, SURVEYORS blanked. */
export const withoutSurveyors = (
  shp: Buffer,
  dbf: Buffer,
): { readonly shp: Buffer; readonly dbf: Buffer } => {
  const copy = subsetShp(shp, dbf, () => true, SURVEYORS)
  if (copy === undefined) throw new Error("AC_a: no mapped area")
  return copy
}

/**
 * The records of a layer whose bounding box meets `box` [e0, n0, e1, n1], in the layer's own
 * coordinates, as a smaller shapefile (`subsetShp`), undefined when none does: `fetch-rt` pins a
 * comune's DBT this way round a part, not whole.
 */
export const meetingBox = (
  shp: Buffer,
  dbf: Buffer,
  [e0, n0, e1, n1]: ReadonlyArray<number>,
): { readonly shp: Buffer; readonly dbf: Buffer } | undefined =>
  subsetShp(
    shp,
    dbf,
    (_, b) => b !== undefined && b[0] <= e1! && b[2] >= e0! && b[1] <= n1! && b[3] >= n0!,
  )
