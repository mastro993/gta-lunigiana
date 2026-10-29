/**
 * Buildings: footprints extruded from below the lowest ground to the eaves, terracotta hip roofs
 * (flat roofs on irregular footprints), wall colours by facade style and tint, and shuttered
 * windows plus a door painted on the walls. Half the windows of a home stand open: a glass pane in
 * the glow layer, dark by day and lit at night. Sheds, garages and barns keep their shutters closed.
 *
 * @module render/buildings
 */
import { ExtrudeGeometry, Path, Shape, Vector2 } from "three"

import { buildingStyleOf, MAP, type Building, type BuildingStyle } from "../sim/map/index.ts"
import { hash01 } from "../tools/geometry.ts"
import { boxOver, linear, paint, type Piece, type Sink, type Triangles } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { hasHipRoof, hipRise, hipRoof, type OrientedBox, orientedBox } from "./roof.ts"

/** Wall colour per style, indexed by the building's tint (0..3). */
const WALLS = {
  plaster: [PALETTE.plasterCream, PALETTE.plasterOchre, PALETTE.plasterPink, PALETTE.plasterGrey],
  stone: [PALETTE.stoneMid, PALETTE.stoneLight, PALETTE.stoneMid, PALETTE.plasterGrey],
  church: [PALETTE.stoneLight, PALETTE.plasterCream, PALETTE.marbleWhite, PALETTE.stoneLight],
  tower: [PALETTE.stoneLight, PALETTE.stoneLight, PALETTE.stoneMid, PALETTE.stoneLight],
  industrial: [PALETTE.plasterGrey, PALETTE.stoneLight, PALETTE.asphaltWorn, PALETTE.plasterGrey],
  station: [PALETTE.plasterOchre, PALETTE.plasterOchre, PALETTE.plasterOchre, PALETTE.plasterOchre],
  ruin: [PALETTE.stoneDark, PALETTE.stoneMid, PALETTE.stoneDark, PALETTE.stoneDark],
} as const satisfies Record<BuildingStyle, readonly [number, number, number, number]>

/** Whether a style gets shuttered windows and a door. */
const WINDOWS = {
  plaster: true,
  stone: true,
  church: false,
  tower: false,
  industrial: false,
  station: true,
  ruin: false,
} as const satisfies Record<BuildingStyle, boolean>

/** The roof colour of a building (weathered terracotta varies house to house; sheds are concrete, ruins open). */
const roofHex = (building: Building): number => {
  const style = buildingStyleOf(building)
  if (style === "industrial") return PALETTE.plasterGrey
  if (style === "ruin") return PALETTE.stoneMid
  return hash01(building.id, 7) < 0.3 ? PALETTE.roofTileLight : PALETTE.roofTile
}

const STOREY = 3
/** Share of windows standing open: a glass pane over the shutter, dark by day and lit at night. */
const OPEN = 0.5
/** Share of the lit windows in amber light rather than warm white. */
const AMBER = 0.3
/** Kinds nobody lives in (CTR sheds, garages, barns, building sites and greenhouses; OSM farm outbuildings): no window of theirs stands open or lights up at night. */
const SHUTTERED = new Set([
  "shed",
  "garage",
  "barn",
  "farm_auxiliary",
  "construction",
  "greenhouse",
])

/** Windows along a wall `len` m long: none under 2.5 m, else one per 3.2 m (at least one), centred at (w + 0.5) · len / count. */
export const windowCount = (len: number): number =>
  len < 2.5 ? 0 : Math.max(1, Math.floor(len / 3.2))

/**
 * Shutters (0.9 × 1.2 m) on every storey of each wall at least 2.5 m long, and a door on the
 * longest wall; an open window of a home adds its glass pane (0.56 × 0.9 m, just in front) to the
 * glow layer.
 */
