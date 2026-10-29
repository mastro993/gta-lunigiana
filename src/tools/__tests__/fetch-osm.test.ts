import assert from "node:assert/strict"
import { test } from "node:test"

import { type Answer, type Bbox, fetchSplit } from "../fetch-osm.ts"

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
