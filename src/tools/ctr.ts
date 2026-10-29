// Regione Toscana CTR 1:2000 (2019 flight, data/raw/rt/ctr) in local metres, clipped to the play
// area: buildings with their surveyed eave elevation, road surfaces with their street names, and
// the area the sheets map (the rail layers are `ctr-rail.ts`'s). `fetch-rt.ts` writes the files.
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { staticGrid } from "../sim/collide.ts"
import type { BuildingStyle } from "../sim/map/kinds.ts"
import { utm32ToLatLon } from "./crs.ts"
import {
  arcLengths,
  clipRing,
  flatRing,
  pointAt,
  pointInRing,
  ringBox,
  signedArea,
  toLocal,
  type P,
  type V,
} from "./geometry.ts"
import { readShp, type ShpRecord } from "./shp.ts"

/**
 * CTR codes read as buildings: what they are, a fixed facade style (otherwise plaster or stone by
 * place) and the wall height used when the record has no plausible elevations. Not buildings
 * here: overhangs (0206), canopies (0208), tents (0209), porticoes and loggias (0240, 0241), all
 * open at ground level, and semi-basements (0235).
 */
const BUILDING_CODES = {
  "0201": { kind: "house", h: 6 },
  "0202": { kind: "industrial", style: "industrial", h: 6 },
  "0203": { kind: "church", style: "church", h: 10 },
  "0204": { kind: "construction", h: 6 },
  "0205": { kind: "ruins", style: "ruin", h: 2.5 },
  "0207": { kind: "shed", h: 2.5 },
  "0210": { kind: "greenhouse", style: "industrial", h: 3 },
  "0211": { kind: "train_station", style: "station", h: 6 },
  "0212": { kind: "substation", style: "industrial", h: 4 },
  "0215": { kind: "greenhouse", style: "industrial", h: 3 },
  "0216": { kind: "barn", h: 5 },
  "0217": { kind: "tower", style: "tower", h: 12 },
  "0218": { kind: "silo", style: "industrial", h: 8 },
  "0244": { kind: "garage", h: 2.6 },
} as const satisfies Record<
  string,
  { readonly kind: string; readonly style?: BuildingStyle; readonly h: number }
>
type BuildingCode = keyof typeof BUILDING_CODES
const isBuildingCode = (code: string): code is BuildingCode => Object.hasOwn(BUILDING_CODES, code)

interface CtrBuilding {
  /** Negative, so it never collides with an OSM id: sheet, layer, record and polygon in decimal digits. */
  readonly id: number
  readonly kind: string
  readonly style?: BuildingStyle
  /**
   * Surveyed eave elevation (highest eave), m a.s.l. Its ground elevation is not used: on units
   * standing on other units it is their base, and the LiDAR terrain decides where walls start.
   */
  readonly eave?: number
  /** Wall height when there is no eave elevation (or it is implausible over the terrain), m. */
  readonly h: number
  readonly outer: ReadonlyArray<number>
  readonly holes?: ReadonlyArray<ReadonlyArray<number>>
}

/** A road surface polygon: `rings[0]` outer (counter-clockwise), then holes; `paved` = asphalt (else dirt). */
interface RoadArea {
  readonly name?: string
  readonly paved: boolean
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
}

/** What `readCtr` reads: buildings, road surfaces and the mapped area. */
export interface Ctr {
  readonly buildings: ReadonlyArray<CtrBuilding>
  readonly roadAreas: ReadonlyArray<RoadArea>
  /** Outer rings of the area each sheet maps (counter-clockwise). */
  readonly mapped: ReadonlyArray<ReadonlyArray<number>>
}

/** A CTR coordinate (EPSG:6707 easting, northing) in local metres. */
export const local = ([e, n]: readonly [number, number]): P => toLocal(...utm32ToLatLon(e, n))

/** One record of a CTR layer: its sheet ("23D19"), its place in the sheet's file (from 0) and its shape. */
export interface CtrRecord {
  readonly sheet: string
  readonly index: number
  readonly rec: ShpRecord
}

/** Every record of a layer over the sheets that have it (a sheet with no garages has no AGE), sheets in name order, records in file order. */
export const ctrRecords = (dir: string, layer: string): Array<CtrRecord> =>
  readdirSync(dir)
    .filter((f) => f.endsWith(`_${layer}.shp.gz`))
    .sort()
    .flatMap((f) => {
      const sheet = f.slice(0, -`_${layer}.shp.gz`.length)
      return readShp(join(dir, `${sheet}_${layer}`)).map((rec, index) => ({ sheet, index, rec }))
    })

