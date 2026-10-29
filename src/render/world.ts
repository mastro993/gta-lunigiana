/**
 * The static world, streamed around the camera focus in the chunks of render/chunks. A built
 * chunk is one terrain mesh, one solid mesh (buildings, roofs, bridges, platforms, street-lamp
 * brackets), one decal mesh (roads, rail), one water mesh (rivers and streams), one glow mesh
 * (window panes and lantern glass, lit at night) and an InstancedMesh per tree kind; empty layers
 * make no mesh. Pieces are bucketed per chunk once, so a build reads only its own; trees are
 * bucketed per chunk as each map tile comes into memory (`tileProvided`). Streaming has two levels:
 * the tiles are planned first, by the screen distance of their boxes, then the chunks of the tiles
 * in reach, so a frame's cost does not grow with the map. A chunk builds once every tile its build
 * reads is in (render/chunk-tiles). Dynamic actors are not here (see render/index.ts).
 *
 * @module render/world
 */
import {
  InstancedMesh,
  Mesh,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Vector3,
} from "three"

import { buildingPieces } from "./buildings.ts"
import { chunkTiles } from "./chunk-tiles.ts"
import {
  CHUNKS,
  chunkOf,
  exactBox,
  plan,
  radiiFor,
  screenDistance,
  screenDistances,
  screenRects,
} from "./chunks.ts"
import {
  decalMaterial,
  merge,
  solidMaterial,
  terrainMaterial,
  treeMaterial,
  Triangles,
  WaterTriangles,
  waterMaterial,
  type Piece,
  type Sink,
} from "./geometry.ts"
import { linePieces } from "./lines.ts"
import { BEHIND, viewAxes } from "./pipeline.ts"
import { railPieces } from "./rail.ts"
import { glowMaterial } from "./sky/glow.ts"
import { lampPieces } from "./sky/lamps.ts"
import { stationPieces } from "./stations.ts"
import { terrainChunk } from "./terrain.ts"
import { bucketTileTrees, chunkTrees, treeMeshes } from "./trees.ts"

const staticMesh = (
  geometry: BufferGeometry,
  material: Material,
  cast: boolean,
  receive = true,
): Mesh => {
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = cast
  mesh.receiveShadow = receive
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}

const emptySink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})

/**
 * Pieces per chunk key: flat (piece, k0, k1) triples, k0..k1 being the piece's segments whose
 * bounding box reaches the chunk (a one-point piece has the one segment 0).
 */
export const bucketPieces = (pieces: ReadonlyArray<Piece>): Array<Array<number>> => {
  const chunks = Array.from({ length: CHUNKS.x * CHUNKS.y }, (): Array<number> => [])
  const range = new Map<number, [number, number]>()
  pieces.forEach((piece, p) => {
    range.clear()
    const pts = piece.pts,
      n = pts.length / 2
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        b = Math.min(k + 1, n - 1),
        bx = pts[2 * b]!,
        by = pts[2 * b + 1]!
      const lo = chunkOf(Math.min(ax, bx), Math.min(ay, by)),
        hi = chunkOf(Math.max(ax, bx), Math.max(ay, by))
      for (let cy = Math.floor(lo / CHUNKS.x); cy <= Math.floor(hi / CHUNKS.x); cy++) {
        for (let cx = lo % CHUNKS.x; cx <= hi % CHUNKS.x; cx++) {
          const key = cy * CHUNKS.x + cx,
            seen = range.get(key)
          if (seen === undefined) range.set(key, [k, k])
          else seen[1] = k
        }
      }
    }
    for (const [key, [k0, k1]] of range) chunks[key]!.push(p, k0, k1)
  })
  return chunks
}

/**
 * The streamed static world under `parent`; `update` it every frame with the camera focus. The
 * host hands it each map tile it takes into memory (`tileProvided`, after `provideTile`) and tells
 * it before letting one go (`tileDropped`, before `dropTile`); `wanted` says which tiles the chunks
 * in reach read.
 */
export class World {
  /** The meshes of every built chunk, by key. */
  readonly loaded = new Map<number, ReadonlyArray<Mesh>>()
  private readonly parent: Object3D
  private readonly lines = linePieces()
  private readonly pieces: ReadonlyArray<Piece> = [
    ...buildingPieces(),
    ...this.lines,
    ...railPieces(this.lines),
    ...stationPieces(),
    ...lampPieces(),
  ]
  private readonly byChunk = bucketPieces(this.pieces)
  private readonly tiles = chunkTiles(this.pieces, this.byChunk)
  /** Each chunk's box: from its tiles' lowest and highest nodes until its terrain is in, then exact (`exact`). */
  private readonly boxes = this.tiles.boxes.slice()
  private readonly exact = new Uint8Array(CHUNKS.x * CHUNKS.y)
  /** Per tile (index into `MAP.tiles`): its trees by chunk once the host has handed it over. */
  private readonly trees: Array<ReturnType<typeof bucketTileTrees> | undefined> =
    this.tiles.keys.map(() => undefined)
  private readonly tileRects = new Float32Array(this.tiles.keys.length * 4)
  private readonly tileDistances = new Float32Array(this.tiles.keys.length)
  /** This frame's screen distance of every chunk in reach and every built one. */
  private readonly distances = new Map<number, number>()
  private readonly wanting = new Set<string>()
  private axes = viewAxes(0)
  /** The view yaw `tileRects` were projected for. */
  private yaw = Number.NaN

  constructor(parent: Object3D) {
    this.parent = parent
  }

