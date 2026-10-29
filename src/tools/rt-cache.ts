// The Regione Toscana archives the map tools download (CTR sheets, LiDAR tiles, the 10 m DTM),
// cached unzipped in the OS temp directory, so `fetch-rt`, `pick-sheets` and `pick-lidar` download
// each once. Needs `unzip` on the PATH.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { getBytes } from "./net.ts"

/** Where the archives and their unzipped folders live. */
const CACHE = join(tmpdir(), "gta-lunigiana-rt")

/** Whether `dir` holds a file at any depth: macOS purges the temp directory's files but keeps its folders. */
const holdsFiles = (dir: string): boolean =>
  existsSync(dir) &&
  readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isFile())

/** The archive at `url`, extracted under CACHE; an extracted folder without files counts as missing. */
export const fetchZip = async (url: string): Promise<string> => {
  mkdirSync(CACHE, { recursive: true })
  const zip = join(CACHE, basename(url)),
    dir = zip.replace(/\.zip$/, "")
  if (!holdsFiles(dir)) {
    if (!existsSync(zip)) writeFileSync(zip, await getBytes(url))
    execFileSync("unzip", ["-o", "-q", zip, "-d", dir])
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
