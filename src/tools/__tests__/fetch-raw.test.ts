import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { fetchRaw, planFetch } from "../fetch-raw.ts"
import { assetName, type Digest, digestOf, type Lock, rawFiles } from "../raw-lock.ts"

/** The pin of `text` as file `path` in release `tag`. */
const pin = (path: string, text: string, tag = "raw-20261030") => ({
  ...digestOf(Buffer.from(text)),
  asset: `${tag}/${assetName(path)}`,
  source: `https://example.org/${path}`,
})

/** A data/raw holding `files` (path → text). */
const rawWith = (files: Record<string, string>): string => {
  const raw = join(mkdtempSync(join(tmpdir(), "fetch-raw-")), "raw")
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(raw, path, ".."), { recursive: true })
    writeFileSync(join(raw, path), text)
  }
  return raw
}

/** The text of every file in `raw` by path. */
const contents = (raw: string) =>
  Object.fromEntries(rawFiles(raw).map((path) => [path, readFileSync(join(raw, path), "utf8")]))

/**
 * A fake GitHub CLI serving `releases` (tag → asset name → text) to `release download <tag> --dir
 * <dir> --pattern <name>…`, recording every call.
 */
const fakeGh = (releases: Record<string, Record<string, string>>) => {
  const calls: Array<ReadonlyArray<string>> = []
  const run = (args: ReadonlyArray<string>): string => {
    calls.push(args)
    const [, , tag, , dir, ...rest] = args
    assert.deepEqual(args.slice(0, 2), ["release", "download"])
    for (let i = 0; i < rest.length; i += 2) {
      assert.equal(rest[i], "--pattern")
      const text = releases[tag!]?.[rest[i + 1]!]
      if (text !== undefined) writeFileSync(join(dir!, rest[i + 1]!), text)
    }
    return ""
  }
  return { run, calls }
}

const quiet = () => undefined

test("planFetch downloads what is missing or differs, keeps what matches, and sorts out the rest", () => {
  const lock: Lock = {
    "same.bin": pin("same.bin", "same"),
    "gone.bin": pin("gone.bin", "gone"),
    "stale.bin": pin("stale.bin", "new"),
    "fetched.bin": { source: "s" },
    "lost.bin": { source: "s" },
  }
  const local = new Map<string, Digest>([
    ["same.bin", digestOf(Buffer.from("same"))],
    ["stale.bin", digestOf(Buffer.from("old"))],
    ["fetched.bin", digestOf(Buffer.from("fetched"))],
    ["extra.bin", digestOf(Buffer.from("extra"))],
  ])
  assert.deepEqual(planFetch(lock, local), {
    download: ["gone.bin", "stale.bin"],
    replace: ["stale.bin"],
    unpinned: ["fetched.bin"],
    lost: ["lost.bin"],
    extra: ["extra.bin"],
  })
})

test("fetchRaw downloads the missing and different files, release by release, then nothing on a second run", () => {
  const lock: Lock = {
    "lunigiana.osm.gz": pin("lunigiana.osm.gz", "osm"),
    "rt/dtm.bin": pin("rt/dtm.bin", "dtm"),
    "rt/ctr/23D11_AED.shp.gz": pin("rt/ctr/23D11_AED.shp.gz", "aed", "raw-20261031"),
  }
  const raw = rawWith({ "lunigiana.osm.gz": "osm", "rt/dtm.bin": "an older dtm" })
  const gh = fakeGh({
    "raw-20261030": { "lunigiana.osm.gz": "osm", "rt.dtm.bin": "dtm" },
    "raw-20261031": { "rt.ctr.23D11_AED.shp.gz": "aed" },
  })
  const lines: Array<string> = []
  fetchRaw(lock, raw, gh.run, (line) => lines.push(line))
  assert.deepEqual(contents(raw), {
    "lunigiana.osm.gz": "osm",
    "rt/ctr/23D11_AED.shp.gz": "aed",
    "rt/dtm.bin": "dtm",
  })
  assert.deepEqual(
    gh.calls.map((args) => [args[2], args.filter((_, i) => i > 5 && i % 2 === 0)]),
    [
      ["raw-20261030", ["rt.dtm.bin"]],
      ["raw-20261031", ["rt.ctr.23D11_AED.shp.gz"]],
    ],
  )
  assert.deepEqual(lines, ["downloaded 2 of 3 files (0.0 MB), replacing 1", "replaced: rt/dtm.bin"])
  // The download folder inside data/raw is gone.
  assert.deepEqual(readdirSync(raw).sort(), ["lunigiana.osm.gz", "rt"])

  lines.length = 0
  fetchRaw(lock, raw, gh.run, (line) => lines.push(line))
  assert.equal(gh.calls.length, 2)
  assert.deepEqual(lines, ["data/raw matches the lock: 3 files"])
})

