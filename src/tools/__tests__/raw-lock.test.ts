import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import * as v from "valibot"

import {
  assetName,
  digestOf,
  type Lock,
  rawFiles,
  readLock,
  recordSource,
  splitAsset,
  writeLock,
} from "../raw-lock.ts"

const ROOT = join(import.meta.dirname, "../../..")
const SHA = "a".repeat(64)

const dirs: Array<string> = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A fresh folder for one test, with `files` (path → text) written into `raw/`. */
const scratch = (files: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "raw-lock-")),
    raw = join(dir, "raw")
  dirs.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(raw, path, ".."), { recursive: true })
    writeFileSync(join(raw, path), text)
  }
  return { raw, lock: join(dir, "raw.lock.json") }
}

test("a lock is written sorted by path, its fields in a fixed order, and read back", () => {
  const { lock } = scratch()
  assert.deepEqual(readLock(lock), {})
  const entries: Lock = {
    "rt/ucs.json.gz": {
      source: "https://example.org/wfs, fetched 2026-10-30",
      bytes: 5,
      sha256: SHA,
    },
    "lunigiana.osm.gz": {
      source: "osm",
      asset: "raw-20261030/lunigiana.osm.gz",
      bytes: 3,
      sha256: SHA,
    },
  }
  writeLock(entries, lock)
  assert.equal(
    readFileSync(lock, "utf8"),
    `{
  "lunigiana.osm.gz": {
    "sha256": "${SHA}",
    "bytes": 3,
    "asset": "raw-20261030/lunigiana.osm.gz",
    "source": "osm"
  },
  "rt/ucs.json.gz": {
    "sha256": "${SHA}",
    "bytes": 5,
    "source": "https://example.org/wfs, fetched 2026-10-30"
  }
}
`,
  )
  assert.deepEqual(readLock(lock), entries)
})

test("a lock entry that is neither pinned nor fetched fails to read", () => {
  const { lock } = scratch()
  const pinned = { sha256: SHA, bytes: 3, asset: "raw-20261030-2/a.bin", source: "s" }
  for (const [label, file] of [
    ["a short hash", { "a.bin": { ...pinned, sha256: "abc" } }],
    ["a half-written pin", { "a.bin": { source: "s", sha256: SHA } }],
    ["a source alone", { "a.bin": { source: "s" } }],
    ["an empty source", { "a.bin": { ...pinned, source: "" } }],
    ["an asset outside a raw release", { "a.bin": { ...pinned, asset: "v1.0/a.bin" } }],
    ["a path out of data/raw", { "../a.bin": pinned }],
    ["a dotfile", { "rt/.DS_Store": pinned }],
  ] as const) {
    writeFileSync(lock, JSON.stringify(file))
    assert.throws(() => readLock(lock), v.ValiError, label)
  }
})

test("an asset is named after the file's path, / as .", () => {
  assert.equal(assetName("rt/ctr/23D11_AED.shp.gz"), "rt.ctr.23D11_AED.shp.gz")
  assert.deepEqual(splitAsset("raw-20261030-2/rt.dtm.bin"), {
    tag: "raw-20261030-2",
    name: "rt.dtm.bin",
  })
})

test("rawFiles lists every file by its path under data/raw, skipping dotfiles and dot-folders", () => {
  const { raw } = scratch({
    "rt/ctr/b.shp.gz": "b",
    "rt/ctr/a.shp.gz": "a",
    "lunigiana.osm.gz": "o",
    ".DS_Store": "x",
    "rt/.DS_Store": "x",
    ".fetch-1/rt.dtm.bin": "x",
  })
  assert.deepEqual(rawFiles(raw), ["lunigiana.osm.gz", "rt/ctr/a.shp.gz", "rt/ctr/b.shp.gz"])
  assert.deepEqual(rawFiles(join(raw, "missing")), [])
})

test("recordSource records a file's digest and source, unless the lock holds its bytes already", () => {
  const { raw, lock } = scratch({ "rt/dtm.bin": "old", "lunigiana.osm.gz": "osm" })
  const pin = (text: string) => ({
    ...digestOf(Buffer.from(text)),
    asset: "raw-20261029/x",
    source: "before",
  })
  writeLock({ "rt/dtm.bin": pin("old"), "lunigiana.osm.gz": pin("osm") }, lock)

  // Fetched again, the same bytes: the pin and its source stay.
  recordSource(join(raw, "lunigiana.osm.gz"), "after", raw, lock)
  assert.deepEqual(readLock(lock)["lunigiana.osm.gz"], pin("osm"))

  // New bytes: fetched, for pin-raw, with the digest of what the tool wrote.
  writeFileSync(join(raw, "rt/dtm.bin"), "new")
  recordSource(join(raw, "rt/dtm.bin"), "after", raw, lock)
  const fetched = { ...digestOf(Buffer.from("new")), source: "after" }
  assert.deepEqual(readLock(lock)["rt/dtm.bin"], fetched)
  // The same bytes again (a second run, or fetch-rt finding the file unchanged): the entry stays.
  recordSource(join(raw, "rt/dtm.bin"), "later", raw, lock)
  assert.deepEqual(readLock(lock)["rt/dtm.bin"], fetched)

  // A new file.
  mkdirSync(join(raw, "cesena"))
  writeFileSync(join(raw, "cesena/dtm.tif"), "tif")
  recordSource(join(raw, "cesena/dtm.tif"), "wcs", raw, lock)
  assert.deepEqual(readLock(lock)["cesena/dtm.tif"], {
    ...digestOf(Buffer.from("tif")),
    source: "wcs",
  })

  assert.throws(
    () => recordSource(join(raw, "../elsewhere.bin"), "s", raw, lock),
    /not a raw input/,
  )
})

test("data/raw and the built maps are ignored by git, and no tracked file is over 1 MB", () => {
  // Issue #6: each rebuilt input or map put a whole new copy of its deflated bytes into the pack.
  // check-ignore exits 0 when any path it is given is ignored, so each is asked alone.
  for (const path of [
    "data/raw/rt/dtm.bin",
    "src/sim/map/monzone.bin",
    "src/sim/map/cesena/0_0.bin",
  ])
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", path], { cwd: ROOT })
  const big = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "")
    .filter(
      (path) => (statSync(join(ROOT, path), { throwIfNoEntry: false })?.size ?? 0) > 1_000_000,
    )
  assert.deepEqual(big, [])
})
