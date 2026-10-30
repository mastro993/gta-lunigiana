// Seam checks on the built maps (a map test: it reads every tile of both maps, so it grows with
// the map and stays out of `pnpm test`). Wherever two listed tiles meet, the terrain nodes they
// share are the same in both, the ground under every road crossing the seam is one height, and the
// walls carry on across it as the tile format stores them: each wall once, in the tile of its
// midpoint, found from either side within `walls.reach`.
import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE, tileKey } from "../../sim/map/kinds.ts"
import {
  decodeMap,
  decodeTile,
  MAP_URL,
  readMapFile,
  TILE_CELLS,
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

/** The height of tile `t`'s terrain at (x, y), decimetres, read from its own nodes (bilinear in the cell holding the point, clamped to the tile). */
const heightIn = (t: TileData, x: number, y: number): number => {
  const fx = (x - TILE * t.i) / (TILE / TILE_CELLS),
    fy = (y - TILE * t.j) / (TILE / TILE_CELLS)
  const c = Math.min(TILE_CELLS - 1, Math.max(0, Math.floor(fx))),
    r = Math.min(TILE_CELLS - 1, Math.max(0, Math.floor(fy)))
  const tx = Math.min(1, Math.max(0, fx - c)),
    ty = Math.min(1, Math.max(0, fy - r))
  const h = (dc: number, dr: number) => t.heights[(r + dr) * TILE_NODES + c + dc]!
  return (h(0, 0) * (1 - tx) + h(1, 0) * tx) * (1 - ty) + (h(0, 1) * (1 - tx) + h(1, 1) * tx) * ty
}

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

  test(`${name}: the ground under every road is one height where the road crosses a seam`, () => {
    let crossings = 0
    for (const road of global.roads) {
      if (road.bridge === true || road.tunnel === true) continue
      for (let k = 0; k + 3 < road.pts.length; k += 2) {
        const [ax, ay, bx, by] = [
          road.pts[k]!,
          road.pts[k + 1]!,
          road.pts[k + 2]!,
          road.pts[k + 3]!,
        ]
        for (const axis of [0, 1] as const) {
          const [a, b] = axis === 0 ? [ax, bx] : [ay, by]
          for (let s = Math.floor(Math.min(a, b) / TILE) + 1; s * TILE <= Math.max(a, b); s++) {
            const t = (s * TILE - a) / (b - a),
              x = axis === 0 ? s * TILE : ax + (bx - ax) * t,
              y = axis === 1 ? s * TILE : ay + (by - ay) * t
            const [ti, tj] = [Math.floor(x / TILE), Math.floor(y / TILE)]
            const before = tiles.get(axis === 0 ? tileKey(s - 1, tj) : tileKey(ti, s - 1)),
              after = tiles.get(tileKey(ti, tj))
            if (before === undefined || after === undefined) continue
            crossings++
            assert.equal(
              heightIn(before, x, y),
              heightIn(after, x, y),
              `road ${road.id} at (${x.toFixed(1)}, ${y.toFixed(1)})`,
            )
          }
        }
      }
    }
    assert.ok(crossings > 0)
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
