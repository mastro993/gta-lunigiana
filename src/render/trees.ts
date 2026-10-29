/**
 * Trees: chestnut-like round canopies and a few conifers, one
 * InstancedMesh per kind per chunk, built when the chunk streams in. Trees near the map edge are
 * mirrored into the apron so the forest does not stop at the bounds. Each tree's look is drawn from
 * its seed, three times its index in the whole map's list (a mirror's one more), so a tree looks the
 * same whichever tile brought it. A `canopy` vertex attribute (1 on the crown, 0 on the trunk) tells
 * the tree material what sways in the wind.
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

import { MAP } from "../sim/map/index.ts"
import { tileTrees } from "../sim/map/tiles.ts"
import { hash01 } from "../tools/geometry.ts"
import { APRON, chunkOf } from "./chunks.ts"
import { merge, paint } from "./geometry.ts"
import { terrainY } from "./ground.ts"
import { PALETTE } from "./palette.ts"

const KINDS = ["broadleaf", "conifer"] as const
type TreeKind = (typeof KINDS)[number]

/** `piece` marked as crown (1: it sways rigidly in the wind) or trunk (0: it stays). */
const crown = (piece: BufferGeometry, sways: 0 | 1): BufferGeometry =>
  piece.setAttribute(
    "canopy",
    new Float32BufferAttribute(
      new Float32Array(piece.getAttribute("position").count).fill(sways),
      1,
    ),
  )

/** Each kind's crown at unit scale, m: its radius, its height and its centre's height over the trunk's base. */
const CROWN = {
  broadleaf: { radius: 3, height: 5, at: 4.2 },
  conifer: { radius: 2, height: 6.5, at: 4.2 },
} as const satisfies Record<TreeKind, { radius: number; height: number; at: number }>

/** Unit-scale tree shapes (≈ 7 m tall), trunk base at the origin; shared by every chunk. */
const shapes = {
  broadleaf: merge([
    crown(paint(new CylinderGeometry(0.22, 0.3, 2, 5).translate(0, 1, 0), PALETTE.woodBrown), 0),
    crown(
      paint(
        new IcosahedronGeometry(1, 0)
          .scale(CROWN.broadleaf.radius, CROWN.broadleaf.height / 2, CROWN.broadleaf.radius)
          .translate(0, CROWN.broadleaf.at, 0),
        PALETTE.forest,
      ),
      1,
    ),
  ]),
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
} as const satisfies Record<TreeKind, BufferGeometry>

/** Linear multipliers on the canopy colour: mid, sunlit, shaded. */
const TINTS = [new Color(1, 1, 1), new Color(1.35, 1.3, 1.1), new Color(0.75, 0.78, 0.72)] as const

/**
 * Share of conifers: conifer woods and half the mixed ones are 3% of the woodland around the valley
 * (Regione Toscana land cover 2019); the rest is chestnut and hop-hornbeam, then beech higher up.
 */
const CONIFERS = 0.03

/** The kind of the tree drawn from `seed`. */
const kindOf = (seed: number): TreeKind => (hash01(seed, 11) < CONIFERS ? "conifer" : "broadleaf")
/** The drawn scale of a tree of map scale `scale` drawn from `seed`. */
const sizeOf = (seed: number, scale: number): number => scale * (0.85 + 0.3 * hash01(seed, 9))
/** Render y of a tree's trunk base at (x, y): a little into the ground, so no slope shows under it. */
const baseY = (x: number, y: number): number => terrainY(x, y) - 0.2

/**
 * Whether the point (x, y) at render height `h` lies in the crown of the tree at (tx, ty) of map
 * scale `scale` and index `id` (as `treesIn` gives them): the broadleaf's ellipsoid, or the
 * conifer's cone, as drawn.
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
    s = sizeOf(seed, scale),
    kind = kindOf(seed),
    { radius, height, at } = CROWN[kind]
  const across = Math.hypot(x - tx, y - ty) / (radius * s),
    up = (h - baseY(tx, ty)) / s - at
  if (kind === "broadleaf") return across * across + ((2 * up) / height) ** 2 < 1
  // The cone narrows from its full radius at its base to nothing at its tip.
  return Math.abs(up) < height / 2 && across < 0.5 - up / height
}

/** One chunk's trees per kind: flat (x, y, scale, seed) quadruples, in seed order. */
type ChunkTrees = Readonly<Record<TreeKind, ArrayLike<number>>>

/**
 * The trees of tile `key` (in memory) bucketed by chunk and kind, each tree within the apron width
 * of a map edge with its mirror images across it: the whole map's buckets cut by tile.
 */
export const bucketTileTrees = (key: string): Map<number, ChunkTrees> => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  const reach = APRON * MAP.heightmap.cell
  const { trees, ids } = tileTrees(key)
  const chunks = new Map<number, Record<TreeKind, Array<number>>>()
  const visit = (x: number, y: number, scale: number, seed: number) => {
    const chunk = chunkOf(x, y)
    let bucket = chunks.get(chunk)
    if (bucket === undefined) chunks.set(chunk, (bucket = { broadleaf: [], conifer: [] }))
    bucket[kindOf(seed)].push(x, y, scale, seed)
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
  return new Map(
    [...chunks].map(([chunk, { broadleaf, conifer }]) => [
      chunk,
      { broadleaf: Float64Array.from(broadleaf), conifer: Float64Array.from(conifer) },
    ]),
  )
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
    merged =
      merged === undefined
        ? bucket
        : {
            broadleaf: mergeBySeed(merged.broadleaf, bucket.broadleaf),
            conifer: mergeBySeed(merged.conifer, bucket.conifer),
          }
  }
  return merged
}

const matrix = new Matrix4(),
  rotation = new Quaternion(),
  up = new Vector3(0, 1, 0),
  at = new Vector3(),
  size = new Vector3()
/**
 * The tree meshes of one chunk, one per kind it has, each tree's trunk base `base(x, y)` (render y;
 * a little into the terrain there by default). Dispose them with `InstancedMesh.dispose` (the shapes
 * are shared).
 */
export const treeMeshes = (
  trees: ChunkTrees,
  material: Material,
  base: (x: number, y: number) => number = baseY,
): Array<InstancedMesh> => {
  const meshes: Array<InstancedMesh> = []
  for (const kind of KINDS) {
    const list = trees[kind]
    if (list.length === 0) continue
    const mesh = new InstancedMesh(shapes[kind], material, list.length / 4)
    for (let i = 0; i < mesh.count; i++) {
      const x = list[4 * i]!,
        y = list[4 * i + 1]!,
        scale = list[4 * i + 2]!,
        seed = list[4 * i + 3]!
      rotation.setFromAxisAngle(up, hash01(seed, 5) * Math.PI * 2)
      const s = sizeOf(seed, scale)
      mesh.setMatrixAt(i, matrix.compose(at.set(x, base(x, y), -y), rotation, size.set(s, s, s)))
      mesh.setColorAt(i, TINTS[Math.floor(hash01(seed, 13) * TINTS.length)]!)
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
