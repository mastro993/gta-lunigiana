import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { after, test } from "node:test"

import { MAX_ASSETS, pinRaw } from "../pin-raw.ts"
import { isPinned, readLock } from "../raw-lock.ts"
import { dirs, fakeGh, fetched, quiet, scratch } from "./pin-fakes.ts"

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test("pinRaw splits an upload over GitHub's 1000 assets a release", () => {
  const files = Object.fromEntries(
    Array.from({ length: MAX_ASSETS + 1 }, (_, i) => [
      `ctr/${String(i).padStart(4, "0")}.gz`,
      `${i}`,
    ]),
  )
  const { raw, lockPath } = scratch(
    files,
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, fetched(text)])),
  )
  const gh = fakeGh()
  pinRaw(raw, lockPath, gh.run, "20261030", quiet)
  assert.deepEqual(
    gh.created.map(({ tag, assets }) => [tag, Object.keys(assets).length]),
    [
      ["raw-20261030", MAX_ASSETS],
      ["raw-20261030-2", 1],
    ],
  )
  const lock = readLock(lockPath)
  assert.ok(Object.values(lock).every(isPinned))
  assert.equal((lock["ctr/1000.gz"] as { asset: string }).asset, "raw-20261030-2/ctr.1000.gz")
})
