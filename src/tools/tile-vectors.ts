// The vectors' part of the cut (tile-map.ts): which tiles hold each road line, river, barrier,
// building and area (every listed tile it comes within HALO of, whole, with its index in the whole
// map's list), what each tile's vectors are, and the global facts about them (the counts, the
// broad phases' lattice corners).
import type { MonzoneMap, Road } from "../sim/map/index.ts"
import { HALO, vergeOf, WATER_VERTICES } from "../sim/map/kinds.ts"
import type { TileVectors, VectorLayer } from "../sim/map/packed.ts"
import type { BuiltMap } from "./tile-map.ts"

/** No vectors: a tile's before the cut adds them. */
export const NO_VECTORS: TileVectors = {
  roads: { ids: [], items: [] },
  buildings: { ids: [], items: [] },
  water: { ids: [], items: [] },
  areas: { ids: [], items: [] },
  barriers: { ids: [], items: [] },
}

/** The vectors as the build makes them, whole (the water before its baked floors). */
type Vectors = Pick<BuiltMap, VectorLayer>

/** Calls `box` with the box of each segment of the flat polyline `pts` (of its one point, if it has one). */
const segmentBoxes = (
  pts: ReadonlyArray<number>,
  box: (x0: number, y0: number, x1: number, y1: number) => void,
): void => {
  if (pts.length === 2) box(pts[0]!, pts[1]!, pts[0]!, pts[1]!)
  for (let k = 0; k + 3 < pts.length; k += 2)
    box(
      Math.min(pts[k]!, pts[k + 2]!),
      Math.min(pts[k + 1]!, pts[k + 3]!),
      Math.max(pts[k]!, pts[k + 2]!),
      Math.max(pts[k + 1]!, pts[k + 3]!),
    )
}

/** The box of the flat ring (or polyline) `ring`: [minX, minY, maxX, maxY]. */
const boxOf = (ring: ReadonlyArray<number>): readonly [number, number, number, number] => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let k = 0; k + 1 < ring.length; k += 2) {
    x0 = Math.min(x0, ring[k]!)
    y0 = Math.min(y0, ring[k + 1]!)
    x1 = Math.max(x1, ring[k]!)
    y1 = Math.max(y1, ring[k + 1]!)
  }
  return [x0, y0, x1, y1]
}

/** Throws unless the road's carriageway and walkers' verge lie within the halo: a lookup at a point on them reads that point's tile alone (src/sim/map/ground.ts, surface.ts). */
const checkRoad = (road: Road): void => {
  const reach = Math.max(road.w / 2 + 0.5, (road.verge ?? vergeOf(road.cls, road.w)) + 0.5)
  if (reach > HALO)
    throw new Error(
      `road ${road.id} reaches ${reach} m off its centreline, past the ${HALO} m halo`,
    )
}

/**
 * Per slot of `slots`, the features of each layer it holds, in the whole map's order: every slot
 * `over` names for a box of the feature (a segment's, or an outer ring's) grown by HALO, and the
 * waterways of every river polygon a slot holds. Throws
 * where a road or a river reaches past the halo off its line (src/sim/water/rivers.ts reads a
 * river's bed at a point from that point's tile too).
 */
