// The 3x test region (`lunigiana-3x`, region.ts), whose play area is lucido's on three times its
// built terrain, against lucido: the terrain and the tables the bake reads from it in lucido's
// rectangle, and the live vehicles round Monzone (six seeds and the same stand at the start:
// `stand.ts`, one child process a map and seed, as a process loads one map). The 3x is built by
// hand (node src/tools/build-map.ts --region lunigiana-3x, 15.5 s, 1.5 GB; CI never builds it), and
// without it this is skipped.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { insideRings } from "../../sim/map/outline.ts"
import { PARKED } from "../../sim/population/parked.ts"
import { TRAFFIC } from "../../sim/systems/populate.ts"
import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../map-file.ts"
import { PARTS, regionFromArgs } from "../region.ts"

const X3 = regionFromArgs(["--region", "lunigiana-3x"])
const skip = existsSync(builtMapUrl(X3))
  ? false
  : `no ${X3.key} build in test-maps: run node src/tools/build-map.ts --region ${X3.key}`
const STAND = fileURLToPath(new URL("stand.ts", import.meta.url))
const run = promisify(execFile)
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

// By the edge, an area lucido's box cuts has its cut rounded to 0.1 m, and a building across it is
// clipped on lucido and dropped on the 3x, its paved front with it (docs/map.md, "Test regions").
test(
  "the 3x's land cover in lucido's rectangle is lucido's, but within 50 m of its edge",
  { skip },
  () => {
    const { lucido, x3 } = maps()
    /** The cover of the cell centred on (x, y). */
    const cover = ({ cover, heightmap: { x0, y0, cols, cell } }: JoinedMap, x: number, y: number) =>
      cover[((y - y0 - cell / 2) / cell) * (cols - 1) + (x - x0 - cell / 2) / cell]
    const [x0, y0, x1, y1] = LUCIDO
    let cells = 0
    for (let y = y0 + 2; y < y1; y += 4)
      for (let x = x0 + 2; x < x1; x += 4) {
        if (inFromEdge(x, y) <= 50) continue
        cells++
        if (cover(lucido, x, y) !== cover(x3, x, y))
          assert.fail(`cell at (${x}, ${y}): ${cover(lucido, x, y)} on lucido, ${cover(x3, x, y)}`)
      }
    assert.equal(cells, 1924 * 2474)
  },
)

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

// Outside the play area the map holds terrain, land cover and trees alone (issue #7): no platform
// stands by the stub of rail the outline leaves.
test("every platform of the 3x lies in its play area, lucido's rectangle", { skip }, () => {
  const { x3 } = maps()
  for (const p of x3.railway.platforms)
    for (const ring of x3.areas[p.area]!.rings)
      for (let i = 0; i < ring.length; i += 2)
        assert.ok(
          insideRings(x3.outline, ring[i]!, ring[i + 1]!),
          `platform at ${ring[i]}, ${ring[i + 1]}`,
        )
})

/** What `stand.ts` prints: the live vehicles after the stand, and the dice's spots round the start. */
interface Stand {
  readonly parked: number
  readonly traffic: number
  readonly other: number
  readonly spots: ReadonlyArray<number>
  /** Each parked car by where its spot stands, its model and its paint. */
  readonly cars: ReadonlyArray<string>
  readonly dice: ReadonlyArray<number>
  readonly near: ReadonlyArray<string>
}
/** The stand on the map of region `key` on `seed`, in a process of its own. */
const stand = async (key: string, seed: number): Promise<Stand> =>
  JSON.parse(
    (await run(process.execPath, [STAND, key, String(seed)], { encoding: "utf8" })).stdout,
  ) as Stand

// A spot's car is the dice's for its place and the seed (`carOn`), not its index, so though the 3x
// leaves out one spot past lucido's edge, which moves every later spot's index (docs/map.md, "Test
// regions"), each seed parks the same cars round Monzone on both: on the spots within 300 m of the
// start, which stand where they do on lucido, the dice's.
test(
  "round Monzone the live vehicles do not grow with the map: on lucido and on three times its built terrain, the same cars on the same spots, the dice's, within 200 parked and 10 traffic",
  { skip },
  async () => {
    const runs = await Promise.all(
      [1, 2, 3, 4, 5, 6].flatMap((seed) =>
        ["lunigiana", X3.key].map(async (key) => ({ key, seed, ...(await stand(key, seed)) })),
      ),
    )
    for (const { key, seed, parked, traffic, other, spots, cars, dice, near } of runs) {
      const on = `${key}, seed ${seed}`
      assert.deepEqual(spots, dice, on)
      assert.deepEqual(near, runs[0]!.near, on)
      assert.deepEqual(cars, runs.find((r) => r.seed === seed)!.cars, on)
      assert.ok(parked + other <= PARKED && traffic <= TRAFFIC.max, on)
      assert.ok(parked > 0 && traffic > 0 && other === 2, on) // the Carabinieri's two
    }
  },
)
