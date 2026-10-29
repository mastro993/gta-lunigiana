/**
 * Street lamps: wall-mounted lanterns on the houses along village streets. The map has no lamp data
 * (two `street_lamp` nodes in the raw OSM), so they are placed here, deterministically from `MAP`:
 * along tertiary, unclassified, residential and service roads, every ≈ 28 m where a house wall
 * fronts the road within 6 m of the carriageway (the road point lies square in front of it) and at
 * least four buildings stand within 40 m (a village, not a lone farmhouse). Each lantern hangs
 * 0.6 m out from the wall, its bracket 4.5 m up, between two windows, in the open (not inside a
 * neighbour's house). A lamp is drawn into its chunk like any static piece: bracket, cap, body and
 * foot solid, the glass in the glow layer (lit at night, not drawn by day, when the dark body inside
 * it shows). `lampsIn` finds them for the night lights.
 *
 * @module render/sky/lamps
 */
import { pointInRing, staticGrid } from "../../sim/collide.ts"
import {
  buildingBoxes,
  buildingsIn,
  buildingStyleOf,
  MAP,
  ROAD_CLASSES,
  roadClassOf,
  type RoadClass,
} from "../../sim/map/index.ts"
import { eaveOf, windowCount } from "../buildings.ts"
import type { Piece, Sink } from "../geometry.ts"
import { groundY, terrainY } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { block } from "../ribbons.ts"
import { platformLamps } from "../stations.ts"

/** A street lamp: where its lantern hangs, which way it faces and what holds it. */
export interface StreetLamp {
  /** The lantern's centre, map metres. */
  readonly x: number
  readonly y: number
  /** The lantern's centre, render y. */
  readonly h: number
  /** Unit direction from what holds it out to the lantern (a wall's toward the street, a pole's toward the track), map frame. */
  readonly nx: number
  readonly ny: number
  /** A lantern on a house wall's bracket, or on a platform pole's (render/stations) the same `ARM` out from its top. */
  readonly kind: "wall" | "pole"
}

/** Road classes lit where houses line them. */
const LIT: ReadonlySet<RoadClass> = new Set(["tertiary", "unclassified", "residential", "service"])
/** Metres between the points tried along a road. */
const STEP = 3
/** Metres along a road between its lamps. */
const SPACING = 28
/** No two lamps closer than this, m (junctions, roads side by side). */
const GAP = 18
/** Farthest a holding wall stands from the carriageway's edge, m; nearest is 0.3 m inside it (a house on the kerb). */
const REACH = { out: 6, in: 0.3 } as const
/** A village: at least this many buildings within this radius (m) of the lamp. */
const VILLAGE = { radius: 40, buildings: 4 } as const
/** Bracket height over the ground outside the wall, m; a lower house takes it 0.4 m under its eaves, down to 3 m. */
const MOUNT = { height: 4.5, lowest: 3, eaves: 0.4 } as const
/** How far the lantern's centre stands out from the wall or the pole, m, and hangs under the bracket. */
const ARM = 0.6
const HANG = 0.3
/** Room kept from a wall's corners, m. */
const CORNER = 0.4

/**
 * Where along a wall `len` m long, nearest `s`, a lantern may hang: between two windows (or at a
 * wall's end, CORNER from the corner), never over one; any point of a wall too short for windows.
 */
const between = (len: number, s: number): number => {
  const count = windowCount(len)
  if (count === 0) return Math.min(len - CORNER, Math.max(CORNER, s))
  const k = Math.min(count, Math.max(0, Math.round((s * count) / len)))
  return Math.min(len - CORNER, Math.max(CORNER, (k * len) / count))
}

/** Whether at least VILLAGE.buildings buildings have their box centre within VILLAGE.radius of (x, y). */
const inVillage = (x: number, y: number): boolean => {
  let n = 0
  const r = VILLAGE.radius
  buildingsIn(x - r, y - r, x + r, y + r, (i) => {
    const [x0, y0, x1, y1] = buildingBoxes[i]!
    if (Math.hypot((x0 + x1) / 2 - x, (y0 + y1) / 2 - y) <= r) n++
  })
  return n >= VILLAGE.buildings
}

