import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"

/** fetch-rt run with `args`: its exit status and what it printed to stderr. */
const fetchRt = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, [join(import.meta.dirname, "../fetch-rt.ts"), ...args], {
    encoding: "utf8",
  })

test("fetch-rt refuses a stage for a test region with buildings of its own, and any test region with nothing of its own, before it asks for anything", () => {
  const stage = fetchRt(["--region", "pontremoli-town", "ctr"])
  assert.notEqual(stage.status, 0)
  assert.match(
    stage.stderr,
    /--region pontremoli-town has buildings alone: run fetch-rt without a stage/,
  )
  const borrowed = fetchRt(["--region", "lunigiana-l"])
  assert.notEqual(borrowed.status, 0)
  assert.match(
    borrowed.stderr,
    /--region lunigiana-l is built from Lunigiana's inputs: fetch none for it/,
  )
})
