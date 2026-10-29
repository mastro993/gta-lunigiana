import assert from "node:assert/strict"
import { test } from "node:test"

import { diffLines, diffList } from "../pick-diff.ts"

test("the same list reports nothing", () => {
  const diff = diffList(["a", "b", "c"], ["a", "b", "c"])
  assert.deepEqual(diff, { added: [], removed: [], moved: [] })
  assert.deepEqual(diffLines(diff, "data/parts/x.json"), ["same as data/parts/x.json"])
})

test("an insertion is added only: the names after it keep their order", () => {
  assert.deepEqual(diffList(["a", "c", "d"], ["a", "b", "c", "d"]), {
    added: ["b"],
    removed: [],
    moved: [],
  })
})

test("one name taken out of order reports that name alone", () => {
  assert.deepEqual(diffList(["a", "b", "c", "d", "e"], ["b", "c", "d", "a", "e"]), {
    added: [],
    removed: [],
    moved: [{ name: "a", from: 1, to: 4 }],
  })
})

test("a dropped name is removed, and the lines list every change", () => {
  const diff = diffList(["a", "b", "c"], ["c", "a", "x"])
  assert.deepEqual(diff.removed, ["b"])
  assert.deepEqual(diff.added, ["x"])
  assert.equal(diff.moved.length, 1)
  assert.equal(diffLines(diff, "p.json").length, 4)
})
