// Downloads the raw map inputs `data/raw.lock.json` pins into `data/raw`. Run: node
// src/tools/fetch-raw.ts  (pnpm fetch-raw). Every pinned file that is missing or whose bytes differ
// comes from its release asset through the GitHub CLI (`gh release download`: signed in, or with
// GH_TOKEN set), so a second run downloads nothing. All downloads are checked against their SHA-256
// and size before any replaces a file: one that differs fails the run with data/raw unchanged.
// A file a fetch tool wrote and `pin-raw` has not uploaded is left as it is, and fails the run if
// data/raw no longer holds the bytes the tool wrote; files the lock does not list are reported and
// left alone.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  type Digest,
  digestOf,
  digests,
  type Gh,
  gh,
  isPinned,
  type Lock,
  type Pinned,
  RAW_DIR,
  readLock,
  splitAsset,
} from "./raw-lock.ts"

/** What `fetch-raw` does with the lock, given data/raw's files. */
export interface FetchPlan {
  /** Pinned files data/raw lacks or holds with other bytes: downloaded. */
  readonly download: ReadonlyArray<string>
  /** Of those, the ones data/raw holds with other bytes: replaced. */
  readonly replace: ReadonlyArray<string>
  /** Fetched files data/raw holds as the fetch tool wrote them: waiting for `pin-raw`. */
  readonly fetched: ReadonlyArray<string>
  /** Fetched files data/raw lacks or holds with other bytes: never uploaded, so nothing can fetch them. */
  readonly lost: ReadonlyArray<string>
  /** Files data/raw holds and the lock does not list: the build may read them. */
  readonly extra: ReadonlyArray<string>
}

/** What to do for `lock`, given the digests of data/raw's files by path. */
export const planFetch = (lock: Lock, local: ReadonlyMap<string, Digest>): FetchPlan => {
  const download: Array<string> = [],
    replace: Array<string> = [],
    fetched: Array<string> = [],
    lost: Array<string> = []
  for (const [path, entry] of Object.entries(lock)) {
    const have = local.get(path)
    if (!isPinned(entry)) (have?.sha256 === entry.sha256 ? fetched : lost).push(path)
    else if (have === undefined) download.push(path)
    else if (have.sha256 !== entry.sha256) {
      download.push(path)
      replace.push(path)
    }
  }
  const extra = [...local.keys()].filter((path) => !Object.hasOwn(lock, path))
  return { download, replace, fetched, lost, extra }
}

/**
 * Brings `raw` in line with `lock` (`planFetch`), downloading through `gh` into a folder inside
 * `raw` (a rename never crosses file systems) and moving the files into place once all of them
 * check. Throws, `raw` unchanged, on a lost file or a download that differs from its pin.
 */
export const fetchRaw = (
  lock: Lock,
  raw: string,
  run: Gh,
  log: (line: string) => void = console.log,
): void => {
  const plan = planFetch(lock, digests(raw))
  for (const path of plan.extra)
    log(`not in the lock, left as it is (the build may read it): ${path}`)
  for (const path of plan.fetched) log(`fetched, not pinned yet (pnpm pin-raw): ${path}`)
  if (plan.lost.length > 0)
    throw new Error(
      `fetch-raw: a fetch tool wrote these files and pin-raw never uploaded them, and data/raw no longer holds the bytes the lock records: fetch them again with their tool and run pnpm pin-raw\n${plan.lost.join("\n")}`,
    )
  const pinned = Object.keys(lock).length - plan.fetched.length
  if (plan.download.length === 0) {
    log(`data/raw matches the lock: ${pinned} files`)
    return
  }
  const pins = new Map(plan.download.map((path) => [path, lock[path] as Pinned]))
  const byTag = new Map<string, Array<string>>()
  for (const pin of pins.values()) {
    const { tag, name } = splitAsset(pin.asset)
    byTag.set(tag, [...(byTag.get(tag) ?? []), name])
  }
  mkdirSync(raw, { recursive: true })
  const tmp = mkdtempSync(join(raw, ".fetch-"))
  try {
    for (const [tag, names] of byTag)
      run(["release", "download", tag, "--dir", tmp, ...names.flatMap((n) => ["--pattern", n])])
    const bad: Array<string> = []
    for (const [path, pin] of pins) {
      const file = join(tmp, splitAsset(pin.asset).name)
      if (!existsSync(file)) {
        bad.push(`${path}: ${pin.asset} was not downloaded`)
        continue
      }
      const got = digestOf(readFileSync(file))
      if (got.sha256 !== pin.sha256 || got.bytes !== pin.bytes)
        bad.push(
          `${path}: ${pin.asset} is ${got.bytes} bytes with SHA-256 ${got.sha256}; the lock pins ${pin.bytes} bytes with ${pin.sha256}`,
        )
    }
    if (bad.length > 0)
      throw new Error(
        `fetch-raw: ${bad.length} of ${pins.size} downloads do not match data/raw.lock.json; data/raw is unchanged\n${bad.join("\n")}`,
      )
    for (const [path, pin] of pins) {
      mkdirSync(dirname(join(raw, path)), { recursive: true })
      renameSync(join(tmp, splitAsset(pin.asset).name), join(raw, path))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const mb = [...pins.values()].reduce((sum, pin) => sum + pin.bytes, 0) / 1e6
  log(
    `downloaded ${pins.size} of ${pinned} files (${mb.toFixed(1)} MB), replacing ${plan.replace.length}`,
  )
  for (const path of plan.replace) log(`replaced: ${path}`)
}

if (import.meta.main) fetchRaw(readLock(), RAW_DIR, gh)
