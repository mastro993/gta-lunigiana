// Adapters (a) and (b) on fixtures cut from real sheets: a few records of each layer, kept with
// `subsetShp` (shp.ts) by their index in the sheet's file, in file order (so a record's index here
// is its place among those kept), the fields that name the survey's people and firm (Dir_lav,
// Coll_top, Coll_fot, Coll_inf, Ditta_es) blanked, gzipped at level 9 (scratch script, not kept):
// - fixtures/ctr2019, from data/raw/rt/ctr (the CTR 1:2000 of 2019, lucido's sheets): 23D11 AED
//   #7 0201, #40 0241, #58 0211, #426 0216; AGE #53 0205; AVI #5, #6, #7, #8; AZR #0. 23D20 AED #8
//   0203, #15 0208, #234 0201 (a courtyard), #235 0206; AGE #105 0244; AVI #6, #10; AZR #1. 23D14
//   AED #0 0201, which lies outside lucido's rectangle.
// - fixtures/ctr2009, from S_<sheet>_2009_6707.zip: 22D04 AE_a #1 0208, #3 0212, #4 0201, #7
//   0203, #26 0202, #48 0240; AV_a #2 0102, #5 0101 (a hole), #15 0101; ML_l #0 0205 (an open wall
//   stub), #5 0205 (a closed ring), #7 0502 (a closed ring); 22D05 AC_a #0, #1; 22D13 AV_a #1 0102,
//   #40 0101 (in a tunnel, Sede 054); 22D18 (west of lucido's rectangle) AE_a #0 0235 (no
//   Quota_gr), #3 0207; AV_a #5 0101 (two parts), #21 0102.
// - fixtures/ctr10k, from S_249020_2010_6707.zip, by `Codice#Record`: AE_a 0204#1 (no Quota_gr),
//   0201#398 (inside 23D11's AZR), 0211#3, 0208#6, 0201#970, 0207#262, 0201#1275 (a courtyard),
//   0203#39; AV_a 0140#26, 0114#4, 0101#20, 0101#21 (inside 23D11's AZR), 0102#93; ML_l 0205#18 (a
//   closed ring); AC_a, whole.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

import { readCtr, readOldCtr, streetName, type Survey } from "../ctr.ts"
import { centroid, pointInRing, signedArea, type P } from "../geometry.ts"
import { partOf, type Rect } from "../region.ts"
import { shapefile } from "./shapefile.ts"

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
/** A box round every fixture record, so none is clipped away. */
const ANYWHERE: Rect = [-1e5, -1e5, 1e5, 1e5]
/** Lucido's rectangle, which the fixtures were cut for: the box a record outside of is dropped. */
const LUCIDO = partOf("lucido").rects[0]!
/** A flat ring's signed area: positive counter-clockwise. */
const areaOf = (flat: ReadonlyArray<number>) =>
  signedArea(Array.from({ length: flat.length / 2 }, (_, i): P => [flat[2 * i]!, flat[2 * i + 1]!]))

/** Each building as the tests compare it: its id's low 32 bits, kind, style, eave, height and courtyards. */
const brief = ({ buildings }: Survey) =>
  buildings.map((b) => [b.id | 0, b.kind, b.style, b.eave, b.h, b.holes?.length ?? 0])
/** Each road surface as the tests compare it: its name, paved or not, and its ring count. */
const roads = ({ roadAreas }: Survey) => roadAreas.map((a) => [a.name, a.paved, a.rings.length])

/** Every outer ring counter-clockwise and every hole clockwise, as `polygonsOf` promises. */
const assertWound = ({ buildings, roadAreas, mapped }: Survey) => {
  for (const b of buildings) {
    assert.ok(areaOf(b.outer) > 0, `${b.id} outer`)
    for (const h of b.holes ?? []) assert.ok(areaOf(h) < 0, `${b.id} hole`)
  }
  for (const [outer, ...holes] of roadAreas.map((a) => a.rings)) {
    assert.ok(areaOf(outer!) > 0)
    for (const h of holes) assert.ok(areaOf(h) < 0)
  }
  for (const ring of mapped) assert.ok(areaOf(ring) > 0)
}