  /**
   * Streams around `focus` (three space) for a view turned `yaw` rad (see `PixelView.yaw`). `reach`
   * is how far from its centre the view shows, in screen metres (see `radiiFor`). Drops chunks
   * beyond the unload radius, then builds the missing ones within the load radius whose tiles are
   * all in, nearest first, until `budgetMs` is spent (always at least one).
   */
  update(focus: Vector3, yaw: number, reach: number, budgetMs: number): void {
    const { keys, needs, owned } = this.tiles
    if (yaw !== this.yaw) {
      this.axes = viewAxes(yaw)
      screenRects(this.tiles.tileBoxes, this.axes.right, this.axes.up, this.tileRects)
      this.yaw = yaw
    }
    const { right, up } = this.axes,
      r = focus.dot(right),
      u = focus.dot(up),
      radii = radiiFor(reach),
      distances = this.distances
    screenDistances(this.tileRects, r, u, this.tileDistances)
    distances.clear()
    this.wanting.clear()
    for (const key of this.loaded.keys())
      distances.set(key, screenDistance(this.boxes, key, right, up, r, u))
    for (const [t, chunks] of owned.entries()) {
      // A tile's box holds its chunks' boxes: none of them is nearer than it.
      if (!(this.tileDistances[t]! <= radii.load)) continue
      for (const key of chunks) {
        let d = screenDistance(this.boxes, key, right, up, r, u)
        if (d > radii.load) continue
        if (this.exact[key] === 0 && this.tiles.terrain[key]!.every(this.isIn)) {
          exactBox(this.boxes, key)
          this.exact[key] = 1
          d = screenDistance(this.boxes, key, right, up, r, u)
          if (d > radii.load) continue
        }
        // A chunk wholly behind the camera's near plane shows nowhere: built if its tiles are in (it may cast a shadow), but
        // never the reason to fetch one (the follow camera would swing such tiles in and out again and again).
        if (!this.behind(key, focus)) for (const n of needs[key]!) this.wanting.add(keys[n]!)
        if (!this.loaded.has(key) && needs[key]!.every(this.isIn)) distances.set(key, d)
      }
    }
    const { build, drop } = plan(distances, this.loaded, radii)
    for (const key of drop) this.drop(key)
    const start = performance.now()
    for (const key of build) {
      const meshes = this.build(key)
      this.parent.add(...meshes)
      this.loaded.set(key, meshes)
      if (performance.now() - start >= budgetMs) break
    }
  }

  /** Whether chunk `key`'s box lies wholly behind the near plane of the camera looking at `focus` (`BEHIND`). */
  private behind(key: number, focus: Vector3): boolean {
    const { back } = this.axes,
      b = this.boxes,
      k = 6 * key
    // Three space is (x, height, −y): the box corner nearest the camera along `back`.
    const nearest =
      Math.min(b[k]! * back.x, b[k + 1]! * back.x) +
      Math.min(b[k + 4]! * back.y, b[k + 5]! * back.y) +
      Math.min(-b[k + 2]! * back.z, -b[k + 3]! * back.z)
    return nearest > focus.dot(back) + BEHIND
  }

  /** The keys of the tiles the chunks within the load radius read and that show in the view (as far as their boxes are known yet), as of the last `update`; the next one changes it. */
  wanted(): ReadonlySet<string> {
    return this.wanting
  }

  /** Tile `key` is in memory (`provideTile`): buckets its trees, so the chunks it holds can build. */
  tileProvided(key: string): void {
    const t = this.tileIndex(key)
    this.trees[t] ??= bucketTileTrees(key)
  }

  /** Tile `key` is about to leave memory (`dropTile`): drops every built chunk that read it, and its trees. */
  tileDropped(key: string): void {
    const t = this.tileIndex(key)
    if (this.trees[t] === undefined) return
    for (const chunk of this.tiles.readers[t]!) if (this.loaded.has(chunk)) this.drop(chunk)
    this.trees[t] = undefined
  }

  /** Whether tile `t` has been handed over (and not let go since). */
  private readonly isIn = (t: number): boolean => this.trees[t] !== undefined

  private tileIndex(key: string): number {
    const t = this.tiles.index.get(key)
    if (t === undefined) throw new Error(`map tile ${key} is not on this map`)
    return t
  }

  /** Removes chunk `key`'s meshes from the scene and frees them. */
  private drop(key: number): void {
    for (const mesh of this.loaded.get(key) ?? []) {
      mesh.removeFromParent()
      // Tree shapes are shared by every chunk: an InstancedMesh frees only its instance buffers.
      if (mesh instanceof InstancedMesh) mesh.dispose()
      else mesh.geometry.dispose()
    }
    this.loaded.delete(key)
  }

  private build(key: number): Array<Mesh> {
    const sink = emptySink(),
      elsewhere = emptySink()
    const at = (x: number, y: number): Sink => (chunkOf(x, y) === key ? sink : elsewhere)
    const list = this.byChunk[key]!
    for (let n = 0; n < list.length; n += 3)
      this.pieces[list[n]!]!.draw(at, list[n + 1]!, list[n + 2]!)
    const meshes = [staticMesh(terrainChunk(key), terrainMaterial, false)]
    const solid = [...(sink.solid.empty ? [] : [sink.solid.geometry()]), ...sink.pieces]
    if (solid.length > 0) meshes.push(staticMesh(merge(solid), solidMaterial, true))
    if (!sink.decal.empty) meshes.push(staticMesh(sink.decal.geometry(), decalMaterial, false))
    if (!sink.water.empty) meshes.push(staticMesh(sink.water.geometry(), waterMaterial, false))
    // Unlit: it neither casts nor receives (an unlit program has no use for the shadow map).
    if (!sink.glow.empty) meshes.push(staticMesh(sink.glow.geometry(), glowMaterial, false, false))
    const trees = chunkTrees(this.tiles.needs[key]!.map((t) => this.trees[t]?.get(key)))
    return trees === undefined ? meshes : [...meshes, ...treeMeshes(trees, treeMaterial)]
  }
}
