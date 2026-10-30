import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { importClosure, mapKey } from "../map-key.ts"

const dirs: Array<string> = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A repository holding `files` (path → text), with the inputs every key reads. */
const repo = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "map-key-"))
  dirs.push(root)
  const all = { "data/raw.lock.json": "{}", "package.json": "{}", "pnpm-lock.yaml": "", ...files }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test("the build's closure reaches the sim and render code its bakes import, and no host", () => {
  const closure = importClosure("src/tools/build-map.ts")
  for (const path of [
    "src/tools/build-map.ts",
    "src/tools/bake.ts", // await import("./bake.ts")
    "src/sim/map/kinds.ts",
    "src/sim/lanes.ts",
    "src/sim/map/tiles.ts", // await import("../sim/map/tiles.ts")
  ])
    assert.ok(closure.includes(path), path)
  assert.ok(!closure.some((path) => /^src\/(?:hud|audio)\/|^src\/main\.ts$/.test(path)), "a host")
})

test("importClosure follows every import form and nothing else", () => {
  const root = repo({
    "src/tools/build-map.ts": `import { a } from "./a.ts"
import "./side.ts"
export * from "../sim/re.ts"
import type { T } from "./types.ts"
const { lazy } = await import("./lazy.ts")
const url = new URL("../sim/map/monzone.bin", import.meta.url)
import { readFileSync } from "node:fs"`,
    "src/tools/a.ts": `import {
  b,
} from './b.ts'`,
    "src/tools/b.ts": `import { a } from "./a.ts"`,
    "src/tools/side.ts": "",
    "src/sim/re.ts": "",
    "src/tools/types.ts": "",
    "src/tools/lazy.ts": "",
    "src/tools/unused.ts": "",
  })
  assert.deepEqual(importClosure("src/tools/build-map.ts", root), [
    "src/sim/re.ts",
    "src/tools/a.ts",
    "src/tools/b.ts",
    "src/tools/build-map.ts",
    "src/tools/lazy.ts",
    "src/tools/side.ts",
    "src/tools/types.ts",
  ])
})

test("an import the key cannot follow throws rather than leaving its file out", () => {
  for (const call of [
    "await import(`./lazy.ts`)",
    'await import(/* @vite-ignore */ "./lazy.ts")',
    "await import(name)",
    'require("./lazy.ts")',
  ]) {
    const root = repo({ "src/tools/build-map.ts": call, "src/tools/lazy.ts": "" })
    assert.throws(
      () => importClosure("src/tools/build-map.ts", root),
      /src\/tools\/build-map\.ts: cannot follow /,
      call,
    )
  }
})

test("an import of a file that is not there throws, naming it", () => {
  const root = repo({ "src/tools/build-map.ts": `import { gone } from "./gone.ts"` })
  assert.throws(
    () => importClosure("src/tools/build-map.ts", root),
    /src\/tools\/build-map\.ts imports \.\/gone\.ts, which is not a file/,
  )
})

test("the key changes with the raw lock and the imported code, and with nothing else", () => {
  const files = {
    "src/tools/build-map.ts": `import "./terrain.ts"`,
    "src/tools/terrain.ts": "export const CELL = 4",
    "src/hud/index.ts": "export const HUD = 1",
  }
  const key = mapKey(repo(files))
  assert.match(key, /^[\da-f]{64}$/)
  assert.equal(mapKey(repo(files)), key)
  assert.equal(mapKey(repo({ ...files, "src/hud/index.ts": "export const HUD = 2" })), key)
  const changes: ReadonlyArray<Record<string, string>> = [
    { "src/tools/terrain.ts": "export const CELL = 2" },
    { "data/raw.lock.json": '{"a.bin":{"source":"s"}}' },
    { "pnpm-lock.yaml": "lockfileVersion: '9.0'" },
  ]
  for (const change of changes)
    assert.notEqual(mapKey(repo({ ...files, ...change })), key, JSON.stringify(change))
})