test("readCtr reads the 2019 buildings: kind, style, eave and height by code, courtyards, ids as before within section 23D", () => {
  const ctr = readCtr(fixture("ctr2019"), LUCIDO)
  // Old ids: -(sheet · 1e5 + layer base (AED 0, AGE 5e4) + index); AED of every sheet, then AGE.
  // Dropped: 23D11 AED 1 (0241 loggia), 23D20 AED 1 (0208 canopy) and 3 (0206 overhang), and
  // 23D14's house, outside lucido's box.
  assert.deepEqual(brief(ctr), [
    [-1100000, "house", undefined, 167.38, 6, 0],
    [-1100002, "train_station", "station", 175.89, 6, 0],
    [-1100003, "barn", undefined, 173.67, 5, 0],
    [-2000000, "church", "church", 461.94, 10, 0],
    [-2000002, "house", undefined, 463.97, 6, 1],
    [-1150000, "ruins", "ruin", undefined, 2.5, 0], // AGE has no elevations
    [-2050000, "garage", undefined, undefined, 2.6, 0],
  ])
  assertWound(ctr)
  // Above 2^32 the id holds the source (1, the 2019 CTR) and the section: 23D is 23 · 26 + 3.
  assert.equal(ctr.buildings[0]!.id, -(11 * 1e5 + 2 ** 32 * (1 * 2 ** 16 + 23 * 26 + 3)))
  assert.equal(ctr.buildings[0]!.id, -284_056_253_155_552)
  for (const b of ctr.buildings) assert.equal(b.id - (b.id | 0), -(2 ** 32) * (2 ** 16 + 601))
  // The box decides what is read: a wide one takes 23D14's house too, after 23D11's AED.
  assert.deepEqual(
    readCtr(fixture("ctr2019"), ANYWHERE).buildings.map((b) => b.id | 0),
    [-1100000, -1100002, -1100003, -1400000, -2000000, -2000002, -1150000, -2050000],
  )
})

test("readCtr reads the 2019 road surfaces (0101 paved, 0102 dirt, named from the toponym) and each sheet's AZR as the mapped area", () => {
  const ctr = readCtr(fixture("ctr2019"), LUCIDO)
  assert.deepEqual(roads(ctr), [
    ["Via Colle", true, 1],
    ["Via Castel dell'Aquila", true, 1],
    [undefined, false, 1], // no toponym
    ["Via XX Settembre", true, 1],
    [undefined, true, 1], // "S.C. DI FAZZANO": a road kind, not a street name
    ["Via Enrico Toti", false, 1],
  ])
  assert.equal(ctr.mapped.length, 2)
  for (const b of ctr.buildings)
    assert.ok(
      ctr.mapped.some((ring) => pointInRing(...centroid(b.outer), ring)),
      `${b.id}`,
    )
})

