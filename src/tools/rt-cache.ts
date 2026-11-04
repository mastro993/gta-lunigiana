// The Regione Toscana archives the map tools download (CTR sheets and sections, LiDAR tiles, the
// 10 m DTM, the DBT's comuni), cached extracted in the OS temp directory, so `fetch-rt`,
// `pick-sheets` and `pick-lidar` download each once. Needs `unzip` on the PATH, and for the DBT's
// .7z `bsdtar` (libarchive: on macOS by default, `libarchive-tools` on Debian and Ubuntu).

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { getBytes } from "./net.ts"

/** Where the archives and their extracted folders live. */
const CACHE = join(tmpdir(), "gta-lunigiana-rt")

/**
 * Whether `dir` holds a file named each of `names`, at any depth: macOS purges the temp directory's
 * files but keeps its folders.
 */
const holdsFiles = (dir: string, names: ReadonlyArray<string>): boolean => {
  if (!existsSync(dir)) return false
  const files = new Set(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name),
  )
  return names.every((name) => files.has(name))
}

/** The archive at `url` under CACHE, downloaded when missing. */
const cached = async (url: string): Promise<string> => {
  mkdirSync(CACHE, { recursive: true })
  const archive = join(CACHE, basename(url))
  if (!existsSync(archive)) writeFileSync(archive, await getBytes(url))
  return archive
}

/**
 * The archive at `url`, extracted under CACHE, and again whenever its folder lacks a file the
 * archive lists: macOS purges the temp directory's files one by one, so a folder may keep some of
 * them (a 10 m DTM's folder its licence and not its grid). An archive purged too is downloaded again.
 */
export const fetchZip = async (url: string): Promise<string> => {
  const dir = join(CACHE, basename(url).replace(/\.zip$/, "")),
    archive = await cached(url)
  const members = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .split("\n")
    .filter((m) => m !== "" && !m.endsWith("/"))
  if (!members.every((m) => existsSync(join(dir, m))))
    execFileSync("unzip", ["-o", "-q", archive, "-d", dir])
  return dir
}

/**
 * The members named `names` (file names, at any depth) of the 7z archive at `url`, extracted under
 * CACHE; a folder missing one of them is extracted again. One bsdtar call takes them all: each call
 * decodes the archive's whole solid stream (1.7 s for a comune's DBT 1:2000, whatever it extracts).
 * Throws when the archive lacks one.
 */
export const fetch7z = async (url: string, names: ReadonlyArray<string>): Promise<string> => {
  const dir = join(CACHE, basename(url).replace(/\.7z$/, ""))
  if (!holdsFiles(dir, names)) {
    const archive = await cached(url)
    mkdirSync(dir, { recursive: true })
    execFileSync("bsdtar", ["-xf", archive, "-C", dir, ...names.map((name) => `*/${name}`)])
  }
  return dir
}

/** The first file under `dir` matching the `find -name` pattern `name`, if any. */
export const findFile = (dir: string, name: string): string | undefined =>
  execFileSync("find", [dir, "-name", name], { encoding: "utf8" }).trim().split("\n")[0] ||
  undefined

/** `findFile`, throwing when nothing matches. */
export const mustFind = (dir: string, name: string): string => {
  const hit = findFile(dir, name)
  if (hit === undefined) throw new Error(`${name} missing under ${dir}`)
  return hit
}
