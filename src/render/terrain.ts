/**
 * The terrain mesh: one faceted, vertex-coloured mesh per chunk (render/chunks), cut from the 4 m
 * heightmap (row 0 = south) and continued by an apron beyond the map bounds so the edges never
 * show the void. Cells take their land-cover colour (`coverIndexAt`, from the tiles); very steep
 * faces show bare limestone. The colour patches and stripes count from the region's anchor
 * (`anchorOf`), never the box's corner, so a part that grows the box west or south repaints none
 * of the ground already built.
 *
 * @module render/terrain
 */
import { BufferGeometry, Float32BufferAttribute } from "three"

import { type Cover, coverIndexAt, coverName } from "../sim/map/cover.ts"
import { MAP } from "../sim/map/index.ts"
import { anchorOf } from "../sim/map/kinds.ts"
import { ROCK_NORMAL_Y } from "../sim/sky/local.ts"
import { hash01 } from "../tools/geometry.ts"
import { chunkCells } from "./chunks.ts"
import { linear } from "./geometry.ts"
import { terrainNodeY, zOf } from "./ground.ts"
import type { Crown } from "./leaves.ts"
import { PALETTE } from "./palette.ts"
import type { TreeKind } from "./trees.ts"

const hm = MAP.heightmap,
  { i: AI, j: AJ } = anchorOf(hm)

/** Base colour, variant colour and the noise level under which a cell takes the variant (`stripes`: alternate columns; `terraces`: a terrace's bare strip). */
export interface CoverLook {
  readonly base: number
  readonly alt: number
  readonly share: number
  readonly stripes?: boolean
  /**
   * Terraces: their `rise`, m, and the bare `strip` along each edge, m across: a cell whose middle
   * lies within half a strip of a terrace's edge (a multiple of `rise` a.s.l.) takes the variant,
   * so the strips follow the contours, closer as the slope steepens, and flat ground shows none.
   */
  readonly terraces?: { readonly rise: number; readonly strip: number }
}

/** How each cover is painted. */
export const COVER_LOOK = {
  meadow: { base: PALETTE.grass, alt: PALETTE.grassDry, share: 0.3 },
  forest: { base: PALETTE.forestDark, alt: PALETTE.forest, share: 0.35 },
  grassland: { base: PALETTE.grassDry, alt: PALETTE.grass, share: 0.35 },
  scrub: { base: PALETTE.forestLight, alt: PALETTE.grassDry, share: 0.4 },
  sparse: { base: PALETTE.grassDry, alt: PALETTE.limestone, share: 0.45 },
  scree: { base: PALETTE.stoneLight, alt: PALETTE.limestone, share: 0.45 },
  rock: { base: PALETTE.limestone, alt: PALETTE.stoneLight, share: 0.35 },
  quarry: { base: PALETTE.marbleWhite, alt: PALETTE.limestone, share: 0.3 },
  residential: { base: PALETTE.grass, alt: PALETTE.grassDry, share: 0.3 },
  farmland: { base: PALETTE.grassDry, alt: PALETTE.dirtTrack, share: 0.5, stripes: true },
  farmyard: { base: PALETTE.dirtTrack, alt: PALETTE.grassDry, share: 0.3 },
  vineyard: { base: PALETTE.grass, alt: PALETTE.dirtTrack, share: 0.5, stripes: true },
  park: { base: PALETTE.grass, alt: PALETTE.forestLight, share: 0.25 },
  school: { base: PALETTE.grass, alt: PALETTE.asphaltWorn, share: 0.2 },
  cemetery: { base: PALETTE.plasterGrey, alt: PALETTE.stoneLight, share: 0.4 },
  pitch: { base: PALETTE.grass, alt: PALETTE.forestLight, share: 0.5, stripes: true },
  parking: { base: PALETTE.asphaltWorn, alt: PALETTE.asphalt, share: 0.2 },
  industrial: { base: PALETTE.asphaltWorn, alt: PALETTE.stoneMid, share: 0.3 },
  paved: { base: PALETTE.asphaltWorn, alt: PALETTE.stoneMid, share: 0.15 },
  platform: { base: PALETTE.asphaltWorn, alt: PALETTE.asphaltWorn, share: 0 },
  ruins: { base: PALETTE.stoneMid, alt: PALETTE.forest, share: 0.4 },
  pebble: { base: PALETTE.limestone, alt: PALETTE.marbleWhite, share: 0.4 },
  river: { base: PALETTE.limestone, alt: PALETTE.marbleWhite, share: 0.4 },
  lake: { base: PALETTE.dirtTrack, alt: PALETTE.stoneMid, share: 0.4 },
  conifer: { base: PALETTE.forestDark, alt: PALETTE.conifer, share: 0.35 },
  mixed: { base: PALETTE.forestDark, alt: PALETTE.forest, share: 0.35 },
  // Terraces rise 2.3–3.3 m round Gragnola (their spacing on rt_ofc.5k23 over the map's slope); a
  // strip of 2.5 m bares a quarter of a grove on a 30% slope, its treads 10 m deep.
  olive: {
    base: PALETTE.grassDry,
    alt: PALETTE.dirtTrack,
    share: 0,
    terraces: { rise: 3, strip: 2.5 },
  },
} as const satisfies Record<Cover, CoverLook>

