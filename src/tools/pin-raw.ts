// Pins data/raw. Run: node src/tools/pin-raw.ts  (pnpm pin-raw), with the GitHub CLI signed in to an
// account that can publish releases. Every file a fetch tool wrote since the last pin (its lock
// entry a source only, `recordSource`) goes to a new prerelease, `raw-YYYYMMDD` (today, UTC), or
// `raw-YYYYMMDD-2`, `-3`… when that tag is taken or a release would pass GitHub's 1000 assets.
// `gh release create` makes it a draft, uploads, then publishes. Each file's SHA-256, size and asset
// then go into data/raw.lock.json; nothing else changes. Assets are never replaced, so an old lock
// still fetches what it pinned. It uploads nothing while data/raw and the lock disagree in a way only
// a person can settle (`planPin`).

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  assetName,
  type Digest,
  digestOf,
  digests,
  type Entry,
  type Gh,
  gh,
  isPinned,
  LOCK_PATH,
  type Lock,
  RAW_DIR,
  readLock,
  writeLock,
} from "./raw-lock.ts"

/** GitHub's limit on a release's assets. */
export const MAX_ASSETS = 1000

/** The release notes: what the release holds, and the credits its sources ask for. */
const NOTES = `Raw map inputs, pinned by \`pnpm pin-raw\`. \`data/raw.lock.json\` maps each file in \`data/raw\` to its asset here, its SHA-256 and its source; \`pnpm fetch-raw\` downloads them.

- Map data © OpenStreetMap contributors, under the Open Database License 1.0: https://www.openstreetmap.org/copyright
- Fonte dei dati: Regione Toscana – Rilievi LIDAR. Carta Tecnica Regionale 1:2000 and Uso e copertura del suolo 2019, Regione Toscana, CC BY 4.0; DTM 10x10 metri, Regione Toscana, CC BY 3.0 IT (Geoscopio cartoteca)
- DTM 5x5 - ultima edizione, Regione Emilia-Romagna, CC BY 4.0

Each file's source is in its lock entry; the README lists the credits in full.`

/** What `pin-raw` uploads, and why it refuses when it does. */
export interface PinPlan {
  /** Files with a source only, written by a fetch tool since the last pin. */
  readonly upload: ReadonlyArray<string>
  /** Disagreements between data/raw and the lock, each with what settles it. */
  readonly problems: ReadonlyArray<string>
}

/** What to upload for `lock`, given the digests of data/raw's files by path. */
export const planPin = (lock: Lock, local: ReadonlyMap<string, Digest>): PinPlan => {
  const upload: Array<string> = [],
    problems: Array<string> = []
  for (const [path, have] of local) {
    const entry: Entry | undefined = lock[path]
    if (entry === undefined)
      problems.push(
        `${path}: no source recorded; write it with its fetch tool (fetch-osm, fetch-rt, fetch-rer), which records one`,
      )
    else if (!isPinned(entry)) upload.push(path)
    else if (entry.sha256 !== have.sha256)
      problems.push(
        `${path}: other bytes than pinned, and no new source; fetch it with its tool to change it, or pnpm fetch-raw to restore it`,
      )
  }
  for (const path of Object.keys(lock))
    if (!local.has(path))
      problems.push(
        `${path}: in the lock but not in data/raw; pnpm fetch-raw restores it, or delete its entry from data/raw.lock.json to drop it`,
      )
  return { upload, problems }
}

/** `count` tags for day `day` (YYYYMMDD) that `taken` lacks: `raw-<day>`, then `raw-<day>-2`, `-3`… */
export const freeTags = (day: string, taken: ReadonlySet<string>, count: number): Array<string> => {
  const tags: Array<string> = []
  for (let k = 1; tags.length < count; k++) {
    const tag = k === 1 ? `raw-${day}` : `raw-${day}-${k}`
    if (!taken.has(tag)) tags.push(tag)
  }
  return tags
}

/**
 * Uploads what `planPin` finds in `raw` through `run` to releases for `day` (YYYYMMDD) and writes
 * the lock at `lockPath` after each release. Throws, uploading nothing, on any problem.
 */
export const pinRaw = (
  raw: string,
  lockPath: string,
  run: Gh,
  day: string,
  log: (line: string) => void = console.log,
): void => {
  let lock = readLock(lockPath)
  const local = digests(raw)
  const { upload, problems } = planPin(lock, local)
  if (problems.length > 0)
    throw new Error(
      `pin-raw: data/raw and data/raw.lock.json disagree; nothing uploaded\n${problems.join("\n")}`,
    )
  if (upload.length === 0) {
    log(`data/raw matches the lock: ${local.size} files, nothing to pin`)
    return
  }
  const names = new Map<string, string>()
  for (const path of upload) {
    const name = assetName(path),
      other = names.get(name)
    if (other !== undefined) throw new Error(`pin-raw: ${other} and ${path} are both asset ${name}`)
    names.set(name, path)
  }
  const taken = new Set(
    run(["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"])
      .split("\n")
      .filter((tag) => tag !== ""),
  )
  const chunks: Array<Array<string>> = []
  for (let i = 0; i < upload.length; i += MAX_ASSETS) chunks.push(upload.slice(i, i + MAX_ASSETS))
  const tags = freeTags(day, taken, chunks.length)
  const stage = mkdtempSync(join(tmpdir(), "pin-raw-"))
  try {
    chunks.forEach((chunk, k) => {
      const tag = tags[k]!,
        files = chunk.map((path) => join(stage, assetName(path)))
      chunk.forEach((path, i) => copyFileSync(join(raw, path), files[i]!))
      run([
        "release",
        "create",
        tag,
        ...files,
        "--title",
        tag,
        "--notes",
        NOTES,
        "--prerelease",
        "--latest=false",
      ])
      // The digests of the copies uploaded, so the lock pins the bytes the release holds.
      const pinned: Record<string, Entry> = {}
      chunk.forEach((path, i) => {
        const { sha256, bytes } = digestOf(readFileSync(files[i]!))
        pinned[path] = {
          sha256,
          bytes,
          asset: `${tag}/${assetName(path)}`,
          source: lock[path]!.source,
        }
      })
      lock = { ...lock, ...pinned }
      writeLock(lock, lockPath)
      log(`pinned ${chunk.length} files in release ${tag}`)
    })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (import.meta.main)
  pinRaw(RAW_DIR, LOCK_PATH, gh, new Date().toISOString().slice(0, 10).replaceAll("-", ""))
