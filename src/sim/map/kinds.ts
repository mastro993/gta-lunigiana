/**
 * Map vocabulary shared by the build (src/tools) and the runtime map module:
 * where the map lies on the Earth, road classes, building styles, area kinds and the tree-trunk
 * wall size, and the 2 km tile grid the map files are cut on. Imports no data, so the build can use it
 * before the map exists. Game code imports
 * these through `./index.ts`; the sky (`src/sim/sky`) reads the loaded map's place through
 * `place()` (sky/place.ts) instead.
 *
 * @module map/kinds
 */

/** The map's origin, degrees (north, east): x and y count metres east and north of it. The build projects with it and writes it as `MAP.origin`. */
export const ORIGIN = { lat: 44.16175, lon: 10.13 } as const

/** Side of a map tile, m: tile (i, j) is the square x 2000i … 2000(i + 1), y 2000j … 2000(j + 1) on the local origin. */
export const TILE = 2000

/**
 * How far round its square a tile holds the vectors, m: every road, river, barrier, building and
 * area with a segment (a ring's box) within this of the square, whole, so a lookup at a point reads
 * the point's tile alone. More than any carriageway, verge or river bed reaches off its centreline
 * (13 m, a river's bed; the build checks it) and than the minimap's margin round a tile (23.3 m).
 */
export const HALO = 32

/** The most vertices a water piece has (the build checks it): a reach of it is keyed by the piece's index times this, plus its first vertex's. */
export const WATER_VERTICES = 65536

/** A tile's key, `"i_j"`: its file is `<key>.bin`, and "map tile i_j not loaded" names it. */
export const tileKey = (i: number, j: number): string => `${i}_${j}`

/**
 * The tiles [i0, i1] × [j0, j1] whose squares hold the terrain nodes of a map spanning `bounds`
 * (its first and last nodes lie on the bounds): every tile with ground in it. A last node on a seam
 * (Cesena's bounds lie on them) is the shared border of the tile below the seam, not a tile of its own.
 */
export const tileRange = (bounds: {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}): { readonly i0: number; readonly i1: number; readonly j0: number; readonly j1: number } => ({
  i0: Math.floor(bounds.minX / TILE),
  i1: Math.ceil(bounds.maxX / TILE) - 1,
  j0: Math.floor(bounds.minY / TILE),
  j1: Math.ceil(bounds.maxY / TILE) - 1,
})

/**
 * The heightmap node a lookup measures a point's cell from, and its column `i` and row `j`: the
 * region's anchor (src/tools/region.ts), which the map file names (`ax`, `ay`) where it is not the
 * first node (x0, y0). Measured from a node fixed per region, with `i` and `j` added to the whole
 * cells alone, a point's fraction of its cell keeps its bits as parts grow the map.
 */
export const anchorOf = (hm: {
  readonly cell: number
  readonly x0: number
  readonly y0: number
  readonly ax?: number
  readonly ay?: number
}): { readonly x: number; readonly y: number; readonly i: number; readonly j: number } => {
  const x = hm.ax ?? hm.x0,
    y = hm.ay ?? hm.y0
  return { x, y, i: (x - hm.x0) / hm.cell, j: (y - hm.y0) / hm.cell }
}

/** How many rings round a tile `tilesRound` searches before it gives up: farther than any map's tiles reach. */
const RINGS = 64

/**
 * The listed tiles round tile (i, j), which `listed` says is not: those of the nearest ring of
 * tiles round it (along the farther axis) holding any, in key order (south to north, then west to
 * east). A lookup in an unlisted tile (an L's notch) reads them, and the cut keeps each wall or
 * tree whose midpoint falls in it in the one of them nearest that midpoint (the first in key order
 * on a tie). Throws when no ring within `RINGS` holds one.
 */
export const tilesRound = (
  i: number,
  j: number,
  listed: (i: number, j: number) => boolean,
): Array<readonly [number, number]> => {
  for (let ring = 1; ring <= RINGS; ring++) {
    const found: Array<readonly [number, number]> = []
    for (let tj = j - ring; tj <= j + ring; tj++)
      for (let ti = i - ring; ti <= i + ring; ti++)
        if (Math.max(Math.abs(ti - i), Math.abs(tj - j)) === ring && listed(ti, tj))
          found.push([ti, tj])
    if (found.length > 0) return found
  }
  throw new Error(`no listed tile within ${RINGS} rings of tile ${tileKey(i, j)}`)
}

