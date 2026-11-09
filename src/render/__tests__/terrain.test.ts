import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../../sim/map/cover.ts"
import { facingAt, terrainZ } from "../../sim/map/ground.ts"
import { MAP } from "../../sim/map/index.ts"
import { anchorOf } from "../../sim/map/kinds.ts"
import { FLAT_GROUND, ROCK_NORMAL_Y } from "../../sim/sky/local.ts"
import { chunkOf, chunkRect } from "../chunks.ts"
import { linear } from "../geometry.ts"
import { terrainNodeY } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { cellSlope, COVER_LOOK, type CoverLook, shade, terrainChunk } from "../terrain.ts"
import { residentAround } from "../testing.ts"

/** Monzone station, and Gragnola's square. */
const STATION = { x: -493.8, y: 436.9 },
  GRAGNOLA = { x: -1751.2, y: 3360.4 }

/**
 * Every face of the chunks `keys` against its cell's look from the anchor (`shade` at its middle's
 * height and slope): the faces in all, those in their look's variant patches, those striped, those
 * of an olive grove and those of them bare, and those in another colour.
 */
const faceColours = (keys: Iterable<number>) => {
  const { cell, x0, y0 } = MAP.heightmap,
    { x: ax, y: ay } = anchorOf(MAP.heightmap)
  let faces = 0,
    patched = 0,
    striped = 0,
    grove = 0,
    bare = 0,
    wrong = 0
  for (const key of keys) {
    const g = terrainChunk(key),
      position = g.getAttribute("position"),
      normal = g.getAttribute("normal"),
      color = g.getAttribute("color")
    for (let v = 0; v < position.count; v += 3) {
      // The triangle's centroid, in map (x east, y north), its cell counted from the anchor, and
      // its cell's middle height and slope, for a terraced look.
      const x = (position.getX(v) + position.getX(v + 1) + position.getX(v + 2)) / 3,
        y = -(position.getZ(v) + position.getZ(v + 1) + position.getZ(v + 2)) / 3
      const ci = Math.floor((x - x0) / cell),
        cj = Math.floor((y - y0) / cell)
      const { z, slope } = cellSlope(
        terrainNodeY(ci, cj),
        terrainNodeY(ci + 1, cj),
        terrainNodeY(ci, cj + 1),
        terrainNodeY(ci + 1, cj + 1),
      )
      const look: CoverLook =
          normal.getY(v) < ROCK_NORMAL_Y ? COVER_LOOK.rock : COVER_LOOK[coverAt(x, y)],
        hex = shade(look, Math.floor((x - ax) / cell), Math.floor((y - ay) / cell), z, slope)
      const want = linear(hex).map(Math.fround).join(),
        got = [color.getX(v), color.getY(v), color.getZ(v)].join()
      faces++
      if (look.stripes === true) striped++
      else if (look === COVER_LOOK.olive) {
        grove++
        if (hex === look.alt) bare++
      } else if (hex === look.alt && look.alt !== look.base) patched++
      if (got !== want) wrong++
    }
  }
  return { faces, patched, striped, grove, bare, wrong }
}

// Regression: the patches counted from the box's south-west corner, so when Fivizzano grew it 2400 m west (600 cells) a third
// of the ground round Monzone station took the other colour of its cover.
test("the ground's colour patches and stripes count from the region's anchor, never the box's corner, so a part that grows the box repaints none of it", () => {
  residentAround([STATION], 300)
  // The chunks over the 128 m square round the station, the pitch west of it with them.
  const keys = new Set(
    [-64, 64].flatMap((dx) => [-64, 64].map((dy) => chunkOf(STATION.x + dx, STATION.y + dy))),
  )
  const { faces, patched, striped, wrong } = faceColours(keys)
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

test("an olive grove's chunk draws its terraces' bare strips where its cells' heights and slopes say", () => {
  // The olive grove nearest Gragnola on a 20 m grid, found by geometry.
  residentAround([GRAGNOLA], 600)
  let at: { readonly x: number; readonly y: number } | undefined
  for (let r = 0; r <= 500 && at === undefined; r += 20)
    for (let dx = -r; dx <= r && at === undefined; dx += 20)
      for (let dy = -r; dy <= r && at === undefined; dy += 20)
        if (
          Math.max(Math.abs(dx), Math.abs(dy)) === r &&
          coverAt(GRAGNOLA.x + dx, GRAGNOLA.y + dy) === "olive"
        )
          at = { x: GRAGNOLA.x + dx, y: GRAGNOLA.y + dy }
  assert.ok(at !== undefined, "an olive grove within 500 m of Gragnola")
  const { grove, bare, wrong } = faceColours([chunkOf(at.x, at.y)])
  assert.ok(grove > 200, `${grove} faces of olive grove`)
  assert.ok(bare > 0.05 * grove && bare < 0.5 * grove, `${bare} of ${grove} bare`)
  assert.equal(wrong, 0)
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
    if (face === FLAT_GROUND) continue // a road or a platform covers it there
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
  // The chunk nearest Monzone station along a line east of it most of whose cells stand in a broadleaf wood: found by its
  // cells, not by its middle nor the wood's edge, as the chunks' squares count from the map's west edge, which moves as
  // parts join (their cells' colours count from the anchor), so a chunk's middle can fall on a sliver of wood.
  residentAround([STATION], 600)
  const { cell } = MAP.heightmap
  const wooded = (at: number) => {
    const { minX, minY, maxX, maxY } = chunkRect(chunkOf(at, STATION.y))
    let woods = 0,
      cells = 0
    for (let py = minY + cell / 2; py < maxY; py += cell)
      for (let px = minX + cell / 2; px < maxX; px += cell) {
        cells++
        if (coverAt(px, py) === "forest") woods++
      }
    return woods > cells / 2
  }
  let x = STATION.x
  while (!wooded(x)) x = chunkRect(chunkOf(x, STATION.y)).maxX
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

test("an olive grove's ground is dry grass, bare in a 2.5 m strip along a terrace's edge every 3 m of rise: none on the flat", () => {
  const { olive } = COVER_LOOK
  assert.equal(shade(olive, 0, 0, 301.5, 0.3), PALETTE.grassDry) // mid-terrace
  assert.equal(shade(olive, 0, 0, 303.2, 0.3), PALETTE.dirtTrack) // 0.67 m off the 303 m edge
  assert.equal(shade(olive, 0, 0, 303, 0), PALETTE.grassDry) // on the flat
  // Cells on a 30% slope at heights spread evenly over the terraces: the strip takes 0.3 × 2.5 / 3.
  let bare = 0
  for (let k = 0; k < 1000; k++)
    if (shade(olive, k, 0, 300 + (3 * k) / 1000, 0.3) === PALETTE.dirtTrack) bare++
  assert.ok(Math.abs(bare - 250) <= 2, `${bare} bare cells of 1000`)
})
