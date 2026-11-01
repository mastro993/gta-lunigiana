import assert from "node:assert/strict"
import { test } from "node:test"

import { seeded } from "../crash/dsp.ts"
import { renderExplosion } from "../explosion.ts"

// The blast's render statistics, over twenty seeds, are in explosion.long-test.ts.
test("a seed renders the same blast twice; another seed draws another", () => {
  const a = renderExplosion({ kind: "explosion", surface: "asphalt" }, 48000, seeded(7)),
    b = renderExplosion({ kind: "explosion", surface: "asphalt" }, 48000, seeded(7))
  const c = renderExplosion({ kind: "explosion", surface: "asphalt" }, 48000, seeded(8))
  assert.deepEqual(a, b)
  assert.ok(a.length !== c.length || a.some((v, i) => v !== c[i]))
})