/** Whether (x, y) lies inside any building's footprint. */
const indoors = (x: number, y: number): boolean => {
  let inside = false
  buildingsIn(x, y, x, y, (i) => {
    if (!inside && pointInRing(x, y, MAP.buildings[i]!.outer)) inside = true
  })
  return inside
}

/** Lamps the walls fronting road point (px, py) could hold, with each wall's distance from it. */
const mounts = (
  px: number,
  py: number,
  half: number,
): Array<{ readonly lamp: StreetLamp; readonly d: number }> => {
  const found: Array<{ readonly lamp: StreetLamp; readonly d: number }> = []
  const r = half + REACH.out
  buildingsIn(px - r, py - r, px + r, py + r, (i) => {
    const b = MAP.buildings[i]!
    if (buildingStyleOf(b) === "ruin") return
    const ring = b.outer,
      n = ring.length / 2
    let eave: number | undefined
    for (let k = 0; k < n; k++) {
      const ax = ring[2 * k]!,
        ay = ring[2 * k + 1]!,
        bx = ring[(2 * k + 2) % ring.length]!,
        by = ring[(2 * k + 3) % ring.length]!
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 2 * CORNER) continue
      // The wall fronts the road point: the point lies outside it (outer rings are counter-clockwise,
      // so the outside is to the right of travel) and its foot on the wall is clear of the corners.
      const tx = (bx - ax) / len,
        ty = (by - ay) / len,
        nx = ty,
        ny = -tx
      const along = (px - ax) * tx + (py - ay) * ty,
        d = (px - ax) * nx + (py - ay) * ny
      if (along < CORNER || along > len - CORNER || d < half - REACH.in || d > r) continue
      const s = between(len, along),
        wx = ax + tx * s,
        wy = ay + ty * s
      const ground = terrainY(wx + nx, wy + ny)
      eave ??= eaveOf(b)
      const bracket = Math.min(ground + MOUNT.height, eave - MOUNT.eaves)
      if (bracket - ground >= MOUNT.lowest)
        found.push({
          lamp: { x: wx + nx * ARM, y: wy + ny * ARM, h: bracket - HANG, nx, ny, kind: "wall" },
          d,
        })
    }
  })
  return found
}

/**
 * The lamp of the nearest wall fronting road point (px, py) whose lantern hangs in the open: the
 * lantern and the ground 1 m out from the wall lie in no house (a party wall has a neighbour there).
 */
const mountNear = (px: number, py: number, half: number): StreetLamp | undefined =>
  mounts(px, py, half)
    .sort((a, b) => a.d - b.d)
    .find(
      ({ lamp }) =>
        !indoors(lamp.x, lamp.y) &&
        !indoors(lamp.x + lamp.nx * (1 - ARM), lamp.y + lamp.ny * (1 - ARM)),
    )?.lamp

/**
 * Every street lamp of the map, placed road by road (widest class first, then map order), so the
 * same map always gives the same lamps.
 */
export const placeLamps = (): Array<StreetLamp> => {
  const lamps: Array<StreetLamp> = []
  const cells = new Map<number, Array<StreetLamp>>()
  const cellOf = (cx: number, cy: number) => cx * 100003 + cy
  const crowded = (x: number, y: number): boolean => {
    const cx = Math.floor(x / GAP),
      cy = Math.floor(y / GAP)
    for (let j = cy - 1; j <= cy + 1; j++)
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const l of cells.get(cellOf(i, j)) ?? [])
          if (Math.hypot(l.x - x, l.y - y) < GAP) return true
      }
    return false
  }
  const roads = MAP.roads.filter((r) => r.tunnel !== true && LIT.has(roadClassOf(r)))
  roads.sort((a, b) => ROAD_CLASSES.indexOf(roadClassOf(a)) - ROAD_CLASSES.indexOf(roadClassOf(b)))
  for (const road of roads) {
    const pts = road.pts
    // `s`: where the next point falls along the current segment (the step carries over its vertices).
    let since = SPACING,
      s = 0
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!,
        ay = pts[k + 1]!,
        len = Math.hypot(pts[k + 2]! - ax, pts[k + 3]! - ay)
      for (; s < len; s += STEP, since += STEP) {
        if (since < SPACING) continue
        const px = ax + ((pts[k + 2]! - ax) * s) / len,
          py = ay + ((pts[k + 3]! - ay) * s) / len
        const lamp = mountNear(px, py, road.w / 2)
        if (lamp === undefined || crowded(lamp.x, lamp.y) || !inVillage(lamp.x, lamp.y)) continue
        lamps.push(lamp)
        const key = cellOf(Math.floor(lamp.x / GAP), Math.floor(lamp.y / GAP))
        cells.set(key, [...(cells.get(key) ?? []), lamp])
        since = 0
      }
      s -= len
    }
  }
  return lamps
}

