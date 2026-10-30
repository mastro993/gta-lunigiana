// Pins data/raw. Run: node src/tools/pin-raw.ts  (pnpm pin-raw), with the GitHub CLI signed in to an
// account that can publish releases. Every file a fetch tool wrote since the last pin (its lock
// entry fetched: a digest and a source, no asset; `recordSource`) goes, if data/raw still holds
// those bytes, to a new prerelease, `raw-YYYYMMDD` (today, UTC), or `raw-YYYYMMDD-2`, `-3`… when
// that tag is taken or a release would pass GitHub's 1000 assets. `gh release create` makes it a
// draft, uploads, then publishes. Each file's asset then goes into data/raw.lock.json; nothing else
// changes. Assets are never replaced, so an old lock
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

/**
 * The release notes: what the release holds, that it is changed from its sources, and the credits
 * and licences they ask for (as the README's attribution section gives them).
 */
export const NOTES = `Raw map inputs, pinned by \`pnpm pin-raw\`. \`data/raw.lock.json\` maps each file in \`data/raw\` to its asset here, its SHA-256 and its source; \`pnpm fetch-raw\` downloads them.

The files are changed from their sources: cut to the play area, subset to the layers and classes the map uses, mosaicked, averaged or re-encoded. Credits and licences:

- Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright
- Fonte dei dati: Regione Toscana – Rilievi LIDAR. The Carta Tecnica Regionale 1:2000 and the Uso e copertura del suolo 2019, Regione Toscana, under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/), and the DTM 10x10 metri, Regione Toscana, under Creative Commons Attribution 3.0 Italia (https://creativecommons.org/licenses/by/3.0/it/), from the Geoscopio cartoteca: https://www502.regione.toscana.it/geoscopio/cartoteca.html
- DTM 5x5 - ultima edizione, Regione Emilia-Romagna, under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/): https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/altimetria/layer-2

Each file's source is in its lock entry. The full credits: https://github.com/mastro993/gta-lunigiana#data-attribution-and-licences`

/** What `pin-raw` uploads, and why it refuses when it does. */
export interface PinPlan {
  /** Fetched files data/raw holds as their fetch tool wrote them. */
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
    else if (entry.sha256 === have.sha256) {
      if (!isPinned(entry)) upload.push(path)
    } else
      problems.push(
        isPinned(entry)
          ? `${path}: other bytes than pinned, and no fetch tool recorded them; fetch it with its tool to change it, or pnpm fetch-raw to restore it`
          : `${path}: other bytes than its fetch tool wrote; fetch it again with its tool`,
      )
  }
  for (const [path, entry] of Object.entries(lock))
    if (!local.has(path))
      problems.push(
        isPinned(entry)
          ? `${path}: in the lock but not in data/raw; pnpm fetch-raw restores it, or delete its entry from data/raw.lock.json to drop it`
          : `${path}: fetched, then gone from data/raw; fetch it again with its tool, or delete its entry from data/raw.lock.json to drop it`,
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
      // The copies are what the release gets: each must still be the bytes its fetch tool wrote.
      chunk.forEach((path, i) => {
        copyFileSync(join(raw, path), files[i]!)
        if (digestOf(readFileSync(files[i]!)).sha256 !== lock[path]!.sha256)
          throw new Error(`pin-raw: ${path} changed while pinning; nothing more uploaded`)
      })
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
      const pinned: Record<string, Entry> = {}
      for (const path of chunk) {
        const { sha256, bytes, source } = lock[path]!
        pinned[path] = { sha256, bytes, asset: `${tag}/${assetName(path)}`, source }
      }
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
