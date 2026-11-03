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
// - Road surfaces: `010104_ar_str`, paved where most of its carriageways (`010101_ac_vei`, the same
//   `ar_str_id`) are by area (`ac_vei_fon` 01; one without any is paved), named from `ar_str_uff`,
//   and the dirt tracks of `010105_ar_vms`.
// - The mapped area: the zones `000201_zona_r`.
import { DBT_RESIDUAL, gaussBoagaToLatLon } from "./crs.ts"
import {
  type BuildingSpec,
  ctrRecords,
  buildingsOf,
  polygonsOf,
  type Survey,
  specOf,
  streetName,
} from "./ctr.ts"
import { type P, TERRAIN_BOX, toLocal } from "./geometry.ts"
import { comune, localOf, surveyId } from "./survey-ids.ts"

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
  if (["06", "11", "22"].includes(ty) || uso === "05" || min === "18") return "0203" // baptistery, church, cathedral, place of worship, chapel
  if (ty === "07" || min === "05") return "0217" // bell tower, tower or gate
  if (uso === "060301" || uso === "060304") return "0211" // passenger station, halt
  if (uso === "080206") return "0212" // transformer station
  if (ty === "08" || uso.startsWith("08") || uso === "060302") return "0202" // shed, industrial, rail depot
  if (ty === "09" || uso === "0902" || uso === "0903") return "0216" // rural building, cowshed, hayloft
  if (min === "07") return "0244" // garage
  if (min === "14" || min === "17") return undefined
  if (min !== "" && min !== "-") return "0207" // huts, kiosks, tombs and the other minor buildings
  return "0201"
}

/** The industrial artefacts of `020201_mn_ind` read as buildings: greenhouses, silos, transformer cabins. */
const ARTEFACTS: Readonly<Record<string, string>> = { "13": "0210", "0703": "0218", "01": "0212" }

/** A unit's height over its foot, m, inside which it stands in for an implausible eave. */
const HEIGHT = { min: 1.5, max: 45 }

/** The artefacts' records are numbered from this, after the units'. */
const ARTEFACT_BASE = 5e6

/** The spec of CTR code `code`, which `kindOf` and `ARTEFACTS` only ever name from `BUILDING_CODES`. */
const spec = (code: string): BuildingSpec => {
  const s = specOf(code)
  if (s === undefined) throw new Error(`no building code ${code}`)
  return s
}

/** The outer ring's area, m², of every polygon of a record (flat counter-clockwise rings). */
const areaOf = (polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>): number =>
  polygons.reduce((sum, [outer]) => {
    let a = 0
    for (let i = 0, j = outer!.length - 2; i < outer!.length; j = i, i += 2)
      a += outer![j]! * outer![i + 1]! - outer![i]! * outer![j + 1]!
    return sum + a / 2
  }, 0)

/** The DBT 1:2000 in `dir`, clipped to `box`: see the module header. */
export const readDbt = (dir: string, box = TERRAIN_BOX): Survey => {
  const layer = (name: string) => ctrRecords(dir, name, "utf8")
  const buildings = [
    ...layer("un_vol").flatMap(({ sheet, index, rec }) => {
      const code = rec.attrs.un_vol_por === "01" ? kindOf(rec.attrs) : undefined
      if (code === undefined) return []
      if (index >= ARTEFACT_BASE)
        throw new Error(`${sheet} un_vol: record ${index} past ${ARTEFACT_BASE}`)
      const s = spec(code),
        av = Number(rec.attrs.un_vol_av)
      return buildingsOf(
        polygonsOf(rec, local, box),
        av >= HEIGHT.min && av <= HEIGHT.max ? { ...s, h: av } : s,
        Number(rec.attrs.un_vol_qe),
        (k) => surveyId("dbt2k", comune(sheet), localOf(index, k)),
      )
    }),
    ...layer("mn_ind").flatMap(({ sheet, index, rec }) => {
      const code = ARTEFACTS[rec.attrs.mn_ind_ty ?? ""]
      if (code === undefined) return []
      if (index >= ARTEFACT_BASE)
        throw new Error(`${sheet} mn_ind: record ${index} past ${ARTEFACT_BASE}`)
      return buildingsOf(
        polygonsOf(rec, local, box),
        spec(code),
        Number(rec.attrs.mn_ind_qe),
        (k) => surveyId("dbt2k", comune(sheet), localOf(ARTEFACT_BASE + index, k)),
      )
    }),
  ]
  // Each road's carriageway area in the box by surface.
  const surfaces = new Map<string, { paved: number; dirt: number }>()
  for (const { sheet, rec } of layer("ac_vei")) {
    const key = `${sheet} ${rec.attrs.ar_str_id}`,
      area = areaOf(polygonsOf(rec, local, box)),
      s = surfaces.get(key) ?? { paved: 0, dirt: 0 }
    if (rec.attrs.ac_vei_fon === "02") s.dirt += area
    else s.paved += area
    surfaces.set(key, s)
  }
  const roadAreas = [
    ...layer("ar_str").flatMap(({ sheet, rec }) => {
      const name = streetName(rec.attrs.ar_str_uff ?? ""),
        s = surfaces.get(`${sheet} ${rec.attrs.ar_str_id}`)
      return polygonsOf(rec, local, box).map((rings) => ({
        ...(name === undefined ? {} : { name }),
        paved: s === undefined || s.paved >= s.dirt,
        rings,
      }))
    }),
    ...layer("ar_vms").flatMap(({ rec }) =>
      polygonsOf(rec, local, box).map((rings) => ({ paved: false, rings })),
    ),
  ]
  const mapped = layer("zona_r").flatMap(({ rec }) =>
    polygonsOf(rec, local, box).map((rings) => rings[0]!),
  )
  return { buildings, roadAreas, mapped }
}
