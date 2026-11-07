/**
 * Trees: the species of the Lunigiana's woods by their land cover, height and aspect (`speciesAt`),
 * and the olive groves' olives by their ids (`kindAt`), one InstancedMesh per kind per chunk, built
 * when the chunk streams in. Trees near the map edge are
 * mirrored into the apron so the forest does not stop at the bounds. Each tree's look is drawn from
 * its seed, three times its id (a mirror's one more; the id is its lattice cell's number, fixed as
 * parts are added: src/tools/trees.ts), so a tree looks the same whichever tile brought it. A bank
 * tree's seeds pass int32 and an olive's mostly 2^32: `hash01` wraps them (ToInt32), and the ids
 * keep any two trees' apart but an olive's mirror's, which may meet a wood's tree's 38 km away
 * (`oliveId` in src/tools/trees.ts). A `canopy` vertex attribute (1 on the crown, 0 on the trunk) tells the
 * tree material what sways in the wind.
 *
 * @module render/trees
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three"

import { type Cover, coverAt } from "../sim/map/cover.ts"
import { heightAt, isWood, MAP, OLIVE_TREES, TILE } from "../sim/map/index.ts"
import { tileTrees } from "../sim/map/tiles.ts"
import { hash01 } from "../tools/geometry.ts"
import { APRON, chunkOf } from "./chunks.ts"
import { merge, paint } from "./geometry.ts"
import { terrainY, zOf } from "./ground.ts"
import type { Crown } from "./leaves.ts"
import { PALETTE } from "./palette.ts"

/**
 * The tree kinds: broadleaf (chestnut, hop-hornbeam and the riparian trees), oak (the broadleaf's
 * crown, darker in red and green: `OAK`), beech, conifer (the black pine, fir and spruce of the
 * plantations, a cone), pine (maritime and stone pine) and olive (the groves', evergreen).
 */
const KINDS = ["broadleaf", "oak", "beech", "conifer", "pine", "olive"] as const
/** A tree kind (`KINDS`). */
export type TreeKind = (typeof KINDS)[number]
/**
 * The crowns the kinds are drawn with, each its own InstancedMesh a chunk: the oak's is the broadleaf's, in its own tint; out of
 * leaf, a broadleaf's or a beech's crown bare, an oak's holding its dead leaves (`Crown`).
 */
const SHAPES = [
  "broadleaf",
  "beech",
  "conifer",
  "pine",
  "olive",
  "bareBroadleaf",
  "bareBeech",
  "deadOak",
] as const
type Shape = (typeof SHAPES)[number]
/** The crown a tree of `kind` wearing `crown` is drawn with. */
const shapeOf = (kind: TreeKind, crown: Crown): Shape =>
  crown === "dead"
    ? "deadOak"
    : crown === "bare"
      ? kind === "beech"
        ? "bareBeech"
        : "bareBroadleaf"
      : kind === "oak"
        ? "broadleaf"
        : kind
/**
 * Of the oaks out of leaf, the share that holds its dead leaves: the downy oak's marcescence (the Turkey oak's grown trees
 * mostly shed theirs). A design value: the IFT lumps the two oaks, so each is taken as half.
 */
const MARCESCENT = 0.5
/** Every tree in leaf: what a chunk wears unless told the season (`crownsOn` in render/leaves.ts). */
const IN_LEAF = (): Crown => "leafy"
/** A record of `of(kind)` for every kind. */
const byKind = <T>(of: (kind: TreeKind) => T): Record<TreeKind, T> =>
  Object.fromEntries(KINDS.map((kind) => [kind, of(kind)])) as Record<TreeKind, T>

/** `piece` marked as crown (1: it sways rigidly in the wind) or trunk (0: it stays). */
const crown = (piece: BufferGeometry, sways: 0 | 1): BufferGeometry =>
  piece.setAttribute(
    "canopy",
    new Float32BufferAttribute(
      new Float32Array(piece.getAttribute("position").count).fill(sways),
      1,
    ),
  )

/**
 * Each kind's crown at unit scale, m: its radius, its height and its centre's height over the
 * trunk's base. The beech's is a taller ovoid than the chestnut's, the pine's an umbrella on a
 * tall bare trunk, the olive's a low, wide one on a short trunk, 3.5 m tall in all.
 */
