import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

import { writeGzipped } from "../build-output.ts"

test("writeGzipped writes each file as gzipSync at level 9 would, and returns their sizes in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "write-gzipped-"))
  try {
    // More files than are gzipped at once, some long and repetitive (a synthetic tile's rows).
    const files = Array.from({ length: 21 }, (_, k) => {
      const data = new Uint8Array(1000 + 5000 * k)
      for (let b = 0; b < data.length; b++) data[b] = (b * (k + 1)) % 7 === 0 ? k : b % 251
      return [join(dir, `${k}.bin`), data] as const
    })
    let pulled = 0
    const sizes = await writeGzipped(
      (function* () {
        for (const f of files) {
          pulled++
          yield f
        }
      })(),
    )
    assert.equal(pulled, files.length)
    files.forEach(([file, data], k) => {
      const gz = readFileSync(file)
      assert.deepEqual(gz, gzipSync(data, { level: 9 }), file)
      assert.equal(sizes[k], gz.length)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