/**
 * A record's polygons, each as flat outer (counter-clockwise) plus holes (clockwise), clipped to
 * the play area. Rings are sorted by size: one inside an earlier outer ring is its hole,
 * otherwise it starts a polygon (so the file's ring order and winding do not matter).
 */
export const polygonsOf = (r: ShpRecord): Array<Array<Array<number>>> => {
  const rings = r.parts
    .map((part) => part.map(local))
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
  const polys: Array<{ outer: Array<P>; flat: Array<number>; holes: Array<Array<P>> }> = []
  for (const ring of rings) {
    const host = polys.find((p) => pointInRing(ring[0]![0], ring[0]![1], p.flat))
    if (host === undefined) {
      polys.push({ outer: ring, flat: ring.flatMap(([x, y]) => [x, y]), holes: [] })
    } else {
      host.holes.push(ring)
    }
  }
  return polys.flatMap((p) => {
    const outer = flatRing(clipRing(p.outer), true)
    if (outer === undefined) return []
    return [
      [outer, ...p.holes.map((h) => flatRing(clipRing(h), false)).filter((h) => h !== undefined)],
    ]
  })
}

const SMALL_WORDS: ReadonlySet<string> = new Set([
  "A",
  "AL",
  "ALLA",
  "DA",
  "DEGLI",
  "DEI",
  "DEL",
  "DELLA",
  "DELLE",
  "DI",
  "E",
  "IL",
  "LA",
  "LE",
])
const title = (w: string) => w[0] + w.slice(1).toLowerCase()
/** One word of a street name: articles lower-case (elided ones too), Roman numerals upper-case, the rest title-cased. */
const streetWord = (w: string, i: number): string => {
  if (i > 0 && SMALL_WORDS.has(w)) return w.toLowerCase()
  if (i > 0 && /^[IVXLC]+$/.test(w)) return w
  const elided = /^(DELL|DALL|SULL|NELL|ALL|L)'(.+)$/.exec(w)
  return elided === null ? title(w) : `${elided[1]!.toLowerCase()}'${title(elided[2]!)}`
}
/** "VIA CASTEL DELL'AQUILA" -> "Via Castel dell'Aquila", "VIA XX SETTEMBRE" -> "Via XX Settembre". Abbreviated road kinds (S.P., S.C., S.V.) and localities are not street names. */
const streetName = (toponym: string): string | undefined => {
  if (!/^(VIA|PIAZZA|VICOLO|LARGO|SALITA) /.test(toponym)) return undefined
  return toponym.split(/\s+/).map(streetWord).join(" ")
}

/** Buildings, road surfaces and mapped areas of every sheet in `dir`. */
export const readCtr = (dir: string): Ctr => {
  /** A layer's records, each with an id from its sheet number, `base` and its index. */
  const layer = (name: string, base = 0) =>
    ctrRecords(dir, name).map(({ sheet, index, rec }) => ({
      rec,
      id: -(Number(sheet.slice(3)) * 1e5 + base + index),
    }))
  const buildings: Array<CtrBuilding> = []
  for (const { rec, id } of [...layer("AED"), ...layer("AGE", 5e4)]) {
    const code = rec.attrs.Cod_CTR!
    if (!isBuildingCode(code)) continue
    const spec: { readonly kind: string; readonly style?: BuildingStyle; readonly h: number } =
      BUILDING_CODES[code]
    const top = Number(rec.attrs.Qt_grmax ?? Number.NaN),
      eave = top > 0 ? top : undefined
    polygonsOf(rec).forEach(([outer, ...holes], k) => {
      buildings.push({
        id: id - k * 1e7,
        kind: spec.kind,
        ...(spec.style === undefined ? {} : { style: spec.style }),
        ...(eave === undefined ? {} : { eave }),
        h: spec.h,
        outer: outer!,
        ...(holes.length > 0 ? { holes } : {}),
      })
    })
  }
  const roadAreas = layer("AVI").flatMap(({ rec }) => {
    const name = streetName(rec.attrs.Toponimo ?? "")
    return polygonsOf(rec).map((rings) => ({
      ...(name === undefined ? {} : { name }),
      paved: rec.attrs.Cod_CTR === "0101",
      rings,
    }))
  })
  const mapped = layer("AZR").flatMap(({ rec }) => polygonsOf(rec).map((rings) => rings[0]!))
  return { buildings, roadAreas, mapped }
}