export const vectorMembers = (
  map: Vectors,
  slots: number,
  over: (x0: number, y0: number, x1: number, y1: number, add: (slot: number) => void) => void,
): Readonly<Record<VectorLayer, ReadonlyArray<ReadonlyArray<number>>>> => {
  map.roads.forEach(checkRoad)
  for (const w of map.water)
    if (Math.max(w.bed, w.w / 2) > HALO)
      throw new Error(
        `water ${w.id} reaches ${Math.max(w.bed, w.w / 2)} m off its centreline, past the ${HALO} m halo`,
      )
  const layer = (
    count: number,
    boxes: (item: number, box: (x0: number, y0: number, x1: number, y1: number) => void) => void,
  ) => {
    const lists = Array.from({ length: slots }, (): Array<number> => []),
      last = new Int32Array(slots).fill(-1)
    for (let item = 0; item < count; item++)
      boxes(item, (x0, y0, x1, y1) =>
        over(x0 - HALO, y0 - HALO, x1 + HALO, y1 + HALO, (s) => {
          if (last[s] === item) return
          last[s] = item
          lists[s]!.push(item)
        }),
      )
    return lists
  }
  const ring = (
    flat: ReadonlyArray<number>,
    box: (x0: number, y0: number, x1: number, y1: number) => void,
  ) => box(...boxOf(flat))
  const areas = layer(map.areas.length, (k, box) => ring(map.areas[k]!.rings[0] ?? [], box))
  // A river polygon's water is its waterways' (src/sim/water/rivers.ts): they lie in each tile it does.
  const water = layer(map.water.length, (k, box) => segmentBoxes(map.water[k]!.pts, box)).map(
    (list, s) => {
      const ways = areas[s]!.flatMap((k) => map.areas[k]!.waters ?? [])
      return ways.length === 0 ? list : [...new Set([...list, ...ways])].sort((a, b) => a - b)
    },
  )
  return {
    roads: layer(map.roads.length, (k, box) => segmentBoxes(map.roads[k]!.pts, box)),
    buildings: layer(map.buildings.length, (k, box) => ring(map.buildings[k]!.outer, box)),
    water,
    areas,
    barriers: layer(map.barriers.length, (k, box) => segmentBoxes(map.barriers[k]!.pts, box)),
  }
}

/** The vectors slot `slot` holds (`members`, from `vectorMembers`), each whole, the water's floors `floors` (baked: by water index). */
export const tileVectors = (
  map: Vectors,
  members: Readonly<Record<VectorLayer, ReadonlyArray<ReadonlyArray<number>>>>,
  slot: number,
  floors: ReadonlyArray<ReadonlyArray<number>>,
): TileVectors => {
  const layer = <T>(ids: ReadonlyArray<number>, item: (k: number) => T) => ({
    ids,
    items: ids.map(item),
  })
  return {
    roads: layer(members.roads[slot]!, (k) => ({ pts: map.roads[k]!.pts, z: map.roads[k]!.z })),
    buildings: layer(members.buildings[slot]!, (k) => map.buildings[k]!),
    water: layer(members.water[slot]!, (k) => ({ ...map.water[k]!, floor: floors[k] ?? [] })),
    areas: layer(members.areas[slot]!, (k) => map.areas[k]!),
    barriers: layer(members.barriers[slot]!, (k) => map.barriers[k]!),
  }
}

/**
 * The global file's facts about the vectors: the halo, each layer's count, and the corners of the
 * broad phases that answer box queries in the whole map's order where the whole map's broad phase
 * put them (the lowest corner of any building's box; the lowest water vertex, the rivers' sound's);
 * the origin for a layer with none. Throws for a water piece of more than `WATER_VERTICES` vertices
 * (a reach's sound is keyed by its piece and vertex, src/audio/places/water.ts).
 */
export const vectorFacts = (map: Vectors): MonzoneMap["vectors"] => {
  const lowest = (flats: ReadonlyArray<ReadonlyArray<number>>): readonly [number, number] => {
    let x = Infinity,
      y = Infinity
    for (const flat of flats) {
      const [x0, y0] = boxOf(flat)
      x = Math.min(x, x0)
      y = Math.min(y, y0)
    }
    return flats.length === 0 ? [0, 0] : [x, y]
  }
  for (const w of map.water)
    if (w.pts.length / 2 > WATER_VERTICES)
      throw new Error(`water ${w.id} has ${w.pts.length / 2} vertices, more than ${WATER_VERTICES}`)
  return {
    halo: HALO,
    counts: {
      roads: map.roads.length,
      buildings: map.buildings.length,
      water: map.water.length,
      areas: map.areas.length,
      barriers: map.barriers.length,
    },
    lattice: {
      buildings: lowest(map.buildings.map((b) => b.outer)),
      water: lowest(map.water.map((w) => w.pts)),
    },
  }
}
