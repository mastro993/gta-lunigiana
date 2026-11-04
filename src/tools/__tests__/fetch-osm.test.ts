import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

import { TILE } from "../../sim/map/kinds.ts"
import {
  type Answer,
  type Bbox,
  buildingsOnly,
  type Elements,
  fetchSplit,
  osmXml,
  partBoxes,
  partGround,
  partToFetch,
  sourceOf,
} from "../fetch-osm.ts"
import { fromLocal, toLocal } from "../geometry.ts"
import { assembleRings, readOsm } from "../osm.ts"
import { osmFile, partOf, regionFromArgs } from "../region.ts"

/** A fake `/map`: nodes on a 0.01° grid, 400 for a box holding more than `limit` of them. */
const fakeMap = (limit: number) => {
  const nodes: Array<readonly [number, number, number]> = []
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 10; j++) nodes.push([nodes.length, 10 + i * 0.01 + 0.005, 44 + j * 0.01])
  const asked: Array<Bbox> = []
  const get = ([w, s, e, n]: Bbox): Promise<Answer> => {
    asked.push([w, s, e, n])
    const hit = nodes.filter(([, x, y]) => x >= w && x <= e && y >= s && y <= n)
    return Promise.resolve(
      hit.length > limit
        ? { status: 400, text: `You requested too many nodes (limit is ${limit}).` }
        : { status: 200, text: hit.map(([id]) => id).join(" ") },
    )
  }
  return { nodes, asked, get }
}

test("fetchSplit asks for a small enough box once", async () => {
  const map = fakeMap(1000)
  const taken: Array<Bbox> = []
  await fetchSplit([10, 44, 10.2, 44.1], map.get, (b) => taken.push(b))
  assert.deepEqual(taken, [[10, 44, 10.2, 44.1]])
  assert.equal(map.asked.length, 1)
})

test("fetchSplit splits a box answered 400 in four, recursively, and loses no node", async () => {
  const map = fakeMap(30)
  const taken: Array<{ box: Bbox; ids: Array<number> }> = []
  await fetchSplit([10, 44, 10.2, 44.1], map.get, (box, text) =>
    taken.push({ box, ids: text.split(" ").map(Number) }),
  )
  // 200 nodes over 30 a box: the whole box and its quarters are refused, the sixteenths come.
  assert.equal(taken.length, 16)
  assert.equal(map.asked.length, 1 + 4 + 16)
  assert.ok(taken.every((t) => t.ids.length <= 30))
  assert.deepEqual(
    [...new Set(taken.flatMap((t) => t.ids))].sort((a, b) => a - b),
    map.nodes.map(([id]) => id),
  )
  // The pieces tile the box: their areas add up to it, and the first quarter comes first.
  const area = ([w, s, e, n]: Bbox) => (e - w) * (n - s)
  assert.ok(
    Math.abs(taken.reduce((sum, t) => sum + area(t.box), 0) - area([10, 44, 10.2, 44.1])) < 1e-12,
  )
  assert.deepEqual(map.asked[1], [10, 44, 10.1, 44.05])
})

test("fetchSplit throws on an answer other than 200 or 400", async () => {
  const get = (): Promise<Answer> =>
    Promise.resolve({ status: 509, text: "Bandwidth limit exceeded" })
  await assert.rejects(
    fetchSplit([10, 44, 10.2, 44.1], get, () => {}),
    /HTTP 509: Bandwidth/,
  )
})

test("fetchSplit stops splitting at a box too small to hold 50 000 nodes", async () => {
  let asked = 0
  const get = (): Promise<Answer> => {
    asked++
    return Promise.resolve({ status: 400, text: "bad request" })
  }
  await assert.rejects(
    fetchSplit([10, 44, 10.2, 44.1], get, () => {}),
    /HTTP 400: bad request/,
  )
  // Depth first, the first failure at the bottom ends the run: one box per level.
  assert.ok(asked < 12)
})

test("fetch-osm fetches the Lunigiana part its argument names, or another map's one part", () => {
  for (const key of ["lucido", "fivizzano"]) {
    const { part, region } = partToFetch([key])
    assert.equal(part, partOf(key))
    assert.equal(region.key, "lunigiana")
  }
  const cesena = regionFromArgs(["--region", "cesena"])
  assert.deepEqual(partToFetch([], cesena), { part: cesena.parts[0], region: cesena })
  assert.throws(() => partToFetch([]), /usage: fetch-osm <part>/)
  assert.throws(() => partToFetch(["lucido", "lucido-l"]), /usage: fetch-osm <part>/)
  assert.throws(() => partToFetch(["aulla"]), /unknown part aulla: use one of lucido, fivizzano, /)
  assert.throws(() => partToFetch(["lucido"], cesena), /usage: fetch-osm --region cesena/)
})

