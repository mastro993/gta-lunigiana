// The key CI caches the built maps under. Run: node src/tools/map-key.ts (it prints the key). It is
// a SHA-256 over every file a build depends on: the raw lock (whose hashes pin data/raw), the package
// manifest and lock (the npm code the build runs, and the `maps` script), and every source file
// build-map.ts imports, followed from import to import. The baked tables reach into src/sim and
// src/render, so the files are followed rather than listed. Specifiers are read with a regular
// expression: a relative path after `from`, `import` or `import(`, as every import in the repo is
// written. It fails closed: a specifier that names no file throws, and so do an `import(` whose
// argument is not a string literal and any `require(` (the repo is ES modules), which it cannot follow.

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const ROOT = join(import.meta.dirname, "../..")
/** The files besides the build's sources that its output depends on. */
const INPUTS = ["data/raw.lock.json", "package.json", "pnpm-lock.yaml"] as const
/** A relative module specifier: `from "./x.ts"`, `import "./x.ts"`, `import("./x.ts")`. */
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g
/** An import the key cannot follow: `require(`, or `import(` with a computed, template or commented specifier. */
const UNFOLLOWED = /\brequire\s*\(|\bimport\s*\(\s*(?!["'])/

/** Every source file `entry` (under `root`) imports, itself included, `/`-separated from `root`, sorted. */
export const importClosure = (entry: string, root = ROOT): Array<string> => {
  const seen = new Set<string>(),
    stack = [resolve(root, entry)]
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, "utf8")
    const unfollowed = UNFOLLOWED.exec(text)
    if (unfollowed !== null)
      throw new Error(
        `${relative(root, file)}: cannot follow ${text.slice(unfollowed.index, unfollowed.index + 40)}…`,
      )
    for (const [, specifier] of text.matchAll(SPECIFIER)) {
      const target = resolve(dirname(file), specifier!)
      if (!existsSync(target))
        throw new Error(`${relative(root, file)} imports ${specifier}, which is not a file`)
      stack.push(target)
    }
  }
  return [...seen].map((file) => relative(root, file).split(sep).join("/")).sort()
}

/** The cache key of the maps built from the repository at `root`: 64 hex digits. */
export const mapKey = (root = ROOT): string => {
  const hash = createHash("sha256")
  for (const path of [...INPUTS, ...importClosure("src/tools/build-map.ts", root)])
    hash
      .update(`${path}\0`)
      .update(readFileSync(join(root, path)))
      .update("\0")
  return hash.digest("hex")
}

if (import.meta.main) console.log(mapKey())
