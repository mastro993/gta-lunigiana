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
// - ar_str (010104): #22 (no carriageway), #362 "VIA BELMESSERI", #411 "VICOLO SANTA CRISTINA" (no
//   carriageway), #522 (a paved and a dirt carriageway), #548 (a dirt one), #650 "LOCALITÀ GUINADI"
//   (no carriageway); ac_vei (010101): the 4 carriageways of those roads (by ar_str_id) and #1990,
//   the A15's in a tunnel (ac_vei_sed 06); ar_vms (010105): #15, #230; zona_r (000201): #10, its
//   zona_r_dt (the survey firms) blanked.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

import { DBT_RESIDUAL, gaussBoagaToLatLon } from "../crs.ts"
import { ctrRecords } from "../ctr.ts"
import { kindOf, readDbt, serialOf } from "../dbt.ts"
import { type P, r1, signedArea, toLocal } from "../geometry.ts"
import type { Rect } from "../region.ts"
import { shapefile } from "./shapefile.ts"

const DIR = fileURLToPath(new URL("fixtures/dbt2k", import.meta.url))
/** A box round every fixture record: Pontremoli lies outside lucido's terrain box, the default. */
const ANYWHERE: Rect = [-1e5, -1e5, 1e5, 1e5]
/** A flat ring's vertices. */
const vertices = (ring: ReadonlyArray<number>): Array<P> =>
  Array.from({ length: ring.length / 2 }, (_, i) => [ring[2 * i]!, ring[2 * i + 1]!])

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

test("readDbt reads the road surfaces from the carriageways, the road areas with none and the dirt tracks, and the zones", () => {
  const dbt = readDbt(DIR, ANYWHERE)
  // [name, paved, outer ring's m²]: each carriageway (ac_vei) paved unless ac_vei_fon is 02, named
  // from its own copy of ar_str_uff, and none in a tunnel (sed 06, the A15's 4,257 m²); then each
  // road area (ar_str) whose road has no carriageway, paved; then the dirt tracks. A road area with
  // carriageways is left out: it holds the sidewalks too (RT's catalogue v21).
  assert.deepEqual(
    dbt.roadAreas.map((a) => [a.name, a.paved, r1(Math.abs(signedArea(vertices(a.rings[0]!))))]),
    [
      [undefined, false, 63.2], // "STRADA SENZA NOME", dirt
      ["Via Belmesseri", true, 265.4], // its road area, with the sidewalks, is 406.9 m²
      [undefined, false, 407.8], // a road's dirt carriageway
      [undefined, true, 22.6], // and its paved one
      [undefined, true, 39], // no carriageway
      ["Vicolo Santa Cristina", true, 320.1], // no carriageway
      [undefined, true, 145.3], // "LOCALITÀ GUINADI": a place, not a street name
      [undefined, false, 34.5], // ar_vms
      [undefined, false, 10.8],
    ],
  )
  assert.equal(dbt.mapped.length, 1)
})

test("readDbt reads the tables as UTF-8: an accented street name", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dbt-"))
  t.after(() => rmSync(dir, { recursive: true }))
  const [e, n] = [1569322, 4912383]
  const ring = [
    [e, n, 0],
    [e, n + 10, 0],
    [e + 10, n + 10, 0],
    [e + 10, n, 0],
    [e, n, 0],
  ] as const
  // The helper writes latin-1: these are the UTF-8 bytes of "À" (c3 80), which latin-1 reads as "Ã\u0080".
  const uff = Buffer.from("VIA DELLA LIBERTÀ", "utf8").toString("latin1")
  const { shp, dbf } = shapefile(15, [
    {
      parts: [ring],
      attrs: { ac_vei_fon: "01", ac_vei_sed: "01", ar_str_id: "1", ar_str_uff: uff },
    },
  ])
  writeFileSync(join(dir, "045014_ac_vei.shp.gz"), gzipSync(shp))
  writeFileSync(join(dir, "045014_ac_vei.dbf.gz"), gzipSync(dbf))
  assert.deepEqual(
    readDbt(dir, ANYWHERE).roadAreas.map((a) => a.name),
    ["Via della Libertà"],
  )
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
  assert.ok(vertices(greenhouse.outer).some(([x, y]) => x === -20829.3 && y === 22167.6))
})
