/**
 * Geometry plumbing and the lit materials shared by the world and actor builders. Everything is
 * non-indexed with exactly `position`, `normal` and `color` (linear), so any two pieces merge into
 * one draw call and get faceted normals; only the tree shapes add `canopy` (`trees.ts`: the crown
 * that sways). Each material is a surface-weather variant with its own program (`render/sky/surface`).
 *
 * @module render/geometry
 */
import { BufferGeometry, Color, Float32BufferAttribute, MeshLambertMaterial } from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { weatherMaterial } from "./sky/surface.ts"

/** Vertex colours, flat Lambert: the look of every lit mesh. */
const flat = (): MeshLambertMaterial =>
  new MeshLambertMaterial({ vertexColors: true, flatShading: true })
/** Flat Lambert pulled towards the camera in depth, so a decal never fights what it lies on. */
const decal = (): MeshLambertMaterial =>
  new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })

/** Buildings, bridges, platforms and the lamps' iron: snow, wet ground and cloud shadows (`render/sky/surface`); the see-through cut leaves their stubs. */
export const solidMaterial = weatherMaterial(flat(), "solid")
/** The terrain: the solid's weather, but the see-through cut takes only the ground that hides the player. */
export const terrainMaterial = weatherMaterial(flat(), "terrain")
/** Ground decals (roads, rail): half-cleared snow, wet ground and puddles that mirror the sky, cloud shadows. */
export const decalMaterial = weatherMaterial(decal(), "road")
/** Rivers and streams, a decal of their own: never snowed on or darkened by rain, ringed by raindrops, cloud shadows. */
export const waterMaterial = weatherMaterial(decal(), "water")
/** The trees (instanced): snow on the canopies' tops, wet, cloud shadows, canopies swaying by whole texels in the wind. */
export const treeMaterial = weatherMaterial(flat(), "tree")
/** People, animals and vehicles: cloud shadows only (no snow on a passer-by's head or a car's roof). */
export const actorMaterial = weatherMaterial(flat(), "actor")

const linearCache = new Map<number, readonly [number, number, number]>()
/** Linear RGB of an sRGB hex colour (vertex colours are linear). */
export const linear = (hex: number): readonly [number, number, number] => {
  let rgb = linearCache.get(hex)
  if (rgb === undefined) {
    const c = new Color(hex)
    rgb = [c.r, c.g, c.b]
    linearCache.set(hex, rgb)
  }
  return rgb
}

/** Grows flat-shaded, vertex-coloured triangles; `geometry()` hands them to three. */
export class Triangles {
  readonly position: Array<number> = []
  readonly normal: Array<number> = []
  readonly color: Array<number> = []

  /** One triangle (three-world coordinates), counter-clockwise seen from its front. */
  tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    hex: number,
  ): void {
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az,
      vx = cx - ax,
      vy = cy - ay,
      vz = cz - az
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= l
    ny /= l
    nz /= l
    const [r, g, b] = linear(hex)
    this.position.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    this.normal.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
    this.color.push(r, g, b, r, g, b, r, g, b)
  }

  /** A quad a-b-c-d (counter-clockwise seen from its front) as two triangles. */
  quad(a: Point3, b: Point3, c: Point3, d: Point3, hex: number): void {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], hex)
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], hex)
  }

  /** A quad wound so its front faces `outward` (any vector on the wanted side). */
  face(a: Point3, b: Point3, c: Point3, d: Point3, outward: Point3, hex: number): void {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2]
    const dot =
      (uy * vz - uz * vy) * outward[0] +
      (uz * vx - ux * vz) * outward[1] +
      (ux * vy - uy * vx) * outward[2]
    if (dot >= 0) this.quad(a, b, c, d, hex)
    else this.quad(d, c, b, a, hex)
  }

  /** Whether nothing was added. */
  get empty(): boolean {
    return this.position.length === 0
  }

  /** The triangles as a non-indexed BufferGeometry. */
  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute("position", new Float32BufferAttribute(this.position, 3))
    g.setAttribute("normal", new Float32BufferAttribute(this.normal, 3))
    g.setAttribute("color", new Float32BufferAttribute(this.color, 3))
    return g
  }
}

/** A three-world point. */
type Point3 = readonly [number, number, number]

