import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { gzipSync } from "node:zlib"

import { mergeOsm, type Osm, readOsm, readOsms } from "../osm.ts"

/** An Osm of `nodes` (id → lat), `ways` (id → node ids) and `relations` (id → way ids), in the order given. */
const osmOf = (
  nodes: ReadonlyArray<readonly [string, number]>,
  ways: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [],
  relations: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [],
): Osm => ({
  nodes: new Map(nodes.map(([id, lat]) => [id, { id, lat, lon: 10, tags: {} }])),
  ways: new Map(ways.map(([id, nds]) => [id, { id, nds, tags: {} }])),
  relations: new Map(
    relations.map(([id, refs]) => [
      id,
      { id, tags: {}, members: refs.map((ref) => ({ type: "way", ref, role: "outer" })) },
    ]),
  ),
})

test("mergeOsm keeps the first part's element of an id two parts hold", () => {
  const first = osmOf([["5", 44.1]], [["7", ["5"]]], [["9", ["7"]]]),
    second = osmOf(
      [
        ["5", 44.2],
        ["6", 44.3],
      ],
      [["7", ["5", "6"]]],
      [["9", ["7", "8"]]],
    )
  const merged = mergeOsm([first, second])
  assert.equal(merged.nodes.get("5"), first.nodes.get("5"))
  assert.equal(merged.nodes.get("6"), second.nodes.get("6"))
  assert.equal(merged.ways.get("7"), first.ways.get("7"))
  assert.equal(merged.relations.get("9"), first.relations.get("9"))
  assert.equal(mergeOsm([second, first]).nodes.get("5"), second.nodes.get("5"))
})

test("mergeOsm orders each kind by numeric id, as one fetch over every part would write it", () => {
  const merged = mergeOsm([
    osmOf(
      [
        ["10", 1],
        ["2", 2],
      ],
      [["300", []]],
      [["40", []]],
    ),
    osmOf(
      [
        ["100", 3],
        ["9", 4],
      ],
      [["30", []]],
      [["4", []]],
    ),
  ])
  // By number, not by string: "10" < "100" < "2" < "9" as strings.
  assert.deepEqual([...merged.nodes.keys()], ["2", "9", "10", "100"])
  assert.deepEqual([...merged.ways.keys()], ["30", "300"])
  assert.deepEqual([...merged.relations.keys()], ["4", "40"])
})

test("mergeOsm gives one part already in id order back as it is", () => {
  const one = osmOf(
    [
      ["3", 1],
      ["12", 2],
    ],
    [
      ["8", ["3", "12"]],
      ["20", ["12"]],
    ],
    [["1", ["8"]]],
  )
  const merged = mergeOsm([one])
  assert.deepEqual(merged, one)
  for (const kind of ["nodes", "ways", "relations"] as const) {
    assert.deepEqual([...merged[kind].keys()], [...one[kind].keys()], kind)
    for (const [id, element] of one[kind]) assert.equal(merged[kind].get(id), element, id)
  }
})

const dirs: Array<string> = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A gzipped OSM file of `elements` (their XML as the API writes it) in a fresh folder. */
const osmFileOf = (name: string, elements: ReadonlyArray<string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "osm-"))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(
    path,
    gzipSync(
      ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6">', ...elements, "</osm>"].join(
        "\n",
      ),
    ),
  )
  return path
}

test("readOsms reads every part's file into one, the earlier part's element winning; one file reads as readOsm reads it", () => {
  const lucido = osmFileOf("lucido.osm.gz", [
      '<node id="1" lat="44.1" lon="10.1"/>',
      '<node id="3" lat="44.3" lon="10.3"/>',
      '<way id="10"><nd ref="1"/><nd ref="3"/><tag k="highway" v="track"/></way>',
    ]),
    next = osmFileOf("next.osm.gz", [
      '<node id="2" lat="44.2" lon="10.2"/>',
      '<node id="3" lat="44.4" lon="10.4"/>',
      '<way id="10"><nd ref="3"/><nd ref="2"/><tag k="highway" v="road"/></way>',
      '<way id="11"><nd ref="2"/><nd ref="3"/></way>',
    ])
  const osm = readOsms([lucido, next])
  assert.deepEqual([...osm.nodes.keys()], ["1", "2", "3"])
  assert.equal(osm.nodes.get("3")!.lat, 44.3)
  assert.deepEqual([...osm.ways.keys()], ["10", "11"])
  assert.deepEqual(osm.ways.get("10")!.nds, ["1", "3"])
  assert.equal(osm.ways.get("10")!.tags.highway, "track")
  assert.deepEqual(readOsms([lucido]), readOsm(lucido))
})
