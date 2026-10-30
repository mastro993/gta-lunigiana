import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { after, test } from "node:test"

import { freeTags, MAX_ASSETS, NOTES, pinRaw, planPin } from "../pin-raw.ts"
import { type Digest, digestOf, isPinned, type Lock, readLock, writeLock } from "../raw-lock.ts"

const dirs: Array<string> = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A data/raw holding `files` (path → text) and a lock holding `lock`. */
const scratch = (files: Record<string, string>, lock: Lock) => {
  const dir = mkdtempSync(join(tmpdir(), "pin-raw-test-")),
    raw = join(dir, "raw"),
    lockPath = join(dir, "raw.lock.json")
  dirs.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(raw, path, ".."), { recursive: true })
    writeFileSync(join(raw, path), text)
  }
  writeLock(lock, lockPath)
  return { raw, lockPath }
}

/**
 * A fake GitHub CLI whose releases have the tags `taken`: it answers `release list` and records
 * each `release create` with its assets' names and texts, read when it is called.
 */
const fakeGh = (taken: ReadonlyArray<string> = []) => {
  const created: Array<{ tag: string; assets: Record<string, string>; flags: Array<string> }> = []
  const run = (args: ReadonlyArray<string>): string => {
    if (args[1] === "list") return taken.map((tag) => `${tag}\n`).join("")
    assert.deepEqual(args.slice(0, 2), ["release", "create"])
    const flag = args.indexOf("--title")
    created.push({
      tag: args[2]!,
      assets: Object.fromEntries(
        args.slice(3, flag).map((file) => [basename(file), readFileSync(file, "utf8")]),
      ),
      flags: args.slice(flag).filter((arg) => arg.startsWith("--")),
    })
    return ""
  }
  return { run, created }
}

const quiet = () => undefined
const README = join(import.meta.dirname, "../../../README.md")
const pinOf = (text: string, asset: string, source: string) => ({
  ...digestOf(Buffer.from(text)),
  asset,
  source,
})
/** What a fetch tool records for `text` from `source`. */
const fetched = (text: string, source = "s") => ({ ...digestOf(Buffer.from(text)), source })

test("planPin uploads the files a fetch tool wrote, and names each disagreement with its remedy", () => {
  const lock: Lock = {
    "same.bin": pinOf("same", "raw-20261029/same.bin", "s"),
    "fetched.bin": fetched("fetched"),
    "refetched.bin": fetched("what the tool wrote"),
    "edited.bin": pinOf("before", "raw-20261029/edited.bin", "s"),
    "gone.bin": pinOf("gone", "raw-20261029/gone.bin", "s"),
    "fetchedgone.bin": fetched("fetchedgone"),
  }
  const local = new Map<string, Digest>(
    ["same", "fetched", "refetched", "edited", "stray"].map((name) => [
      `${name}.bin`,
      digestOf(Buffer.from(name)),
    ]),
  )
  const { upload, problems } = planPin(lock, local)
  assert.deepEqual(upload, ["fetched.bin"])
  assert.equal(problems.length, 5)
  // Fetched, then replaced (a fetch-raw on another branch's lock): the tool's bytes are gone.
  assert.match(
    problems[0]!,
    /^refetched\.bin: other bytes than its fetch tool wrote; fetch it again/,
  )
  assert.match(
    problems[1]!,
    /^edited\.bin: other bytes than pinned, and no fetch tool recorded them; .*pnpm fetch-raw/,
  )
  assert.match(problems[2]!, /^stray\.bin: no source recorded; write it with its fetch tool/)
  assert.match(
    problems[3]!,
    /^gone\.bin: in the lock but not in data\/raw; pnpm fetch-raw restores it/,
  )
  assert.match(problems[4]!, /^fetchedgone\.bin: fetched, then gone from data\/raw; fetch it again/)
})

test("freeTags takes the day's tag, then -2, -3…, skipping the taken ones", () => {
  assert.deepEqual(freeTags("20261030", new Set(), 1), ["raw-20261030"])
  assert.deepEqual(freeTags("20261030", new Set(["raw-20261030", "raw-20261030-3"]), 2), [
    "raw-20261030-2",
    "raw-20261030-4",
  ])
})