test("fetch-osm refuses a test region's part, built from Lunigiana's parts' OSM, but one with buildings of its own", () => {
  for (const [key, region] of [
    ["lucido-l", "lunigiana-l"],
    ["lucido-3x", "lunigiana-3x"],
    ["sillara", "bagnone-ridge"],
    ["sarzana-town", "sarzana-town"],
  ] as const)
    assert.throws(
      () => partToFetch([key]),
      new RegExp(`part ${key} is test region ${region}'s, built from Lunigiana's parts' OSM`),
    )
  const town = partToFetch(["pontremoli-town"])
  assert.equal(town.region.key, "pontremoli-town")
  assert.ok(town.region.ownBuildings)
})

test("fetch-osm asks for each rectangle of a part's tiles cut to its box plus 100 m, never an L's notch", () => {
  const lunigiana = regionFromArgs([]).parts
  // lucido's tiles cut to its box are its rectangle: the box its pinned extract was fetched over.
  assert.equal(
    sourceOf(partBoxes(partOf("lucido"), lunigiana), false),
    "https://api.openstreetmap.org/api/0.6/map?bbox=10.092494,44.105952,10.192509,44.197749 and each area multipolygon's /relation/<id>/full",
  )
  const town = partOf("pontremoli-town")
  assert.equal(
    sourceOf(partBoxes(town, [town]), true),
    "https://api.openstreetmap.org/api/0.6/map?bbox=9.869961,44.368742,9.892464,44.384941 and each building multipolygon's /relation/<id>/full, buildings only",
  )
  // The L's six tiles in two rectangles, each 100 m round its ground: the notch's two tiles, x 0…2400
  // by y 2000…3900, are in neither.
  const l = partOf("lucido-l")
  const local = partBoxes(l, [l]).map(([w, s, e, n]) =>
    [...toLocal(s, w), ...toLocal(n, e)].map((v) => Math.round(v)),
  )
  assert.deepEqual(local, [
    [-2500, -100, 2500, 2100],
    [-2500, 1900, 100, 4000],
  ])
})

test("partGround: a part's own tiles cut to the grown box, and the ground the box adds to the earlier parts' tiles", () => {
  const a = { key: "a", title: "A", rects: [[0, 0, 3000, 3000]] as const },
    b = { key: "b", title: "B", rects: [[3000, 0, 7000, 1000]] as const }
  assert.deepEqual(partGround(a, [a, b]), [[0, 0, 3000, 3000]])
  // B's tiles 2_0 and 3_0, then the strip x 3000…4000 the box adds to A's 1_0 and 1_1; tiles 2_1 and
  // 3_1, which no rectangle meets, are in neither.
  assert.deepEqual(partGround(b, [a, b]), [
    [4000, 0, 7000, 2000],
    [3000, 0, 4000, 3000],
  ])
  assert.throws(() => partGround(b, [a]), /part b is not among a/)
})

// Regression: fetch-osm asked for Fivizzano's rectangles alone, while the grown box gave lucido's
// tiles 1.1 km more ground west and east and Fivizzano's its own beyond its rectangles: the trees
// stood on 28 km² of roads, houses and streams no extract held.
test("the extracts the lock records hold the ground of every listed tile in Lunigiana's box", () => {
  // Lunigiana alone: Cesena's one part's extract is its box, and its local frame is another
  // process's (geometry.ts reads the region from the command line).
  const lock = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../data/raw.lock.json"), "utf8"),
  ) as Record<string, { readonly source: string }>
  const region = regionFromArgs([])
  const boxes = region.parts.flatMap((p) =>
    [...(lock[osmFile(p).slice("data/raw/".length)]?.source ?? "").matchAll(/bbox=([\d.,]+)/g)].map(
      (m) => m[1]!.split(",").map(Number),
    ),
  )
  const { minX, minY, maxX, maxY } = region.bounds
  let missed = 0
  for (const { i, j } of region.tiles)
    for (let y = Math.max(j * TILE, minY) + 50; y < Math.min((j + 1) * TILE, maxY); y += 100)
      for (let x = Math.max(i * TILE, minX) + 50; x < Math.min((i + 1) * TILE, maxX); x += 100) {
        const [lat, lon] = fromLocal(x, y)
        if (!boxes.some(([w, s, e, n]) => lon >= w! && lon <= e! && lat >= s! && lat <= n!))
          missed++
      }
  assert.equal(missed, 0, `${missed} hm² of the listed tiles in the box no extract holds`)
})