/**
 * Highway classes the build emits, widest first. The build folds each link into the class below
 * (`motorway_link` and `trunk_link` into primary, `primary_link` into secondary, `secondary_link`
 * and `tertiary_link` into tertiary), `living_street` into residential, `footway` and `pedestrian`
 * into path.
 */
export const ROAD_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "track",
  "path",
  "steps",
] as const
export type RoadClass = (typeof ROAD_CLASSES)[number]

const roadClasses: ReadonlySet<string> = new Set(ROAD_CLASSES)
/** Whether `cls` is one of ROAD_CLASSES. */
export const isRoadClass = (cls: string): cls is RoadClass => roadClasses.has(cls)

/** The road's class; the build only emits `ROAD_CLASSES` (checked by map.map-test.ts), anything else reads as "path". */
export const roadClassOf = (road: { readonly cls: string }): RoadClass =>
  isRoadClass(road.cls) ? road.cls : "path"

/**
 * How far each road class's surface floats above its profile (m); wider classes on top, so junctions
 * never z-fight. Primary, secondary and tertiary roads share one: they are the same asphalt. A step
 * of 0.04 m keeps a class's painted lines (0.02 m over it) under the next class's asphalt where a
 * slip road meets a trunk road or a motorway. The ground model's (`./ground-model.ts`), read by the
 * game and the map build alike (a bridge's deck tops it: `DECK_SLAB`).
 */
export const ROAD_LIFT = {
  motorway: 0.24,
  trunk: 0.2,
  primary: 0.16,
  secondary: 0.16,
  tertiary: 0.16,
  unclassified: 0.14,
  residential: 0.12,
  service: 0.1,
  track: 0.08,
  steps: 0.07,
  path: 0.06,
} as const satisfies Record<RoadClass, number>

/**
 * A bridge's deck as `src/render/lines.ts` draws it: a slab from the deck's top (a road's surface,
 * its profile plus `ROAD_LIFT`, or a rail deck's ballast, `DECK_BALLAST`) `depth` m down, reaching
 * `margin` m past the carriageway or the ballast on either side. The map build keeps the terrain out
 * of it (`src/tools/deck-ground.ts`).
 */
export const DECK_SLAB = { depth: 0.9, margin: 0.4 } as const

/** On a rail bridge the ballast is a flat strip over the deck, m: its width, and its top over the bed's profile. */
export const DECK_BALLAST = { width: 3.2, lift: 0.04 } as const

/**
 * A bridge deck or tunnel within this height (m) of where an actor was is the one it is on
 * (`groundZ` in `./ground-model.ts`). The map build reads it too: the walls under the decks stand
 * farther than ONE_LEVEL and this under a deck's top (src/tools/deck-walls.ts).
 */
export const ON_DECK = 0.5

/**
 * Two grounds this near in height (m) are one level: bodies meet, a body meets a train's car, and a
 * wall with a level (a bridge's parapet) stops a body, only on one level (`onOneLevel` in
 * src/sim/one-level.ts); a parapet opens only where a road this near its deck reaches it
 * (src/tools/parapets.ts).
 */
export const ONE_LEVEL = 2

/**
 * Per class: carriageway width (m), whether it is asphalt when OSM names no surface, and who uses
 * it (AI traffic and the player's car, the player's car only, or only people on foot). The widths
 * of the classes the Lucido valley lacks (motorway to secondary) are defaults per carriageway for
 * the first part that maps one to measure on the orthophoto (issue #8); a `lanes` tag overrides
 * them (`laneWidth`), and the CTR's road surfaces override both.
 */
export const ROADS = {
  motorway: { w: 11, paved: true, use: "traffic" },
  trunk: { w: 8.5, paved: true, use: "traffic" },
  primary: { w: 7, paved: true, use: "traffic" },
  secondary: { w: 6.5, paved: true, use: "traffic" },
  tertiary: { w: 6.5, paved: true, use: "traffic" },
  unclassified: { w: 5, paved: true, use: "traffic" },
  residential: { w: 4.5, paved: true, use: "traffic" },
  service: { w: 3.5, paved: false, use: "traffic" },
  track: { w: 3, paved: false, use: "drive" },
  path: { w: 1.5, paved: false, use: "walk" },
  steps: { w: 2, paved: false, use: "walk" },
} as const satisfies Record<
  RoadClass,
  { readonly w: number; readonly paved: boolean; readonly use: "traffic" | "drive" | "walk" }