/** Road classes whose width and name come from the road surfaces they run over. */
const SURFACED: ReadonlySet<string> = new Set([
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "track",
])
const STATION = 4 // m between width stations along a road
const END = 6 // m at each end without stations: junctions widen the surface there
const MARCH = 0.2 // m per step when walking out to the surface edge
const REACH = 10 // m: wider than this on either side is a square or a car park, not the road
const WIDTH = { min: 3, max: 12 } // m, for the clamp (the marble truck is 2.45 m wide)

/** OSM surfaces the CTR may correct: the class defaults (an untagged road gets one of them). */
const GENERIC_SURFACES: ReadonlySet<string> = new Set(["asphalt", "unpaved"])

/**
 * Width, surface and name of each road from the CTR road surfaces under it: the median width
 * across the surface (perpendicular to the centreline) at stations every STATION m that lie on a
 * surface, asphalt or dirt by most stations, and the street name most of them share. A road takes
 * the width and surface when at least half its stations, and three or more, are on a surface. It
 * takes the name when that holds for its stations inside the area the sheets map (`mapped`): a
 * road that runs on into the unmapped mountains keeps the name its village stretch shows. OSM
 * names and specific OSM surfaces (cobblestone, gravel...) stay.
 */
export const fitRoads = (
  roads: ReadonlyArray<{
    readonly cls: string
    name?: string
    w: number
    surface: string
    readonly pts: ReadonlyArray<V>
  }>,
  areas: ReadonlyArray<RoadArea>,
  mapped: ReadonlyArray<ReadonlyArray<number>>,
): void => {
  const box = areas.map((a) => ringBox(a.rings[0]!))
  const grid = staticGrid(areas.length, (k) => box[k]!, 32)
  const mappedIn = staticGrid(mapped.length, (k) => ringBox(mapped[k]!), 64)
  const inMapped = (x: number, y: number): boolean => {
    let hit = false
    mappedIn(x, y, x, y, (k) => (hit ||= pointInRing(x, y, mapped[k]!)))
    return hit
  }
  /** The surface under (x, y), the first by index on an overlap, or -1. */
  const under = (x: number, y: number): number => {
    let hit = -1
    grid(x, y, x, y, (k) => {
      const [x0, y0, x1, y1] = box[k]!,
        [outer, ...holes] = areas[k]!.rings
      if (
        hit < 0 &&
        x >= x0 &&
        x <= x1 &&
        y >= y0 &&
        y <= y1 &&
        pointInRing(x, y, outer!) &&
        !holes.some((h) => pointInRing(x, y, h))
      )
        hit = k
    })
    return hit
  }
  const edge = (x: number, y: number, dx: number, dy: number) => {
    let d = 0
    while (d < REACH && under(x + dx * (d + MARCH), y + dy * (d + MARCH)) >= 0) d += MARCH
    return d
  }
  for (const road of roads) {
    if (!SURFACED.has(road.cls)) continue
    const arc = arcLengths(road.pts),
      length = arc.at(-1)!
    const widths: Array<number> = [],
      names = new Map<string, number>()
    let stations = 0,
      surveyed = 0,
      paved = 0
    for (let at = END; at <= length - END; at += STATION, stations++) {
      const { x, y, tx, ty } = pointAt(road.pts, arc, at),
        k = under(x, y)
      if (k >= 0 || inMapped(x, y)) surveyed++
      if (k < 0) continue
      const left = edge(x, y, -ty, tx),
        right = edge(x, y, ty, -tx)
      if (left >= REACH || right >= REACH) continue
      widths.push(left + right + MARCH)
      if (areas[k]!.paved) paved++
      const name = areas[k]!.name
      if (name !== undefined) names.set(name, (names.get(name) ?? 0) + 1)
    }
    if (widths.length < 3) continue
    const [best] = [...names].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))
    if (
      road.name === undefined &&
      widths.length * 2 >= surveyed &&
      best !== undefined &&
      best[1] * 2 >= widths.length
    )
      road.name = best[0]
    if (widths.length * 2 < stations) continue
    widths.sort((p, q) => p - q)
    road.w =
      Math.round(
        Math.min(WIDTH.max, Math.max(WIDTH.min, widths[Math.floor(widths.length / 2)]!)) * 10,
      ) / 10
    if (GENERIC_SURFACES.has(road.surface))
      road.surface = paved * 2 >= widths.length ? "asphalt" : "unpaved"
  }
}