const CROWN = {
  broadleaf: { radius: 3, height: 5, at: 4.2 },
  oak: { radius: 3, height: 5, at: 4.2 },
  beech: { radius: 2.4, height: 7.2, at: 5.8 },
  conifer: { radius: 2, height: 6.5, at: 4.2 },
  pine: { radius: 2.6, height: 2.2, at: 5.8 },
  olive: { radius: 1.8, height: 2.8, at: 2.1 },
} as const satisfies Record<TreeKind, { radius: number; height: number; at: number }>
/** The widest crown's radius at unit scale, m. */
const WIDEST = Math.max(...KINDS.map((kind) => CROWN[kind].radius))

/** A round crown (an ellipsoid) of `kind` in `hex` on a trunk `trunk` m tall, trunk base at the origin. */
const roundTree = (kind: Exclude<TreeKind, "conifer">, hex: number, trunk: number) =>
  merge([
    crown(
      paint(
        new CylinderGeometry(0.22, 0.3, trunk, 5).translate(0, trunk / 2, 0),
        PALETTE.woodBrown,
      ),
      0,
    ),
    crown(
      paint(
        new IcosahedronGeometry(1, 0)
          .scale(CROWN[kind].radius, CROWN[kind].height / 2, CROWN[kind].radius)
          .translate(0, CROWN[kind].at, 0),
        hex,
      ),
      1,
    ),
  ])

/** Unit-scale tree shapes (≈ 7 m tall, the beech ≈ 9 m, the olive 3.5 m), trunk base at the origin; shared by every chunk. */
const shapes = {
  broadleaf: roundTree("broadleaf", PALETTE.forest, 2),
  beech: roundTree("beech", PALETTE.beech, 2.5),
  conifer: merge([
    crown(
      paint(new CylinderGeometry(0.18, 0.24, 1.6, 5).translate(0, 0.8, 0), PALETTE.woodBrown),
      0,
    ),
    crown(
      paint(
        new ConeGeometry(CROWN.conifer.radius, CROWN.conifer.height, 6).translate(
          0,
          CROWN.conifer.at,
          0,
        ),
        PALETTE.conifer,
      ),
      1,
    ),
  ]),
  pine: roundTree("pine", PALETTE.pine, 5),
  olive: roundTree("olive", PALETTE.olive, 1.2),
  bareBroadleaf: roundTree("broadleaf", PALETTE.bareCrown, 2),
  bareBeech: roundTree("beech", PALETTE.bareCrown, 2.5),
  deadOak: roundTree("oak", PALETTE.oakDead, 2),
} as const satisfies Record<Shape, BufferGeometry>

/** Linear multipliers on the canopy colour: mid, sunlit, shaded. */
const TINTS = [new Color(1, 1, 1), new Color(1.35, 1.3, 1.1), new Color(0.75, 0.78, 0.72)] as const
/**
 * The oak's on the broadleaf's crown (linear): the oak woods below 400 m against the chestnut woods
 * on the 2021 and 2023 orthophotos, in one strip and aspect over 62 patches, (0.85, 0.93, 1.10),
 * the blue left as the chestnut's since the two flights disagree on it (0.98 and 1.22).
 */
const OAK = new Color(0.85, 0.93, 1)
/** Each kind's canopy multipliers (`TINTS`; an oak's darkened by `OAK`). */
const TINTS_OF: Record<TreeKind, ReadonlyArray<Color>> = byKind((kind) =>
  kind === "oak" ? TINTS.map((t) => t.clone().multiply(OAK)) : TINTS,
)

/**
 * The beech's share of the broadleaf woods, logistic in the height (m a.s.l.): half at `mid`,
 * rising over about `width` either side, its belt `north` m lower on a face turned full north.
 * Regione Toscana's forest inventory (IFT, a 400 m grid, read for these constants only) over the 14
 * Lunigiana comuni holds no beech below 400 m, 16% of the forest at 800–1000 m (24% on north faces,
 * 11% on south ones), 55% at 1000–1200 m, 89% at 1200–1400 m and all of it at 1400–1600 m, which
 * these give the built map's woods within 3 points. Its 2,141 forest points in Massa-Carrara round
 * Fivizzano, Casola and Comano alone fit 1115 ± 15 m, 96 ± 6 m and 58 ± 21 m (maximum likelihood).
 */
