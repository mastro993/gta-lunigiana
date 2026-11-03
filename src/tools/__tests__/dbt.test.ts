// Adapter (c) on a fixture cut from Pontremoli's DBT 1:2000 (DBT2K_045014_PONTREMOLI_2010_2010.7z,
// its shp_dbt layers): records kept with `subsetShp` (shp.ts) by their index in the layer's file,
// in file order (so a record's index here is its place among those kept), gzipped at level 9
// (scratch script, not kept), as fixtures/dbt2k/045014_<layer>:
// - un_vol (020101): #1815 hut (edi_min_ty 01), #1816 garage (07), #1976 house, #2156 loggia (17),
//   #2229 station (edifc_uso 060301), #2238 rural (edifc_ty 09), #2668 tower (edi_min_ty 05), #2732
//   shed (edifc_ty 08), #3472 church (11), #3496 under construction (edifc_stat 01), #4700 disused
//   (02), #6925 bell tower (07), #7012 a courtyard, #7127 chapel (edi_min_ty 18), #7582 por 08,
//   #11079 un_vol_av 1.06 m, #11311 por 03, #11404 por 04;
// - mn_ind (020201): #28 transformer cabin (01), #58 tank (0702), #63 greenhouse (13), #77 silo (0703);
// - ar_str (010104): #22 (no carriageway), #362 "VIA BELMESSERI", #522 (a paved and a dirt
//   carriageway), #548 (a dirt one), #650 "LOCALITÀ GUINADI"; ac_vei (010101): their 4 carriageways
//   (by ar_str_id); ar_vms (010105): #15, #230; zona_r (000201): #10, its zona_r_dt (the survey
//   firms) blanked.
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { DBT_RESIDUAL, gaussBoagaToLatLon } from "../crs.ts"
import { ctrRecords } from "../ctr.ts"
import { kindOf, readDbt, serialOf } from "../dbt.ts"
import { r1, toLocal } from "../geometry.ts"
import type { Rect } from "../region.ts"

const DIR = fileURLToPath(new URL("fixtures/dbt2k", import.meta.url))
/** A box round every fixture record: Pontremoli lies outside lucido's terrain box, the default. */
const ANYWHERE: Rect = [-1e5, -1e5, 1e5, 1e5]

test("kindOf: the building's state, type and use or the minor building's type, the first rule that holds", () => {
  const building = (a: Readonly<Record<string, string>>) =>
    kindOf({ edifc_ty: "01", edifc_uso: "01", edifc_stat: "03", edi_min_ty: "-", ...a })
  const minor = (ty: string) =>
    kindOf({ edifc_ty: "-", edifc_uso: "-", edifc_stat: "-", edi_min_ty: ty })
  assert.equal(building({ edifc_stat: "01", edifc_ty: "11" }), "0204") // under construction first
  assert.equal(building({ edifc_stat: "02", edifc_uso: "-900091" }), "0205")
  assert.equal(minor("06"), "0205") // archaeological
  for (const ty of ["06", "11", "22"]) assert.equal(building({ edifc_ty: ty }), "0203", ty)
  // A bell tower is a tower though it is a place of worship (uso 05), as all 44 of Pontremoli's are.
  assert.equal(building({ edifc_ty: "07", edifc_uso: "05" }), "0217")
  assert.equal(building({ edifc_ty: "01", edifc_uso: "05" }), "0203") // an oratory
  assert.equal(minor("18"), "0203") // chapel
  assert.equal(building({ edifc_ty: "07" }), "0217")
  assert.equal(minor("05"), "0217") // tower or gate
  for (const uso of ["060301", "060304"]) assert.equal(building({ edifc_uso: uso }), "0211", uso)
  assert.equal(building({ edifc_uso: "080206" }), "0212")
  const industrial: ReadonlyArray<Record<string, string>> = [
    { edifc_ty: "08" },
    { edifc_uso: "0804" },
    { edifc_uso: "060302" }, // rail depot
  ]
  for (const a of industrial) assert.equal(building(a), "0202", JSON.stringify(a))
  const rural: ReadonlyArray<Record<string, string>> = [
    { edifc_ty: "09" },
    { edifc_uso: "0902" }, // cowshed
    { edifc_uso: "0903" }, // hayloft
  ]
  for (const a of rural) assert.equal(building(a), "0216", JSON.stringify(a))
  assert.equal(minor("07"), "0244")
  for (const ty of ["14", "17"]) assert.equal(minor(ty), undefined, ty) // open at the sides
  for (const ty of ["01", "04", "13", "-900095"]) assert.equal(minor(ty), "0207", ty)
  for (const ty of ["01", "03", "10"]) assert.equal(building({ edifc_ty: ty }), "0201", ty)
  assert.equal(kindOf({}), "0201")
})

