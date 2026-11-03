import assert from "node:assert/strict"
import { test } from "node:test"

import { hash01 } from "../geometry.ts"
import {
  comune,
  localOf,
  section10k,
  sheet2k,
  SOURCES,
  type SurveySource,
  surveyId,
} from "../survey-ids.ts"

/** The id the 2019 CTR's buildings had before the sources and sections: record `index` of `sheet`'s layer from `base`, polygon `k`. */
const oldId = (sheet: number, base: number, index: number, k: number) =>
  -(sheet * 1e5 + base + index) - k * 1e7
/** The same building's id now, in section `section`'s 2019 sheet. */
const newId = (section: string, sheet: number, base: number, index: number, k: number) =>
  surveyId(
    "ctr2019",
    sheet2k(`${section}${String(sheet).padStart(2, "0")}`).section,
    localOf(sheet * 1e5 + base + index, k),
  )

test("sheet2k, section10k and comune code a section by its name alone, and refuse other names", () => {
  assert.deepEqual(sheet2k("23D11"), { section: 23 * 26 + 3, sheet: 11 })
  assert.deepEqual(sheet2k("22D04"), { section: 22 * 26 + 3, sheet: 4 })
  assert.deepEqual(sheet2k("25B24"), { section: 25 * 26 + 1, sheet: 24 })
  for (const name of ["23D1", "23d11", "23D29C", "60312", "0738D", ""])
    assert.throws(() => sheet2k(name), /not a 1:2000 sheet name/, name)
  // A 1:10 000 section is one of the 16 of its 1:50 000 sheet, 010 to 160.
  assert.equal(section10k("249010"), 249 * 16)
  assert.equal(section10k("249020"), 249 * 16 + 1)
  assert.equal(section10k("249160"), 249 * 16 + 15)
  for (const name of ["249000", "249170", "249025", "24902", "S_249020", "249020x"])
    assert.throws(() => section10k(name), /not a 1:10 000 section name/, name)
  assert.equal(comune("045014"), 45 * 512 + 14) // Pontremoli
  assert.equal(comune("100001"), 100 * 512 + 1) // Prato's province, Tuscany's highest
  for (const name of ["45014", "045512", "04501a", "045014_un_vol"])
    assert.throws(() => comune(name), /not an ISTAT comune code/, name)
})

test("surveyId: the same record number in another section or source is another id", () => {
  const ids = [
    ...["23D11", "22D11", "24C11"].map((sheet) =>
      surveyId("ctr2019", sheet2k(sheet).section, localOf(11 * 1e5 + 7, 0)),
    ),
    ...(Object.keys(SOURCES) as Array<SurveySource>).map((source) =>
      surveyId(source, sheet2k("23D11").section, localOf(11 * 1e5 + 7, 0)),
    ),
  ]
  assert.equal(new Set(ids).size, ids.length - 1) // the 2019 CTR's 23D11 is in both lists
  for (const id of ids) assert.ok(id < 0 && Number.isSafeInteger(id))
})

test("surveyId keeps the 2019 ids' low 32 bits: id | 0 is the old id, and -(id | 0) the old tint seed", () => {
  for (const [sheet, base, index, k] of [
    [11, 0, 0, 0],
    [19, 0, 770, 0], // the most AED records of a lucido sheet
    [54, 5e4, 574, 0], // AGE from 5e4
    [99, 5e4, 49_999, 99], // the largest local part: 999 999 999
  ] as const) {
    const old = oldId(sheet, base, index, k)
    for (const section of ["23D", "22D", "24C"]) {
      const id = newId(section, sheet, base, index, k)
      assert.equal(id | 0, old, `${section}${sheet} #${index}`)
      assert.equal(hash01(-(id | 0), 7), hash01(-old % 1e9, 7)) // features.ts's tint, before and now
      assert.equal(hash01(id, 7), hash01(old, 7)) // the renderer's roof, shutter and window seeds
    }
  }
})

test("surveyId: every id is a safe integer, up to the last section of the last source", () => {
  const last = Math.max(...Object.values(SOURCES))
  for (const source of Object.keys(SOURCES) as Array<SurveySource>) {
    const id = surveyId(source, 2 ** 16 - 1, localOf(1e7 - 1, 99))
    assert.ok(Number.isSafeInteger(id), source)
    assert.equal(id | 0, -999_999_999, source)
  }
  // The slots left above the sources read so far: 2^21 slots of 2^32 fill the 53 bits.
  assert.ok((last + 1) * 2 ** 16 <= 2 ** 21)
  for (const section of [-1, 2 ** 16, 1.5, Number.NaN])
    assert.throws(() => surveyId("dbt2k", section, 0), /section code/, `${section}`)
})

test("localOf: a record's number under 1e7 and up to 100 polygons, so the local part stays under 2^31", () => {
  assert.equal(localOf(0, 0), 0)
  assert.equal(localOf(2_000_002, 3), 32_000_002)
  for (const unit of [-1, 1e7, 1.5, Number.NaN])
    assert.throws(() => localOf(unit, 0), /record number/, `${unit}`)
  assert.throws(() => localOf(5, 100), /more than 100 polygons/)
  assert.ok(localOf(1e7 - 1, 99) < 2 ** 31)
})
