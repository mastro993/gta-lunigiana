/**
 * A scratch data/raw and lock, and a fake GitHub CLI, for the pin-raw tests, shared by `pin-raw.test.ts` and `pin-raw.long-test.ts`.
 *
 * @module tools/__tests__/pin-fakes
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { digestOf, type Lock, writeLock } from "../raw-lock.ts"

/** The scratch directories made, for each test file's `after` to remove. */
export const dirs: Array<string> = []

/** A data/raw holding `files` (path → text) and a lock holding `lock`. */
export const scratch = (files: Record<string, string>, lock: Lock) => {
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
export const fakeGh = (taken: ReadonlyArray<string> = []) => {
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

/** A log that says nothing. */
export const quiet = () => undefined

/** What a fetch tool records for `text` from `source`. */
export const fetched = (text: string, source = "s") => ({ ...digestOf(Buffer.from(text)), source })