/** Elements as the OSM API writes them, keyed by id. */
const elementsOf = (xml: ReadonlyArray<string>): Elements => {
  const all: Elements = { node: new Map(), way: new Map(), relation: new Map() }
  for (const e of xml) {
    const [, kind, id] = /^<(node|way|relation) id="(\d+)"/.exec(e)!
    all[kind as keyof Elements].set(Number(id), e)
  }
  return all
}
const node = (id: number, tags = "") =>
  `<node id="${id}" visible="true" version="1" lat="${44 + id / 1e4}" lon="${10 + (id % 7) / 1e4}"${tags === "" ? "/>" : `>\n    ${tags}\n  </node>`}`
const way = (id: number, nds: ReadonlyArray<number>, tags: ReadonlyArray<string>) =>
  [
    `<way id="${id}" visible="true" version="1">`,
    ...nds.map((n) => `    <nd ref="${n}"/>`),
    ...tags.map((t) => `    ${t}`),
    "  </way>",
  ].join("\n")
const relation = (id: number, members: ReadonlyArray<number>, tags: ReadonlyArray<string>) =>
  [
    `<relation id="${id}" visible="true" version="1">`,
    ...members.map(
      (m, k) => `    <member type="way" ref="${m}" role="${k === 0 ? "outer" : "inner"}"/>`,
    ),
    ...tags.map((t) => `    ${t}`),
    "  </relation>",
  ].join("\n")

test("buildingsOnly keeps the building ways, the building multipolygons, their member ways and the nodes they use", (t) => {
  const all = elementsOf([
    ...Array.from({ length: 16 }, (_, k) => node(k + 1)),
    node(17, '<tag k="amenity" v="bench"/>'),
    way(101, [1, 2, 3, 1], ['<tag k="building" v="house"/>']),
    way(102, [4, 5], ['<tag k="highway" v="residential"/>']),
    way(103, [6, 7, 8, 6], []),
    way(104, [9, 10, 11, 9], []),
    way(105, [12, 13, 14, 12], ['<tag k="building:part" v="yes"/>']),
    way(106, [15, 16, 4, 15], []),
    relation(
      201,
      [103, 104],
      ['<tag k="building" v="church"/>', '<tag k="type" v="multipolygon"/>'],
    ),
    relation(202, [106], ['<tag k="landuse" v="forest"/>', '<tag k="type" v="multipolygon"/>']),
    relation(203, [101], ['<tag k="building" v="yes"/>', '<tag k="type" v="building"/>']),
  ])
  const kept = buildingsOnly(all)
  assert.deepEqual([...kept.relation.keys()], [201])
  assert.deepEqual([...kept.way.keys()], [101, 103, 104])
  assert.deepEqual([...kept.node.keys()], [1, 2, 3, 6, 7, 8, 9, 10, 11])
  // Kept whole: what the file holds is the API's own XML of each.
  assert.equal(kept.way.get(101), all.way.get(101))
  // readOsm reads the file it makes, and the church's rings assemble from it.
  const dir = mkdtempSync(join(tmpdir(), "fetch-osm-")),
    path = join(dir, "town.osm.gz")
  t.after(() => rmSync(dir, { recursive: true }))
  writeFileSync(path, gzipSync(osmXml(kept)))
  const osm = readOsm(path),
    church = osm.relations.get("201")!
  assert.deepEqual([...osm.ways.keys()], ["101", "103", "104"])
  assert.equal(osm.ways.get("101")!.tags.building, "house")
  assert.deepEqual(church.tags, { building: "church", type: "multipolygon" })
  assert.deepEqual(assembleRings(osm, church, "outer"), [["6", "7", "8", "6"]])
  assert.deepEqual(assembleRings(osm, church, "inner"), [["9", "10", "11", "9"]])
  assert.equal(osm.nodes.size, 9)
})
