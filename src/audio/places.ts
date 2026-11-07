/**
 * What the map around the listener sounds like: what a car hit (the material of the drive wall at
 * a contact point), the mix of forest, open ground and village (the ambience beds), how enclosed a
 * street is (the reverb send), forest along a path (foliage loss), rock faces that echo, and the
 * church bells. The animals (farm dogs, owls, the birds' trees) are in places/animals.ts, running
 * water in places/water.ts; the surface under a foot or a tyre is the sim's (`surfaceAt`). Off the
 * roads everything reads the sim's land cover (`coverAt`). Around the listener the tiles are in
 * memory and the reads are exact; forest along a path, which can run for kilometres, reads the
 * coarse grid past them (`./ground.ts`). Each 32 m ambience block is worked out where it is first
 * asked for, once the tiles under it are in memory, and kept.
 *
 * @module audio/places
 */
import { segDist2 } from "../sim/collide.ts"
import { type Cover, coverAt, coverIndexAt, coverName } from "../sim/map/cover.ts"
import {
  type BellEntry,
  type Building,
  buildingStyleOf,
  heightAt,
  isWood,
  MAP,
  treesIn,
  TRUNK,
  wallsNear,
} from "../sim/map/index.ts"
import { anchorOf } from "../sim/map/kinds.ts"
import { isResident, placeAt, tilesOver } from "../sim/map/tiles.ts"
import { buildingsIn } from "../sim/map/vectors.ts"
import { hash01 } from "../tools/geometry.ts"
import { delayOf, EAR_HEIGHT } from "./acoustics.ts"
import { landAt } from "./ground.ts"
import type { Material } from "./types.ts"

export { birdSpot, type Dog, dogsNear, type Owl, owlsNear } from "./places/animals.ts"
export { waterNear, type WaterHeard } from "./places/water.ts"

const { cell } = MAP.heightmap,
  { x: AX, y: AY, i: AI, j: AJ } = anchorOf(MAP.heightmap),
  COLS = MAP.heightmap.cols - 1,
  ROWS = MAP.heightmap.rows - 1

/** A building's walls by how they sound: greenhouses are glass, industrial buildings metal sheet, rubble stone and old buildings stone, the rest rendered masonry. */
const buildingMaterial = (building: Building): Material => {
  const style = buildingStyleOf(building)
  return building.kind === "greenhouse"
    ? "glass"
    : style === "industrial"
      ? "sheet"
      : style === "stone" || style === "church" || style === "tower" || style === "ruin"
        ? "stone"
        : "masonry"
}

/** The map's barriers (`Barrier.kind`) by how they sound. */
const BARRIER_MATERIAL: Partial<Record<string, Material>> = {
  guard_rail: "rail",
  wall: "stone",
  cliff: "rock",
}

/** The distance from (x, y) to the polyline `pts`, m; `closed` adds the edge back to its start (a ring). */
const distanceTo = (pts: ReadonlyArray<number>, closed: boolean, x: number, y: number): number => {
  let d2 = Number.MAX_VALUE
  for (let i = closed ? 0 : 2, n = pts.length, j = closed ? n - 2 : 0; i < n; j = i, i += 2)
    d2 = Math.min(d2, segDist2(x, y, pts[j]!, pts[j + 1]!, pts[i]!, pts[i + 1]!).d2)
  return Math.sqrt(d2)
}

/** A drive wall in the bare-stone covers is the rock itself: a cut quarry face, a crag, a bank of scree. */
const BANK_MATERIAL: Partial<Record<Cover, Material>> = {
  rock: "rock",
  quarry: "rock",
  scree: "rock",
}

/** A trunk, building or barrier this much farther than the nearest drive wall is not the wall that was hit, m (a trunk's square wall against its circle, a contact a few cm off). */
const SAME_WALL = 0.6
/** A trunk, building or barrier is looked for this near the contact point, m: well within the vectors' `HALO`, so the point's tile holds every barrier that near. */
const REACH = 3

/**
 * What a vehicle hitting a drive wall at the contact point (x, y) hit, by how it sounds: the
 * nearest tree trunk, building wall or barrier within 3 m, if it is the nearest drive wall; else
 * the bank itself, rock in the bare-stone covers and earth elsewhere (a steep bank, the end of the
 * map). On a tie the first offered wins: trunks, buildings in the broad phase's order, then
 * barriers in the whole map's.
 */
