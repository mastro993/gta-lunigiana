/**
 * Roads and rivers as pieces the streamed world draws chunk by chunk: ribbons along their
 * polylines (render/ribbons), densified so they follow the terrain facets, in the decal layer and
 * rivers in the water layer, and the decks under road bridges. The track is in render/rail.
 *
 * @module render/lines
 */
import { ROAD_LIFT } from "../sim/map/ground.ts"
import { MAP, roadClassOf, type Road } from "../sim/map/index.ts"
import { channelOf, reachOf } from "../sim/water/channel.ts"
import type { Flowing, Piece, SinkAt } from "./geometry.ts"
import { surfaceY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { prism, type RibbonSpec, strips, throughApron } from "./ribbons.ts"
import { underPanel } from "./track-index.ts"

/** Deck slab under segments k0..k1 of a bridge and a low parapet along each side. */
const bridge = (
  at: SinkAt,
  pts: ReadonlyArray<number>,
  y: (k: number) => number,
  width: number,
  hex: number,
  k0: number,
  k1: number,
): void => {
  for (let k = 2 * k0; k <= 2 * k1 && k + 3 < pts.length; k += 2) {
    const ax = pts[k]!,
      ay = pts[k + 1]!,
      bx = pts[k + 2]!,
      by = pts[k + 3]!
    const tris = at((ax + bx) / 2, (ay + by) / 2).solid
    const ya = y(k / 2),
      yb = y(k / 2 + 1)
    prism(tris, ax, ay, ya, bx, by, yb, 0, width + 0.8, -0.9, -0.05, hex)
    for (const side of [-1, 1])
      prism(tris, ax, ay, ya, bx, by, yb, side * (width / 2 + 0.25), 0.35, -0.1, 0.8, hex)
  }
}

/** The surface colour of a road. */
export const roadHex = (road: Road): number => {
  const cls = roadClassOf(road)
  if (cls === "steps") return PALETTE.stoneLight
  switch (road.surface) {
    case "asphalt":
      return cls === "service" || cls === "track" || cls === "path"
        ? PALETTE.asphaltWorn
        : PALETTE.asphalt
    case "cobblestone":
    case "pebblestone":
      return PALETTE.cobbleDark
    case "gravel":
      return PALETTE.stoneLight
    default:
      return PALETTE.dirtTrack
  }
}

/** Old masonry for small and historic bridges, concrete for the provincial roads. */
const bridgeHex = (road: Road): number => {
  const cls = roadClassOf(road)
  return cls === "tertiary" || cls === "unclassified" ? PALETTE.plasterGrey : PALETTE.stoneMid
}

/** A piece drawing the deck under a bridge whose deck top is `y(k)` at vertex k (roads here, the track in rail.ts). */
export const deck = (
  pts: ReadonlyArray<number>,
  y: (k: number) => number,
  width: number,
  hex: number,
): Piece => ({ pts, draw: (at, k0, k1) => bridge(at, pts, y, width, hex, k0, k1) })

/** Roads (with centre dashes on the provincial roads and decks on bridges); tunnels are not drawn. */
const roads = (): Array<Piece> =>
  MAP.roads.flatMap((road) => {
    if (road.tunnel === true) return []
    const cls = roadClassOf(road),
      lift = ROAD_LIFT[cls],
      lifted = road.bridge === true
    const line = throughApron(road.pts, road.z)
    const specs: Array<RibbonSpec> = [
      {
        ...line,
        width: road.w,
        hex: roadHex(road),
        y: (x, y, z) => surfaceY(z, x, y, lift, lifted),
      },
    ]
    if (cls === "tertiary") {
      specs.push({
        ...line,
        width: 0.25,
        hex: PALETTE.marbleWhite,
        dash: 3,
        y: (x, y, z) => surfaceY(z, x, y, lift + 0.02, lifted),
        // Not under a level crossing's panels, which lie as high over the road (render/rail).
        skip: underPanel,
      })
    }
    return [
      strips(line, specs),
      ...(lifted ? [deck(road.pts, (k) => yOf(road.z[k]!) + lift, road.w, bridgeHex(road))] : []),
    ]
  })

/**
 * Rivers and streams: a shallow ribbon over the whole bed, with a deeper channel down the middle of
 * the wide ones, laid flat on the bed (`channelOf`) for the shader to lift to the level the rivers
 * run at; the terrain above that level hides it, so in a spate the water spreads over the gravel.
 */
const water = (): Array<Piece> =>
  MAP.water.map((w) => {
    const ch = channelOf(w),
      n = w.pts.length / 2
    const flowing = Array.from({ length: n }, (_, i): Flowing => {
      const a = Math.max(0, i - 1),
        b = Math.min(n - 1, i + 1),
        dx = w.pts[2 * b]! - w.pts[2 * a]!,
        dy = w.pts[2 * b + 1]! - w.pts[2 * a + 1]!,
        l = Math.hypot(dx, dy) || 1
      return [ch.stage[i]!, dx / l, dy / l, ch.speed[i]!]
    })
    const line = throughApron(w.pts, Array.from(ch.bed), flowing)
    const spec = { pts: line.pts, z: line.z, flowing: line.along }
    return strips(spec, [
      {
        ...spec,
        width: 2 * reachOf(w),
        hex: PALETTE.waterShallow,
        y: (_x, _y, z) => yOf(z) + 0.02,
      },
      ...(w.w >= 8
        ? [
            {
              ...spec,
              width: w.w * 0.45,
              hex: PALETTE.waterDeep,
              y: (_x: number, _y: number, z: number) => yOf(z) + 0.04,
            },
          ]
        : []),
    ])
  })

/** Every road and river piece of the map, in draw order. */
export const linePieces = (): Array<Piece> => [...roads(), ...water()]
