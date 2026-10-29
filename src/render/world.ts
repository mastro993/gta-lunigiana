/**
 * The static world, streamed around the camera focus in the chunks of render/chunks. A built
 * chunk is one terrain mesh, one solid mesh (buildings, roofs, bridges, platforms, street-lamp
 * brackets), one decal mesh (roads, rail), one water mesh (rivers and streams), one glow mesh
 * (window panes and lantern glass, lit at night) and an InstancedMesh per tree kind; empty layers
 * make no mesh. Pieces and trees are bucketed
 * per chunk once, so a build reads only its own; the land cover is rasterised once for the whole
 * map (`mapCover`, shared with the audio host; ≈ 105 ms, 4.9 MB, cheaper than clipping areas per
 * chunk). Dynamic actors are not here (see render/index.ts).
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

import { mapCover } from "../sim/map/cover.ts"
import { buildingPieces } from "./buildings.ts"
import {
  chunkBoxes,
  CHUNKS,
  chunkOf,
  plan,
  radiiFor,
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
import { viewAxes } from "./pipeline.ts"
import { railPieces } from "./rail.ts"
import { glowMaterial } from "./sky/glow.ts"
import { lampPieces } from "./sky/lamps.ts"
import { stationPieces } from "./stations.ts"
import { terrainChunk } from "./terrain.ts"
import { bucketTrees, treeMeshes } from "./trees.ts"

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

/** The streamed static world under `parent`; `update` it every frame with the camera focus. */
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
  private readonly trees = bucketTrees()
  private readonly cover = mapCover()
  private readonly boxes = chunkBoxes()
  private readonly rects = new Float32Array(CHUNKS.x * CHUNKS.y * 4)
  private readonly distances = new Float32Array(CHUNKS.x * CHUNKS.y)
  private axes = viewAxes(0)
  /** The view yaw `rects` were projected for. */
  private yaw = Number.NaN

  constructor(parent: Object3D) {
    this.parent = parent
  }

  /**
   * Streams around `focus` (three space) for a view turned `yaw` rad (see `PixelView.yaw`). `reach`
   * is how far from its centre the view shows, in screen metres (see `radiiFor`). Drops chunks
   * beyond the unload radius, then builds the missing ones within the load radius, nearest first,
   * until `budgetMs` is spent (always at least one).
   */
  update(focus: Vector3, yaw: number, reach: number, budgetMs: number): void {
    if (yaw !== this.yaw) {
      this.axes = viewAxes(yaw)
      screenRects(this.boxes, this.axes.right, this.axes.up, this.rects)
      this.yaw = yaw
    }
    screenDistances(this.rects, focus.dot(this.axes.right), focus.dot(this.axes.up), this.distances)
    const { build, drop } = plan(this.distances, this.loaded, radiiFor(reach))
    for (const key of drop) {
      for (const mesh of this.loaded.get(key) ?? []) {
        mesh.removeFromParent()
        // Tree shapes are shared by every chunk: an InstancedMesh frees only its instance buffers.
        if (mesh instanceof InstancedMesh) mesh.dispose()
        else mesh.geometry.dispose()
      }
      this.loaded.delete(key)
    }
    const start = performance.now()
    for (const key of build) {
      const meshes = this.build(key)
      this.parent.add(...meshes)
      this.loaded.set(key, meshes)
      if (performance.now() - start >= budgetMs) break
    }
  }

  private build(key: number): Array<Mesh> {
    const sink = emptySink(),
      elsewhere = emptySink()
    const at = (x: number, y: number): Sink => (chunkOf(x, y) === key ? sink : elsewhere)
    const list = this.byChunk[key]!
    for (let n = 0; n < list.length; n += 3)
      this.pieces[list[n]!]!.draw(at, list[n + 1]!, list[n + 2]!)
    const meshes = [staticMesh(terrainChunk(key, this.cover), terrainMaterial, false)]
    const solid = [...(sink.solid.empty ? [] : [sink.solid.geometry()]), ...sink.pieces]
    if (solid.length > 0) meshes.push(staticMesh(merge(solid), solidMaterial, true))
    if (!sink.decal.empty) meshes.push(staticMesh(sink.decal.geometry(), decalMaterial, false))
    if (!sink.water.empty) meshes.push(staticMesh(sink.water.geometry(), waterMaterial, false))
    // Unlit: it neither casts nor receives (an unlit program has no use for the shadow map).
    if (!sink.glow.empty) meshes.push(staticMesh(sink.glow.geometry(), glowMaterial, false, false))
    const trees = this.trees.get(key)
    return trees === undefined ? meshes : [...meshes, ...treeMeshes(trees, treeMaterial)]
  }
}