test("a download whose bytes differ from the lock fails loudly, leaving data/raw as it was", () => {
  const lock: Lock = {
    "rt/dtm.bin": pin("rt/dtm.bin", "dtm"),
    "rt/ucs.json.gz": pin("rt/ucs.json.gz", "ucs"),
  }
  const raw = rawWith({ "rt/dtm.bin": "an older dtm" })
  const gh = fakeGh({ "raw-20261030": { "rt.dtm.bin": "dtm", "rt.ucs.json.gz": "tampered" } })
  assert.throws(
    () => fetchRaw(lock, raw, gh.run, quiet),
    /1 of 2 downloads do not match data\/raw\.lock\.json; data\/raw is unchanged\nrt\/ucs\.json\.gz: raw-20261030\/rt\.ucs\.json\.gz is 8 bytes with SHA-256 [\da-f]{64}; the lock pins 3 bytes/,
  )
  assert.deepEqual(contents(raw), { "rt/dtm.bin": "an older dtm" })
  assert.deepEqual(readdirSync(raw), ["rt"])
})

test("an asset the release lacks fails the run", () => {
  const lock: Lock = { "rt/dtm.bin": pin("rt/dtm.bin", "dtm") }
  const raw = rawWith({})
  assert.throws(
    () => fetchRaw(lock, raw, fakeGh({}).run, quiet),
    /rt\/dtm\.bin: raw-20261030\/rt\.dtm\.bin was not downloaded/,
  )
  assert.deepEqual(contents(raw), {})
})

test("a file the lock gives a source only fails the run when data/raw lacks it, before any download", () => {
  const lock: Lock = { "rt/dtm.bin": pin("rt/dtm.bin", "dtm"), "rt/ucs.json.gz": { source: "s" } }
  const gh = fakeGh({ "raw-20261030": { "rt.dtm.bin": "dtm" } })
  assert.throws(
    () => fetchRaw(lock, rawWith({}), gh.run, quiet),
    /data\/raw lacks them: fetch them with their tool and run pnpm pin-raw\nrt\/ucs\.json\.gz$/,
  )
  assert.equal(gh.calls.length, 0)
})

test("fetched-but-unpinned and unlisted files are reported and left alone", () => {
  const lock: Lock = { "rt/dtm.bin": pin("rt/dtm.bin", "dtm"), "rt/ucs.json.gz": { source: "s" } }
  const raw = rawWith({ "rt/dtm.bin": "dtm", "rt/ucs.json.gz": "new ucs", "notes.txt": "mine" })
  const lines: Array<string> = []
  fetchRaw(lock, raw, fakeGh({}).run, (line) => lines.push(line))
  assert.deepEqual(lines, [
    "not in the lock, left as it is (the build may read it): notes.txt",
    "fetched, not pinned yet (pnpm pin-raw): rt/ucs.json.gz",
    "data/raw matches the lock: 1 files",
  ])
  assert.equal(contents(raw)["rt/ucs.json.gz"], "new ucs")
})
