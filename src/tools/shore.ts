// The shore (issue #13) from OSM and Regione Liguria's beaches (Spiagge, `readSpiagge` in ucs.ts),
// in local metres: the beaches as `sand`, `pebble` or `rock` areas, by their Spiagge polygon, else
// OSM's `surface`, else sand; Spiagge's own sand, pebbles and rocky shore, where OSM maps no beach
// (the coves under Montemarcello and Punta Bianca); the piers OSM maps as lines as paths on decks
// (`pierDeck`), and as areas, paved and raised to their deck's height; and the breakwaters and
// groynes as rock raised over the sea, walkable, with a drive wall along their outline. Areas are
// clipped to the built terrain's box, lines to the play area, as features.ts does. Only + − × ÷ and
// sqrt, so every architecture builds the same shore (`map-key.test.ts`).
import type { Area, Barrier } from "../sim/map/index.ts"
import { type AreaKind, ROADS } from "../sim/map/kinds.ts"
import { closed, isBuilding, lineVertices, ringOf, type RoadF } from "./features.ts"
import {
  boxesMeet,
  centroid,
  clipRing,
  crossings,
  flatLine,
  flatRing,
  type P,
  pointInRing,
  ringBox,
  TERRAIN_BOX,
  type V,
} from "./geometry.ts"
import { assembleRings, type Osm, type Tags } from "./osm.ts"
import { clipPieces, OUTLINE, type Piece } from "./play-area.ts"
import { type Beach, ucsAreas } from "./ucs.ts"

/** A pier's deck stands this high over the water under it (the sea's 0 m, a lake's level, a river's surface), m. */
export const PIER_DECK = 1
/** A breakwater's or a groyne's top, m a.s.l.: its rocks over the sea. */
export const BREAKWATER_TOP = 1.5
/** How wide a breakwater or a groyne OSM maps as a line stands, m. */
const BREAKWATER_WIDTH = 3.5
/** A mitre at a line's bend reaches at most this many half widths out (a hairpin's would run off). */
const MITRE = 2

/** Area kinds by Spiagge's physical character (`cod_caratt_fis`): its fills (106) and river courses (301, 302) are none. */
const SPIAGGE: Readonly<Record<string, AreaKind>> = {
  "102": "sand", // spiaggia sabbiosa
  "103": "pebble", // spiaggia ciottolosa
  "104": "rock", // battigia rocciosa
}

/** OSM `surface` values of a beach that is not sand. */
const SURFACE: Readonly<Record<string, AreaKind>> = {
  gravel: "pebble",
  fine_gravel: "pebble",
  pebblestone: "pebble",
  pebbles: "pebble",
  shingle: "pebble",
  rock: "rock",
  rocky: "rock",
}

/** Ground raised to `top` m a.s.l. under an area's rings in the tile pass (`raiseAreas` in water-areas.ts). */
export interface Raised {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly top: number
}

/** What the shore adds to the map. */
export interface Shore {
  /** The beaches, Spiagge's own, the piers' areas and the breakwaters, in that order. */
  readonly areas: Array<Area>
  /** The ground under the piers' areas and the breakwaters, raised. */
  readonly raised: Array<Raised>
  /** The piers mapped as lines, paths on decks. */
  readonly piers: Array<RoadF>
  /** A `breakwater` drive wall along every ring of every breakwater and groyne. */
  readonly barriers: Array<Barrier>
}

/** A polygon OSM maps: its tags and its rings in local metres, outer first, each open. */
interface Polygon {
  readonly tags: Tags
  readonly rings: ReadonlyArray<ReadonlyArray<P>>
}

/** The closed ways (no buildings) and multipolygons tagged as `keep` says, each outer ring with the inner ones inside it. */
const polygonsOf = (osm: Osm, keep: (t: Tags) => boolean): Array<Polygon> => [
  ...[...osm.ways.values()]
    .filter((w) => keep(w.tags) && closed(w) && !isBuilding(w.tags) && w.tags.area !== "no")
    .map((w) => ({ tags: w.tags, rings: [ringOf(osm, w.nds)] })),
  ...[...osm.relations.values()]
    .filter((rel) => rel.tags.type === "multipolygon" && keep(rel.tags) && !isBuilding(rel.tags))
    .flatMap((rel) => {
      const inners = assembleRings(osm, rel, "inner").map((r) => ringOf(osm, r))
      return assembleRings(osm, rel, "outer").map((r) => {
        const outer = ringOf(osm, r),
          flat = outer.flat()
        return {
          tags: rel.tags,
          rings: [outer, ...inners.filter((h) => pointInRing(h[0]![0], h[0]![1], flat))],
        }
      })
    }),
]

