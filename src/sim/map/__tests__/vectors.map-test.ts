import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../../tools/map-file.ts"
import { staticGrid } from "../../collide.ts"
import { decodeTile, VECTOR_LAYERS } from "../format/tile-file.ts"
import { MAP } from "../index.ts"
import { HALO, TILE, tileKey, tileRange, tilesRound } from "../kinds.ts"
import { readMapFile, tileUrl } from "../packed.ts"
import { buildingsIn } from "../vectors.ts"

// Map checks (pnpm test:map): every tile's vectors against the whole map joined from them.
const WHOLE = wholeMap()
const RANGE = tileRange(MAP.bounds)
const tiles = new Map(
  MAP.tiles.map(({ i, j }) => [
    tileKey(i, j),
    decodeTile(readMapFile(tileUrl(MAP.name, tileKey(i, j)))),
  ]),
)

/** The box of a flat ring or polyline. */
const boxOf = (flat: ReadonlyArray<number>): [number, number, number, number] => {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let k = 0; k + 1 < flat.length; k += 2) {
    box[0] = Math.min(box[0], flat[k]!)
    box[1] = Math.min(box[1], flat[k + 1]!)
    box[2] = Math.max(box[2], flat[k]!)
    box[3] = Math.max(box[3], flat[k + 1]!)
  }
  return box
}

const LISTED = new Set(tiles.keys())
const isListed = (i: number, j: number) => LISTED.has(tileKey(i, j))

/**
 * The listed tiles a box comes within the halo of, its tile indices clamped to the range: for one
 * the region leaves off its list (an L's notch, Lunigiana's west and east of lucido), the listed
 * tiles round it (`tilesRound`), which a lookup there reads.
 */
const tilesNear = ([x0, y0, x1, y1]: readonly [number, number, number, number]): Array<string> => {
  const at = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(v / TILE)))
  const out: Array<string> = []
  for (let j = at(y0 - HALO, RANGE.j0, RANGE.j1); j <= at(y1 + HALO, RANGE.j0, RANGE.j1); j++)
    for (let i = at(x0 - HALO, RANGE.i0, RANGE.i1); i <= at(x1 + HALO, RANGE.i0, RANGE.i1); i++)
      if (isListed(i, j)) out.push(tileKey(i, j))
      else for (const [ri, rj] of tilesRound(i, j, isListed)) out.push(tileKey(ri, rj))
  return out
}

/** Each segment's box of a flat polyline (its one point's, for a point). */
const segments = (pts: ReadonlyArray<number>) =>
  pts.length === 2
    ? [boxOf(pts)]
    : Array.from({ length: pts.length / 2 - 1 }, (_, k) => boxOf(pts.slice(2 * k, 2 * k + 4)))

test("each tile holds, whole and in the whole map's order, exactly the vectors with a segment or ring box within the halo of it (or of an unlisted tile it is round), and the waterways of its river polygons", () => {
  const near = {
    roads: WHOLE.roads.map((r) => segments(r.pts)),
    water: WHOLE.water.map((w) => segments(w.pts)),
    barriers: WHOLE.barriers.map((b) => segments(b.pts)),
    buildings: WHOLE.buildings.map((b) => [boxOf(b.outer)]),
    areas: WHOLE.areas.map((a) => [boxOf(a.rings[0]!)]),
  }
  const wants = Object.fromEntries(
    VECTOR_LAYERS.map((layer) => {
      const want = new Map([...tiles.keys()].map((key) => [key, [] as Array<number>]))
      near[layer].forEach((boxes, id) => {
        for (const key of new Set(boxes.flatMap(tilesNear))) want.get(key)!.push(id)
      })
      return [layer, want]
    }),
  ) as Record<(typeof VECTOR_LAYERS)[number], Map<string, Array<number>>>
  // A river polygon's water is its waterways': a tile holding the polygon holds them too.
  for (const [key, areas] of wants.areas) {
    const ways = areas.flatMap((k) => WHOLE.areas[k]!.waters ?? [])
    if (ways.length > 0)
      wants.water.set(
        key,
        [...new Set([...wants.water.get(key)!, ...ways])].sort((a, b) => a - b),
      )
  }
  for (const layer of VECTOR_LAYERS) {
    const want = wants[layer]
    for (const [key, tile] of tiles) {
      assert.deepEqual(tile.vectors[layer].ids, want.get(key), `${layer} in ${key}`)
      const whole: ReadonlyArray<object> = WHOLE[layer]
      tile.vectors[layer].items.forEach((item, k) => {
        const id = tile.vectors[layer].ids[k]!,
          expected =
            layer === "roads" ? { pts: WHOLE.roads[id]!.pts, z: WHOLE.roads[id]!.z } : whole[id]
        assert.deepEqual(item, expected, `${layer} ${id} in ${key}`)
      })
    }
  }
})

test("buildingsIn answers exactly as one broad phase over the whole map does: the same buildings, in the same order, across the seams too", () => {
  const boxes = WHOLE.buildings.map((b) => boxOf(b.outer))
  const grid = staticGrid(boxes.length, (i) => boxes[i]!, 64)
  // Boxes from 1 to 600 m across (the dogs' 205 m reach, an occlusion path), half of them within
  // 80 m of a seam, the rest within 300 m of a building: the box round the parts holds land with
  // none (an L's notch, the woods), where a box drawn anywhere would find nothing.
  let seed = 11,
    found = 0
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 1500; k++) {
    const seam = k % 2 === 0,
      near = boxes[Math.floor(next() * boxes.length)]!
    const x = seam
        ? TILE * (RANGE.i0 + Math.floor(next() * (RANGE.i1 - RANGE.i0 + 2))) + (next() - 0.5) * 160
        : near[0] + (next() - 0.5) * 600,
      y = seam
        ? TILE * (RANGE.j0 + Math.floor(next() * (RANGE.j1 - RANGE.j0 + 2))) + (next() - 0.5) * 160
        : near[1] + (next() - 0.5) * 600,
      r = 0.5 + next() ** 2 * 300
    const box = [x - r, y - r, x + r, y + r * (0.5 + next())] as const
    const got: Array<number> = [],
      want: Array<number> = []
    buildingsIn(...box, (i, b, bb) => {
      got.push(i)
      assert.deepEqual(b, WHOLE.buildings[i])
      assert.deepEqual(bb, boxes[i])
    })
    grid(...box, (i) => want.push(i))
    assert.deepEqual(got, want, box.join(","))
    found += got.length
  }
  assert.ok(found > 10_000, `${found} buildings found`)
  assert.deepEqual(MAP.vectors.lattice.buildings, [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
  ])
})
