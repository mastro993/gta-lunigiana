import assert from "node:assert/strict"
import { test } from "node:test"

import { fitProfile, type Pin } from "../profile-fit.ts"

// Regression (review of #20): a broken minimum held within the grade of the broken bound beside it
// was raised past the maximum at its own sample, which a pinned sample no longer checks: the rail
// 206182844 fell 36.6% at (−19005, −3660), and its twins 206182846 and 111752500 stood 3.63 m apart.
test("fitProfile raises a broken minimum toward the bound beside it no higher than the maximums allow, its own sample's among them", () => {
  // A track beside its twin at 100 m, held within 0.3 m of it, its ground dipping 3 m under it; a
  // deck's end 4 m before the twin starts holds it at 104 m or more; the rail's grade limit.
  const n = 61,
    ds = 4,
    T = 0.3
  const s = Array.from({ length: n }, (_, k) => k * ds)
  const p = {
    x: [...s],
    y: s.map(() => 0),
    s,
    z: Float64Array.from(s, (_, k) => (k > 10 && k < 40 ? 97 : 100)),
    vertexSample: [0, n - 1],
  }
  const twin: Array<Pin> = []
  for (let k = 11; k < n - 1; k++)
    twin.push({ k, z: 100 - T, kind: "min" }, { k, z: 100 + T, kind: "max" })
  fitProfile(
    p,
    0.0375,
    [{ k: 0, z: 100 }, { k: n - 1, z: 100 }, { k: 10, z: 104, kind: "min" }, ...twin],
    1,
  )
  assert.ok(p.z[10]! >= 104 - 1e-6, `the deck's end at ${p.z[10]}`)
  for (const { k, z, kind } of twin)
    assert.ok(
      kind === "min" ? p.z[k]! >= z - 1e-6 : p.z[k]! <= z + 1e-6,
      `${p.z[k]!.toFixed(2)} m at sample ${k}, past its twin's ${kind} ${z}`,
    )
})