const BEECH = { mid: 1080, width: 90, north: 80 } as const
/** Conifers among the broadleaf: their share in the plantations' belt (`from`–`to` m) and elsewhere (the IFT round Fivizzano: 6.2% and 3.3% of the forest points). */
const CONIFERS = { belt: 0.06, elsewhere: 0.03, from: 800, to: 1400 } as const
/** Pines: a conifer wood's conifers below `planted` m, and this `share` of the broadleaf below `below` m (the IFT's 10% conifers below 200 m, mostly maritime pine). */
const PINES = { planted: 600, share: 0.1, below: 300 } as const
/** The conifers' share of a mixed wood. */
const MIXED = 0.45
/**
 * Oaks (Turkey and downy oak), as a share of the broadleaf on south and north faces below each
 * height, m: the IFT round Fivizzano, 52% and 28% of its broadleaf points below 400 m, 31% and 12%
 * at 400–800 m, 39% and 15% at 800–1000 m, 38% and 28% at 1000–1200 m (63 and 57 points) and none
 * of its 12 above; the rest is chestnut and hop-hornbeam.
 */
const OAKS = [
  { below: 400, south: 0.52, north: 0.28 },
  { below: 800, south: 0.31, north: 0.12 },
  { below: 1000, south: 0.39, north: 0.15 },
  { below: 1200, south: 0.38, north: 0.28 },
] as const

/**
 * The species of a tree on land cover `cover` at height `z` (m a.s.l.), on ground facing
 * `northness` (−1 south … 1 north, 0 flat), drawn by `h` in [0, 1): out of the woods, a bank's
 * broadleaf; in a conifer wood, a conifer (a pine below `PINES.planted`); in a mixed one, a conifer
 * as `MIXED` says; else a beech as `BEECH` says, a conifer as `CONIFERS` says, a pine low down as
 * `PINES` says, an oak as `OAKS` says (most on low south faces), and a broadleaf.
 */
export const speciesAt = (cover: Cover, z: number, northness: number, h: number): TreeKind => {
  if (!isWood(cover)) return "broadleaf"
  const needles = z < PINES.planted ? "pine" : "conifer"
  if (cover === "conifer") return needles
  // Each test takes share `p` of what `u` still spans, else stretches the rest back over [0, 1).
  let u = h
  if (cover === "mixed") {
    if (u < MIXED) return needles
    u = rest(u, MIXED)
  }
  const beech =
    1 / (1 + Math.exp(-(z - BEECH.mid + BEECH.north * Math.max(0, northness)) / BEECH.width))
  if (u < beech) return "beech"
  u = rest(u, beech)
  const conifers = z >= CONIFERS.from && z < CONIFERS.to ? CONIFERS.belt : CONIFERS.elsewhere
  if (u < conifers) return "conifer"
  u = rest(u, conifers)
  if (z < PINES.below) {
    if (u < PINES.share) return "pine"
    u = rest(u, PINES.share)
  }
  const oaks = OAKS.find(({ below }) => z < below)
  return oaks !== undefined && u < (northness < 0 ? oaks.south : oaks.north) ? "oak" : "broadleaf"
}

/** A draw `u` in [0, 1) that missed share `p`, stretched back over [0, 1). */
const rest = (u: number, p: number): number => (u - p) / (1 - p)

/** The side of the squares the ground's aspect is measured on, m: a hillside's, not a bump's; it divides TILE. */
const SLOPE = 20
/** Squares a tile side. */
const SLOPES = TILE / SLOPE
/** Slopes gentler than this (rise over run) face their way in proportion: flat ground faces no way. */
const FLAT = 0.1

/** Where corner `k` of a tile side's squares lies, from the side's start `at`: the last a hair inside the tile, so the tile alone is read. */
const along = (k: number, at: number): number => (k === SLOPES ? at + TILE - 1e-3 : at + k * SLOPE)
/** The ground's height (`heightAt`) at corner (a, b) of tile (i, j)'s squares. */
const cornerHeight = (i: number, j: number, a: number, b: number): number =>
  heightAt(along(a, TILE * i), along(b, TILE * j))

/**
 * The kind of the tree at (x, y), whole metres, drawn from `seed` (its own: 3 × its id): an olive
 * for an olive grove's (its id from OLIVE_TREES), else its species (`speciesAt`) on the land cover
 * under it, at its height and aspect on its tile's `SLOPE` m square, whose corners' heights
 * `height` gives as `cornerHeight` does (the tree's tile must be in memory). The northness is the
 * share of the square's slope that falls to the north (`FLAT`).
 */