export const wallAt = (x: number, y: number): Material => {
  const x0 = x - REACH,
    y0 = y - REACH,
    x1 = x + REACH,
    y1 = y + REACH
  let wall = Infinity
  for (const s of wallsNear("drive", x0, y0, x1, y1))
    wall = Math.min(wall, segDist2(x, y, s.ax, s.ay, s.bx, s.by).d2)
  let nearest = Math.min(REACH, Math.sqrt(wall) + SAME_WALL),
    material: Material = BANK_MATERIAL[coverAt(x, y)] ?? "earth"
  const offer = (d: number, what: Material) => {
    if (d < nearest) [nearest, material] = [d, what]
  }
  treesIn(x0, y0, x1, y1, (tx, ty) => offer(Math.hypot(tx - x, ty - y) - TRUNK / 2, "tree"))
  buildingsIn(x0, y0, x1, y1, (_, building) => {
    const what = buildingMaterial(building)
    for (const ring of [building.outer, ...(building.holes ?? [])])
      offer(distanceTo(ring, true, x, y), what)
  })
  // A tile holds a dozen barriers at most: every one the point's tile holds is measured, in the whole map's order.
  for (const { kind, pts } of placeAt(x, y).vectors.barriers.items) {
    const what = BARRIER_MATERIAL[kind]
    if (what !== undefined) offer(distanceTo(pts, false, x, y), what)
  }
  return material
}

/** Shares 0…1 of the ground around a point: woods, open grass, scrub and fields, village (river beds and bare stone count as none). */
interface Ambience {
  readonly forest: number
  readonly open: number
  readonly built: number
}

const AMBIENCE = {
  meadow: "open",
  forest: "forest",
  grassland: "open",
  scrub: "open",
  sparse: "open",
  scree: "none",
  rock: "none",
  quarry: "none",
  residential: "built",
  farmland: "open",
  farmyard: "open",
  vineyard: "open",
  park: "open",
  school: "built",
  cemetery: "open",
  pitch: "open",
  parking: "built",
  industrial: "built",
  paved: "built",
  platform: "built",
  ruins: "open",
  pebble: "none",
  river: "none",
  lake: "none",
  conifer: "forest",
  mixed: "forest",
  olive: "open",
} as const satisfies Record<Cover, keyof Ambience | "none">

/** Where each share of `Ambience` is kept in a block. */
const SHARE = { forest: 0, open: 1, built: 2 } as const satisfies Record<keyof Ambience, number>
/** Each land-cover index's share. */
const KINDS = Array.from({ length: 256 }, (_, v) => AMBIENCE[coverName(v)])

/**
 * An ambience block is this many cover cells a side (32 m), on the cover's lattice; at most `BLOCKS`
 * are kept (2 km square of them). The blocks count from the region's anchor (`anchorOf`), never the
 * box's corner, as the owls' squares do: a part that grows the box west or south moves no block of
 * the parts before it. Block (i, j) starts at cell (`AI + i * BLOCK`, `AJ + j * BLOCK`).
 */
const BLOCK = 8,
  BLOCKS = 4096
/** The blocks that meet the box along x and along y: the first's index (negative west or south of the anchor) and the last's. */
const blockCols = { first: Math.floor(-AI / BLOCK), last: Math.ceil((COLS - AI) / BLOCK) - 1 },
  blockRows = { first: Math.floor(-AJ / BLOCK), last: Math.ceil((ROWS - AJ) / BLOCK) - 1 }
/** The blocks worked out, by `slot`: their forest, open and built shares. */
const blocks = new Map<number, Float32Array>()
/** Block (i, j)'s place in `blocks`. */
const slot = (i: number, j: number) =>
  (j - blockRows.first) * (blockCols.last - blockCols.first + 1) + i - blockCols.first

/**
 * The shares of block (i, j), its cells counted once the tiles under it are in memory (and kept); until
 * then, all of its share is the coarse cover's at its centre.
 */
