// The check minimap.test.ts (Monzone's tile, against the tiles round it) and minimap.map-test.ts
// (two tiles, against the whole map) share: a tile's canvas, painted from only that tile's vectors,
// gets every fill and stroke a wider paint draws on it, in order and alike.
import assert from "node:assert/strict"

import type { MapLayers } from "../../render/map-style.ts"
import { MAP, type Road, TILE } from "../../sim/map/index.ts"
import { tileKey } from "../../sim/map/kinds.ts"
import type { Layer } from "../../sim/map/packed.ts"
import { isListed, tileVectors } from "../../sim/map/tiles.ts"
import { paintMap, tileLayers } from "../minimap.ts"

/** A stand-in for the browser's Path2D: it keeps the points it is given. */
class Points {
  readonly pts: Array<number> = []
  moveTo(x: number, y: number) {
    this.pts.push(x, y)
  }
  lineTo(x: number, y: number) {
    this.pts.push(x, y)
  }
  closePath() {}
}

/** A fill or stroke `paintMap` made: its points (canvas px) and the context's style then. */
interface Drawn {
  readonly pts: ReadonlyArray<number>
  readonly fill?: unknown
  readonly rule?: unknown
  readonly stroke?: unknown
  readonly width?: unknown
  readonly alpha?: unknown
}

/** The fills and strokes `paintMap` makes on a stand-in 2D context, in order, painting `layers` as tile (i, j)'s canvas. */
const painted = (i: number, j: number, layers: MapLayers<Road>): Array<Drawn> => {
  const drawn: Array<Drawn> = [],
    state: Record<string | symbol, unknown> = {}
  const ctx = new Proxy(
    {
      save: () => {},
      restore: () => {},
      clip: () => {},
      fill: (p: Points, rule?: string) =>
        drawn.push({ pts: p.pts, fill: state.fillStyle, rule: rule ?? "nonzero" }),
      stroke: (p: Points) =>
        drawn.push({
          pts: p.pts,
          stroke: state.strokeStyle,
          width: state.lineWidth,
          alpha: state.globalAlpha,
        }),
    },
    {
      set: (_, key, value) => {
        state[key] = value
        return true
      },
    },
  )
  Object.assign(globalThis, { Path2D: Points })
  paintMap(
    ctx as unknown as CanvasRenderingContext2D,
    0.3,
    { minX: i * TILE, maxY: (j + 1) * TILE },
    layers,
    {
      ox: 1,
      oy: 1,
    },
  )
  return drawn
}

/** A tile canvas's side, px. */
const SIDE = 602

/** Whether the box u0 … u1, v0 … v1 (px) grown by `pad` reaches the canvas. */
const reaches = (u0: number, v0: number, u1: number, v1: number, pad: number) =>
  u0 <= SIDE + pad && u1 >= -pad && v0 <= SIDE + pad && v1 >= -pad

/**
 * Whether a fill or stroke can colour a pixel of the canvas: a fill whose box reaches it (1 px of
 * antialiasing round it), a stroke with a segment whose box does, grown by its half width and 1 px.
 */
const drawsOn = ({ pts, width }: Drawn): boolean => {
  if (width === undefined) {
    const us = pts.filter((_, k) => k % 2 === 0),
      vs = pts.filter((_, k) => k % 2 === 1)
    return reaches(Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs), 1)
  }
  const pad = Number(width) / 2 + 1
  for (let k = 0; k + 3 < pts.length; k += 2)
    if (
      reaches(
        Math.min(pts[k]!, pts[k + 2]!),
        Math.min(pts[k + 1]!, pts[k + 3]!),
        Math.max(pts[k]!, pts[k + 2]!),
        Math.max(pts[k + 1]!, pts[k + 3]!),
        pad,
      )
    )
      return true
  return false
}

/** The features of `layers` (any order), each once, in the whole map's order. */
const merged = <T>(layers: ReadonlyArray<Layer<T>>): Layer<T> => {
  const byId = new Map<number, T>()
  for (const { ids, items } of layers) ids.forEach((id, k) => byId.set(id, items[k]!))
  const ids = [...byId.keys()].sort((a, b) => a - b)
  return { ids, items: ids.map((id) => byId.get(id)!) }
}

/**
 * The features of the listed tiles round tile (i, j) and of the tile itself, merged (every feature
 * within 2 km of its square), with every rail piece: what the tile's canvas would get without its
 * own cut.
 */
export const layersAround = (i: number, j: number): MapLayers<Road> => {
  const tiles = [-1, 0, 1].flatMap((dj) =>
    [-1, 0, 1].flatMap((di) =>
      isListed(i + di, j + dj) ? [tileVectors(tileKey(i + di, j + dj))] : [],
    ),
  )
  const roads = merged(tiles.map((t) => t.roads))
  return {
    outline: MAP.outline,
    areas: merged(tiles.map((t) => t.areas)).items,
    water: merged(tiles.map((t) => t.water)).items,
    rail: MAP.rail,
    roads: roads.ids.map((id, k) => ({ ...MAP.roads[id]!, ...roads.items[k]! })),
    buildings: merged(tiles.map((t) => t.buildings)).items,
  }
}

/**
 * Paints tile (i, j)'s canvas from its own vectors (`tileLayers`), and again from `wider` (more of
 * the map, or all of it), and checks the first draws every fill and stroke the second draws on the
 * canvas, in order and alike (points, colour, width, opacity), and little more; the tile holds a
 * village.
 */
export const checkTilePaint = (i: number, j: number, wider: MapLayers<Road>): void => {
  const all = painted(i, j, wider).filter(drawsOn)
  const near = painted(i, j, tileLayers(tileVectors(tileKey(i, j)), i, j))
  assert.ok(all.length > 500, `${i}_${j} holds the village`)
  assert.deepEqual(near.filter(drawsOn), all, `${i}_${j}`)
  assert.ok(near.length < 1.2 * all.length, `and little more: ${near.length} for ${all.length}`)
}