>

/** Whether the player can drive a road of this class (tracks included). */
export const isDrivable = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use !== "walk"

/** Whether AI traffic may use a road of this class (drivable minus tracks). */
export const isTraffic = (cls: string): boolean => isRoadClass(cls) && ROADS[cls].use === "traffic"

/**
 * Whether a road is a motorway or a trunk road (an Italian "strada extraurbana principale"), or one of their slip roads
 * (`ramp`, primary by class): the Codice della Strada keeps people on foot and mopeds such as the Ape 50 off them (art. 175)
 * and bans stopping on their carriageways and ramps (art. 176, comma 5).
 */
export const isMotorRoad = (road: { readonly cls: string; readonly ramp?: boolean }): boolean =>
  road.cls === "motorway" || road.cls === "trunk" || road.ramp === true

/**
 * How far from a road's centreline people walk, m, on either side: its verge, 0.8 m past the
 * carriageway's edge, or 0.3 m off the middle of paths, steps and tracks. A road's own `verge`
 * (the build's, where the verge would run beside the railway) overrides it.
 */
export const vergeOf = (cls: string, w: number): number =>
  cls === "path" || cls === "steps" || cls === "track" ? 0.3 : w / 2 + 0.8

/** How far past its carriageway a road's surface reaches, m: where a wheel stands on it (`groundZ` in `./ground-model.ts`). */
export const ROAD_PAD = 0.3

/**
 * How far either side of a bridge's or tunnel's centreline someone on foot is on it, m: half a metre
 * past its walkers' verge (`vergeOf`, or the road's own `verge`), and at least ROAD_PAD past its
 * carriageway (`groundZ` in `./ground-model.ts`; the walls under the decks stand there, src/tools/deck-walls.ts).
 */
export const footReach = (cls: string, w: number, verge?: number): number =>
  Math.max(w / 2 + ROAD_PAD, (verge ?? vergeOf(cls, w)) + 0.5)

/** A traffic lane's width, m: a `lanes` tag on a main road (motorway to secondary) gives it this much per lane. */
export const LANE = 3.5

/** The hard shoulder right of a motorway carriageway's lanes, m. */
export const SHOULDER = 3

/** The classes whose `lanes` tag sets their width (`laneWidth`): the main roads, motorway to secondary. */
const LANED: ReadonlySet<string> = new Set(["motorway", "trunk", "primary", "secondary"])

/** A main road's carriageway width from its OSM `lanes` tag, m (lanes × LANE, plus SHOULDER on a motorway); undefined for other classes. */
export const laneWidth = (cls: string, lanes: number): number | undefined =>
  LANED.has(cls) ? lanes * LANE + (cls === "motorway" ? SHOULDER : 0) : undefined

/**
 * A carriageway's hard shoulder, m: a motorway's SHOULDER, narrowed to what its rightmost lane
 * leaves when that lane's middle would fall left of the centreline (a one-lane carriageway, 6.5 m,
 * keeps 1.5 m: a full shoulder put its lane 1.5 m left, and the lane offset, clamped at the
 * centreline, ran traffic over the shoulder's line); none on other classes.
 */
export const shoulderOf = (road: { readonly cls: string; readonly w: number }): number =>
  road.cls === "motorway" ? Math.max(0, Math.min(SHOULDER, road.w / 2 - LANE / 2)) : 0

/**
 * The nominal traffic lane offset, m right of a road's centreline (drive on the right). A two-way
 * road: a quarter of the width plus 0.2 m on roads 5 m wide or more, 0.5 m on narrower ones. A
 * oneway road: the middle of its rightmost lane (LANE wide, left of a motorway's shoulder,
 * `shoulderOf`), or the centreline where the road is narrower than a lane, since w/4 + 0.2 put a
 * car on a motorway's hard shoulder.
 */