const blockAt = (i: number, j: number): Float32Array => {
  const k = slot(i, j),
    known = blocks.get(k)
  if (known !== undefined) return known
  // Blocks on the box's edges are cut short.
  const ci0 = Math.max(0, AI + i * BLOCK),
    cj0 = Math.max(0, AJ + j * BLOCK),
    ci1 = Math.min(COLS, AI + (i + 1) * BLOCK),
    cj1 = Math.min(ROWS, AJ + (j + 1) * BLOCK)
  const shares = new Float32Array(3)
  const sw = { x: AX + (ci0 - AI + 0.5) * cell, y: AY + (cj0 - AJ + 0.5) * cell },
    ne = { x: AX + (ci1 - AI - 0.5) * cell, y: AY + (cj1 - AJ - 0.5) * cell }
  if (!tilesOver(sw.x, sw.y, ne.x, ne.y).every(isResident)) {
    const kind = AMBIENCE[landAt((sw.x + ne.x) / 2, (sw.y + ne.y) / 2)]
    if (kind !== "none") shares[SHARE[kind]] = 1
    return shares
  }
  for (let cj = cj0; cj < cj1; cj++)
    for (let ci = ci0; ci < ci1; ci++) {
      const kind = KINDS[coverIndexAt(ci, cj)]!
      if (kind !== "none") shares[SHARE[kind]]! += 1
    }
  for (let s = 0; s < 3; s++) shares[s]! /= (ci1 - ci0) * (cj1 - cj0)
  if (blocks.size >= BLOCKS) blocks.delete(blocks.keys().next().value!)
  blocks.set(k, shares)
  return shares
}

/** The ambience around (x, y): the 32 m blocks' shares, bilinear between block centres. */
export const ambienceAt = (x: number, y: number): Ambience => {
  const size = cell * BLOCK
  const fx = Math.min(blockCols.last, Math.max(blockCols.first, (x - AX) / size - 0.5)),
    fy = Math.min(blockRows.last, Math.max(blockRows.first, (y - AY) / size - 0.5))
  const i = Math.min(blockCols.last - 1, Math.floor(fx)),
    j = Math.min(blockRows.last - 1, Math.floor(fy)),
    tx = fx - i,
    ty = fy - j
  const sw = blockAt(i, j),
    se = blockAt(i + 1, j),
    nw = blockAt(i, j + 1),
    ne = blockAt(i + 1, j + 1)
  const at = (s: number) => {
    const south = sw[s]! + (se[s]! - sw[s]!) * tx,
      north = nw[s]! + (ne[s]! - nw[s]!) * tx
    return south + (north - south) * ty
  }
  return { forest: at(SHARE.forest), open: at(SHARE.open), built: at(SHARE.built) }
}

/** Facades are looked for in `PROBES` directions up to `PROBE_REACH` m; one `FULL_FACADE` m above the listener's ground counts fully. */
const PROBES = 8,
  PROBE_REACH = 15,
  FULL_FACADE = 4
const probeX = Array.from({ length: PROBES }, (_, k) => Math.cos((2 * Math.PI * k) / PROBES))
const probeY = Array.from({ length: PROBES }, (_, k) => Math.sin((2 * Math.PI * k) / PROBES))

/** How enclosed (x, y) is, 0 (open) … 1 (a narrow stone street): the share of directions that meet a facade within 15 m, by its height. */
export const streetAt = (x: number, y: number): number => {
  const nearest = new Float64Array(PROBES).fill(PROBE_REACH),
    weight = new Float64Array(PROBES),
    ground = heightAt(x, y)
  const ring = (pts: ReadonlyArray<number>, w: number) => {
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
      const px = pts[j]! - x,
        py = pts[j + 1]! - y,
        ex = pts[i]! - pts[j]!,
        ey = pts[i + 1]! - pts[j + 1]!
      for (let k = 0; k < PROBES; k++) {
        const den = probeX[k]! * ey - probeY[k]! * ex
        if (den === 0) continue
        const t = (px * ey - py * ex) / den,
          u = (px * probeY[k]! - py * probeX[k]!) / den
        if (t >= 0 && t < nearest[k]! && u >= 0 && u <= 1) [nearest[k], weight[k]] = [t, w]
      }
    }
  }
  buildingsIn(
    x - PROBE_REACH,
    y - PROBE_REACH,
    x + PROBE_REACH,
    y + PROBE_REACH,
    (_, { z0, h, outer, holes }) => {
      const w = Math.min(1, Math.max(0, z0 + h - ground) / FULL_FACADE)
      ring(outer, w)
      for (const hole of holes ?? []) ring(hole, w)
    },
  )
  return weight.reduce((sum, w) => sum + w, 0) / PROBES
}

/** Forest along a path is sampled every this many metres. */
const FOREST_STEP = 8

/** Metres of woods (`WOODS`) on the straight path from (ax, ay) to (bx, by), for `foliageLoss` (the coarse cover's past the tiles in memory). */
export const forestAlong = (ax: number, ay: number, bx: number, by: number): number => {
  const length = Math.hypot(bx - ax, by - ay),
    n = Math.max(1, Math.ceil(length / FOREST_STEP))
  let forest = 0
  for (let k = 0; k < n; k++)
    if (isWood(landAt(ax + ((bx - ax) * (k + 0.5)) / n, ay + ((by - ay) * (k + 0.5)) / n))) forest++
  return (forest * length) / n
}