test("pinRaw uploads only the fetched files, under their flattened names, and pins them in the lock", () => {
  const before = pinOf("osm", "raw-20261029/lunigiana.osm.gz", "osm, fetched 2026-10-29")
  const { raw, lockPath } = scratch(
    { "lunigiana.osm.gz": "osm", "rt/ctr/23D11_AED.shp.gz": "aed", "rt/dtm.bin": "dtm" },
    {
      "lunigiana.osm.gz": before,
      "rt/ctr/23D11_AED.shp.gz": fetched("aed", "ctr url"),
      "rt/dtm.bin": fetched("dtm", "mosaic"),
    },
  )
  const gh = fakeGh(["raw-20261030"])
  pinRaw(raw, lockPath, gh.run, "20261030", quiet)
  assert.deepEqual(gh.created, [
    {
      tag: "raw-20261030-2",
      assets: { "rt.ctr.23D11_AED.shp.gz": "aed", "rt.dtm.bin": "dtm" },
      flags: ["--title", "--notes", "--prerelease", "--latest=false"],
    },
  ])
  assert.deepEqual(readLock(lockPath), {
    "lunigiana.osm.gz": before,
    "rt/ctr/23D11_AED.shp.gz": pinOf("aed", "raw-20261030-2/rt.ctr.23D11_AED.shp.gz", "ctr url"),
    "rt/dtm.bin": pinOf("dtm", "raw-20261030-2/rt.dtm.bin", "mosaic"),
  })

  // Pinned, nothing is left to upload, and the lock stays as it is.
  const lock = readFileSync(lockPath, "utf8")
  pinRaw(raw, lockPath, gh.run, "20261031", quiet)
  assert.equal(gh.created.length, 1)
  assert.equal(readFileSync(lockPath, "utf8"), lock)
})

test("pinRaw splits an upload over GitHub's 1000 assets a release", () => {
  const files = Object.fromEntries(
    Array.from({ length: MAX_ASSETS + 1 }, (_, i) => [
      `ctr/${String(i).padStart(4, "0")}.gz`,
      `${i}`,
    ]),
  )
  const { raw, lockPath } = scratch(
    files,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, fetched(text)])),
  )
  const gh = fakeGh()
  pinRaw(raw, lockPath, gh.run, "20261030", quiet)
  assert.deepEqual(
    gh.created.map(({ tag, assets }) => [tag, Object.keys(assets).length]),
    [
      ["raw-20261030", MAX_ASSETS],
      ["raw-20261030-2", 1],
    ],
  )
  const lock = readLock(lockPath)
  assert.ok(Object.values(lock).every(isPinned))
  assert.equal((lock["ctr/1000.gz"] as { asset: string }).asset, "raw-20261030-2/ctr.1000.gz")
})

test("pinRaw uploads nothing while data/raw and the lock disagree", () => {
  const { raw, lockPath } = scratch(
    { "rt/dtm.bin": "dtm", "stray.bin": "x" },
    { "rt/dtm.bin": fetched("dtm", "mosaic") },
  )
  const gh = fakeGh()
  assert.throws(
    () => pinRaw(raw, lockPath, gh.run, "20261030", quiet),
    /disagree; nothing uploaded\nstray\.bin: no source recorded/,
  )
  assert.deepEqual(gh.created, [])
  assert.deepEqual(readLock(lockPath), { "rt/dtm.bin": fetched("dtm", "mosaic") })
})

test("two files that flatten to one asset name are refused", () => {
  const { raw, lockPath } = scratch(
    { "a/b.gz": "1", "a.b.gz": "2" },
    { "a/b.gz": fetched("1"), "a.b.gz": fetched("2") },
  )
  assert.throws(
    () => pinRaw(raw, lockPath, fakeGh().run, "20261030", quiet),
    /a\.b\.gz and a\/b\.gz are both asset a\.b\.gz/,
  )
})

test("the release notes credit every source as the README does, with its licence", () => {
  // CC BY asks for the licence's URI and a note that the material was changed; the ODbL for its name.
  for (const text of [
    "© OpenStreetMap contributors",
    "Open Database License (ODbL) 1.0",
    "Fonte dei dati: Regione Toscana – Rilievi LIDAR",
    "https://creativecommons.org/licenses/by/4.0/",
    "https://creativecommons.org/licenses/by/3.0/it/",
    "DTM 5x5 - ultima edizione",
    "The files are changed from their sources",
  ]) {
    assert.ok(NOTES.includes(text), text)
    assert.ok(text.startsWith("The files") || readFileSync(README, "utf8").includes(text), text)
  }
})
