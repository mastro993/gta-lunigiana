// Adapter (c): Regione Toscana's DBT 1:2000 (data/raw/rt/dbt2k, one comune's layers a file,
// `045014_un_vol`), in the national schema of DM 10/11/2011 (RT's catalogue v21 of 13 May 2014 names
// the codes), EPSG:3003, read into the survey record of ctr.ts. Its tables are UTF-8 and pad their
// numbers with NULs (shp.ts drops them). `fetch-rt.ts` writes the files.
// - Buildings: the volumetric units `020101_un_vol` standing on the ground (`un_vol_por` 01; not the
//   porticoes 03, underpasses 04, semi-basements 08 or covered passages 09, open at ground level or
//   under it), their kind from the building (`edifc_*`) or minor building (`edi_min_ty`) each belongs
//   to (`kindOf`); `un_vol_qe` is the eave (the archive's "In Gronda" spot heights, to 0.01 m) and
//   `un_vol_av` its height over the unit's foot, the height when the eave over the terrain is not
//   plausible. Plus the greenhouses, silos and transformer cabins of `020201_mn_ind`, which no unit
//   holds, their top (`mn_ind_qe`) as the eave.
// - Road surfaces: the carriageways `010101_ac_vei`, each paved unless `ac_vei_fon` is 02, named
//   from its own copy of `ar_str_uff`, and none in a tunnel (`ac_vei_sed` 06). At 1:2000 they leave
//   out the sidewalks, as the CTR's road surfaces do, and the road areas `010104_ar_str` hold them
//   (RT's catalogue v21), so a road area is read only where its road (`ar_str_id`) has no
//   carriageway (161 of Pontremoli's 703, urban and local streets, the old town's vicoli among
//   them): paved, named from `ar_str_uff`. Plus the dirt tracks of `010105_ar_vms`.
// - The mapped area: the zones `000201_zona_r`.
// Two comuni's archives of one survey both hold the land between them, under the same RT numbers
// (Minucciano's and Giuncugnano's of 2011: 982 units), each copy cut at its own archive's edge, so a
// record two archives hold is read once (`layer`).
import { DBT_RESIDUAL, gaussBoagaToLatLon } from "./crs.ts"
import {
  type BuildingSpec,
  type CtrRecord,
  ctrRecords,
  buildingsOf,
  polygonsOf,
  type RoadArea,
  type Survey,
  specOf,
  streetName,
} from "./ctr.ts"
import { type P, signedArea, TERRAIN_BOX, toLocal } from "./geometry.ts"
import type { ShpRecord } from "./shp.ts"
import { comune, surveyId } from "./survey-ids.ts"

/** A DBT coordinate (EPSG:3003 easting, northing) in local metres. */
const local = ([e, n]: readonly [number, number]): P =>
  toLocal(...gaussBoagaToLatLon(e, n, DBT_RESIDUAL))

/** A unit's attributes, as `kindOf` reads them. */
type Attrs = Readonly<Record<string, string>>

/**
 * The CTR building code (ctr.ts `BUILDING_CODES`) of a unit standing on the ground, from its
 * building's state, type and use or its minor building's type; the first rule that holds wins.
 * Undefined for the minor buildings open at the sides (loggias 17, pressurised tents 14).
 */
export const kindOf = (a: Attrs): string | undefined => {
  const ty = a.edifc_ty ?? "",
    uso = a.edifc_uso ?? "",
    min = a.edi_min_ty ?? ""
  if (a.edifc_stat === "01") return "0204" // under construction
  if (a.edifc_stat === "02" || min === "06") return "0205" // disused or ruined, archaeological
  if (ty === "07" || min === "05") return "0217" // bell tower (a place of worship too), tower or gate
  if (["06", "11", "22"].includes(ty) || uso === "05" || min === "18") return "0203" // baptistery, church, cathedral, place of worship, chapel
  if (uso === "0603" || uso === "060301" || uso === "060304") return "0211" // rail service (the NC5's), passenger station, halt
  if (uso === "080206") return "0212" // transformer station
  if (ty === "08" || uso.startsWith("08") || uso === "060302") return "0202" // shed, industrial, rail depot
  if (ty === "09" || uso === "09" || uso === "0902" || uso === "0903") return "0216" // rural building, agricultural use (the NC5's), cowshed, hayloft
  if (min === "07") return "0244" // garage
  if (min === "14" || min === "17") return undefined
  if (min !== "" && min !== "-") return "0207" // huts, kiosks, tombs and the other minor buildings
  return "0201"
}

/** The industrial artefacts of `020201_mn_ind` read as buildings: greenhouses, silos, transformer cabins. */
const ARTEFACTS: Readonly<Record<string, string>> = { "13": "0210", "0703": "0218", "01": "0212" }

/** A unit's height over its foot, m, inside which it stands in for an implausible eave. */
const HEIGHT = { min: 1.5, max: 45 }

/**
 * RT's own number of a record (`un_vol_id`, or `suolo_id` for an artefact: "RT" + its class + 2
 * digits + an 8-digit serial, "RT0201010201757565"), unique in its class and kept however a part's
 * box cuts the layer, where a record's place in the file is not.
 */
export const serialOf = (id: string | undefined, cls: string): number => {
  const m = /^RT(\d{6})\d\d(\d{8})$/.exec(id ?? "")
  if (m === null || m[1] !== cls) throw new Error(`not a DBT ${cls} id: ${id}`)
  return Number(m[2])
}

/** A serial is under this; the polygons of a record step by it. */
const SERIAL = 1e8
/** The artefacts' local ids start here, after the units'. */
const ARTEFACTS_FROM = 1e9