/** A discrete echo of a loud sound off a rock face: seconds after the direct sound, dB below its 1 m level, and where the face is from the listener, m. */
export interface Echo {
  readonly delay: number
  readonly loss: number
  readonly dx: number
  readonly dy: number
}

/** Echoing faces are searched in `AZIMUTHS` directions from `ECHO_NEAR` to `ECHO_FAR` m every `ECHO_STEP` m (physics.md §7: distinct echoes from 17 m on). */
const AZIMUTHS = 16,
  ECHO_NEAR = 40,
  ECHO_FAR = 400,
  ECHO_STEP = 8
/** A face is bare rock, as painted: it climbs at least this steeply (50°; a gentler slope sends sound to the sky) and stands this many metres above the ears. */
const FACE_SLOPE = 1.2,
  FACE_RISE = 10
/** Reflection loss of a rock face, dB (a cliff scatters more than it mirrors: Pieren and Wunderli 2011), and air absorption at 1 kHz, dB/m (ISO 9613-1, 15 °C / 70 %). */
const ROCK_DB = 10,
  AIR_DB = 0.0041

/**
 * Up to two echoes at (x, y), strongest first, from rock faces 40–400 m away that the listener can
 * see, at least 45° apart: delay 2d/c, loss 20·log10(2d) + air absorption + reflection loss. Empty
 * where no rock is in sight (buildings are not searched).
 */
export const echoesAt = (x: number, y: number): ReadonlyArray<Echo> => {
  const ear = heightAt(x, y) + EAR_HEIGHT,
    faces: Array<{
      readonly k: number
      readonly d: number
      readonly dx: number
      readonly dy: number
      readonly loss: number
    }> = []
  for (let k = 0; k < AZIMUTHS; k++) {
    const ux = Math.cos((2 * Math.PI * k) / AZIMUTHS),
      uy = Math.sin((2 * Math.PI * k) / AZIMUTHS)
    // The steepest sight line so far: a face is heard only if it rises above it.
    let horizon = -Number.MAX_VALUE,
      previous = heightAt(x, y)
    for (let d = ECHO_STEP; d <= ECHO_FAR; d += ECHO_STEP) {
      const z = heightAt(x + ux * d, y + uy * d),
        slope = (z - previous) / ECHO_STEP,
        sight = (z - ear) / d
      previous = z
      if (d >= ECHO_NEAR && sight >= horizon && slope >= FACE_SLOPE && z - ear >= FACE_RISE) {
        faces.push({
          k,
          d,
          dx: ux * d,
          dy: uy * d,
          loss: 20 * Math.log10(2 * d) + AIR_DB * 2 * d + ROCK_DB,
        })
        break
      }
      horizon = Math.max(horizon, sight)
    }
  }
  faces.sort((a, b) => a.loss - b.loss)
  const apart = (a: number, b: number) =>
    Math.min(Math.abs(a - b), AZIMUTHS - Math.abs(a - b)) >= AZIMUTHS / 8
  const first = faces[0],
    second = faces.find((f) => first !== undefined && apart(f.k, first.k))
  return [first, second]
    .filter((f) => f !== undefined)
    .map(({ d, dx, dy, loss }) => ({ delay: delayOf(2 * d), loss, dx, dy }))
}

/** A church bell: its tower top, the prime partial of its bell, Hz, and its seed 0…1, which sets how late it strikes the hour. */
export interface Bell {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly pitch: number
  readonly seed: number
}

/** Taller towers hang bigger bells: the prime falls an octave from 800 Hz (a 10 m tower) to 400 Hz (30 m). */
const pitchOf = (h: number): number => 800 * 2 ** -Math.min(1, Math.max(0, (h - 10) / 20))

/**
 * The bells of the towers the build found (`MAP.derived.bells`). A bell's seed is hashed from its
 * building's id (salt 15: the renderer's roof hashes it with 7), never from its place in the list,
 * which every part that grows the map reorders.
 */
export const bellsFrom = (towers: ReadonlyArray<BellEntry>): ReadonlyArray<Bell> =>
  towers.map(({ id, x, y, z, h }) => ({
    key: `bell:${id}`,
    x,
    y,
    z,
    pitch: pitchOf(h),
    seed: hash01(id, 15),
  }))

/** One bell per settlement: the tallest church or tower of every district that has one (the build finds them, src/tools/bells.ts). */
export const bells: ReadonlyArray<Bell> = bellsFrom(MAP.derived.bells)