/** A polygon's rings as an area of `kind` clipped to the built terrain's box, or undefined when its outer ring is left with none. */
const areaOf = (kind: AreaKind, rings: ReadonlyArray<ReadonlyArray<P>>): Area | undefined => {
  const outer = flatRing(clipRing(rings[0]!, TERRAIN_BOX), true)
  if (outer === undefined) return undefined
  const holes = rings
    .slice(1)
    .map((h) => flatRing(clipRing(h, TERRAIN_BOX), false))
    .filter((h) => h !== undefined)
  return { kind, rings: [outer, ...holes] }
}

/** Whether (x, y) lies in a Spiagge polygon's rings, even-odd over them. */
const onBeach = ({ rings }: Beach, x: number, y: number): boolean => {
  let inside = false
  for (const ring of rings) if (pointInRing(x, y, ring.flat())) inside = !inside
  return inside
}

/** The side of the lattice (from the local origin) a beach is sampled on for its Spiagge material, m. */
const SAMPLE = 2

/**
 * A beach's kind: Spiagge's where the polygons of one of its materials (sand, pebbles, rocky shore)
 * hold at least half of the beach's points on a SAMPLE m lattice (its centre where none falls in
 * it), else its OSM `surface`'s, else sand. Read at its centre alone, OSM's untagged cove under
 * Montemarcello (way 68823662, 3,431 m², 79 % of it in Spiagge's pebbles), its centre outside the
 * cove, came out sand up a 3–5 m slope.
 */
const beachKind = (
  tags: Tags,
  outer: ReadonlyArray<P>,
  beaches: ReadonlyArray<Beach>,
): AreaKind => {
  const ring = outer.flat(),
    [x0, y0, x1, y1] = ringBox(ring)
  const near = beaches.filter(
    (b) =>
      SPIAGGE[b.code] !== undefined && boxesMeet(ringBox(b.rings[0]!.flat()), [x0, y0, x1, y1]),
  )
  const pts: Array<P> = []
  for (let y = (Math.floor(y0 / SAMPLE) + 0.5) * SAMPLE; y < y1; y += SAMPLE)
    for (let x = (Math.floor(x0 / SAMPLE) + 0.5) * SAMPLE; x < x1; x += SAMPLE)
      if (pointInRing(x, y, ring)) pts.push([x, y])
  if (pts.length === 0) pts.push(centroid(ring))
  const held = new Map<AreaKind, number>()
  for (const [x, y] of pts) {
    const under = near.find((b) => onBeach(b, x, y))
    if (under !== undefined)
      held.set(SPIAGGE[under.code]!, (held.get(SPIAGGE[under.code]!) ?? 0) + 1)
  }
  const [most] = [...held].sort((a, b) => b[1] - a[1])
  return most !== undefined && 2 * most[1] >= pts.length
    ? most[0]
    : (SURFACE[tags.surface ?? ""] ?? "sand")
}

/** A ring `2 · half` m wide round the open line `pts`: its left side out, its right side back, mitred at each bend, square at its ends. */
const buffered = (pts: ReadonlyArray<P>, half: number): Array<P> => {
  const normals = pts.slice(1).map(([x, y], k) => {
    const dx = x - pts[k]![0],
      dy = y - pts[k]![1],
      len = Math.sqrt(dx * dx + dy * dy)
    return [-dy / len, dx / len] as const
  })
  const offsets = pts.map((_, k) => {
    const a = normals[Math.max(0, k - 1)]!,
      b = normals[Math.min(normals.length - 1, k)]!
    const mx = a[0] + b[0],
      my = a[1] + b[1],
      along = mx * a[0] + my * a[1],
      reach = Math.sqrt(mx * mx + my * my) / Math.max(along, 1e-9)
    // The mitre's point, half m off both sides' edges; past MITRE half widths, pulled in to it.
    const scale = (half / Math.max(along, 1e-9)) * Math.min(1, MITRE / reach)
    return [mx * scale, my * scale] as const
  })
  return [
    ...pts.map(([x, y], k): P => [x + offsets[k]![0], y + offsets[k]![1]]),
    ...pts.map(([x, y], k): P => [x - offsets[k]![0], y - offsets[k]![1]]).reverse(),
  ]
}

/** How the shore's lines are cut: to the play area, as features.ts cuts the roads and barriers. */
type Clip = (pts: ReadonlyArray<V>) => Array<Piece>
const toPlay: Clip = (pts) => clipPieces(OUTLINE, pts)

/** Whether a way or a relation is a beach: OSM's `natural=beach`, `sand` or `dune`. */
const isBeach = (t: Tags) => t.natural === "beach" || t.natural === "sand" || t.natural === "dune"
/** Whether a way or a relation is a breakwater or a groyne. */
const isBreakwater = (t: Tags) => t.man_made === "breakwater" || t.man_made === "groyne"