export const kindAt = (
  x: number,
  y: number,
  seed: number,
  height: (i: number, j: number, a: number, b: number) => number = cornerHeight,
): TreeKind => {
  if (seed >= 3 * OLIVE_TREES) return "olive"
  const i = Math.floor(x / TILE),
    j = Math.floor(y / TILE),
    fx = (x - TILE * i) / SLOPE,
    fy = (y - TILE * j) / SLOPE
  const a = Math.min(SLOPES - 1, Math.floor(fx)),
    b = Math.min(SLOPES - 1, Math.floor(fy))
  const sw = height(i, j, a, b),
    se = height(i, j, a + 1, b),
    nw = height(i, j, a, b + 1),
    ne = height(i, j, a + 1, b + 1)
  const east = (se + ne - sw - nw) / (2 * SLOPE),
    north = (nw + ne - sw - se) / (2 * SLOPE)
  const tx = fx - a,
    south = sw + (se - sw) * tx,
    z = south + (nw + (ne - nw) * tx - south) * (fy - b)
  const northness = -north / Math.max(FLAT, Math.sqrt(east * east + north * north))
  return speciesAt(coverAt(x, y), z, northness, hash01(seed, 11))
}

/** The drawn scale of a tree of map scale `scale` drawn from `seed`. */
const sizeOf = (seed: number, scale: number): number => scale * (0.85 + 0.3 * hash01(seed, 9))
/** Render y of a tree's trunk base at (x, y): a little into the ground, so no slope shows under it. */
const baseY = (x: number, y: number): number => terrainY(x, y) - 0.2

/**
 * Whether the point (x, y) at render height `h` lies in the crown of the tree at (tx, ty) of map
 * scale `scale` and index `id` (as `treesIn` gives them; its tile in memory): the round crowns'
 * ellipsoid, or the conifer's cone, as drawn.
 */
export const inCrown = (
  tx: number,
  ty: number,
  scale: number,
  id: number,
  x: number,
  y: number,
  h: number,
): boolean => {
  const seed = 3 * id,
    s = sizeOf(seed, scale)
  // Most points asked about lie past every crown's reach: no species to work out.
  if (Math.hypot(x - tx, y - ty) >= WIDEST * s) return false
  const kind = kindAt(tx, ty, seed),
    { radius, height, at } = CROWN[kind]
  const across = Math.hypot(x - tx, y - ty) / (radius * s),
    up = (h - baseY(tx, ty)) / s - at
  if (kind !== "conifer") return across * across + ((2 * up) / height) ** 2 < 1
  // The cone narrows from its full radius at its base to nothing at its tip.
  return Math.abs(up) < height / 2 && across < 0.5 - up / height
}

/** One chunk's trees: flat (x, y, scale, seed) quadruples, in seed order. */
type ChunkTrees = ArrayLike<number>

/**
 * The trees of tile `key` (in memory) bucketed by chunk, each tree within the apron width of a map
 * edge with its mirror images across it: the whole map's buckets cut by tile.
 */
export const bucketTileTrees = (key: string): Map<number, ChunkTrees> => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const reach = APRON * MAP.heightmap.cell
  const { trees, ids } = tileTrees(key)
  const chunks = new Map<number, Array<number>>()
  const visit = (x: number, y: number, scale: number, seed: number) => {
    const chunk = chunkOf(x, y)
    let bucket = chunks.get(chunk)
    if (bucket === undefined) chunks.set(chunk, (bucket = []))
    bucket.push(x, y, scale, seed)
  }
  for (let k = 0; k < ids.length; k++) {
    const x = trees[3 * k]!,
      y = trees[3 * k + 1]!,
      scale = trees[3 * k + 2]!,
      seed = 3 * ids[k]!
    visit(x, y, scale, seed)
    // Most trees are far from every edge: no mirrors, so skip building the lists below.
    if (x - minX >= reach && maxX - x >= reach && y - minY >= reach && maxY - y >= reach) continue
    const xs = [
      x,
      ...(x - minX < reach ? [2 * minX - x] : []),
      ...(maxX - x < reach ? [2 * maxX - x] : []),
    ]
    const ys = [
      y,
      ...(y - minY < reach ? [2 * minY - y] : []),
      ...(maxY - y < reach ? [2 * maxY - y] : []),
    ]
    for (const mx of xs)
      for (const my of ys) if (mx !== x || my !== y) visit(mx, my, scale, seed + 1)
  }
  // Packed: a bucket is read, never grown again.
  return new Map([...chunks].map(([chunk, bucket]) => [chunk, Float64Array.from(bucket)]))
}

