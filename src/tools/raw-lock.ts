// The pin of the map's raw inputs (issue #6). `data/raw/` is gitignored: git cannot delta its
// deflated files, so each rebuilt input added a whole copy to the pack. `data/raw.lock.json`
// (tracked) maps each file in it, by its path under `data/raw`, to its SHA-256, its size, the release
// asset that holds it (`raw-YYYYMMDD/<path with / as .>`) and where it came from. The fetch tools
// record each file they write (`recordSource`): its digest and source with no asset, fetched but not
// pinned, until `pnpm pin-raw` uploads those bytes; `pnpm fetch-raw` downloads what the lock pins.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

import * as v from "valibot"

const ROOT = join(import.meta.dirname, "../..")
/** The raw inputs, gitignored. */
export const RAW_DIR = join(ROOT, "data/raw")
/** The lock, tracked. */
export const LOCK_PATH = join(ROOT, "data/raw.lock.json")

/**
 * A file's path under `data/raw`, `/`-separated. Each part keeps to the characters GitHub keeps in
 * an asset's name and never starts with a dot (no `..`, and dotfiles such as `.DS_Store` are not
 * inputs).
 */
const PATH = /^[\w-][\w.-]*(?:\/[\w-][\w.-]*)*$/
/** A release asset: the tag (`raw-` and the UTC day, `-2`, `-3`… past the first) and the name. */
const ASSET = /^(raw-\d{8}(?:-\d+)?)\/([\w-][\w.-]*)$/

const Fields = {
  sha256: v.pipe(v.string(), v.regex(/^[\da-f]{64}$/)),
  bytes: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  source: v.pipe(v.string(), v.nonEmpty()),
}
// Strict, so a pinned entry with a broken asset fails instead of reading as fetched.
const PinnedSchema = v.strictObject({ ...Fields, asset: v.pipe(v.string(), v.regex(ASSET)) })
const FetchedSchema = v.strictObject(Fields)
const LockSchema = v.record(
  v.pipe(v.string(), v.regex(PATH)),
  v.union([PinnedSchema, FetchedSchema]),
)

/** A pinned file: its bytes' SHA-256 and count, the asset holding them, and where they came from. */
export type Pinned = v.InferOutput<typeof PinnedSchema>
/** A file a fetch tool wrote and `pin-raw` has not uploaded: the digest of the bytes it wrote, and their source. */
export type Fetched = v.InferOutput<typeof FetchedSchema>
/** A lock entry: pinned, or fetched and waiting for `pin-raw`. */
export type Entry = Pinned | Fetched
/** The lock: an entry per file, by its path under `data/raw`. */
export type Lock = Readonly<Record<string, Entry>>

/** Whether `entry` is pinned (it has an asset). */
export const isPinned = (entry: Entry): entry is Pinned => "asset" in entry

/** A file's bytes: their SHA-256 and their count. */
export interface Digest {
  readonly sha256: string
  readonly bytes: number
}

/** The SHA-256 and size of `bytes`. */
export const digestOf = (bytes: Buffer): Digest => ({
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
})

/** The lock at `path`; an empty one when there is none yet. Throws on an entry it cannot read. */
export const readLock = (path = LOCK_PATH): Lock =>
  existsSync(path) ? v.parse(LockSchema, JSON.parse(readFileSync(path, "utf8"))) : {}

/** Writes `lock` to `path`: entries sorted by path, fields in a fixed order, one per line. */
export const writeLock = (lock: Lock, path = LOCK_PATH): void => {
  const sorted = Object.fromEntries(
    Object.keys(lock)
      .sort()
      .map((file) => {
        const entry = lock[file]!
        return [
          file,
          isPinned(entry)
            ? {
                sha256: entry.sha256,
                bytes: entry.bytes,
                asset: entry.asset,
                source: entry.source,
              }
            : { sha256: entry.sha256, bytes: entry.bytes, source: entry.source },
        ]
      }),
  )
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Runs the GitHub CLI with `args` and returns what it prints. */
export type Gh = (args: ReadonlyArray<string>) => string

/** The GitHub CLI on the PATH (signed in, or GH_TOKEN set); its errors and progress go to stderr. */
export const gh: Gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })

/** The asset name of the file at `path` under `data/raw`: its path with `/` as `.`. */
export const assetName = (path: string): string => path.replaceAll("/", ".")

/** The tag and name of `asset` (`raw-20261030/rt.dtm.bin`). */
export const splitAsset = (asset: string): { readonly tag: string; readonly name: string } => {
  const [, tag, name] = ASSET.exec(asset)!
  return { tag: tag!, name: name! }
}

/** Every file under `dir` by its `/`-separated path, sorted, skipping dotfiles and dot-folders. */
export const rawFiles = (dir = RAW_DIR): Array<string> =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
        .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
        .sort()
    : []

/** The digest of every file under `dir` (`rawFiles`), by path. */
export const digests = (dir = RAW_DIR): Map<string, Digest> =>
  new Map(rawFiles(dir).map((path) => [path, digestOf(readFileSync(join(dir, path)))]))

/** `what`, stamped with today's UTC date: the source of a download that changes over time. */
export const fetchedToday = (what: string): string =>
  `${what}, fetched ${new Date().toISOString().slice(0, 10)}`

/**
 * Records that a fetch tool holds `file` (under `raw`) from `source`. An entry already recording
 * these bytes, pinned or fetched, stays as it is; otherwise the file becomes fetched, with the
 * digest of its bytes, for `pin-raw`.
 */
export const recordSource = (
  file: string,
  source: string,
  raw = RAW_DIR,
  lockPath = LOCK_PATH,
): void => {
  const path = relative(raw, file).split(sep).join("/")
  if (!PATH.test(path)) throw new Error(`${file} is not a raw input under ${raw}`)
  const lock = readLock(lockPath),
    digest = digestOf(readFileSync(file))
  if (lock[path]?.sha256 === digest.sha256) return
  writeLock({ ...lock, [path]: { ...digest, source } }, lockPath)
}