/**
 * The shore of `osm` and of Liguria's `beaches` (`Shore`), its lines cut by `clip`: the beaches by
 * material (`beachKind`); Spiagge's sand, pebbles and rocky shore as areas; each pier OSM maps as an
 * open way and no road (a `highway` makes it one in `extractRoads`) a path on a deck, as wide as its
 * `width` tag says or a path; each closed one paved and raised to PIER_DECK; each breakwater and
 * groyne rock raised to BREAKWATER_TOP, a closed way or a multipolygon as drawn, an open way
 * BREAKWATER_WIDTH m wide along it, walled for vehicles along each of its rings.
 */
export const extractShore = (
  osm: Osm,
  beaches: ReadonlyArray<Beach>,
  clip: Clip = toPlay,
): Shore => {
  const sands = polygonsOf(osm, isBeach).flatMap(({ tags, rings }) => {
    const area = areaOf(beachKind(tags, rings[0]!, beaches), rings)
    return area === undefined ? [] : [area]
  })
  const spiagge = beaches.flatMap(({ code, rings }) => {
    const kind = SPIAGGE[code]
    return kind === undefined ? [] : ucsAreas(kind, rings[0]!, rings.slice(1))
  })
  const ways = [...osm.ways.values()]
  const piers = ways
    .filter((w) => w.tags.man_made === "pier" && w.tags.highway === undefined && !closed(w))
    .flatMap((w) => {
      const t = w.tags,
        width = Number.parseFloat(t.width ?? "")
      return clip(lineVertices(osm, w.nds)).map(({ pts }): RoadF => ({
        id: +w.id,
        cls: "path",
        ...(t.name ? { name: t.name } : {}),
        w: width > 0 ? width : ROADS.path.w,
        surface: t.surface ?? "wood",
        bridge: true,
        private: t.access === "private" || t.access === "no",
        pier: true,
        pts,
      }))
    })
  const decks = polygonsOf(osm, (t) => t.man_made === "pier").flatMap(({ rings }) => {
    const area = areaOf("paved", rings)
    return area === undefined ? [] : [{ area, top: PIER_DECK }]
  })
  const breakwaters = [
    ...polygonsOf(osm, isBreakwater),
    ...ways
      .filter((w) => isBreakwater(w.tags) && !closed(w))
      .map((w) => ({
        tags: w.tags,
        rings: [
          buffered(
            lineVertices(osm, w.nds).map((v): P => [v.x, v.y]),
            BREAKWATER_WIDTH / 2,
          ),
        ],
      })),
  ].flatMap(({ rings }) => {
    const area = areaOf("rock", rings)
    return area === undefined ? [] : [{ area, top: BREAKWATER_TOP }]
  })
  const raised = [...decks, ...breakwaters]
  return {
    areas: [...sands, ...spiagge, ...raised.map(({ area }) => area)],
    raised: raised.map(({ area, top }) => ({ rings: area.rings, top })),
    piers,
    barriers: breakwaters.flatMap(({ area }) =>
      area.rings.flatMap((ring) =>
        clip(closedLine(ring)).map(({ pts }) => ({ kind: "breakwater", pts: flatLine(pts) })),
      ),
    ),
  }
}

/** A flat ring as a line round it, its first point repeated last. */
const closedLine = (ring: ReadonlyArray<number>): Array<V> => {
  const pts: Array<V> = []
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push({ x: ring[i]!, y: ring[i + 1]! })
  return [...pts, pts[0]!]
}

/** Whether two flat rings share ground: their boxes meet, and a vertex of either lies in the other or two edges cross. */
const ringsMeet = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean =>
  boxesMeet(ringBox(a), ringBox(b)) &&
  (pointInRing(a[0]!, a[1]!, b) ||
    pointInRing(b[0]!, b[1]!, a) ||
    crossings(closedLine(a), closedLine(b)).length > 0)

/**
 * The `sea` areas with each raised area of `raised` that lies wholly in one of them (a breakwater
 * off the beach, which OSM's coastline leaves out) cut out of it as a hole: its rock is dry land,
 * with no sea over it to paint, carve, draw or swim in. One the coastline runs round or across is
 * none of the sea's.
 */
