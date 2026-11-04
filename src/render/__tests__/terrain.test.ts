import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../../sim/map/cover.ts"
import { facingAt, terrainZ } from "../../sim/map/ground.ts"
import { MAP } from "../../sim/map/index.ts"
import { anchorOf } from "../../sim/map/kinds.ts"
import { LEVEL, ROCK_NORMAL_Y } from "../../sim/sky/local.ts"
import { chunkOf, chunkRect } from "../chunks.ts"
import { linear } from "../geometry.ts"
import { PALETTE } from "../palette.ts"
import { COVER_LOOK, type CoverLook, shade, terrainChunk } from "../terrain.ts"
import { residentAround } from "../testing.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }

// Regression: the patches counted from the box's south-west corner, so when Fivizzano grew it 2400 m west (600 cells) a third
// of the ground round Monzone station took the other colour of its cover.
test("the ground's colour patches and stripes count from the region's anchor, never the box's corner, so a part that grows the box repaints none of it", () => {
  const { cell } = MAP.heightmap,
    { x: ax, y: ay } = anchorOf(MAP.heightmap)
  residentAround([STATION], 300)
  // The chunks over the 128 m square round the station, the pitch west of it with them.
  const keys = new Set(
    [-64, 64].flatMap((dx) => [-64, 64].map((dy) => chunkOf(STATION.x + dx, STATION.y + dy))),
  )
  let faces = 0,
    patched = 0,
    striped = 0,
    wrong = 0
  for (const key of keys) {
    const g = terrainChunk(key),
      position = g.getAttribute("position"),
      normal = g.getAttribute("normal"),
      color = g.getAttribute("color")
    for (let v = 0; v < position.count; v += 3) {
      // The triangle's centroid, in map (x east, y north), and its cell counted from the anchor.
      const x = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2)) / 3,
        y = -(position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2)) / 3
      const look: CoverLook =
          normal.getY(v) < ROCK_NORMAL_Y ? COVER_LOOK.rock : COVER_LOOK[coverAt(x, y)],
        hex = shade(look, Math.floor((x - ax) / cell), Math.floor((y - ay) / cell))
      const want = linear(hex).map(Math.fround).join(),
        got = [color.getX(v), color.getY(v), color.getZ(v)].join()
      faces++
      if (look.stripes === true) striped++
      else if (hex === look.alt && look.alt !== look.base) patched++
      if (got !== want) wrong++
    }
  }
  assert.ok(
    patched > 500 && striped > 200,
    `${patched} faces in their cover's variant patches and ${striped} striped, of ${faces}`,
  )
  assert.equal(
    wrong,
    0,
    `${wrong} of ${faces} faces in another colour than their cell's from the anchor`,
  )
})

test("each face of the terrain mesh faces as the sim's facingAt says over it, so the snow it draws on north faces is where the tyres lose grip", () => {
  residentAround([STATION], 300)
  const g = terrainChunk(chunkOf(STATION.x, STATION.y)),
    position = g.getAttribute("position"),
    normal = g.getAttribute("normal")
  let checked = 0,
    worst = 0
  for (let v = 0; v < position.count; v += 3) {
    // The triangle's centroid, in map (x east, y north), and its face normal in three space (z is south).
    const x = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2)) / 3,
      y = -(position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2)) / 3
    const face = facingAt(x, y, terrainZ(x, y))
    if (face === LEVEL) continue // a road or a platform covers it there
    worst = Math.max(
      worst,
      Math.abs(face.north + normal.getZ(v)),
      Math.abs(face.up - normal.getY(v)),
    )
    checked++
  }
  assert.ok(checked > 1500, `${checked} faces of bare terrain`)
  assert.ok(worst < 1e-6, `a face normal ${worst} off the sim's (float32)`)
})

test("out of leaf a broadleaf wood's floor shows its leaf litter: only the woods change colour, and only to the litter or their dark shade", () => {
  // The chunk nearest Monzone station along a line east of it whose middle stands in a broadleaf wood: found by its
  // middle, not by the wood's edge, as the chunks' squares count from the map's west edge, which moves as parts join
  // (their cells' colours count from the anchor).
  residentAround([STATION], 600)
  let x = STATION.x
  const middle = (at: number) => {
    const { minX, minY, maxX, maxY } = chunkRect(chunkOf(at, STATION.y))
    return coverAt((minX + maxX) / 2, (minY + maxY) / 2)
  }
  while (middle(x) !== "forest") x += 8
  const key = chunkOf(x, STATION.y),
    leafy = terrainChunk(key).getAttribute("color"),
    heights: Array<number> = [],
    bare = terrainChunk(key, (_kind, z) => {
      heights.push(z)
      return "bare"
    }).getAttribute("color")
  const allowed = new Set(
    [PALETTE.litter, PALETTE.forestDark].map((hex) => linear(hex).map(Math.fround).join()),
  )
  let changed = 0
  for (let v = 0; v < leafy.count; v += 3) {
    const before = [leafy.getX(v), leafy.getY(v), leafy.getZ(v)].join(),
      after = [bare.getX(v), bare.getY(v), bare.getZ(v)].join()
    if (before === after) continue
    assert.ok(allowed.has(after), `a face out of leaf in ${after}`)
    changed++
  }
  assert.ok(changed > 500, `${changed} faces of woods`)
  // The woods' floor is judged at its height above the sea, not at its render y (200 m lower).
  assert.ok(
    heights.length > 0 && heights.every((z) => Math.abs(z - terrainZ(x, STATION.y)) < 100),
    "the cells' heights a.s.l.",
  )
  // In leaf it is the chunk the world always drew.
  assert.deepEqual(
    Array.from(terrainChunk(key, () => "leafy").getAttribute("color").array),
    Array.from(leafy.array),
  )
})
