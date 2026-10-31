// The 3x test region (`lunigiana-3x`, region.ts), whose play area is lucido's on three times its
// built terrain, against lucido: the terrain and the tables the bake reads from it in lucido's
// rectangle, and the live vehicles round Monzone (the same seed and the same stand at the start:
// `stand.ts`, one child process a map, as a process loads one map). The 3x is built by hand (node
// src/tools/build-map.ts --region lunigiana-3x, 16 s, 1.5 GB; CI never builds it), and without it
// this is skipped.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { PARKED } from "../../sim/population/parked.ts"
import { TRAFFIC } from "../../sim/systems/populate.ts"
import { builtMapUrl, readWholeMap, wholeMap } from "../map-file.ts"
import { PARTS, regionFromArgs } from "../region.ts"
import type { JoinedMap } from "../tile-map.ts"

const X3 = regionFromArgs(["--region", "lunigiana-3x"])
const skip = existsSync(builtMapUrl(X3))
  ? false
  : `no ${X3.key} build in test-maps: run node src/tools/build-map.ts --region ${X3.key}`
const STAND = fileURLToPath(new URL("stand.ts", import.meta.url))
const LUCIDO = PARTS[0]!.rects[0]!

let both: { readonly lucido: JoinedMap; readonly x3: JoinedMap } | undefined
/** Lucido's map and the 3x's, whole, read once. */
const maps = () => (both ??= { lucido: wholeMap(), x3: readWholeMap(builtMapUrl(X3)) })

/** Metres from (x, y) in to lucido's edge. */
const inFromEdge = (x: number, y: number) => {
  const [x0, y0, x1, y1] = LUCIDO
  return Math.min(x - x0, x1 - x, y - y0, y1 - y)
}

test("every terrain node in lucido's rectangle is lucido's on the 3x", { skip }, () => {
  const { heightmap: a } = maps().lucido,
    { heightmap: b } = maps().x3
  const [x0, y0, x1, y1] = LUCIDO
  const z = (m: typeof a, x: number, y: number) =>
    m.data[((y - m.y0) / m.cell) * m.cols + (x - m.x0) / m.cell]
  let nodes = 0
  for (let y = y0; y <= y1; y += a.cell)
    for (let x = x0; x <= x1; x += a.cell, nodes++)
      if (z(a, x, y) !== z(b, x, y))
        assert.fail(`node (${x}, ${y}): ${z(a, x, y)} dm on lucido, ${z(b, x, y)} on the 3x`)
  assert.equal(nodes, 1951 * 2501)
})

test("the 3x bakes lucido's lamps, water beds and parked spots' rests", { skip }, () => {
  const { lucido, x3 } = maps()
  const key = (o: object) => JSON.stringify(o)
  assert.equal(x3.lamps.length, lucido.lamps.length)
  lucido.lamps.forEach((l, i) => assert.equal(key(x3.lamps[i]!), key(l), `lamp ${i}`))
  assert.equal(x3.water.length, lucido.water.length)
  lucido.water.forEach((w, i) => {
    const v = x3.water[i]!
    assert.equal(key(v.pts), key(w.pts), `water ${w.id}`)
    w.floor.forEach((f, k) =>
      assert.ok(
        Object.is(v.floor[k], f),
        `water ${w.id}'s bed at ${k}: ${f} on lucido, ${v.floor[k]}`,
      ),
    )
  })
  // Every spot the 3x keeps is lucido's, rest and all; it leaves out only one by a building it
  // drops across lucido's edge.
  const spots = new Set(lucido.spawns.parked.map(key)),
    kept = new Set(x3.spawns.parked.map(key))
  for (const spot of x3.spawns.parked) assert.ok(spots.has(key(spot)), `3x spot ${key(spot)}`)
  const left = lucido.spawns.parked.filter((s) => !kept.has(key(s)))
  assert.deepEqual(
    left.map((s) => inFromEdge(s.x, s.y) < 50),
    [true],
  )
})

/** How many vehicles are live after the stand on the map of region `key`, by kind. */
const stand = (key: string) => {
  const { parked, traffic, other } = JSON.parse(
    execFileSync(process.execPath, [STAND, key], { encoding: "utf8" }),
  ) as { readonly parked: number; readonly traffic: number; readonly other: number }
  return { parked, traffic, other }
}

test(
  "round Monzone the live vehicles are as many on three times lucido's built terrain as on lucido, within 200 parked and 10 traffic",
  { skip },
  () => {
    const lucido = stand("lunigiana")
    assert.deepEqual(stand(X3.key), lucido)
    const { parked, traffic, other } = lucido
    assert.ok(parked + other <= PARKED && traffic <= TRAFFIC.max)
    assert.ok(parked > 0 && traffic > 0 && other === 2) // the Carabinieri's two
  },
)