/** `a`'s and `b`'s (x, y, scale, seed) quadruples merged in seed order (a tree's mirrors share its seed and stay in their order). */
const mergeBySeed = (a: ArrayLike<number>, b: ArrayLike<number>): Float64Array => {
  const out = new Float64Array(a.length + b.length)
  let i = 0,
    j = 0,
    o = 0
  while (i < a.length || j < b.length) {
    const fromA = j >= b.length || (i < a.length && a[i + 3]! <= b[j + 3]!)
    const from = fromA ? a : b,
      k = fromA ? i : j
    for (let n = 0; n < 4; n++) out[o + n] = from[k + n]!
    o += 4
    if (fromA) i += 4
    else j += 4
  }
  return out
}

/** A chunk's trees from its buckets in the tiles it draws trees from (`bucketTileTrees`), in seed order as one whole-map bucket holds them; undefined when it has none. */
export const chunkTrees = (
  buckets: ReadonlyArray<ChunkTrees | undefined>,
): ChunkTrees | undefined => {
  let merged: ChunkTrees | undefined
  for (const bucket of buckets) {
    if (bucket === undefined) continue
    merged = merged === undefined ? bucket : mergeBySeed(merged, bucket)
  }
  return merged
}

/**
 * The kind of each of `trees` (`kindAt`), a mirror its tree's: a mirror stands past a map edge
 * (seed 3 × id + 1), so its tree stands at its image back across the edge, with seed 3 × id. The
 * squares' corner heights are read once each.
 */
const kindsOf = (trees: ChunkTrees): Array<TreeKind> => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const heights = new Map<string, number>()
  const height = (i: number, j: number, a: number, b: number) => {
    const key = `${i}_${j}_${a}_${b}`
    let h = heights.get(key)
    if (h === undefined) heights.set(key, (h = cornerHeight(i, j, a, b)))
    return h
  }
  const back = (v: number, min: number, max: number) =>
    v < min ? 2 * min - v : v > max ? 2 * max - v : v
  return Array.from({ length: trees.length / 4 }, (_, n) => {
    const seed = trees[4 * n + 3]!
    return kindAt(
      back(trees[4 * n]!, minX, maxX),
      back(trees[4 * n + 1]!, minY, maxY),
      seed - (seed % 3),
      height,
    )
  })
}

const matrix = new Matrix4(),
  rotation = new Quaternion(),
  up = new Vector3(0, 1, 0),
  at = new Vector3(),
  size = new Vector3()
/**
 * The tree meshes of one chunk, one per crown it has (`shapeOf`), each tree tinted as its kind
 * (`kinds` says each tree's; their kinds `kindAt` gives by default, which reads their tiles) and
 * wearing what `crowns` says for its kind at its height (all in leaf by default), each tree's trunk
 * base `base(x, y)` (render y; a little into the terrain there by default). Dispose them with
 * `InstancedMesh.dispose` (the shapes are shared).
 */
export const treeMeshes = (
  trees: ChunkTrees,
  material: Material,
  base: (x: number, y: number) => number = baseY,
  kinds: ReadonlyArray<TreeKind> = kindsOf(trees),
  crowns: (kind: TreeKind, z: number) => Crown = IN_LEAF,
): Array<InstancedMesh> => {
  const meshes: Array<InstancedMesh> = []
  const worn = kinds.map((kind, n) => {
    const crown = crowns(kind, zOf(base(trees[4 * n]!, trees[4 * n + 1]!)))
    return shapeOf(
      kind,
      crown === "dead" && hash01(trees[4 * n + 3]!, 17) >= MARCESCENT ? "bare" : crown,
    )
  })
  for (const shape of SHAPES) {
    const count = worn.reduce((sum, s) => (s === shape ? sum + 1 : sum), 0)
    if (count === 0) continue
    const mesh = new InstancedMesh(shapes[shape], material, count)
    for (let n = 0, i = 0; n < kinds.length; n++) {
      if (worn[n] !== shape) continue
      // Out of leaf no kind's green tint applies.
      const tints = shape === shapeOf(kinds[n]!, "leafy") ? TINTS_OF[kinds[n]!] : TINTS
      const x = trees[4 * n]!,
        y = trees[4 * n + 1]!,
        scale = trees[4 * n + 2]!,
        seed = trees[4 * n + 3]!
      rotation.setFromAxisAngle(up, hash01(seed, 5) * Math.PI * 2)
      const s = sizeOf(seed, scale)
      mesh.setMatrixAt(i, matrix.compose(at.set(x, base(x, y), -y), rotation, size.set(s, s, s)))
      mesh.setColorAt(i++, tints[Math.floor(hash01(seed, 13) * tints.length)]!)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere() // after setMatrixAt, or culling keeps a stale sphere
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    meshes.push(mesh)
  }
  return meshes
}
