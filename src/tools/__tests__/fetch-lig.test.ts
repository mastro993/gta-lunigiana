import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"

/** fetch-lig run with `args`: its exit status and what it printed to stderr. */
const fetchLig = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, [join(import.meta.dirname, "../fetch-lig.ts"), ...args], {
    encoding: "utf8",
  })

test("fetch-lig takes one known part and refuses anything else before it asks for anything", () => {
  const two = fetchLig(["sarzana-town", "lucido"])
  assert.notEqual(two.status, 0)
  assert.match(two.stderr, /usage: fetch-lig <part>/)
  const unknown = fetchLig(["sarzana"])
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /unknown part sarzana: use one of lucido, .*sarzana-town/)
})