export const laneOffset = (road: {
  readonly cls: string
  readonly w: number
  readonly oneway?: boolean
}): number =>
  road.oneway === true
    ? Math.max(0, road.w / 2 - shoulderOf(road) - LANE / 2)
    : road.w >= 5
      ? road.w / 4 + 0.2
      : 0.5

/** Facade styles the build emits. */
export const BUILDING_STYLES = [
  "plaster",
  "stone",
  "church",
  "tower",
  "industrial",
  "station",
  "ruin",
] as const
export type BuildingStyle = (typeof BUILDING_STYLES)[number]

/** Land-use kinds the build emits: land covers (the woods among them, `WOODS`, and the olive groves, `olive`), a river's gravel (`pebble`) and its water (`river`, `lake`). */
export const AREA_KINDS = [
  "forest",
  "cemetery",
  "pitch",
  "park",
  "parking",
  "vineyard",
  "farmland",
  "farmyard",
  "industrial",
  "residential",
  "platform",
  "school",
  "ruins",
  "grassland",
  "paved",
  "quarry",
  "rock",
  "sparse",
  "scree",
  "scrub",
  "pebble",
  "river",
  "lake",
  "conifer",
  "mixed",
  "olive",
] as const
export type AreaKind = (typeof AREA_KINDS)[number]

const areaKinds: ReadonlySet<string> = new Set(AREA_KINDS)
/** Whether `kind` is one of AREA_KINDS. */
export const isAreaKind = (kind: string): kind is AreaKind => areaKinds.has(kind)

/** The woods, where the trees grow: broadleaf (`forest`, OSM's and the UCS's), and the UCS's conifer and mixed woods. */
export const WOODS = ["forest", "conifer", "mixed"] as const satisfies ReadonlyArray<AreaKind>
/** A kind of wood. */
type Wood = (typeof WOODS)[number]

const woods: ReadonlySet<string> = new Set(WOODS)
/** Whether an area or a cover of `kind` is a wood (`WOODS`). */
export const isWood = (kind: string): kind is Wood => woods.has(kind)

/** Whether an area of `kind` holds water: a river's polygon (its bed, as wide as it spreads) or a lake; a river's gravel (`pebble`) does not. */
export const isWaterArea = (kind: string): kind is "river" | "lake" =>
  kind === "river" || kind === "lake"

/**
 * Track on no line, drawn and driven by no train: a loop rejoins other track at both ends
 * (Gragnola's track 1), a siding leads to a dead end (yard tracks, stubs).
 */
export const RAIL_KINDS = ["loop", "siding"] as const
/** A kind of track on no line. */
export type RailKind = (typeof RAIL_KINDS)[number]

/** The rail head over a rail piece's `z` (the bed its sleepers lie on), m: where trains run (`src/sim/rail/lines.ts`) and the rails are drawn (`src/render/rail.ts`). */
export const RAIL_LIFT = 0.12

/**
 * How near its track a platform's edge comes, m: the map's stand 1.63–1.73 m off their tracks'
 * centrelines, and its edges within this of a running track or loop take the yellow line
 * (`src/render/platforms.ts`). A piece no edge of which comes this near any track is no platform
 * people wait on but a walkway (`src/tools/platforms.ts`): a train's step reaches no further.
 */
export const PLATFORM_EDGE = 2.2

/**
 * The first olive tree's id: the olive groves' trees stand on a lattice of their own
 * (src/tools/trees.ts), numbered past every wood's and bank's tree (2^28 + 2^30), so a tree is an
 * olive by its id alone (`kindAt` in src/render/trees.ts).
 */
export const OLIVE_TREES = 1_342_177_280

/** Side of the square wall around every tree trunk, m. */
export const TRUNK = 0.5

/** Appends the four edges (ax, ay, bx, by) of the TRUNK square centred on (x, y) to `out`. */
export const pushTrunk = (out: Array<number>, x: number, y: number): void => {
  const h = TRUNK / 2
  out.push(
    x - h,
    y - h,
    x + h,
    y - h,
    x + h,
    y - h,
    x + h,
    y + h,
    x + h,
    y + h,
    x - h,
    y + h,
    x - h,
    y + h,
    x - h,
    y - h,
  )
}
