import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const kit =
  skip === false
    ? {
        ...(await import("./pools.ts")),
        ...(await import("../chunks.ts")),
        ...(await import("../geometry.ts")),
        ...(await import("../ground.ts")),
        ...(await import("../palette.ts")),
        ...(await import("../water.ts")),
        ...(await import("../sky/water-shader.ts")),
        ...(await import("../../sim/map/index.ts")),
        ...(await import("../../sim/map/ground.ts")),
        ...(await import("../../sim/water/channel.ts")),
        ...(await import("../../sim/water/rivers.ts")),
        ...(await import("../../sim/__tests__/flows.ts")),
      }
    : undefined

/** 1.4 km off Marinella di Sarzana's beach (its village at -9071, -12606), x the column the checks below look down. */
const OFF_MARINELLA = { x: -9071, y: -13500 }

test(
  "poolWater, magra-coast: off Marinella the sea is a quad over each cell, drawn 0.05 m over its level 0 m as a river's area water is over its bed, in the sea's shallows' colour, the sea's look whole, as deep as it stands over each node",
  { skip },
  () => {
    const k = kit!
    const key = k.chunkOf(OFF_MARINELLA.x, OFF_MARINELLA.y),
      { i0, j0, i1, j1 } = k.chunkCells(key)
    const quads = k.drawn(key)
    assert.equal(quads.length, (i1 - i0) * (j1 - j0), "the whole chunk is sea")
    let deepest = 0
    for (const { corners } of quads)
      for (const c of corners) {
        const at = `node ${c.i},${c.j}`
        assert.equal(c.h, k.yOf(k.SEA_LEVEL) + k.OVER_BED, `${at}: over the sea's level`)
        assert.deepEqual([c.stage, c.flow[2], c.held, c.sea], [0, 0, 0, 1], `${at}: still, the sea`)
        assert.ok(Math.abs(c.still + k.terrainNodeZ(c.i, c.j)) < 1e-9, `${at}: ${c.still} m deep`)
        assert.deepEqual(c.color, k.linear(k.PALETTE.seaShallow), `${at}: the shallows' colour`)
        deepest = Math.max(deepest, c.still)
      }
    assert.ok(deepest > 1, `${deepest.toFixed(2)} m deep`)
  },
)

test(
  "poolWater, magra-coast: in the apron south of the map the sea runs on over the edge's sea floor, each node the edge node's water",
  { skip },
  () => {
    const k = kit!
    const { cell } = k.MAP.heightmap
    const edge = k.chunkOf(OFF_MARINELLA.x, k.MAP.bounds.minY + cell / 2),
      apron = k.chunkOf(OFF_MARINELLA.x, k.chunkRect(edge).minY - cell / 2)
    const { i0, j0, i1, j1 } = k.chunkCells(apron)
    assert.ok(j1 <= 0 && apron !== edge, "a chunk all apron, south of the edge")
    const quads = k.drawn(apron)
    assert.equal(quads.length, (i1 - i0) * (j1 - j0), "sea over the whole apron chunk")
    // The edge chunk's nodes on the edge, where the apron's take their water from.
    const onEdge = new Map<number, ReadonlyArray<number>>()
    for (const { corners } of k.drawn(edge))
      for (const c of corners)
        if (c.j === 0) onEdge.set(c.i, [c.h, c.stage, ...c.flow, c.still, c.held, c.sea])
    let shallowest = Number.POSITIVE_INFINITY
    for (const { corners } of quads)
      for (const c of corners) {
        assert.deepEqual(
          [c.h, c.stage, ...c.flow, c.still, c.held, c.sea],
          onEdge.get(c.i),
          `node ${c.i},${c.j}: the edge node's water`,
        )
        shallowest = Math.min(shallowest, c.still)
      }
    assert.ok(
      shallowest > 2,
      `the edge's sea floor extruded, ${shallowest.toFixed(2)} m deep at least`,
    )
  },
)

