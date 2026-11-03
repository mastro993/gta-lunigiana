import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { importClosure } from "../tools/map-key.ts"

const ROOT = join(import.meta.dirname, "../..")

test("the modules the pages load in the browser import no Node built-in", () => {
  // Vite leaves a `node:` module out of the page, and the game fails to start when one is read: the
  // map tools the game shares (geometry.ts for `hash01`, and through it region.ts) must not import
  // `node:fs` and the like. The entries are index.html's and lab.html's scripts.
  const files = [...new Set(["src/boot.ts", "src/audio/lab.ts"].flatMap((e) => importClosure(e)))]
  assert.ok(files.includes("src/main.ts") && files.includes("src/tools/region.ts"))
  const node = files.filter((f) => readFileSync(join(ROOT, f), "utf8").includes(`from "node:`))
  assert.deepEqual(node, [])
})