/** A river vertex's own: its rise per unit stage (m: the depth at q^STAGE = 1), and its flow, map x east and y north (a unit vector) and its mean speed per unit (m/s). */
export type Flowing = readonly [stage: number, x: number, y: number, speed: number]

/**
 * Water's triangles: each vertex lies on the river's bed and carries how far its surface rises
 * (`stage`) and the way and speed it flows (`flow`), which the water shader turns into the level
 * and current the rivers run at (`render/sky/surface`).
 */
export class WaterTriangles extends Triangles {
  readonly stage: Array<number> = []
  readonly flow: Array<number> = []

  /** A quad a-b-c-d of water (counter-clockwise seen from above), each corner with its own `Flowing`. */
  waterQuad(
    a: Point3,
    b: Point3,
    c: Point3,
    d: Point3,
    hex: number,
    flowing: readonly [Flowing, Flowing, Flowing, Flowing],
  ): void {
    this.quad(a, b, c, d, hex)
    for (const k of [0, 1, 2, 0, 2, 3] as const) {
      const [stage, x, y, speed] = flowing[k]
      this.stage.push(stage)
      this.flow.push(x, y, speed)
    }
  }

  /** The triangles as a non-indexed BufferGeometry, with `stage` and `flow`. */
  override geometry(): BufferGeometry {
    const g = super.geometry()
    g.setAttribute("stage", new Float32BufferAttribute(this.stage, 1))
    g.setAttribute("flow", new Float32BufferAttribute(this.flow, 3))
    return g
  }
}

/** The per-chunk buckets static builders write into: merged into one mesh per material per chunk. */
export interface Sink {
  /** Opaque world geometry (terrain-like depth). */
  readonly solid: Triangles
  /** Ground decals (roads, rail) drawn with a polygon offset over what they cover. */
  readonly decal: Triangles
  /** Rivers and streams: decals with their own material (`waterMaterial`), so no snow lies on them; their level and current are the shader's. */
  readonly water: WaterTriangles
  /** Things that shine at night (window panes, lantern glass): dark glass by day, their vertex colour lit at night (`glowMaterial`). */
  readonly glow: Triangles
  /** Ready-made solid pieces (extrusions) merged with `solid`. */
  readonly pieces: Array<BufferGeometry>
}
/** The sink of the chunk holding map point (x, y). */
export type SinkAt = (x: number, y: number) => Sink

/**
 * A static item drawn chunk by chunk. `pts` is its anchor polyline (one point for a building);
 * `draw` emits segments k0..k1 of it, reading their neighbours for joints, and puts every
 * triangle in `at` of the point it belongs to, so a chunk keeps exactly its share.
 */
export interface Piece {
  readonly pts: ReadonlyArray<number>
  readonly draw: (at: SinkAt, k0: number, k1: number) => void
}

/** A three primitive (Box, Cylinder, Extrude...) as non-indexed position/normal/color in one colour. */
export const paint = (source: BufferGeometry, hex: number): BufferGeometry => {
  const g = source.index === null ? source : source.toNonIndexed()
  for (const name of Object.keys(g.attributes))
    if (name !== "position" && name !== "normal") g.deleteAttribute(name)
  if (g.getAttribute("normal") === undefined) g.computeVertexNormals()
  const [r, gg, b] = linear(hex)
  const n = g.getAttribute("position").count
  const color = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) color.set([r, gg, b], i * 3)
  g.setAttribute("color", new Float32BufferAttribute(color, 3))
  g.clearGroups()
  return g
}

/** One geometry from many painted pieces (throws instead of three's silent `null`). */
export const merge = (pieces: ReadonlyArray<BufferGeometry>): BufferGeometry => {
  const merged = mergeGeometries([...pieces])
  if (merged === null) throw new Error("mergeGeometries failed: attribute sets differ")
  return merged
}

const built = new Map<string, BufferGeometry>()
/** The geometry named `key` (a train car's, a crossing arm's), merged from `make`'s pieces the first time and shared for good (never disposed). */
export const sharedGeometry = (key: string, make: () => Array<BufferGeometry>): BufferGeometry => {
  let geometry = built.get(key)
  if (geometry === undefined) built.set(key, (geometry = merge(make())))
  return geometry
}