test(
  "poolWater, magra-coast: the Magra's polygon at its mouth is drawn where waterAt has its level, the sea holding it up at 0 m at the mean flow",
  { skip },
  () => {
    const k = kit!
    // The Magra's river polygon: the one with waterways holding (-11250, -12700), above its mouth.
    const pool = k
      .poolsAt(-11250, -12700)
      .find((p) => p.kind === "river" && k.holds(p.rings, -11250, -12700))
    assert.ok(pool !== undefined, "the Magra's polygon")
    const cells = k.cellsOf({ kind: "river", rings: pool.rings, waters: [] })
    const held = new Set<string>(),
      nodes = new Set<string>()
    for (const key of k.chunksOf(cells))
      for (const { corners } of k.drawn(key))
        for (const c of corners) {
          if (c.stage === 0) continue
          const x = k.MAP.heightmap.x0 + c.i * k.MAP.heightmap.cell,
            y = k.MAP.heightmap.y0 + c.j * k.MAP.heightmap.cell
          if (!k.holds(pool.rings, x, y)) continue
          nodes.add(`${c.i},${c.j}`)
          if (c.held > 0) held.add(`${c.i},${c.j}`)
          for (const q of [k.MEAN, k.SPATE]) {
            const drawn = k.zOf(c.h) - 0.05 + Math.max(c.stage * Ops.pow(q, k.STAGE), c.held),
              level = k.waterAt(x, y, -100, q)!.level
            assert.ok(
              Math.abs(drawn - level) < 1e-6,
              `node ${c.i},${c.j} at ${q}: drawn ${drawn}, ${level}`,
            )
          }
        }
    assert.ok(
      nodes.size > 100 && held.size > 0,
      `${held.size} of ${nodes.size} nodes under the sea's level`,
    )
  },
)

// Regression: the sea was drawn at 0 m and the Magra's polygon, held up to it, 0.05 m over it (its
// water over its bed), so from the sea's side the view saw the floor through the step along the
// mouth, a line of light and dark dashes.
test(
  "poolWater, magra-coast: the Magra's polygon meets the sea flush at every node they share at the mouth, wholly in the sea's look there as the sea",
  { skip },
  () => {
    const k = kit!
    const { sea, river } = magraNodes(k)
    let shared = 0
    for (const [node, { y, share }] of river) {
      const level = sea.get(node)
      if (level === undefined) continue
      shared++
      assert.ok(Math.abs(y - level) < 1e-6, `node ${node}: the river at ${y}, the sea at ${level}`)
      assert.equal(share, 1, `node ${node}: the sea's share`)
    }
    assert.ok(shared > 50, `${shared} nodes shared with the sea`)
  },
)

test(
  "poolWater, magra-coast: the Magra's polygon takes the sea's look as its own course does, no step between neighbouring nodes, none where a stream joining it comes nearest",
  { skip },
  () => {
    const k = kit!
    const { river } = magraNodes(k)
    let pairs = 0,
      worst = 0,
      least = 1
    for (const [node, { share }] of river) {
      least = Math.min(least, share)
      const [i, j] = node.split(",").map(Number) as [number, number]
      for (const next of [`${i + 1},${j}`, `${i},${j + 1}`]) {
        const other = river.get(next)
        if (other === undefined) continue
        pairs++
        worst = Math.max(worst, Math.abs(other.share - share))
      }
    }
    assert.ok(pairs > 50_000, `${pairs} pairs of neighbouring nodes`)
    assert.ok(least > 0.75, `the sea's share ${least.toFixed(3)} at least`)
    assert.ok(worst < 0.2, `a step of ${worst.toFixed(3)} in the sea's share between two nodes`)
  },
)

/** The Magra's polygon's drawn nodes, and the sea's beside it: each node's surface as the shader lifts it at the mean flow, and the river's share of the sea's look. */
const magraNodes = (k: NonNullable<typeof kit>) => {
  const pool = k
    .poolsAt(-11250, -12700)
    .find((p) => p.kind === "river" && k.holds(p.rings, -11250, -12700))
  assert.ok(pool !== undefined, "the Magra's polygon")
  const sea = new Map<string, number>(),
    river = new Map<string, { readonly y: number; readonly share: number }>()
  for (const key of k.chunksOf(k.cellsOf({ kind: "river", rings: pool.rings, waters: [] })))
    for (const { corners } of k.drawn(key)) {
      const isSea = corners[0].stage === 0 && corners[0].held === 0
      for (const c of corners) {
        const y = c.h + Math.max(c.stage * Ops.pow(k.MEAN, k.STAGE), c.held)
        if (isSea) sea.set(`${c.i},${c.j}`, y)
        else river.set(`${c.i},${c.j}`, { y, share: c.sea })
      }
    }
  return { sea, river }
}
