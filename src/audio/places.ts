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
  type Building,
  buildingBoxes,
  buildingsIn,
  buildingStyleOf,
  districtAt,
  heightAt,
  MAP,
  treesIn,
  TRUNK,
  wallsNear,
} from "../sim/map/index.ts"
import { isResident, tilesOver } from "../sim/map/tiles.ts"
import { delayOf, EAR_HEIGHT } from "./acoustics.ts"
import { landAt } from "./ground.ts"
import type { Material } from "./types.ts"

export { birdSpot, type Dog, dogsNear, type Owl, owlsNear } from "./places/animals.ts"
export { waterNear, type WaterHeard } from "./places/water.ts"

const { cell, x0, y0 } = MAP.heightmap,
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

/**
 * What a vehicle hitting a drive wall at the contact point (x, y) hit, by how it sounds: the
 * nearest tree trunk, building wall or barrier within `reach` m, if it is the nearest drive wall;
 * else the bank itself, rock in the bare-stone covers and earth elsewhere (a steep bank, the end
 * of the map).
 */
export const wallAt = (x: number, y: number, reach = 3): Material => {
  let wall = Infinity
  for (const s of wallsNear("drive", x - reach, y - reach, x + reach, y + reach))
    wall = Math.min(wall, segDist2(x, y, s.ax, s.ay, s.bx, s.by).d2)
  let nearest = Math.min(reach, Math.sqrt(wall) + SAME_WALL),
    material: Material = BANK_MATERIAL[coverAt(x, y)] ?? "earth"
  const offer = (d: number, what: Material) => {
    if (d < nearest) [nearest, material] = [d, what]
  }
  treesIn(x - reach, y - reach, x + reach, y + reach, (tx, ty) =>
    offer(Math.hypot(tx - x, ty - y) - TRUNK / 2, "tree"),
  )
  buildingsIn(x - reach, y - reach, x + reach, y + reach, (i) => {
    const building = MAP.buildings[i]!,
      what = buildingMaterial(building)
    for (const ring of [building.outer, ...(building.holes ?? [])])
      offer(distanceTo(ring, true, x, y), what)
  })
  // The map has a few dozen barriers: every one is measured.
  for (const { kind, pts } of MAP.barriers) {
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
} as const satisfies Record<Cover, keyof Ambience | "none">

/** Where each share of `Ambience` is kept in a block. */
const SHARE = { forest: 0, open: 1, built: 2 } as const satisfies Record<keyof Ambience, number>
/** Each land-cover index's share. */
const KINDS = Array.from({ length: 256 }, (_, v) => AMBIENCE[coverName(v)])

/** An ambience block is this many cover cells a side (32 m), on the cover's lattice; at most `BLOCKS` are kept (2 km square of them). */
const BLOCK = 8,
  BLOCKS = 4096
const blockCols = Math.ceil(COLS / BLOCK),
  blockRows = Math.ceil(ROWS / BLOCK)
/** The blocks worked out, by `j * blockCols + i`: their forest, open and built shares. */
const blocks = new Map<number, Float32Array>()

/**
 * The shares of block (i, j), its cells counted once the tiles under it are in memory (and kept); until
 * then, all of its share is the coarse cover's at its centre.
 */
const blockAt = (i: number, j: number): Float32Array => {
  const k = j * blockCols + i,
    known = blocks.get(k)
  if (known !== undefined) return known
  // Blocks on the north and east edges are cut short.
  const ci0 = i * BLOCK,
    cj0 = j * BLOCK,
    ci1 = Math.min(COLS, ci0 + BLOCK),
    cj1 = Math.min(ROWS, cj0 + BLOCK)
  const shares = new Float32Array(3)
  const sw = { x: x0 + (ci0 + 0.5) * cell, y: y0 + (cj0 + 0.5) * cell },
    ne = { x: x0 + (ci1 - 0.5) * cell, y: y0 + (cj1 - 0.5) * cell }
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
  const fx = Math.min(blockCols - 1, Math.max(0, (x - x0) / size - 0.5)),
    fy = Math.min(blockRows - 1, Math.max(0, (y - y0) / size - 0.5))
  const i = Math.min(blockCols - 2, Math.floor(fx)),
    j = Math.min(blockRows - 2, Math.floor(fy)),
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
  buildingsIn(x - PROBE_REACH, y - PROBE_REACH, x + PROBE_REACH, y + PROBE_REACH, (i) => {
    const { z0, h, outer, holes } = MAP.buildings[i]!,
      w = Math.min(1, Math.max(0, z0 + h - ground) / FULL_FACADE)
    ring(outer, w)
    for (const hole of holes ?? []) ring(hole, w)
  })
  return weight.reduce((sum, w) => sum + w, 0) / PROBES
}

/** Forest along a path is sampled every this many metres. */
const FOREST_STEP = 8

/** Metres of forest on the straight path from (ax, ay) to (bx, by), for `foliageLoss` (the coarse cover's past the tiles in memory). */
export const forestAlong = (ax: number, ay: number, bx: number, by: number): number => {
  const length = Math.hypot(bx - ax, by - ay),
    n = Math.max(1, Math.ceil(length / FOREST_STEP))
  let forest = 0
  for (let k = 0; k < n; k++)
    if (landAt(ax + ((bx - ax) * (k + 0.5)) / n, ay + ((by - ay) * (k + 0.5)) / n) === "forest")
      forest++
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

/** A church bell: its tower top and the prime partial of its bell, Hz. */
export interface Bell {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly pitch: number
}

/** Taller towers hang bigger bells: the prime falls an octave from 800 Hz (a 10 m tower) to 400 Hz (30 m). */
const pitchOf = (h: number): number => 800 * 2 ** -Math.min(1, Math.max(0, (h - 10) / 20))

/** The tallest church or tower of every district that has one. */
const findBells = (): Array<Bell> => {
  const tallest = new Map<string, number>()
  MAP.buildings.forEach((b, i) => {
    const style = buildingStyleOf(b)
    if (style !== "church" && style !== "tower") return
    const [bx0, by0, bx1, by1] = buildingBoxes[i]!,
      district = districtAt((bx0 + bx1) / 2, (by0 + by1) / 2).name,
      best = tallest.get(district)
    if (best === undefined || b.h > MAP.buildings[best]!.h) tallest.set(district, i)
  })
  return [...tallest.values()].map((i) => {
    const { id, z0, h } = MAP.buildings[i]!,
      [bx0, by0, bx1, by1] = buildingBoxes[i]!
    return {
      key: `bell:${id}`,
      x: (bx0 + bx1) / 2,
      y: (by0 + by1) / 2,
      z: z0 + h,
      pitch: pitchOf(h),
    }
  })
}
/** One bell per settlement. */
export const bells: ReadonlyArray<Bell> = findBells()