const windows = (sink: Sink, b: Building, eave: number): void => {
  const ring = b.outer,
    n = ring.length / 2,
    home = !SHUTTERED.has(b.kind)
  const shutter = hash01(b.id, 3) < 0.6 ? PALETTE.shutterGreen : PALETTE.woodBrown
  let longest = 0,
    door = -1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      len = Math.hypot(ring[2 * j]! - ring[2 * i]!, ring[2 * j + 1]! - ring[2 * i + 1]!)
    if (len > longest) [longest, door] = [len, i]
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = ring[2 * i]!,
      ay = ring[2 * i + 1]!,
      bx = ring[2 * j]!,
      by = ring[2 * j + 1]!
    const len = Math.hypot(bx - ax, by - ay),
      count = windowCount(len)
    if (count === 0) continue
    const dx = (bx - ax) / len,
      dy = (by - ay) / len
    const ground = terrainY(ax + (bx - ax) / 2 + dy, ay + (by - ay) / 2 - dx)
    // Outer rings are counter-clockwise, so the outside is to the right of travel: (dy, -dx).
    const quad = (
      tris: Triangles,
      s: number,
      half: number,
      low: number,
      high: number,
      out: number,
      hex: number,
    ) => {
      const px = ax + dx * (s - half) + dy * out,
        py = ay + dy * (s - half) - dx * out
      const qx = ax + dx * (s + half) + dy * out,
        qy = ay + dy * (s + half) - dx * out
      tris.face([px, low, -py], [qx, low, -qy], [qx, high, -qy], [px, high, -py], [dy, 0, dx], hex)
    }
    for (let w = 0; w < count; w++) {
      const s = ((w + 0.5) * len) / count
      for (let y = ground + 1, storey = 0; y + 1.2 < eave - 0.5; y += STOREY, storey++) {
        if (i === door && w === Math.floor(count / 2) && storey === 0) {
          quad(sink.solid, s, 0.6, ground, ground + 2.1, 0.05, PALETTE.woodBrown)
          continue
        }
        quad(sink.solid, s, 0.45, y, y + 1.2, 0.05, shutter)
        const open = hash01(b.id, i, w, storey)
        if (home && open < OPEN)
          quad(
            sink.glow,
            s,
            0.28,
            y + 0.15,
            y + 1.05,
            0.08,
            open < OPEN * AMBER ? PALETTE.windowAmber : PALETTE.windowLit,
          )
      }
    }
  }
}

/**
 * Render y of a building's eaves: its wall height over its lowest ground, raised where the uphill
 * side would bury them (downhill facades grow), but no more than 6 m of slope: past that (terraces,
 * castle blocks) the building digs into the hill instead of becoming a tower.
 */
export const eaveOf = (b: Building): number => {
  let highest = -Number.MAX_VALUE
  for (let k = 0; k + 1 < b.outer.length; k += 2)
    highest = Math.max(highest, terrainY(b.outer[k]!, b.outer[k + 1]!))
  return Math.max(yOf(b.z0) + b.h, Math.min(highest, yOf(b.z0) + 6) + 2.5)
}

/** Whether `b` takes a hip roof over `box` (its footprint's `orientedBox`); the rest have flat roofs. */
const hipRoofed = (b: Building, box: OrientedBox): boolean => {
  const style = buildingStyleOf(b)
  return (
    style !== "industrial" && style !== "ruin" && b.holes === undefined && hasHipRoof(b.outer, box)
  )
}

/** Render y of a building's highest point: its ridge, or its eaves under a flat roof. */
export const topOf = (b: Building): number => {
  const box = orientedBox(b.outer)
  return eaveOf(b) + (hipRoofed(b, box) ? hipRise(box) : 0)
}

/** One building as walls (an extrusion) plus roof and windows added to `sink`. */
const building = (sink: Sink, b: Building) => {
  const style = buildingStyleOf(b)
  const points: Array<Vector2> = []
  for (let k = 0; k + 1 < b.outer.length; k += 2)
    points.push(new Vector2(b.outer[k], b.outer[k + 1]))
  const shape = new Shape(points)
  for (const hole of b.holes ?? []) {
    const path: Array<Vector2> = []
    for (let k = 0; k + 1 < hole.length; k += 2) path.push(new Vector2(hole[k], hole[k + 1]))
    shape.holes.push(new Path(path))
  }
  const base = yOf(b.z0) - 0.5
  const eave = eaveOf(b)
  const walls = new ExtrudeGeometry(shape, { depth: eave - base, bevelEnabled: false })
  walls.rotateX(-Math.PI / 2) // (east, north, up) -> (east, up, -north)
  walls.translate(0, base, 0)
  const painted = paint(walls, WALLS[style][b.tint & 3]!)
  const box = orientedBox(b.outer)
  if (hipRoofed(b, box)) hipRoof(sink.solid, box, eave, roofHex(b))
  else recolourTop(painted, roofHex(b))
  if (WINDOWS[style]) windows(sink, b, eave)
  return painted
}

/** Paints the up-facing cap of an extrusion (a flat roof). */
const recolourTop = (g: ReturnType<typeof paint>, hex: number): void => {
  const normal = g.getAttribute("normal"),
    color = g.getAttribute("color")
  const [r, gg, bb] = linear(hex)
  for (let i = 0; i < normal.count; i++) if (normal.getY(i) > 0.5) color.setXYZ(i, r, gg, bb)
}

/** Every building as a piece anchored at its first vertex (it goes whole into that chunk), reading the ground round its footprint. */
export const buildingPieces = (): Array<Piece> =>
  MAP.buildings.map((b) => ({
    pts: [b.outer[0]!, b.outer[1]!],
    reads: boxOver(b.outer),
    draw: (at) => {
      const sink = at(b.outer[0]!, b.outer[1]!)
      sink.pieces.push(building(sink, b))
    },
  }))
