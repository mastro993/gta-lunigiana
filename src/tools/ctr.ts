// Regione Toscana's surveys of the ground, in local metres, each read into one record (`Survey`):
// buildings with their surveyed eave elevation or height, road surfaces with their street names,
// and the area the source maps. Adapter (a) reads the CTR 1:2000 of 2019 (data/raw/rt/ctr:
// `readCtr`), adapter (b) the old schema of the CTR 1:2000 of 2009 and the CTR 1:10 000 of 2010
// (rt/ctr2009, rt/ctr10k: `readOldCtr`); dbt.ts holds adapter (c), the DBT 1:2000, and surveys.ts
// merges them by priority. `fitRoads` fits the roads to the road surfaces. The rail layers are
// `ctr-rail.ts`'s; `fetch-rt.ts` writes the files.
import { existsSync, readdirSync } from "node:fs"
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
  TERRAIN_BOX,
  toLocal,
  type P,
  type V,
} from "./geometry.ts"
import { apartFrom } from "./overlap.ts"
import { type DbfEncoding, readShp, type ShpRecord } from "./shp.ts"
import { localOf, section10k, sheet2k, type SurveySource, surveyId } from "./survey-ids.ts"

/** What a building code says: its kind, a fixed facade style (otherwise plaster or stone by place) and its default wall height, m. */
export interface BuildingSpec {
  readonly kind: string
  readonly style?: BuildingStyle
  readonly h: number
}

/**
 * CTR codes read as buildings: what they are, a fixed facade style (otherwise plaster or stone by
 * place) and the wall height used when the record has no plausible elevations. Not buildings
 * here: overhangs (0206), canopies (0208), tents (0209), porticoes and loggias (0240, 0241), all
 * open at ground level, and semi-basements (0235). The old schema uses the same codes
 * (`AE_a.Codice`, and 0205 for the ruins it draws as `ML_l` lines).
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
} as const satisfies Record<string, BuildingSpec>
type BuildingCode = keyof typeof BUILDING_CODES
const isBuildingCode = (code: string): code is BuildingCode => Object.hasOwn(BUILDING_CODES, code)

/** A CTR code's building, or undefined when the code is not one. */
export const specOf = (code: string): BuildingSpec | undefined =>
  isBuildingCode(code) ? BUILDING_CODES[code] : undefined

/** A surveyed building, as every survey source is read into it. */
export interface SurveyBuilding {
  /** Negative, so it never collides with an OSM id, and unique over every source and section (survey-ids.ts). */
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
export interface RoadArea {
  readonly name?: string
  readonly paved: boolean
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
}

/** What a survey source maps: its buildings, road surfaces and mapped area. */
export interface Survey {
  readonly buildings: ReadonlyArray<SurveyBuilding>
  readonly roadAreas: ReadonlyArray<RoadArea>
  /** Outer rings of the area each sheet, section or zone maps (counter-clockwise). */
  readonly mapped: ReadonlyArray<ReadonlyArray<number>>
}

/** A CTR coordinate (EPSG:6707 easting, northing) in local metres. */
export const local = ([e, n]: readonly [number, number]): P => toLocal(...utm32ToLatLon(e, n))

/** One record of a survey layer: its sheet, section or comune ("23D19"), its place in that file (from 0) and its shape. */
export interface CtrRecord {
  readonly sheet: string
  readonly index: number
  readonly rec: ShpRecord
}

/**
 * Every record of a layer over the sheets that have it (a sheet with no garages has no AGE), sheets
 * in name order, records in file order: the files `<sheet>_<layer>.shp.gz` in `dir`, none when it
 * does not exist.
 */
export const ctrRecords = (
  dir: string,
  layer: string,
  encoding: DbfEncoding = "latin1",
): Array<CtrRecord> =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(`_${layer}.shp.gz`))
        .sort()
        .flatMap((f) => {
          const sheet = f.slice(0, -`_${layer}.shp.gz`.length)
          return readShp(join(dir, `${sheet}_${layer}`), encoding).map((rec, index) => ({
            sheet,
            index,
            rec,
          }))
        })
    : []

/**
 * A record's polygons, each as flat outer (counter-clockwise) plus holes (clockwise), in local metres
 * through `project` (the CTR's EPSG:6707 by default) and clipped to `box` (the built terrain's,
 * `TERRAIN_BOX`, by default). Rings are sorted by size: one inside an earlier outer ring is its hole,
 * otherwise it starts a polygon (so the file's ring order and winding do not matter).
 */
export const polygonsOf = (
  r: ShpRecord,
  project: (en: readonly [number, number]) => P = local,
  box = TERRAIN_BOX,
): Array<Array<Array<number>>> => {
  const rings = r.parts
    .map((part) => part.map(project))
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
    const outer = flatRing(clipRing(p.outer, box), true)
    if (outer === undefined) return []
    return [
      [
        outer,
        ...p.holes.map((h) => flatRing(clipRing(h, box), false)).filter((h) => h !== undefined),
      ],
    ]
  })
}

