import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

import { decimetres, writeGzipped } from "../build-output.ts"

/** A 3 × 2 grid of heights `z`, m. */
const grid = (z: ReadonlyArray<number>) => ({
  cell: 4,
  cols: 3,
  rows: 2,
  x0: 0,
  y0: 0,
  z: Float64Array.from(z),
})

test("decimetres rounds the grid to whole decimetres, from -3276.8 m to 3276.7 m", () => {
  assert.deepEqual(
    Array.from(decimetres(grid([0, 12.34, 12.36, -3276.8, 3276.7, -0.04]))),
    [0, 123, 124, -32768, 32767, 0],
  )
})

test("decimetres throws for a height that does not fit int16, rather than wrapping it", () => {
  for (const bad of [4000, -4000, 3276.75, Number.NaN, Infinity])
    assert.throws(
      () => decimetres(grid([0, 0, 0, 0, 0, 0].map((z, k) => (k === 4 ? bad : z)))),
      /heightmap: .* at node \(1, 1\) does not fit int16/,
    )
})

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
