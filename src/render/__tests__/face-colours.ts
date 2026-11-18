// The terrain's faces against their cells' looks, which terrain.test.ts (Lunigiana) and
// terrain-coast.map-test.ts (the coast test region) share. It reads the map's grid as it loads: a
// process that provides another map imports it after that.
import { coverAt } from "../../sim/map/cover.ts"
import { MAP } from "../../sim/map/index.ts"
import { anchorOf } from "../../sim/map/kinds.ts"
import { ROCK_NORMAL_Y } from "../../sim/sky/local.ts"
import { linear } from "../geometry.ts"
import { terrainNodeY } from "../ground.ts"
import { cellSlope, COVER_LOOK, type CoverLook, shade, terrainChunk } from "../terrain.ts"

/**
 * Every face of the chunks `keys` against its cell's look from the anchor (`shade` at its middle's
 * height and slope): the faces in all, those in their look's variant patches, those striped, those
 * of an olive grove and those of them bare, those of a beach and those of them wet, and those in
 * another colour.
 */
export const faceColours = (keys: Iterable<number>) => {
  const { cell, x0, y0 } = MAP.heightmap,
    { x: ax, y: ay } = anchorOf(MAP.heightmap)
  let faces = 0,
    patched = 0,
    striped = 0,
    grove = 0,
    bare = 0,
    beach = 0,
    wet = 0,
    wrong = 0
  for (const key of keys) {
    const g = terrainChunk(key),
      position = g.getAttribute("position"),
      normal = g.getAttribute("normal"),
      color = g.getAttribute("color")
    for (let v = 0; v < position.count; v += 3) {
      // The triangle's centroid, in map (x east, y north), its cell counted from the anchor, and
      // its cell's middle height and slope, for a terraced look or a beach's wet sand.
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
      } else if (look.wet !== undefined) {
        beach++
        if (hex === look.wet.hex) wet++
      } else if (hex === look.alt && look.alt !== look.base) patched++
      if (got !== want) wrong++
    }
  }
  return { faces, patched, striped, grove, bare, beach, wet, wrong }
}
