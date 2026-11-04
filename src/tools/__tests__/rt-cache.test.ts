import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { fetchZip } from "../rt-cache.ts"

// Regression: macOS purged the 10 m DTM's grid from its extracted folder but kept its licence, and
// fetch-rt took the folder for whole, so it found no grid.
test("fetchZip extracts an archive again when the OS purged some of its folder's files", async (t) => {
  const cache = join(tmpdir(), "gta-lunigiana-rt"),
    name = `rt-cache-test-${process.pid}`,
    src = mkdtempSync(join(tmpdir(), "rt-cache-src-"))
  mkdirSync(cache, { recursive: true })
  t.after(() => {
    rmSync(src, { recursive: true })
    rmSync(join(cache, `${name}.zip`), { force: true })
    rmSync(join(cache, name), { recursive: true, force: true })
  })
  writeFileSync(join(src, "licence.pdf"), "licence")
  writeFileSync(join(src, "grid.asc"), "ncols 1")
  execFileSync("zip", [
    "-q",
    "-j",
    join(cache, `${name}.zip`),
    join(src, "licence.pdf"),
    join(src, "grid.asc"),
  ])
  // The URL is never asked for: the archive is already in the cache.
  const url = `https://example.invalid/${name}.zip`
  const dir = await fetchZip(url)
  rmSync(join(dir, "grid.asc"))
  assert.equal(await fetchZip(url), dir)
  assert.equal(readFileSync(join(dir, "grid.asc"), "utf8"), "ncols 1")
})