test("readDbt reads the units standing on the ground and the industrial artefacts: kind, eave, height, courtyards, ids by comune", () => {
  const { buildings } = readDbt(DIR, ANYWHERE)
  // [local id, kind, style, eave = un_vol_qe or mn_ind_qe, h = un_vol_av in 1.5–45 m, courtyards]:
  // the local id is RT's serial (the last 8 digits of un_vol_id, or suolo_id for an artefact, from
  // 1e9), so it holds however a part's box cuts the layer.
  // Dropped: un_vol 3 (a loggia), 14 (por 08), 16 (por 03), 17 (por 04); mn_ind 1 (a tank).
  assert.deepEqual(
    buildings.map((b) => [-(b.id | 0), b.kind, b.style, b.eave, b.h, b.holes?.length ?? 0]),
    [
      [1757932, "shed", undefined, 241.74, 1.71, 0],
      [1757933, "garage", undefined, 258.72, 2.83, 0],
      [1762804, "house", undefined, 261.89, 7.65, 0],
      [1757976, "train_station", "station", 247.02, 13.88, 0],
      [1757985, "barn", undefined, 247.89, 2.52, 0],
      [1758183, "tower", "tower", 282.67, 4.7, 0],
      [1758207, "industrial", "industrial", 251.38, 3.66, 0],
      [1758663, "church", "church", 251.86, 6.98, 0],
      [1758687, "construction", undefined, 240.96, 3.93, 0],
      [1759436, "ruins", "ruin", 253.5, 1.95, 0],
      [1761715, "tower", "tower", 258.52, 23.89, 0], // the bell tower
      [1761803, "house", undefined, 250.35, 17.75, 1],
      [1761920, "church", "church", 268.04, 3.04, 0], // the chapel
      [1768556, "shed", undefined, 869.07, 2.5, 0], // 1.06 m over its foot: the code's height
      [1_000_016_273, "substation", "industrial", 260.03, 4, 0],
      [1_000_016_313, "greenhouse", "industrial", 240.03, 3, 0],
      [1_000_016_327, "silo", "industrial", 204.22, 8, 0],
    ],
  )
  const [unit] = ctrRecords(DIR, "un_vol", "utf8")
  assert.equal(unit!.rec.attrs.un_vol_id, "RT0201010201757932")
  assert.equal(serialOf("RT0201010201757932", "020101"), 1757932)
  assert.throws(() => serialOf("RT0202010200016273", "020101"), /not a DBT 020101 id/)
  assert.throws(() => serialOf(undefined, "020101"), /not a DBT 020101 id/)
  // Source 2, comune 045014: 45 · 512 + 14.
  for (const b of buildings) assert.equal(b.id - (b.id | 0), -(2 ** 32) * (2 * 2 ** 16 + 23054))
  // Pontremoli lies outside lucido's terrain box, the default box.
  assert.deepEqual(readDbt(DIR), { buildings: [], roadAreas: [], mapped: [] })
})

test("readDbt reads the road surfaces, paved by most of their carriageways' area, the dirt tracks, the names and the zones", () => {
  const dbt = readDbt(DIR, ANYWHERE)
  assert.deepEqual(
    dbt.roadAreas.map((a) => [a.name, a.paved, a.rings.length]),
    [
      [undefined, true, 1], // no carriageway: paved
      ["Via Belmesseri", true, 1],
      [undefined, false, 1], // dirt 407.8 m² against paved 22.6 m²
      [undefined, false, 1], // "STRADA SENZA NOME", dirt
      [undefined, true, 1], // "LOCALITÀ GUINADI": a place, not a street name
      [undefined, false, 1], // ar_vms
      [undefined, false, 1],
    ],
  )
  assert.equal(dbt.mapped.length, 1)
  // The tables are UTF-8: latin-1 would read "À" as two characters.
  const uff = (encoding: "latin1" | "utf8") =>
    ctrRecords(DIR, "ar_str", encoding)[4]!.rec.attrs.ar_str_uff
  assert.equal(uff("utf8"), "LOCALITÀ GUINADI")
  assert.equal(uff("latin1"), "LOCALITÃ\u0080 GUINADI")
})

test("readDbt places the DBT's EPSG:3003 vertices with the DBT's residual", () => {
  // The greenhouse's first vertex, as the file holds it.
  const [e, n] = [1569322.28, 4912383.28]
  assert.deepEqual(ctrRecords(DIR, "mn_ind", "utf8")[2]!.rec.parts[0]![0], [e, n])
  const at = (residual?: typeof DBT_RESIDUAL) =>
    toLocal(...gaussBoagaToLatLon(e, n, residual)).map(r1)
  assert.deepEqual(at(DBT_RESIDUAL), [-20829.3, 22167.6])
  assert.deepEqual(at(), [-20829.8, 22167.8]) // the LiDAR's residual: 0.5 m off
  const greenhouse = readDbt(DIR, ANYWHERE).buildings.find((b) => b.kind === "greenhouse")!
  const vertices = Array.from({ length: greenhouse.outer.length / 2 }, (_, i) =>
    greenhouse.outer.slice(2 * i, 2 * i + 2),
  )
  assert.ok(vertices.some(([x, y]) => x === -20829.3 && y === 22167.6))
})