let placed: ReadonlyArray<StreetLamp> | undefined
/**
 * Every lamp: the wall lanterns (`placeLamps()`) and the platforms' pole lamps (`platformLamps()`), placed on first use and
 * shared (the world's chunks and the night lights read the same list); never write to it.
 */
export const streetLamps = (): ReadonlyArray<StreetLamp> =>
  (placed ??= [
    ...placeLamps(),
    ...platformLamps().map(({ x, y, h, nx, ny }) => ({
      x: x + nx * ARM,
      y: y + ny * ARM,
      h,
      nx,
      ny,
      kind: "pole" as const,
    })),
  ])

let grid: ReturnType<typeof staticGrid> | undefined
/**
 * Lamp broad phase (`staticGrid`, 32 m cells): calls `visit` with the index into `streetLamps()`
 * of every lamp in a cell the box overlaps; run the exact test. `visit` must not query again.
 */
export const lampsIn = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (lamp: number) => void,
): void => {
  const lamps = streetLamps()
  grid ??= staticGrid(lamps.length, (i) => [lamps[i]!.x, lamps[i]!.y, lamps[i]!.x, lamps[i]!.y], 32)
  grid(minX, minY, maxX, maxY, visit)
}

/** Half sizes of the lantern's glass, m (out, up, across); its solid body stands 2 cm inside it. */
const GLASS = { out: 0.14, up: 0.18, side: 0.14 } as const

/**
 * One lamp into a chunk: the iron bracket from the wall, or the grey steel pole (standing on the ground under it, a
 * platform's top) and the bracket from its top, the lantern's cap, body and foot (solid), its glass (glow). By day the glass is not drawn and the dark body
 * keeps the lantern whole; at night the glass covers it.
 */
const drawLamp = (sink: Sink, lamp: StreetLamp): void => {
  const x = lamp.x,
    z = -lamp.y,
    ux = lamp.nx,
    uz = -lamp.ny,
    top = lamp.h + HANG,
    iron = PALETTE.lanternIron,
    holder = lamp.kind === "pole" ? PALETTE.signalPole : iron
  if (lamp.kind === "pole") {
    const px = x - ux * ARM,
      pz = z - uz * ARM,
      foot = groundY(px, -pz)
    block(
      sink.solid,
      px,
      (foot + top + 0.12) / 2,
      pz,
      ux,
      uz,
      0.06,
      (top + 0.12 - foot) / 2,
      0.06,
      holder,
    )
  }
  block(
    sink.solid,
    x - ux * (ARM / 2),
    top + 0.06,
    z - uz * (ARM / 2),
    ux,
    uz,
    ARM / 2 + 0.06,
    0.06,
    0.06,
    holder,
  )
  block(sink.solid, x, lamp.h + 0.23, z, ux, uz, 0.19, 0.05, 0.19, iron)
  block(
    sink.solid,
    x,
    lamp.h,
    z,
    ux,
    uz,
    GLASS.out - 0.02,
    GLASS.up,
    GLASS.side - 0.02,
    PALETTE.windowGlass,
  )
  block(sink.solid, x, lamp.h - 0.22, z, ux, uz, 0.1, 0.04, 0.1, iron)
  block(sink.glow, x, lamp.h, z, ux, uz, GLASS.out, GLASS.up, GLASS.side, PALETTE.lampLight)
}

/** Every lamp as a piece anchored at its lantern (it goes whole into that chunk, its pole too). */
export const lampPieces = (): Array<Piece> =>
  streetLamps().map((lamp) => ({
    pts: [lamp.x, lamp.y],
    draw: (at) => drawLamp(at(lamp.x, lamp.y), lamp),
  }))