test("readOldCtr reads the CTR 2009: building codes kept and dropped, Quota_gr the eave, the closed ML_l 0205 rings as ruins, 0101 and 0102 surfaces out of tunnels, AC_a the mapped area, ids by sheet", () => {
  const ctr = readOldCtr(fixture("ctr2009"), "ctr2009", ANYWHERE)
  // Dropped: 22D04 AE_a 0 (0208 canopy) and 5 (0240 portico), 22D18 AE_a 0 (0235 semi-basement,
  // the only record without a Quota_gr); 22D04 ML_l 0 (an open wall stub) and 2 (0502, not a ruin).
  assert.deepEqual(brief(ctr), [
    [-400001, "substation", "industrial", 1228.71, 4, 0],
    [-400002, "house", undefined, 1290.1, 6, 0],
    [-400003, "church", "church", 1334.73, 10, 0],
    [-400004, "industrial", "industrial", 1140.14, 6, 0],
    [-1800001, "shed", undefined, 241.59, 2.5, 0],
    [-450001, "ruins", "ruin", undefined, 2.5, 0], // ML_l from 5e4, as 2019's AGE; no elevations
  ])
  // Source 3, section 22D (22 · 26 + 3), local part sheet · 1e5 + index as the 2019 CTR's.
  assert.equal(ctr.buildings[0]!.id, -(4 * 1e5 + 1 + 2 ** 32 * (3 * 2 ** 16 + 22 * 26 + 3)))
  assert.equal(ctr.buildings[5]!.id, -(4 * 1e5 + 5e4 + 1 + 2 ** 32 * (3 * 2 ** 16 + 22 * 26 + 3)))
  // The ruin is ML_l 1's ring as surveyed, 23.3 m² (ML_l 0 would be 20.3 m² were it closed).
  assert.equal(Math.round(areaOf(ctr.buildings[5]!.outer)), 23)
  assert.deepEqual(roads(ctr), [
    [undefined, false, 1], // "STRADA COMUNALE PIANZA VALLINI", dirt
    [undefined, true, 2], // the same road, asphalt, round a hole
    ["Via Martiri della Libertà", true, 1],
    [undefined, false, 1], // 22D13 AV_a 0, dirt; not AV_a 1, asphalt in a tunnel (Sede 054)
    ["Via Renzo Matazzoni", true, 1], // one record of two parts: two surfaces
    ["Via Renzo Matazzoni", true, 1],
    [undefined, false, 1],
  ])
  assert.equal(ctr.mapped.length, 2) // 22D05's AC_a: two rings where its frame is one rectangle
  assertWound(ctr)
  // In lucido's rectangle, 22D18 is gone, and so is 22D13 AV_a 0, south of it.
  const lucido = readOldCtr(fixture("ctr2009"), "ctr2009", LUCIDO)
  assert.deepEqual(
    lucido.buildings.map((b) => b.id),
    [...ctr.buildings.slice(0, 4), ctr.buildings[5]!].map((b) => b.id),
  )
  assert.equal(lucido.roadAreas.length, 3)
})

// Regression: Castelpoggio's 2009 sheet draws four houses twice, as an AE_a unit and as a closed
// ML_l ruin ring round it (house -846894537227872, 54 m², and ruin -846894537277170, 58 m²,
// overlap 0.93), each standing at its own height; ruin -846894537277171, wrapped round a house's
// corner with no ground in common, its vertex mean inside the house, is a ruin of its own.
test("readOldCtr drops a ruin ring sharing half the smaller one's area with a unit of its sheet, and keeps one beside a unit", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ctr2009-"))
  t.after(() => rmSync(dir, { recursive: true }))
  const [e, n] = [578000, 4884000]
  const ring = (pts: ReadonlyArray<readonly [number, number]>, z = 0) =>
    [...pts, pts[0]!].map(([x, y]): readonly [number, number, number] => [e + x, n + y, z])
  const write = (layer: string, type: 13 | 15, records: Parameters<typeof shapefile>[1]) => {
    const { shp, dbf } = shapefile(type, records)
    writeFileSync(join(dir, `22D04_${layer}.shp.gz`), gzipSync(shp))
    writeFileSync(join(dir, `22D04_${layer}.dbf.gz`), gzipSync(dbf))
  }
  const square = (x: number, y: number, s: number) =>
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ] as const
  write("AE_a", 15, [
    { parts: [ring(square(0, 0, 10), 250)], attrs: { Codice: "0201", Quota_gr: "256.5" } },
  ])
  write("ML_l", 13, [
    { parts: [ring(square(1, 1, 10))], attrs: { Codice: "0205" } }, // over the house: 81 of its 100 m²
    {
      parts: [
        ring([
          [10, 0],
          [12, 0],
          [12, 12],
          [5, 12],
          [5, 10],
          [10, 10],
        ]),
      ], // round its corner
      attrs: { Codice: "0205" },
    },
  ])
  assert.deepEqual(brief(readOldCtr(dir, "ctr2009", ANYWHERE)), [
    [-400000, "house", undefined, 256.5, 6, 0],
    [-450001, "ruins", "ruin", undefined, 2.5, 0],
  ])
})