/** A broadleaf wood's floor out of leaf (`crownsOn`): its leaf litter, the evergreen undergrowth showing through; a mixed wood's half its conifers' shade. */
const OUT_OF_LEAF = {
  forest: { base: PALETTE.litter, alt: PALETTE.forestDark, share: 0.35 },
  mixed: { base: PALETTE.forestDark, alt: PALETTE.litter, share: 0.5 },
} as const satisfies Partial<Record<Cover, CoverLook>>

const PATCH = 4 // cells between noise lattice points: variant patches are blobs of ~16 m, not single cells
/** Smooth value noise in [0, 1): hashed lattice values blended bilinearly. */
const patchNoise = (i: number, j: number): number => {
  const fi = Math.floor(i / PATCH),
    fj = Math.floor(j / PATCH),
    u = i / PATCH - fi,
    v = j / PATCH - fj
  const a = hash01(fi, fj),
    b = hash01(fi + 1, fj),
    c = hash01(fi, fj + 1),
    d = hash01(fi + 1, fj + 1)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

/**
 * Picks the base or variant colour of a look for cell (i, j), counted from the region's anchor,
 * whose middle stands `z` m a.s.l. on a slope of `slope` (rise over run).
 */
export const shade = (look: CoverLook, i: number, j: number, z = 0, slope = 0): number => {
  const { terraces } = look
  const half = terraces === undefined ? 0 : (slope * terraces.strip) / 2
  return (
    look.stripes === true
      ? (i & 1) === 1
      : terraces === undefined
        ? patchNoise(i, j) < look.share
        : Math.floor((z - half) / terraces.rise) !== Math.floor((z + half) / terraces.rise)
  )
    ? look.alt
    : look.base
}

/**
 * A cell's middle height (m a.s.l.) and its slope (rise over run) from its corners' render heights
 * (south-west, south-east, north-west, north-east).
 */
export const cellSlope = (
  sw: number,
  se: number,
  nw: number,
  ne: number,
): { readonly z: number; readonly slope: number } => {
  const east = (se + ne - sw - nw) / (2 * hm.cell),
    north = (nw + ne - sw - se) / (2 * hm.cell)
  return { z: zOf((sw + se + nw + ne) / 4), slope: Math.hypot(east, north) }
}

/**
 * Builds the terrain chunk `key` (see `chunkOf`) coloured by the land cover, a broadleaf wood's floor as its broadleaf wears
 * `crowns` say at the cell's height (in leaf by default); its tiles must be in memory.
 */
export const terrainChunk = (
  key: number,
  crowns?: (kind: TreeKind, z: number) => Crown,
): BufferGeometry => {
  const { i0, j0, i1, j1 } = chunkCells(key)
  const cells = (i1 - i0) * (j1 - j0)
  const position = new Float32Array(cells * 18),
    normal = new Float32Array(cells * 18),
    color = new Float32Array(cells * 18)
  let v = 0
  const put = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    rgb: readonly [number, number, number],
  ) => {
    position[v] = x
    position[v + 1] = y
    position[v + 2] = z
    normal[v] = nx
    normal[v + 1] = ny
    normal[v + 2] = nz
    color[v] = rgb[0]
    color[v + 1] = rgb[1]
    color[v + 2] = rgb[2]
    v += 3
  }
  // One triangle a-b-c given in sim (x, y, h); emitted as three (x, h, -y).
  const tri = (
    ax: number,
    ay: number,
    ah: number,
    bx: number,
    by: number,
    bh: number,
    cx: number,
    cy: number,
    ch: number,
    look: CoverLook,
    i: number,
    j: number,
    z: number,
    slope: number,
  ) => {
    const ux = bx - ax,
      uy = bh - ah,
      uz = ay - by,
      vx = cx - ax,
      vy = ch - ah,
      vz = ay - cy
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= l
    ny /= l
    nz /= l
    const rgb = linear(shade(ny < ROCK_NORMAL_Y ? COVER_LOOK.rock : look, i - AI, j - AJ, z, slope))
    put(ax, ah, -ay, nx, ny, nz, rgb)
    put(bx, bh, -by, nx, ny, nz, rgb)
    put(cx, ch, -cy, nx, ny, nz, rgb)
  }
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      // The apron takes the cover of the edge cell it continues (`coverIndexAt` clamps).
      const cover = coverName(coverIndexAt(i, j))
      const x = hm.x0 + i * hm.cell,
        y = hm.y0 + j * hm.cell,
        x1 = x + hm.cell,
        y1 = y + hm.cell
      const sw = terrainNodeY(i, j),
        se = terrainNodeY(i + 1, j),
        nw = terrainNodeY(i, j + 1),
        ne = terrainNodeY(i + 1, j + 1)
      const look =
        (cover === "forest" || cover === "mixed") &&
        crowns !== undefined &&
        crowns("broadleaf", zOf((sw + se + nw + ne) / 4)) !== "leafy"
          ? OUT_OF_LEAF[cover]
          : COVER_LOOK[cover]
      const { z, slope } = cellSlope(sw, se, nw, ne)
      // Split along the south-west → north-east diagonal, as `terrainY` assumes.
      tri(x, y, sw, x1, y, se, x1, y1, ne, look, i, j, z, slope)
      tri(x, y, sw, x1, y1, ne, x, y1, nw, look, i, j, z, slope)
    }
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute(position, 3))
  g.setAttribute("normal", new Float32BufferAttribute(normal, 3))
  g.setAttribute("color", new Float32BufferAttribute(color, 3))
  return g
}