/** The buildings a record's polygons make, polygon `k` numbered `id(k)`, with `spec`'s kind, style and height and the eave elevation when one is surveyed (positive). */
export const buildingsOf = (
  polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  spec: BuildingSpec,
  eave: number,
  id: (k: number) => number,
): Array<SurveyBuilding> =>
  polygons.map(([outer, ...holes], k) => ({
    id: id(k),
    kind: spec.kind,
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(eave > 0 ? { eave } : {}),
    h: spec.h,
    outer: outer!,
    ...(holes.length > 0 ? { holes } : {}),
  }))

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
  "DELLO",
  "DI",
  "E",
  "IL",
  "LA",
  "LE",
])
/** Articles and prepositions that elide before a vowel: "dell'Aquila", "d'Italia". */
const ELIDED: ReadonlySet<string> = new Set(["ALL", "D", "DALL", "DELL", "L", "NELL", "SULL"])
/** The accented vowel a final vowel and apostrophe stand for in the CTR's and the DBT's ASCII: "UNITA'" is "Unità". */
const GRAVE: Readonly<Record<string, string>> = { A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" }
const title = (w: string) => w[0] + w.slice(1).toLowerCase()
/** One word of a street name: a final apostrophe the accent, articles lower-case (elided ones too), Roman numerals and initials ("G.B.") upper-case, the rest title-cased, both sides of an elision ("Sant'Antonio"). */
const streetWord = (raw: string, i: number): string => {
  const w = raw.replace(/([AEIOU])'$/, (_, v: string) => GRAVE[v]!)
  if (i > 0 && SMALL_WORDS.has(w)) return w.toLowerCase()
  if (i > 0 && /^[IVXLC]+$/.test(w)) return w
  if (/^([A-Z]\.)+$/.test(w)) return w
  const elided = /^([A-Z]+)'(.+)$/.exec(w)
  if (elided === null) return title(w)
  const head = elided[1]!
  return `${ELIDED.has(head) ? head.toLowerCase() : title(head)}'${title(elided[2]!)}`
}
/** "VIA CASTEL DELL'AQUILA" -> "Via Castel dell'Aquila", "PIAZZA UNITA' D'ITALIA" -> "Piazza Unità d'Italia". Abbreviated road kinds (S.P., S.C., S.V.) and localities are not street names. */
export const streetName = (toponym: string): string | undefined => {
  if (!/^(VIA|VIALE|PIAZZA|PIAZZALE|PIAZZETTA|VICOLO|LARGO|SALITA) /.test(toponym)) return undefined
  return toponym.split(/\s+/).map(streetWord).join(" ")
}

/** A 1:2000 sheet's records are numbered under this in each layer: AED's and AE_a's from 0, AGE's and ML_l's from it. */
const LAYER = 5e4

/** The local number of record `index` of sheet `sheet`'s layer from `base` (as the 2019 ids always were). */
const sheetUnit = (sheet: number, base: number, index: number): number => {
  if (index >= LAYER) throw new Error(`sheet ${sheet}: record ${index} past ${LAYER} in a layer`)
  return sheet * 1e5 + base + index
}

/**
 * Adapter (a), the CTR 1:2000 of 2019 in `dir`: buildings (`AED` volumetric units, `AGE` garages
 * and ruins; `Cod_CTR` through `BUILDING_CODES`, `Qt_grmax` the eave), road surfaces (`AVI`,
 * 0101 asphalt, 0102 dirt, `Toponimo`) and the mapped area (`AZR`), clipped to `box`.
 */
export const readCtr = (dir: string, box = TERRAIN_BOX): Survey => {
  const buildings: Array<SurveyBuilding> = []
  for (const [layer, base] of [
    ["AED", 0],
    ["AGE", LAYER],
  ] as const)
    for (const { sheet, index, rec } of ctrRecords(dir, layer)) {
      const spec = specOf(rec.attrs.Cod_CTR!)
      if (spec === undefined) continue
      const { section, sheet: n } = sheet2k(sheet),
        unit = sheetUnit(n, base, index)
      buildings.push(
        ...buildingsOf(polygonsOf(rec, local, box), spec, Number(rec.attrs.Qt_grmax), (k) =>
          surveyId("ctr2019", section, localOf(unit, k)),
        ),
      )
    }
  const roadAreas = ctrRecords(dir, "AVI").flatMap(({ rec }) => {
    const name = streetName(rec.attrs.Toponimo ?? "")
    return polygonsOf(rec, local, box).map((rings) => ({
      ...(name === undefined ? {} : { name }),
      paved: rec.attrs.Cod_CTR === "0101",
      rings,
    }))
  })
  const mapped = ctrRecords(dir, "AZR").flatMap(({ rec }) =>
    polygonsOf(rec, local, box).map((rings) => rings[0]!),
  )
  return { buildings, roadAreas, mapped }
}

/** The old schema's road surfaces: 0101 asphalt, 0102 dirt (not 0114, track in a tunnel, nor 0140, the rail bed). */
const OLD_ROAD_CODES: ReadonlySet<string> = new Set(["0101", "0102"])
/** The old schema's `Sede` of a road surface in a tunnel: no ground to pave (`ctr-rail.ts` reads the rail's the same way). */
const IN_TUNNEL = "054"
/** The old schema's code of a ruin, a line in `ML_l`: a closed one outlines its walls. */
const RUIN = "0205"
/** A 1:10 000 section's records are numbered under this in each layer: AE_a's from 0, ML_l's from it. */
const SECTION_LAYER = 5e6

/** Whether a line closes on itself: its first vertex is its last. */
const closed = (line: ReadonlyArray<readonly [number, number]>): boolean =>
  line[0]![0] === line.at(-1)![0] && line[0]![1] === line.at(-1)![1]

/**
 * Adapter (b), the CTR's old schema in `dir`, as the CTR 1:2000 of 2009 (`ctr2009`, files by sheet,
 * `22D04_AE_a`) and the CTR 1:10 000 of 2010 (`ctr10k`, files by section, `249020_AE_a`) share it:
 * buildings (`AE_a`, `Codice` through `BUILDING_CODES`, `Quota_gr` the eave), ruins (the closed
 * `ML_l` lines of code 0205, through `BUILDING_CODES` with no eave: an open wall stub makes no
 * footprint; but a ring sharing half the smaller one's area with a unit of its sheet, which then
 * draws one building twice: `apartFrom`), road surfaces (`AV_a`, 0101 asphalt and 0102 dirt,
 * `Toponimo`, none in a tunnel) and the mapped area (`AC_a`), clipped to `box`. The schema has no
 * garage code (0244).
 */
export const readOldCtr = (
  dir: string,
  source: Extract<SurveySource, "ctr2009" | "ctr10k">,
  box = TERRAIN_BOX,
): Survey => {
  /** Record `index` of layer `layer` (AE_a 0, ML_l 1) of `key`: its section and local number. */
  const unitOf = (key: string, layer: 0 | 1, index: number) => {
    if (source === "ctr10k") {
      if (index >= SECTION_LAYER)
        throw new Error(`section ${key}: record ${index} past ${SECTION_LAYER} in a layer`)
      return { section: section10k(key), unit: layer * SECTION_LAYER + index }
    }
    const { section, sheet } = sheet2k(key)
    return { section, unit: sheetUnit(sheet, layer * LAYER, index) }
  }
  /** The buildings `make` reads from layer `layer`'s records (AE_a 0, ML_l 1), by sheet or section, in file order. */
  const bySheet = (
    layer: 0 | 1,
    make: (rec: ShpRecord, id: (k: number) => number) => Array<SurveyBuilding>,
  ) => {
    const of = new Map<string, Array<SurveyBuilding>>()
    for (const { sheet, index, rec } of ctrRecords(dir, layer === 0 ? "AE_a" : "ML_l")) {
      const made = make(rec, (k) => {
        const { section, unit } = unitOf(sheet, layer, index)
        return surveyId(source, section, localOf(unit, k))
      })
      if (made.length === 0) continue
      const kept = of.get(sheet)
      if (kept === undefined) of.set(sheet, made)
      else kept.push(...made)
    }
    return of
  }
  const units = bySheet(0, (rec, id) => {
    const spec = specOf(rec.attrs.Codice!)
    return spec === undefined
      ? []
      : buildingsOf(polygonsOf(rec, local, box), spec, Number(rec.attrs.Quota_gr), id)
  })
  const ruins = bySheet(1, (rec, id) =>
    rec.attrs.Codice === RUIN
      ? buildingsOf(
          polygonsOf({ ...rec, parts: rec.parts.filter(closed) }, local, box),
          specOf(RUIN)!,
          0,
          id,
        )
      : [],
  )
  const buildings = [
    ...[...units.values()].flat(),
    ...[...ruins].flatMap(([sheet, rings]) => apartFrom(units.get(sheet) ?? [], rings)),
  ]
  const roadAreas = ctrRecords(dir, "AV_a").flatMap(({ rec }) => {
    if (!OLD_ROAD_CODES.has(rec.attrs.Codice!) || rec.attrs.Sede === IN_TUNNEL) return []
    const name = streetName(rec.attrs.Toponimo ?? "")
    return polygonsOf(rec, local, box).map((rings) => ({
      ...(name === undefined ? {} : { name }),
      paved: rec.attrs.Codice === "0101",
      rings,
    }))
  })
  const mapped = ctrRecords(dir, "AC_a").flatMap(({ rec }) =>
    polygonsOf(rec, local, box).map((rings) => rings[0]!),
  )
  return { buildings, roadAreas, mapped }
}

/** Road classes whose width and name come from the road surfaces they run over. */
const SURFACED: ReadonlySet<string> = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
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