export const holedSea = (sea: ReadonlyArray<Area>, raised: ReadonlyArray<Raised>): Array<Area> => {
  const holes = sea.map((): Array<Array<number>> => [])
  for (const { rings } of raised) {
    const outer = rings[0]!,
      line = closedLine(outer)
    const k = sea.findIndex(
      (a) =>
        boxesMeet(ringBox(a.rings[0]!), ringBox(outer)) &&
        a.rings.every(
          (ring, r) =>
            pointInRing(outer[0]!, outer[1]!, ring) === (r === 0) &&
            crossings(closedLine(ring), line).length === 0,
        ),
    )
    const hole = flatRing(
      outer.flatMap((v, i) => (i % 2 === 0 ? [[v, outer[i + 1]!] as P] : [])),
      false,
    )
    if (k >= 0 && hole !== undefined) holes[k]!.push(hole)
  }
  return sea.map((a, k) =>
    holes[k]!.length === 0 ? a : { ...a, rings: [...a.rings, ...holes[k]!] },
  )
}

/**
 * `areas` (the land cover's) without the gravel (`pebble`, Liguria's 331, "spiagge, dune e
 * sabbie") that shares ground with a Spiagge polygon of `beaches`: Spiagge says the beach's
 * material. The rivers' gravel bars inland stay.
 */
export const offBeaches = (
  areas: ReadonlyArray<Area>,
  beaches: ReadonlyArray<Beach>,
): Array<Area> => {
  const outers = beaches.map((b) => b.rings[0]!.flat())
  return areas.filter(
    (a) => a.kind !== "pebble" || !outers.some((outer) => ringsMeet(a.rings[0]!, outer)),
  )
}

/** An end of a pier is on dry ground when the ground this far past it along its line is dry, m. */
const PAST_END = 0.5

/**
 * A pier's deck z at each of its vertices `pts`: PIER_DECK over the water's level where a water
 * area holds it (`level`; whatever the DTM reads there: Liguria's reads the Magra's estuary 1.4–1.8 m
 * up, as high as its quays, over a river at 0–0.3 m), over dry ground PIER_DECK or the ground
 * (`ground`) where it stands higher, and an end on dry ground (no water PAST_END m on past it, so an
 * end the water's edge cuts is the shore's) at that ground, so a walker steps onto it from the beach
 * or the quay; a vertex with no ground (NaN, past the terrain's sources) at PIER_DECK.
 */
export const pierDeck = (
  pts: ReadonlyArray<V>,
  ground: (v: V) => number,
  level: (x: number, y: number) => number | undefined,
): Array<number> => {
  /** Whether the ground PAST_END m on past the end `v`, from its neighbour `u`, is dry. */
  const dry = (v: V, u: V) => {
    const dx = v.x - u.x,
      dy = v.y - u.y,
      len = Math.sqrt(dx * dx + dy * dy) || 1
    return level(v.x + (dx / len) * PAST_END, v.y + (dy / len) * PAST_END) === undefined
  }
  return pts.map((v, k) => {
    const z = ground(v),
      end = k === 0 ? pts[1] : k === pts.length - 1 ? pts[k - 1] : undefined
    if (end !== undefined && dry(v, end)) return Number.isNaN(z) ? PIER_DECK : z
    const water = level(v.x, v.y)
    if (water !== undefined) return water + PIER_DECK
    return Number.isNaN(z) ? PIER_DECK : Math.max(z, PIER_DECK)
  })
}

/**
 * `piers` cut at the edges of the `water` areas: a stretch over the water stays a pier's deck, a
 * stretch on dry ground (a boardwalk on the bank, a quay round a basin the map holds no water in) is
 * a path at grade, which the ground under a deck would otherwise be dug from (`deck-ground.ts`). In
 * order along each pier; the cuts carry no id.
 */
export const splitPiers = (
  piers: ReadonlyArray<RoadF>,
  water: ReadonlyArray<Area>,
): Array<RoadF> => {
  const boxes = water.map((a) => ringBox(a.rings[0]!))
  return piers.flatMap((pier) => {
    const box = ringBox(flatLine(pier.pts))
    let runs: Array<{ readonly pts: Array<V>; readonly from: number; readonly wet: boolean }> = [
      { pts: [...pier.pts], from: 0, wet: false },
    ]
    water.forEach((a, k) => {
      if (!boxesMeet(boxes[k]!, box)) return
      runs = runs.flatMap((run) =>
        run.wet
          ? [run]
          : [
              ...clipPieces(a.rings, run.pts).map((p) => ({
                ...p,
                from: run.from + p.from,
                wet: true,
              })),
              ...clipPieces(a.rings, run.pts, true).map((p) => ({
                ...p,
                from: run.from + p.from,
                wet: false,
              })),
            ],
      )
    })
    return runs
      .sort((a, b) => a.from - b.from)
      .map(({ pts, wet }): RoadF => {
        if (wet) return { ...pier, pts }
        const { bridge: _bridge, pier: _pier, ...path } = pier
        return { ...path, pts }
      })
  })
}
