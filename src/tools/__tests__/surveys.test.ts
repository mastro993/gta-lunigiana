import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

import { readCtr, readOldCtr, type RoadArea, type Survey, type SurveyBuilding } from "../ctr.ts"
import { readDbt } from "../dbt.ts"
import { readNc5 } from "../nc5.ts"
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

// Regression: at the Liguria border two 2019 CTR houses outside their sheets' AZR stood twice, with
// the NC5's copies inside its own area (-283940288538918 and -1475896793484707 at (-8851, -4763),
// overlap 1.00; -283940288438611 and -1475669160234022, 0.97), each at its own height.
test("bySourcePriority drops a later source's building sharing half the smaller one's area with an earlier source's, wherever the earlier maps the ground", () => {
  const first = survey({
    buildings: [building(-1, 500, 500), building(-2, 600, 500, 4), building(-3, 700, 500)],
    mapped: [rect(0, 0, 100)], // none of them in it
  })
  const second = survey({
    buildings: [
      building(-11, 502, 500), // 80 of its 100 m² on -1
      building(-12, 598, 498, 8), // larger, all of -2 under it
      building(-13, 706, 500), // 40% on -3: a building of its own
      building(-14, 800, 500), // on none
      building(-15, 801, 501), // on -14, of its own source: the 2019 CTR's units stand on others
    ],
    mapped: [rect(450, 450, 400)],
  })
  assert.deepEqual(
    bySourcePriority([first, second]).buildings.map((b) => b.id),
    [-1, -2, -3, -13, -14, -15],
  )
})

test("readSurveys merges the sources in the order 2019 CTR, DBT 1:2000, CTR 2009, NC5, CTR 10k", (t) => {
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
  // A part's Liguria folder (data/raw/lig/<part>): one NC5 building, Sarzana's cathedral's nave.
  const lig = join(rt, "lig")
  mkdirSync(join(lig, "nc5"), { recursive: true })
  const [e, n] = [577010, 4884780]
  writeFileSync(
    join(lig, "nc5", "L6871.json.gz"),
    gzipSync(
      JSON.stringify({
        features: [
          {
            properties: { classref: "248082_1707522", edifc_ty: "11", edifc_uso: "05" },
            polygons: [[[e, n, 39, e + 30, n, 39, e + 30, n + 30, 39, e, n + 30, 39, e, n, 39]]],
          },
        ],
      }),
    ),
  )
  const box: Rect = [-1e5, -1e5, 1e5, 1e5]
  const { survey, ctr2019 } = readSurveys(rt, [lig], box)
  const sources = [
    readCtr(fixture("ctr2019"), box),
    readDbt(fixture("dbt2k"), box),
    readOldCtr(fixture("ctr2009"), "ctr2009", box),
    readNc5([join(lig, "nc5")], box),
    readOldCtr(fixture("ctr10k"), "ctr10k", box),
  ]
  assert.equal(sources[3]!.buildings.length, 1)
  assert.deepEqual(ctr2019, sources[0])
  assert.deepEqual(survey, bySourcePriority(sources))
  // The 10k's house 0201#398 and surface 0101#21 lie in 23D11's AZR: the 2019 CTR maps them.
  const tenk = sources[4]!
  assert.deepEqual(
    survey.buildings.slice(-tenk.buildings.length + 1),
    tenk.buildings.filter((b) => (b.id | 0) !== -1),
  )
  assert.equal(survey.roadAreas.length, sources.reduce((n, s) => n + s.roadAreas.length, 0) - 1)
  // Where the sources are missing (Lunigiana fetches no DBT), none is read.
  assert.deepEqual(readSurveys(join(rt, "nowhere"), [join(rt, "nowhere")], box).survey, {
    buildings: [],
    roadAreas: [],
    mapped: [],
  })
})