/** The local id (survey-ids.ts: under 2^31) of polygon `k` of the record with `serial`, its class's ids from `base`. */
const localId = (base: number, serial: number, k: number): number => {
  if (k >= 10) throw new Error(`DBT record ${serial} has more than 10 polygons`)
  return base + serial + k * SERIAL
}

/** The spec of CTR code `code`, which `kindOf` and `ARTEFACTS` only ever name from `BUILDING_CODES`. */
const spec = (code: string): BuildingSpec => {
  const s = specOf(code)
  if (s === undefined) throw new Error(`no building code ${code}`)
  return s
}

/**
 * The RT number of a record in the layers whose records each hold one: which one survey gives the
 * same in every comune's archive it maps.
 */
const RECORD_ID: Readonly<Record<string, string>> = {
  un_vol: "un_vol_id",
  mn_ind: "suolo_id",
  ac_vei: "ac_vei_id",
  ar_vms: "ar_vms_id",
}

/** The ground a record's rings cover, m²: an archive's edge cuts its copy of a record smaller. */
const groundOf = ({ rec }: CtrRecord): number =>
  rec.parts.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0)

/**
 * Layer `name`'s records in `dir`, a record two comuni's archives hold read once. In a layer of
 * `RECORD_ID`, the copy that covers the most ground, as the other archive cut its own at its edge
 * (the first comune's by ISTAT code on a tie). A road area's `ar_str_id` names its road, which
 * several of one archive's records share, so a road area is dropped only as the same road's copy of
 * the same rings. The zones are all read: the mapped area is their union, which each archive's cut
 * copy of a zone only shrinks.
 */
const layer = (dir: string, name: string): Array<CtrRecord> => {
  const records = ctrRecords(dir, name, "utf8"),
    key = RECORD_ID[name]
  if (key !== undefined) {
    const kept = new Map<string, CtrRecord>()
    for (const r of records) {
      const id = r.rec.attrs[key] ?? "",
        best = kept.get(id)
      if (id !== "" && (best === undefined || groundOf(r) > groundOf(best))) kept.set(id, r)
    }
    return records.filter((r) => {
      const id = r.rec.attrs[key] ?? ""
      return id === "" || kept.get(id) === r
    })
  }
  if (name !== "ar_str") return records
  const seen = new Set<string>()
  return records.filter(({ rec }) => {
    const copy = `${rec.attrs.ar_str_id} ${JSON.stringify(rec.parts)}`
    if (seen.has(copy)) return false
    seen.add(copy)
    return true
  })
}

/** The DBT 1:2000 in `dir`, clipped to `box`: see the module header. */
export const readDbt = (dir: string, box = TERRAIN_BOX): Survey => {
  const buildings = [
    ...layer(dir, "un_vol").flatMap(({ sheet, rec }) => {
      const code = rec.attrs.un_vol_por === "01" ? kindOf(rec.attrs) : undefined
      if (code === undefined) return []
      const s = spec(code),
        av = Number(rec.attrs.un_vol_av),
        serial = serialOf(rec.attrs.un_vol_id, "020101")
      return buildingsOf(
        polygonsOf(rec, local, box),
        av >= HEIGHT.min && av <= HEIGHT.max ? { ...s, h: av } : s,
        Number(rec.attrs.un_vol_qe),
        (k) => surveyId("dbt2k", comune(sheet), localId(0, serial, k)),
      )
    }),
    ...layer(dir, "mn_ind").flatMap(({ sheet, rec }) => {
      const code = ARTEFACTS[rec.attrs.mn_ind_ty ?? ""]
      if (code === undefined) return []
      const serial = serialOf(rec.attrs.suolo_id, "020201")
      return buildingsOf(
        polygonsOf(rec, local, box),
        spec(code),
        Number(rec.attrs.mn_ind_qe),
        (k) => surveyId("dbt2k", comune(sheet), localId(ARTEFACTS_FROM, serial, k)),
      )
    }),
  ]
  // A road's area holds its sidewalks wherever an archive maps a carriageway of it, its own copy read
  // or not.
  const carriageways = layer(dir, "ac_vei"),
    roadsWithOne = new Set(
      ctrRecords(dir, "ac_vei", "utf8").map(({ sheet, rec }) => `${sheet} ${rec.attrs.ar_str_id}`),
    )
  /** A record's road surfaces in the box, named from its `ar_str_uff` when that is a street name. */
  const surfaces = (rec: ShpRecord, paved: boolean): Array<RoadArea> => {
    const name = streetName(rec.attrs.ar_str_uff ?? "")
    return polygonsOf(rec, local, box).map((rings) => ({
      ...(name === undefined ? {} : { name }),
      paved,
      rings,
    }))
  }
  const roadAreas = [
    ...carriageways.flatMap(({ rec }) =>
      rec.attrs.ac_vei_sed === "06" ? [] : surfaces(rec, rec.attrs.ac_vei_fon !== "02"),
    ),
    ...layer(dir, "ar_str").flatMap(({ sheet, rec }) =>
      roadsWithOne.has(`${sheet} ${rec.attrs.ar_str_id}`) ? [] : surfaces(rec, true),
    ),
    ...layer(dir, "ar_vms").flatMap(({ rec }) =>
      polygonsOf(rec, local, box).map((rings) => ({ paved: false, rings })),
    ),
  ]
  const mapped = layer(dir, "zona_r").flatMap(({ rec }) =>
    polygonsOf(rec, local, box).map((rings) => rings[0]!),
  )
  return { buildings, roadAreas, mapped }
}
