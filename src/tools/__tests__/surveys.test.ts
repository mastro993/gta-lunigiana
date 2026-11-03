import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { readCtr, readOldCtr, type RoadArea, type Survey, type SurveyBuilding } from "../ctr.ts"
import { readDbt } from "../dbt.ts"
import type { Rect } from "../region.ts"
import { bySourcePriority, readSurveys } from "../surveys.ts"

/** The counter-clockwise flat ring of the `w` × `h` m rectangle from (x, y). */
const rect = (x: number, y: number, w: number, h = w) => [x, y, x + w, y, x + w, y + h, x, y + h]
const building = (id: number, x: number, y: number, w = 10): SurveyBuilding => ({
  id,
  kind: "house",
  h: 6,
  outer: rect(x, y, w),
})
const road = (name: string, x: number, y: number, w = 10): RoadArea => ({
  name,
  paved: true,
  rings: [rect(x, y, w, 4)],
})
const survey = (s: Partial<Survey>): Survey => ({ buildings: [], roadAreas: [], mapped: [], ...s })

test("bySourcePriority keeps a later source's building or road surface only where no earlier source maps the ground, by its centroid", () => {
  const first = survey({
    buildings: [building(-1, 10, 10), building(-2, 500, 500)], // the second outside its own area
    roadAreas: [road("a", 20, 50)],
    mapped: [rect(0, 0, 100)],
  })
  const second = survey({
    buildings: [
      building(-11, 40, 40), // in the first's area
      building(-12, 95, 20), // across its edge, its centroid outside
      building(-13, 85, 60, 20), // across its edge, its centroid inside
      building(-14, 150, 150), // in its own area only
    ],
    roadAreas: [road("b", 30, 30), road("c", 120, 120)],
    mapped: [rect(50, 50, 200)],
  })
  const third = survey({
    buildings: [building(-21, 200, 200), building(-22, 70, 10), building(-23, 300, 20)],
    roadAreas: [road("d", 60, 60), road("e", 400, 400)],
    mapped: [rect(250, 0, 100)],
  })
  const merged = bySourcePriority([first, second, third])
  assert.deepEqual(
    merged.buildings.map((b) => b.id),
    [-1, -2, -12, -14, -23],
  )
  assert.deepEqual(
    merged.roadAreas.map((a) => a.name),
    ["a", "c", "e"],
  )
  assert.deepEqual(merged.mapped, [...first.mapped, ...second.mapped, ...third.mapped])
  // A source alone, or first, keeps all it has.
  assert.deepEqual(bySourcePriority([second]), second)
  assert.deepEqual(bySourcePriority([]), { buildings: [], roadAreas: [], mapped: [] })
})

test("readSurveys merges the sources in the order 2019 CTR, DBT 1:2000, CTR 2009, CTR 10k", (t) => {
  const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
  // data/raw/rt's layout: the 2019 CTR in ctr, the others under their source's name.
  const rt = mkdtempSync(join(tmpdir(), "surveys-"))
  t.after(() => rmSync(rt, { recursive: true }))
  for (const [dir, name] of [
    ["ctr", "ctr2019"],
    ["dbt2k", "dbt2k"],
    ["ctr2009", "ctr2009"],
    ["ctr10k", "ctr10k"],
  ])
    cpSync(fixture(name!), join(rt, dir!), { recursive: true })
  const box: Rect = [-1e5, -1e5, 1e5, 1e5]
  const { survey, ctr2019 } = readSurveys(rt, box)
  const sources = [
    readCtr(fixture("ctr2019"), box),
    readDbt(fixture("dbt2k"), box),
    readOldCtr(fixture("ctr2009"), "ctr2009", box),
    readOldCtr(fixture("ctr10k"), "ctr10k", box),
  ]
  assert.deepEqual(ctr2019, sources[0])
  assert.deepEqual(survey, bySourcePriority(sources))
  // The 10k's house 0201#398 and surface 0101#21 lie in 23D11's AZR: the 2019 CTR maps them.
  const tenk = sources[3]!
  assert.deepEqual(
    survey.buildings.slice(-tenk.buildings.length + 1),
    tenk.buildings.filter((b) => (b.id | 0) !== -1),
  )
  assert.equal(survey.roadAreas.length, sources.reduce((n, s) => n + s.roadAreas.length, 0) - 1)
  // Where the sources are missing (Lunigiana fetches no DBT), none is read.
  assert.deepEqual(readSurveys(join(rt, "nowhere"), box).survey, {
    buildings: [],
    roadAreas: [],
    mapped: [],
  })
})
