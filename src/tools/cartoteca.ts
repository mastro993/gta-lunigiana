// Regione Toscana's Geoscopio services: the WMS/WFS endpoint, the download tree, and readers for
// the two answers the map tools parse, a WFS 1.0.0 GetFeature (GML 2, EPSG:3003 polygons) and the
// LiDAR layer's text/html GetFeatureInfo (the archive names with their MD5, the owner).

/** The WMS and WFS endpoint; `map=` picks the service (`wmscartoteca`, `wmsucs`, `wmsofc`…). */
export const RT_WMS = "https://www502.regione.toscana.it/wmsraster/com.rt.wms.RTmap/wms"
/** The root of the download tree (`ctr2k/SHP/…`, `altimetria/lidar/dtm/…`). */
export const RT_DOWNLOAD = "https://www502.regione.toscana.it/geoscopio/download"

/** A 2019 CTR 1:2000 sheet's shapefile archive (`sheet` like `23D11`). */
export const ctrUrl = (sheet: string): string => `${RT_DOWNLOAD}/ctr2k/SHP/S_${sheet}_2019_6707.zip`
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
 * A text/html GetFeatureInfo on the LiDAR index at (lat, lon): the tile whose data footprint holds
 * the point (the index's polygons are the footprints, not the sheet frames).
 */
export const lidarGfiUrl = (lat: number, lon: number): string => {
  const d = 0.0005
  return `${RT_WMS}?map=wmscartoteca&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=rt_cartoteca.lidar2k&QUERY_LAYERS=rt_cartoteca.lidar2k&SRS=EPSG:4326&BBOX=${lon - d},${lat - d},${lon + d},${lat + d}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=text/html&FEATURE_COUNT=50&STYLES=`
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

/** The LiDAR tiles in a GetFeatureInfo answer, in the server's order. */
export const parseLidarGfi = (html: string): Array<LidarInfo> =>
  html
    .split("<!-- rt_found -->")
    .slice(1)
    .map((block) => {
      const field = (label: string) =>
        new RegExp(`${label}:<b>([^<]*)</b>`).exec(block)?.[1]?.trim() ?? ""
      const dtm = /href=\S*\/lidar\/dtm\/([^/>\s]+)\.zip>/.exec(block)?.[1]
      return {
        owner: field("Proprieta'"),
        sheet: field("Foglio").toLowerCase(),
        lot: field("Lotto"),
        survey: field("Rilievo"),
        ...(dtm === undefined ? {} : { dtm }),
      }
    })
