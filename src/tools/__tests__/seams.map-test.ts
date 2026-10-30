// Seam checks on the built maps (a map test: it reads every tile of both maps, so it grows with
// the map and stays out of `pnpm test`). Wherever two listed tiles meet, the terrain nodes they
// share are the same in both, and the walls carry on across the seam as the tile format stores
// them: each wall once, in the tile of its midpoint, found from either side within `walls.reach`. A
// road's z has no seam (the roads lie whole in the global file), and the ground under a road at a
// seam is read from the shared nodes alone.
import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE, tileKey } from "../../sim/map/kinds.ts"
import {
  decodeMap,
  decodeTile,
  MAP_URL,
  readMapFile,
  TILE_NODES,
  type TileData,
  tileUrl,
} from "../../sim/map/packed.ts"

const KINDS = ["walk", "shore", "drive"] as const

/** A built map's global file and its tiles by key, each decoded on its own (not joined). */
const load = (name: string) => {
  const global = decodeMap(readMapFile(new URL(`${name}.bin`, MAP_URL)))
  const tiles = new Map<string, TileData>()
  for (const { i, j } of global.tiles)
    tiles.set(tileKey(i, j), decodeTile(readMapFile(tileUrl(name, tileKey(i, j)))))
  return { global, tiles }
}

const MAPS = ["monzone", "cesena"].map((name) => ({ name, ...load(name) }))

/** Every pair of listed tiles sharing a border: the east or north neighbour of each. */
const seams = (tiles: ReadonlyMap<string, TileData>) =>
  [...tiles.values()].flatMap((a) =>
    (
      [
        ["east", tiles.get(tileKey(a.i + 1, a.j))],
        ["north", tiles.get(tileKey(a.i, a.j + 1))],
      ] as const
    ).flatMap(([side, b]) => (b === undefined ? [] : [{ side, a, b }])),
  )

for (const { name, global, tiles } of MAPS) {
  test(`${name}: every node two tiles share has one height`, () => {
    const pairs = seams(tiles)
    assert.ok(pairs.length > 0)
    for (const { side, a, b } of pairs)
      for (let k = 0; k < TILE_NODES; k++) {
        const [ka, kb] =
          side === "east"
            ? [k * TILE_NODES + TILE_NODES - 1, k * TILE_NODES]
            : [(TILE_NODES - 1) * TILE_NODES + k, k]
        assert.equal(
          a.heights[ka],
          b.heights[kb],
          `${tileKey(a.i, a.j)} and its ${side} neighbour, node ${k} along the seam`,
        )
      }
  })

  test(`${name}: the walls carry on across every seam, each once and found from either side`, () => {
    const { reach } = global.walls
    const tileAt = (x: number, y: number) => [Math.floor(x / TILE), Math.floor(y / TILE)] as const
    for (const kind of KINDS) {
      // Every wall once, in one tile: none lost or doubled where it crosses a seam.
      const seen = new Uint8Array(
        [...tiles.values()].reduce((n, t) => n + t.wallIds[kind].length, 0),
      )
      for (const t of tiles.values())
        for (const id of t.wallIds[kind]) {
          assert.equal(seen[id], 0, `${kind} wall ${id} twice`)
          seen[id] = 1
        }
      if (kind !== "shore") assert.equal(seen.length, global.walls.counts[kind])
      const point = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`
      /** The walls touching each end point, over `from` (ids). */
      const touching = (from: Iterable<TileData>) => {
        const ends = new Map<string, Array<number>>()
        for (const t of from) {
          const w = t.walls[kind]
          t.wallIds[kind].forEach((id, k) => {
            for (const p of [point(w[4 * k]!, w[4 * k + 1]!), point(w[4 * k + 2]!, w[4 * k + 3]!)])
              ends.set(p, [...(ends.get(p) ?? []), id])
          })
        }
        return ends
      }
      const all = touching(tiles.values()),
        nearBy = new Map<string, Map<string, Array<number>>>()
      let crossing = 0
      for (const t of tiles.values()) {
        const w = t.walls[kind]
        for (let k = 0; k < t.wallIds[kind].length; k++) {
          const ends = [
            [w[4 * k]!, w[4 * k + 1]!],
            [w[4 * k + 2]!, w[4 * k + 3]!],
          ] as const
          if (String(tileAt(...ends[0])) === String(tileAt(...ends[1]))) continue
          crossing++
          for (const [x, y] of ends) {
            const [i0, j0] = tileAt(x - reach, y - reach),
              [i1, j1] = tileAt(x + reach, y + reach)
            const near: Array<TileData> = []
            for (let j = j0; j <= j1; j++)
              for (let i = i0; i <= i1; i++) {
                const n = tiles.get(tileKey(i, j))
                if (n !== undefined) near.push(n)
              }
            assert.ok(near.includes(t), `${kind} wall ${t.wallIds[kind][k]}: its tile out of reach`)
            const ids = (from: Map<string, Array<number>>) =>
              (from.get(point(x, y)) ?? []).toSorted((p, q) => p - q)
            const key = near.map((n) => tileKey(n.i, n.j)).join(" ")
            if (!nearBy.has(key)) nearBy.set(key, touching(near))
            assert.deepEqual(ids(nearBy.get(key)!), ids(all), `${kind} walls at (${x}, ${y})`)
            // The water's edge is closed outlines only: a wall that crosses a seam carries on.
            if (kind === "shore")
              assert.equal(ids(all).length % 2, 0, `shore wall ends at (${x}, ${y})`)
          }
        }
      }
      if (kind !== "shore") assert.ok(crossing > 0, `no ${kind} wall crosses a seam`)
    }
  })
}