test("readOldCtr reads the CTR 10k: no eave without a Quota_gr, the ML_l ruins, only 0101 and 0102 surfaces, ids by section", () => {
  const ctr = readOldCtr(fixture("ctr10k"), "ctr10k")
  // Dropped: AE_a 3 (0208 canopy). The local part is the record's index in the section's file.
  assert.deepEqual(brief(ctr), [
    [0, "construction", undefined, undefined, 6, 0], // Quota_gr 0
    [-1, "house", undefined, 164.78, 6, 0],
    [-2, "train_station", "station", 221.09, 6, 0],
    [-4, "house", undefined, 230.74, 6, 0],
    [-5, "shed", undefined, 230.06, 2.5, 0],
    [-6, "house", undefined, 315.6, 6, 1],
    [-7, "church", "church", 225.35, 10, 0],
    [-5000000, "ruins", "ruin", undefined, 2.5, 0], // ML_l, numbered from 5e6
  ])
  // Source 4, section 249020: the 2nd of the 16 sections of 1:50 000 sheet 249.
  assert.equal(ctr.buildings[1]!.id, -(1 + 2 ** 32 * (4 * 2 ** 16 + 249 * 16 + 1)))
  assert.equal(ctr.buildings[7]!.id, -(5e6 + 2 ** 32 * (4 * 2 ** 16 + 249 * 16 + 1)))
  // Dropped: 0140 (the rail bed) and 0114 (a track in a tunnel). The toponyms are road numbers.
  assert.deepEqual(roads(ctr), [
    [undefined, true, 1],
    [undefined, true, 1],
    [undefined, false, 1],
  ])
  assert.equal(ctr.mapped.length, 1)
  assertWound(ctr)
})

test("streetName title-cases street names, articles and elisions lower-case, Roman numerals and initials kept, a final apostrophe the accent; road kinds and places are not names", () => {
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ["VIA CASTEL DELL'AQUILA", "Via Castel dell'Aquila"],
    ["VIA XX SETTEMBRE", "Via XX Settembre"],
    ["VIA LEONARDO II", "Via Leonardo II"],
    ["PIAZZA SAN NICOLA", "Piazza San Nicola"],
    ["VICOLO DEI MULINI", "Vicolo dei Mulini"],
    ["LARGO  DI   PORTA", "Largo di Porta"],
    ["SALITA ALLA ROCCA", "Salita alla Rocca"],
    ["VIA DEL PRA'", "Via del Prà"], // the CTR writes a final accent as an apostrophe
    ["VIA DELLA LIBERTÀ", "Via della Libertà"], // a letter (UTF-8) stays one
    ["PIAZZA UNITA' D'ITALIA", "Piazza Unità d'Italia"], // DBT, Pontremoli
    ["VIA SANT'ANTONIO", "Via Sant'Antonio"], // CTR 2009, 22D18
    ["VIA G.B. NATALI", "Via G.B. Natali"], // initials keep their capitals (DBT)
    ["VIA VETERANI DELLO SPORT", "Via Veterani dello Sport"], // DBT
    ["VIALE DEI MILLE", "Viale dei Mille"], // DBT
    ["PIAZZALE DELL'UCCELLIERA", "Piazzale dell'Uccelliera"], // CTR 2009
    ["PIAZZETTA DI SOMMOBORGO", "Piazzetta di Sommoborgo"], // DBT
    ["S.P. DI TENERANO (N.10)", undefined],
    ["S.C. DI FAZZANO", undefined],
    ["STRADA SENZA NOME", undefined],
    ["LOCALITÀ GUINADI", undefined],
    ["VIA", undefined],
    ["", undefined],
  ]
  assert.deepEqual(
    cases.map(([toponym]) => [toponym, streetName(toponym)]),
    cases,
  )
})
