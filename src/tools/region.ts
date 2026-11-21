// The maps the build makes and the parts each is made of.
// - Regions: separately built maps (Lunigiana, Cesena), never sharing survey inputs; the build
//   and the geometry read the one `--region` names (REGION, Lunigiana by default). A
//   region's play area is the union of its parts' (play-area.ts); its built terrain is the box round
//   every part's rectangles (`bounds`), its tiles those the rectangles meet, and its trees stand on
//   a lattice from a corner fixed for good (`anchor`, trees.ts).
// - Test regions (issue #7): other shapes and sizes built from Lunigiana's inputs, in its frame and
//   on its anchor, into `test-maps/` (gitignored), to check the build; the game never loads them.
//   Three far from lucido have terrain of their own (`ownTerrain`, issues #10, #12 and #13), one
//   buildings of its own (`ownBuildings`, issue #11) and one OSM of its own (`ownOsm`, issue #13);
//   a part's Regione Liguria sources are its own anyway (`ligDir`, issue #12).
// - Parts (issue #3): the Lunigiana map grows one part at a time, each a key, a title and its
//   rectangles in local metres, on 100 m multiples, and optionally a mask inside them. Today's map
//   is part `lucido`. The part tools (`rt-index`, `pick-sheets`, `pick-lidar`, `coverage`,
//   `footprint-check`), `fetch-rt`, `fetch-lig` and `fetch-osm` take parts from here, and each part
//   has an OSM extract of its own (`osmFile`), which the build merges with its region's others'.

// The game loads this module (through geometry.ts), so it imports no Node built-in
// (`src/__tests__/browser.test.ts`).
import type { MapId } from "../maps.ts"
import { tileRange } from "../sim/map/kinds.ts"

/** A rectangle [minX, minY, maxX, maxY] in local metres. */
export type Rect = readonly [number, number, number, number]

/** A part of a map: its key (the tools' argument), its title, its rectangles and its mask. */
export interface Part {
  readonly key: string
  readonly title: string
  readonly rects: ReadonlyArray<Rect>
  /**
   * The part's play area where it is less than its rectangles: one simple counter-clockwise flat
   * ring [x0, y0, x1, y1, ...] on 0.1 m, inside the rectangles (`checkMask`). Without one, the
   * part plays over the whole of its rectangles.
   */
  readonly mask?: ReadonlyArray<number>
}

/** A separately built map; survey inputs are never shared between regions, but a test region's. */
export interface Region {
  /** The `--region` argument that selects it. */
  readonly key: string
  /** The map whose inputs and local frame it is built from (its parts' OSM, `osmFiles`, …). */
  readonly id: MapId
  /** Its files' name: the global file `<file>.bin` and the tiles `<file>/<i>_<j>.bin`, in `mapDir`. */
  readonly file: string
  /** A test region: built from another region's inputs to check the build, into `test-maps/`; never shipped, and fetched for only when it has terrain of its own. */
  readonly test: boolean
  /**
   * A test region with terrain of its own (issue #10): `fetch-rt --region <key>` mosaics its part's
   * manifest into `data/raw/rt/<key>` (`dtmDir`), which the build reads instead of Lunigiana's.
   */
  readonly ownTerrain: boolean
  /**
   * A test region with surveyed buildings of its own (issue #11): `fetch-rt --region <key>` writes
   * the surveys its part's manifest lists into data/raw/rt/<key> (`surveyDir`), clipped to its box,
   * and `fetch-osm <part>` OSM's buildings over its part into data/raw/osm/<part>.osm.gz (`osmFile`);
   * no map is built for it.
   */
  readonly ownBuildings: boolean
  /**
   * A test region with OpenStreetMap of its own (issue #13): `fetch-osm <part>` writes OSM's whole
   * extract over its part into data/raw/osm/<part>.osm.gz (`osmFile`), which the build reads instead
   * of Lunigiana's parts'; with terrain of its own too, the build makes its map from its own inputs.
   */
  readonly ownOsm: boolean
  readonly origin: { readonly lat: number; readonly lon: number }
  /** Its parts: the play area is the union of their masks, or their rectangles where they have none. */
  readonly parts: ReadonlyArray<Part>
  /** The box round every part's rectangles: the built terrain, which the play area lies in. */
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  /** The 2 km tiles its parts' rectangles meet, south to north, then west to east: the trees cover these. */
  readonly tiles: ReadonlyArray<{ readonly i: number; readonly j: number }>
  /**
   * The south-west corner of the tree lattice and its masks, local metres on the 4 m bank cells
   * (trees.ts): set once, where the first part's corner was, and never moved, so no lattice tree
   * moves and no tree changes its id as parts are added.
   */
  readonly anchor: { readonly x: number; readonly y: number }
}

/** Whether local (x, y) lies in one of the rectangles. */
export const inRects = (rects: ReadonlyArray<Rect>, x: number, y: number): boolean =>
  rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)

/** A rectangle as a counter-clockwise flat ring from its south-west corner. */
export const rectRing = ([x0, y0, x1, y1]: Rect): Array<number> => [x0, y0, x1, y0, x1, y1, x0, y1]

/** The local box [minX, minY, maxX, maxY] round every rectangle. */
export const rectsBox = (rects: ReadonlyArray<Rect>): Rect => [
  Math.min(...rects.map((r) => r[0])),
  Math.min(...rects.map((r) => r[1])),
  Math.max(...rects.map((r) => r[2])),
  Math.max(...rects.map((r) => r[3])),
]

/** The sign of the turn a → b → c, exact on integers: 1 left, −1 right, 0 straight. */
const turn = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))

/** Whether c, on the line through a and b, lies between them (ends included). */
const between = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.min(ax, bx) <= cx &&
  cx <= Math.max(ax, bx) &&
  Math.min(ay, by) <= cy &&
  cy <= Math.max(ay, by)

/** Whether two segments [ax, ay, bx, by] share any point. */
const meet = ([ax, ay, bx, by]: Rect, [cx, cy, dx, dy]: Rect): boolean => {
  const d1 = turn(cx, cy, dx, dy, ax, ay),
    d2 = turn(cx, cy, dx, dy, bx, by),
    d3 = turn(ax, ay, bx, by, cx, cy),
    d4 = turn(ax, ay, bx, by, dx, dy)
  if (d1 * d2 < 0 && d3 * d4 < 0) return true
  return (
    (d1 === 0 && between(cx, cy, dx, dy, ax, ay)) ||
    (d2 === 0 && between(cx, cy, dx, dy, bx, by)) ||
    (d3 === 0 && between(ax, ay, bx, by, cx, cy)) ||
    (d4 === 0 && between(ax, ay, bx, by, dx, dy))
  )
}

/**
 * Throws, naming the part and the fault, unless its mask (if any) is one simple counter-clockwise
 * ring on 0.1 m lying in its rectangles: at least three vertices, no edge meeting another but at
 * the vertex they share, every stretch of every edge in a rectangle, and no ground outside the
 * rectangles inside it (a gap they leave). Checked on whole
 * decimetres, so the predicates are exact.
 */
export const checkMask = ({ key, rects, mask }: Part): void => {
  if (mask === undefined) return
  const fail = (why: string): never => {
    throw new Error(`part ${key}'s mask ${why}`)
  }
  if (mask.length < 6 || mask.length % 2 !== 0) fail("needs three or more (x, y) vertices")
  if (mask.some((v) => Math.round(v * 10) / 10 !== v)) fail("has a vertex off the 0.1 m lattice")
  const dm = mask.map((v) => Math.round(v * 10)),
    n = dm.length / 2
  const edge = (i: number): Rect => [
    dm[2 * i]!,
    dm[2 * i + 1]!,
    dm[(2 * i + 2) % dm.length]!,
    dm[(2 * i + 3) % dm.length]!,
  ]
  let area = 0
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    area += ax * by - bx * ay
  }
  if (area <= 0) fail("is not counter-clockwise")
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    if (ax === bx && ay === by) fail(`repeats vertex ${i}`)
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = edge(i)
    // The next edge may only share its first vertex: it must not fold back along this one.
    const [, , cx, cy] = edge((i + 1) % n)
    if (turn(ax, ay, bx, by, cx, cy) === 0 && !between(ax, ay, cx, cy, bx, by))
      fail(`folds back at vertex ${(i + 1) % n}`)
    for (let j = i + 2; j < n; j++)
      if ((j + 1) % n !== i && meet(edge(i), edge(j))) fail(`crosses itself: edges ${i} and ${j}`)
  }
  for (let i = 0; i < n; i++)
    if (!inRects(rects, mask[2 * i]!, mask[2 * i + 1]!))
      fail(`has vertex ${i} outside its rectangles`)
  // Each edge in the rectangles: cut where it crosses any rectangle's side, the middle of every
  // piece between the cuts lies in one (a piece is in or out of each rectangle all along, and the
  // rectangles are closed).
  for (let i = 0; i < n; i++) {
    const [ex, ey, fx, fy] = edge(i),
      [ax, ay, bx, by] = [ex / 10, ey / 10, fx / 10, fy / 10]
    const ts = [0, 1]
    for (const [x0, y0, x1, y1] of rects) {
      if (bx !== ax) ts.push((x0 - ax) / (bx - ax), (x1 - ax) / (bx - ax))
      if (by !== ay) ts.push((y0 - ay) / (by - ay), (y1 - ay) / (by - ay))
    }
    const cuts = ts.filter((t) => t >= 0 && t <= 1).sort((s, t) => s - t)
    for (let k = 0; k + 1 < cuts.length; k++) {
      const t = (cuts[k]! + cuts[k + 1]!) / 2
      if (!inRects(rects, ax + (bx - ax) * t, ay + (by - ay) * t))
        fail(`leaves its rectangles on edge ${i}`)
    }
  }
  // Its inside in the rectangles too: their sides cut the box round them into cells each wholly in
  // or wholly out of them, and with no edge leaving them, a cell they miss is wholly in or out of
  // the mask, so its centre decides (a mask round a hole in a donut of rectangles fails here).
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b),
    ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b)
  for (let a = 0; a + 1 < xs.length; a++)
    for (let b = 0; b + 1 < ys.length; b++) {
      const x = (xs[a]! + xs[a + 1]!) / 2,
        y = (ys[b]! + ys[b + 1]!) / 2
      if (!inRects(rects, x, y) && insideRing(mask, x, y))
        fail("encloses ground outside its rectangles")
    }
}

/** Whether (x, y), on no edge of the flat ring, lies inside it (even-odd). */
const insideRing = (ring: ReadonlyArray<number>, x: number, y: number): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!,
      yi = ring[i + 1]!,
      xj = ring[j]!,
      yj = ring[j + 1]!
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) inside = !inside
  }
  return inside
}

/** Every tile any of `rects` meets (more than along its edge), south to north, then west to east. */
export const tilesOf = (rects: ReadonlyArray<Rect>): Region["tiles"] => {
  const keys = new Set<string>(),
    tiles: Array<{ i: number; j: number }> = []
  for (const [minX, minY, maxX, maxY] of rects) {
    const { i0, i1, j0, j1 } = tileRange({ minX, minY, maxX, maxY })
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (!keys.has(`${i}_${j}`)) {
          keys.add(`${i}_${j}`)
          tiles.push({ i, j })
        }
  }
  return tiles.sort((a, b) => a.j - b.j || a.i - b.i)
}

/** A region of `parts` with its tree lattice at `anchor`, each mask checked, its bounds the box round every rectangle. */
const regionOf = (
  {
    key,
    id,
    file,
    test,
    ownTerrain = false,
    ownBuildings = false,
    ownOsm = false,
  }: Pick<Region, "key" | "id" | "file" | "test"> & {
    readonly ownTerrain?: boolean
    readonly ownBuildings?: boolean
    readonly ownOsm?: boolean
  },
  origin: Region["origin"],
  parts: ReadonlyArray<Part>,
  anchor: Region["anchor"],
): Region => {
  for (const part of parts) checkMask(part)
  const rects = parts.flatMap((p) => p.rects)
  const [minX, minY, maxX, maxY] = rectsBox(rects)
  return {
    key,
    id,
    file,
    test,
    ownTerrain,
    ownBuildings,
    ownOsm,
    origin,
    parts,
    bounds: { minX, minY, maxX, maxY },
    tiles: tilesOf(rects),
    anchor,
  }
}

/**
 * Every Lunigiana part, in build order: `fetch-rt` mosaics every part's LiDAR in this order and
 * `pick-lidar` replays the earlier parts' before a part's own candidates, so a later part's tiles
 * never take a cell an earlier part's give. `lucido`: lat 44.1069–44.1968, lon 10.0937–10.1913,
 * the whole Lucido catchment, ridge to ridge, plus the Aulella side by Gragnola and Codiponte.
 */
export const PARTS: ReadonlyArray<Part> = [
  { key: "lucido", title: "Valle del Lucido", rects: [[-2900, -6100, 4900, 3900]] },
  {
    key: "fivizzano",
    title: "Fivizzano, Casola and the upper Aulella",
    // The issue's L (#17), and two rectangles of Lucca land the runbook's critic added (issue #3,
    // step 1) so no permanent edge cuts a village: Pieve San Lorenzo, Novella and Renzano whole
    // (x 5700…6700), and Magliano, Varliano and Montale (x 10100…10600).
    rects: [
      [-5300, 3900, 10100, 13000],
      [4900, -900, 5700, 3900],
      [5700, 2900, 6700, 3900],
      [10100, 4600, 10600, 7800],
    ],
    // The rectangles less Emilia-Romagna at Cima Belfiore: Regione Toscana's regional border as OSM
    // maps it (ways 783897858, 866778403 and 443598856, admin_level 4, fetched 2026-11-04), in the
    // local frame to 0.1 m, from x 10100 to y 13000; round the summit, whose peak node 577763720 at
    // (9705.5, 12014.0) OSM puts 3.6 m beyond the border (the landmark point (9706, 12014) 4.1 m),
    // it bends out to (9726, 12014), so the summit plays.
    mask: [
      4900, -900, 5700, -900, 5700, 2900, 6700, 2900, 6700, 3900, 10100, 3900, 10100, 4600, 10600,
      4600, 10600, 7800, 10100, 7800, 10100, 11909.4, 10029.7, 11854.3, 9924.6, 11826.6, 9756,
      11948.9, 9730.6, 11968.6, 9726, 12014, 9703.5, 12042.7, 9685, 12202.9, 9664.6, 12284.8,
      9637.1, 12311.8, 9611.9, 12346.1, 9568.7, 12370.3, 9515.7, 12425.9, 9464.3, 12475, 9452.4,
      12482.6, 9366.5, 12544.1, 9324.9, 12579, 9262.6, 12597, 9221.6, 12619.4, 9147.2, 12669.2,
      9124, 12762, 9091.3, 12779.6, 9048.6, 12851, 9008.5, 12876.5, 8992.6, 12901.4, 8978.2,
      12918.1, 8966.6, 12942.4, 8954.2, 12968.3, 8939.6, 13000, -5300, 13000, -5300, 3900, 4900,
      3900,
    ],
  },
  {
    key: "fosdinovo",
    title: "Fosdinovo, the Bardine valley and the Apuan foothills",
    rects: [[-11500, -6100, -2900, 3900]],
    // The rectangle less Carrara's corner (issue #18): south of the line 1 km beyond the extent's
    // comuni (OSM's admin_level 8 relations, fetched 2026-11-07 from the OSM API, buffered 1 km and
    // simplified to 2 m) and east of x −4000, where the runbook's critic (issue #3, step 1) bent it
    // out so that Castelpoggio, 1.3 km into Carrara, plays whole and the SP73 through it leaves the
    // play area once, toward Gragnana. Castelnuovo Magra, Sarzana and Luni play (#12 has landed).
    mask: [
      -11500, -6100, -4000, -6100, -4000, -5025.3, -3930.1, -5065.9, -3817.1, -5114.9, -3734.8,
      -5140.8, -3650.5, -5159.4, -3517.6, -5174.5, -3368.6, -5196.5, -3293.7, -5202.3, -3213.7,
      -5203.1, -3140.3, -5200.3, -3070, -5192.8, -2988.6, -5263.4, -2900, -5324.9, -2900, 3900,
      -11500, 3900,
    ],
  },
  {
    key: "aulla",
    title: "Aulla and the Magra–Aulella–Taverone confluence",
    rects: [[-22100, 3900, -5300, 13000]],
    // The rectangle less Liguria's Calice al Cornoviglio and the sliver of Follo in its west corner
    // (issue #19): Regione Toscana's border as those comuni's OSM admin_level 8 relations (42939,
    // 42908, fetched 2026-11-16 from the OSM API) draw it, simplified to 5 m. Bolano's land north of
    // y 3900 (relation 42917, fetched 2026-11-21, simplified to 5 m) plays since Sarzana's part
    // (issue #20) plays Bolano whole, so the two parts meet along y 3900 from x −21568.6 east.
    mask: [
      -15723.6, 3900, -5300, 3900, -5300, 13000, -22100, 13000, -22100, 11926.4, -22055, 11905.7,
      -22066.8, 11851.6, -22025.1, 11782, -22021, 11327.1, -21923.8, 11223.1, -21926, 10833.3,
      -21919.5, 10790.5, -21622.8, 10293.2, -21432.8, 9897, -21543.5, 9698.2, -21621.3, 9617.7,
      -21638.1, 9492.3, -21602.5, 9348.5, -21582.3, 9179.8, -21525.4, 9013.9, -21504.2, 8907.9,
      -21518.9, 8745, -21574.5, 8363.5, -21681, 8336.5, -21868.6, 8224.6, -21904.5, 8150.5, -21887,
      8145.2, -21804.4, 8032.7, -21741.5, 7976.1, -21652.4, 7914.6, -21622.6, 7830.7, -21537.2,
      7723.9, -21434.5, 7665.5, -21362.4, 7612.2, -21329.8, 7543.7, -21252.7, 7426.5, -21149.1,
      7438.4, -21107.5, 7435.7, -21015.1, 7405, -20881.6, 7322, -20725.5, 7159, -20616.5, 7126,
      -20580.1, 7105.7, -20582, 6920.2, -20599.6, 6746.8, -20627.1, 6634.8, -20647.8, 6476.8,
      -20636.5, 6408.6, -20676.6, 6369.4, -20705.1, 6323.7, -20784.7, 6264.9, -20834.2, 5998.3,
      -20860.2, 5946.8, -20861.1, 5840.4, -20891.6, 5732, -20885.4, 5691.6, -20858.9, 5647.2,
      -20924.8, 5594.5, -20982.3, 5506.9, -21045.9, 5468.5, -21052.5, 5452.7, -21026.1, 5396,
      -21029.4, 5371.9, -21132.9, 5279.1, -21147.7, 5210.1, -21141.3, 5086.4, -21148.7, 5039.3,
      -21155.5, 5017.3, -21203.6, 4948, -21217.6, 4901, -21182.9, 4858.5, -21172.4, 4833.8,
      -21178.8, 4786.6, -21199.3, 4732.7, -21202.8, 4685.7, -21214.6, 4661.2, -21250.1, 4631.6,
      -21268.5, 4576.2, -21318.8, 4549.7, -21346.7, 4463.6, -21385.6, 4416.8, -21403.1, 4366.4,
      -21452.8, 4296.8, -21463.5, 4238.1, -21456.8, 4160.9, -21545.7, 4023.4, -21550.8, 3950.3,
      -21568.6, 3900, -20310.5, 3900,
    ],
  },
  {
    key: "sarzana",
    title: "Sarzana and the lower Val di Magra",
    rects: [[-23100, -8500, -11500, 3900]],
    // The rectangle less La Spezia's and Lerici's suburbs and the Gulf (issue #20): the extent's
    // comuni (Sarzana, Santo Stefano di Magra, Vezzano Ligure, Arcola, Aulla, Fosdinovo, Podenzana),
    // Bolano whole, Follo and Calice al Cornoviglio within 1 km of the extent and the SP10 between
    // Piano di Follo and Piana Battolla within 80 m, and Lerici east of x −17000, as their OSM
    // admin_level 8 relations draw them (fetched 2026-11-21 from the OSM API); La Spezia and the
    // rest of Lerici stop at the comune border on the ridge, and no sea lies within 1 km of the
    // extent. Where an edge cut a cluster of buildings the runbook's critic (issue #3, step 1)
    // found, the edge bends round the cluster: out where most of it lay inside, in where most lay
    // outside, never into the extent's comuni. Simplified to 5 m.
    mask: [
      -23100, -141.6, -23100, -1184.6, -23026.2, -1148.1, -22996.9, -1144.6, -23010.5, -1245,
      -23042.3, -1323, -23038.2, -1348.3, -23000, -1386.7, -22979.9, -1420.6, -22907.6, -1701,
      -22825.2, -1880.2, -22817.8, -1925.3, -22824.3, -1934.7, -22869.7, -1941.2, -22890.7, -1902.8,
      -22924.3, -1891.6, -23003.7, -1958.9, -22929.3, -2080.6, -22896.1, -2070.7, -22777.3, -2060.5,
      -22712.5, -2081.7, -22606.3, -2102.9, -22574.7, -2128.3, -22541.4, -2189.9, -22516.7, -2303.7,
      -22436.5, -2479.2, -22443.8, -2490.1, -22478, -2472.8, -22486.7, -2480.2, -22485.7, -2492.3,
      -22446.7, -2511.1, -22395.6, -2498.8, -22363.9, -2555.7, -22373.4, -2583.5, -22342.6, -2584.1,
      -22275.2, -2617.7, -22261, -2640.8, -22316.5, -2777.8, -22297.9, -2822, -22328.1, -2889.6,
      -22314.1, -2918.4, -22229, -2913.5, -22194.5, -2855.1, -22190.9, -2806.2, -22171.9, -2785,
      -22128.6, -2786.6, -22090.9, -2816.9, -22061.8, -2820.5, -22005.6, -3013.9, -22035.4, -3076.3,
      -22002.1, -3125.5, -22005.5, -3173.1, -21993.9, -3213.6, -21949.6, -3255.6, -21919.6, -3304.1,
      -21862.6, -3297.1, -21821.6, -3274.6, -21772.9, -3294.9, -21760, -3335.1, -21805.2, -3374.6,
      -21807.2, -3407.9, -21768.9, -3457.7, -21689.8, -3494.5, -21653.2, -3493.5, -21614.8, -3455.2,
      -21557.4, -3345.3, -21544.6, -3336, -21493.5, -3347.3, -21457.3, -3397.1, -21423.9, -3397.3,
      -21404.2, -3377.9, -21379.9, -3294.4, -21360.8, -3281.4, -21280.4, -3366.9, -21237.5, -3368.1,
      -21191.1, -3419.3, -21129.3, -3435.7, -21099.7, -3490.7, -21055.5, -3525.3, -20947.7, -3544,
      -20911.9, -3535, -20864.1, -3544.9, -20837.4, -3541.7, -20786.4, -3579.2, -20768.5, -3617.6,
      -20737.2, -3623.3, -20658.8, -3596.7, -20601.3, -3558.6, -20507, -3557, -20453.6, -3581,
      -20396.1, -3619.3, -20324.5, -3644.5, -20277.2, -3640.8, -20245.2, -3680.9, -20225.9, -3694.7,
      -20173.2, -3709.8, -20115.7, -3768, -19980.6, -3799.6, -19936.7, -3854.9, -19893.3, -3872,
      -19888.1, -3903.5, -19948.6, -3936.1, -19959.5, -3955.2, -19953, -4011.7, -19939.6, -4025,
      -19938.3, -4070.4, -19903.1, -4138.7, -19858.7, -4170.8, -19830.1, -4174.4, -19813.2, -4192.5,
      -19766.6, -4213.9, -19761.6, -4224.4, -19779.4, -4254.8, -19779.3, -4268.1, -19762.5, -4297.1,
      -19746.3, -4307.3, -19734.2, -4410, -19757.6, -4616.8, -19733.1, -4611.2, -19716.7, -4616.5,
      -19679.4, -4691.5, -19678.7, -4760.3, -19666.9, -4784.7, -19697, -4869.3, -19616.2, -5005.1,
      -19654.4, -5119.8, -19625.6, -5245.2, -19631, -5252.6, -19648, -5241.5, -19677.2, -5241.5,
      -19720.3, -5275.4, -19773.1, -5276.5, -19838.2, -5355, -19837.5, -5397.4, -19819.3, -5438.9,
      -19750.8, -5456.6, -19731.8, -5491.8, -19734.8, -5506, -19849.3, -5520.6, -20090, -5529.1,
      -20118.9, -5559.9, -20122.7, -5576, -20062.8, -5713.6, -20023.6, -5761.3, -20000.5, -5771.4,
      -19960.9, -5821.2, -19859.7, -5891, -19671.3, -5957.7, -19697.3, -6046.7, -19649.4, -6071.7,
      -19617.7, -6146.6, -19622.9, -6167.6, -19607.6, -6188.4, -19530.3, -6233.7, -19509.6, -6257,
      -19488.1, -6334.1, -19444.8, -6423.6, -19434.6, -6476.9, -19413.5, -6515, -19411.1, -6557,
      -19392.7, -6590.8, -19360.1, -6622.5, -19300.3, -6661.3, -19281.4, -6685.9, -19260.9, -6737.1,
      -19217.1, -6776.3, -19228.8, -6879, -19215.6, -6943.8, -19173.1, -7012.6, -19136.2, -7044.6,
      -19131.9, -7069.3, -19094.5, -7102.9, -19087.1, -7191.2, -19062.6, -7205.3, -19046.4, -7202.6,
      -19010.9, -7129.2, -18958.8, -7108, -18904, -7069.8, -18761.9, -7054, -18726, -6997.1,
      -18656.4, -6945.4, -18647.7, -6922, -18625.3, -6914.8, -18609.6, -6894.5, -18564.7, -6862.3,
      -18429.3, -6841.3, -18403.9, -6852.3, -18374, -6853.3, -18356.2, -6787.5, -18344.2, -6768.2,
      -18330.9, -6767.4, -18122.4, -7023.1, -17899, -7355.2, -17907.3, -7387.1, -17919.2, -7400.7,
      -17919.5, -7434.5, -17932.6, -7453.5, -17927.8, -7483.5, -17808.6, -7623.5, -17752.8, -7648.8,
      -17733.8, -7670, -17708.4, -7784.7, -17673.3, -7832.2, -17657.6, -7876.1, -17636.3, -7908.4,
      -17610.5, -7929.9, -17603.9, -7957, -17476, -8078.2, -17436, -8104.1, -17428.9, -8119.3,
      -17399, -8124.5, -17391.8, -8144.4, -17341.4, -8171.2, -17317, -8204.9, -17302.5, -8212,
      -17226.8, -8246.3, -17159.9, -8242.7, -17103.7, -8148.1, -17006.5, -8077.6, -17004.6, -8063.8,
      -17026.1, -8020.5, -17023.6, -7993.8, -17001.8, -7979.6, -16994.9, -8012.7, -16947.6, -7993.2,
      -16937.7, -7976.1, -16942.9, -7933.6, -16928.3, -7908.3, -16908, -7902.9, -16882.9, -7917.4,
      -16859, -7988, -16878.3, -8062.5, -16933.7, -8095.7, -16963.1, -8156.7, -17000, -8170.1,
      -17000, -8423.5, -16976.8, -8421.7, -16923.3, -8444.5, -16893.4, -8500, -11500, -8500, -11500,
      3900, -22356.5, 3900, -22366.1, 3848.4, -22402.1, 3828.8, -22435.9, 3846, -22486.5, 3849.2,
      -22515.7, 3900, -22812.1, 3900, -22843.5, 3785.6, -22859.6, 3662.5, -22847.2, 3647.1, -22799,
      3621.8, -22791.8, 3603, -22808.3, 3575.2, -22851.6, 3569.3, -22862.1, 3560, -22842.4, 3382.9,
      -22783.8, 3180.7, -22751.5, 3093.1, -22627.8, 2848.7, -22431.7, 2561.8, -22374.6, 2493.6,
      -22375.8, 2328.9, -22365.3, 2233, -22316.8, 2045.8, -22279.4, 1957, -22214.7, 1834.8, -22137,
      1714.7, -22067.8, 1588.9, -21978.8, 1471.7, -21955.5, 1404.9, -21950, 1373, -21992.1, 1202.2,
      -21989, 1132.2, -22049.7, 1107.7, -22049.5, 1073, -22003.4, 985.9, -21943.9, 957.7, -21891.6,
      753.8, -21872.7, 710.6, -21766.7, 605.4, -21774.3, 562.7, -21842.7, 518.1, -21842.7, 490,
      -21832.1, 468, -21895, 368.9, -21982.6, 191.5, -22059.2, 123.6, -22196.5, 78.9, -22232, 110.2,
      -22264, 112, -22296.8, 53.7, -22402.6, 33.4, -22503.9, 2.3, -22673.8, -76.8, -22873.2, -90.6,
      -23057.4, -137.9,
    ],
  },
]

const LUNIGIANA_ORIGIN = { lat: 44.16175, lon: 10.13 }
// Each anchor is its first part's south-west corner.
const LUNIGIANA_ANCHOR = { x: -2900, y: -6100 }
const LUNIGIANA = regionOf(
  { key: "lunigiana", id: "lunigiana", file: "monzone", test: false },
  LUNIGIANA_ORIGIN,
  PARTS,
  LUNIGIANA_ANCHOR,
)
const lucido = PARTS[0]!.rects[0]!

/**
 * The test regions, each built from Lunigiana's inputs on its origin and anchor (so a tree stands
 * where it does on the shipped map, with the same id):
 * - `lunigiana-l`: two rectangles of lucido in an L, 6 of its tiles. The leg, x −2400…0 by y
 *   0…3900, holds Monzone (its station, the Carabinieri, the start) and Gragnola's rail layout to
 *   lucido's north edge; the foot, x 0…2400 by y 0…1400, Equi Terme and its station. The notch, round
 *   Fazzano, Casciana and Codiponte, is real land, so roads leave the play area across its two sides
 *   and are capped there (`l-region.map-test.ts`, which CI runs on it).
 * - `lunigiana-lucido`: part lucido alone, as the shipped map was before Fivizzano joined it (issue
 *   #17): what `x3-region.map-test.ts` compares the 3x with, built by hand as the 3x is.
 * - `lunigiana-3x`: lucido between two rectangles of terrain only, as wide as it, 3 times its built
 *   terrain and 78 tiles; a mask on lucido's rectangle keeps the play area lucido's. Past lucido the
 *   terrain is the tile files' where Lunigiana's grown box filled them (x ≈ −4050…6050, and north
 *   of y ≈ 1950 from x ≈ −5350 to 10650) and their edge drawn on elsewhere (`loadDtm`), for the
 *   build's memory and time and the cars round Monzone (docs/map.md, "Test regions").
 * - `bagnone-ridge`: 4 × 4 km of the Apennine ridge round Monte Sillara, x −8000…−4000 by
 *   y 20000…24000, with terrain of its own and nothing else: the LiDAR stops 1–2 km below the crest,
 *   so it checks the fallback chain's seams and the summit (issue #10) before part 6 (#22) exists.
 * - `pontremoli-town`: 1.6 × 1.6 km round Pontremoli's town, x −20700…−19100 by y 23100…24700
 *   (lat 44.370–44.384, lon 9.872–9.890 rounded out to 100 m), with buildings of its own and nothing
 *   else: the DBT 1:2000 of 2010 and OSM's buildings, so it checks the DBT's adapter (issue #11)
 *   before part 8 (#24) exists.
 * - `magra-coast`: 6 × 4 km of the coast, x −14000…−8000 by y −15000…−11000, Liguria's but for
 *   Carrara's wedge east of the Parmignola: Punta Bianca and the cliffs under Montemarcello, the
 *   Magra's mouth between Bocca di Magra and Fiumaretta, and the sand of Marinella and Luni Mare,
 *   with the sea 0.7–2.2 km out to its south edge. Its terrain (Liguria's DTM, Massa-Carrara's
 *   10 m DTM in that wedge, the sea filled in), its OSM and Regione Liguria's sources are its own,
 *   so it builds a map of its own, which CI builds: it checks the sea, the beaches, the piers and
 *   the Magra's mouth (issue #13) before part 5 (#21) exists.
 */
const TEST_REGIONS: ReadonlyArray<Region> = [
  regionOf(
    { key: "lunigiana-l", id: "lunigiana", file: "lunigiana-l", test: true },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "lucido-l",
        title: "Valle del Lucido, an L from Gragnola to Equi Terme",
        rects: [
          [-2400, 0, 0, 3900],
          [0, 0, 2400, 1400],
        ],
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    { key: "lunigiana-lucido", id: "lunigiana", file: "lunigiana-lucido", test: true },
    LUNIGIANA_ORIGIN,
    [PARTS[0]!],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    { key: "lunigiana-3x", id: "lunigiana", file: "lunigiana-3x", test: true },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "lucido-3x",
        title: "Valle del Lucido between two of terrain only",
        rects: [[-10700, -6100, -2900, 3900], lucido, [4900, -6100, 12700, 3900]],
        mask: rectRing(lucido),
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    { key: "bagnone-ridge", id: "lunigiana", file: "bagnone-ridge", test: true, ownTerrain: true },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "sillara",
        title: "The Bagnone ridge round Monte Sillara",
        rects: [[-8000, 20000, -4000, 24000]],
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    {
      key: "pontremoli-town",
      id: "lunigiana",
      file: "pontremoli-town",
      test: true,
      ownBuildings: true,
    },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "pontremoli-town",
        title: "Pontremoli's town",
        rects: [[-20700, 23100, -19100, 24700]],
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
  regionOf(
    {
      key: "magra-coast",
      id: "lunigiana",
      file: "magra-coast",
      test: true,
      ownTerrain: true,
      ownOsm: true,
    },
    LUNIGIANA_ORIGIN,
    [
      {
        key: "magra-coast",
        title: "The coast from Punta Bianca to Luni Mare",
        rects: [[-14000, -15000, -8000, -11000]],
      },
    ],
    LUNIGIANA_ANCHOR,
  ),
]

const regions: ReadonlyArray<Region> = [
  LUNIGIANA,
  regionOf(
    { key: "cesena", id: "cesena", file: "cesena", test: false },
    { lat: 44.1391, lon: 12.2429 },
    [{ key: "cesena", title: "Cesena", rects: [[-2000, -2000, 2000, 2000]] }],
    { x: -2000, y: -2000 },
  ),
  ...TEST_REGIONS,
]

/** Selects a known region by its key (`--region <key>` or `--region=<key>`), defaulting to the original map; invalid input fails before I/O. */
export const regionFromArgs = (args: ReadonlyArray<string>): Region => {
  const index = args.indexOf("--region"),
    joined = args.find((a) => a.startsWith("--region="))
  const key =
    joined === undefined
      ? index < 0
        ? "lunigiana"
        : args[index + 1]
      : joined.slice("--region=".length)
  const region = regions.find((candidate) => candidate.key === key)
  if (region === undefined)
    throw new Error(
      `Unknown or missing region: ${key ?? "--region requires a name"} (use one of ${regions.map((r) => r.key).join(", ")})`,
    )
  return region
}

/** Where the build writes `region`'s files, from the repository root: beside the game's map code, or a test region's in the gitignored `test-maps`. */
export const mapDir = (region: Region): string => (region.test ? "test-maps" : "src/sim/map")

/** Where `fetch-rt` writes the DTM mosaic `region` is built on, from the repository root: its own folder, or Lunigiana's. */
export const dtmDir = (region: Region): string =>
  region.ownTerrain ? `data/raw/rt/${region.key}` : "data/raw/rt"

/** Where `fetch-rt` writes the surveys `region` is built on (`readSurveys`), from the repository root: its own folder, or Lunigiana's. */
export const surveyDir = (region: Region): string =>
  region.ownBuildings ? `data/raw/rt/${region.key}` : "data/raw/rt"

/** Where `fetch-rt` writes a Lunigiana part's land cover (the UCS 2019), from the repository root (issue #17). */
export const ucsFile = (part: Pick<Part, "key">): string => `data/raw/rt/ucs/${part.key}.json.gz`

/** Where `fetch-lig` writes a part's Regione Liguria sources (NC5, the DTM's crops, the land use), from the repository root (issue #12). */
export const ligDir = (part: Pick<Part, "key">): string => `data/raw/lig/${part.key}`

/** Where `fetch-osm` writes a part's OpenStreetMap extract, from the repository root (issue #7). */
export const osmFile = (part: Pick<Part, "key">): string => `data/raw/osm/${part.key}.osm.gz`

/**
 * The parts whose fetched inputs (OSM, land cover) `region` is built from, in order: its own, or a
 * test region's built from Lunigiana's inputs, Lunigiana's.
 */
export const inputParts = (region: Region): ReadonlyArray<Part> =>
  region.test && !region.ownBuildings && !region.ownOsm ? PARTS : region.parts

/**
 * The parts whose Regione Toscana land cover (`ucsFile`) the build of `region` reads: its input
 * parts, but none for a region with terrain of its own, which `fetch-rt` writes none for.
 */
export const ucsParts = (region: Region): ReadonlyArray<Part> =>
  region.ownTerrain ? [] : inputParts(region)

/**
 * The OSM extracts the build of `region` merges, in this order (`readOsms`), from the repository
 * root: its parts'. A test region, built from Lunigiana's inputs, reads Lunigiana's parts' (`PARTS`)
 * instead, but for one with buildings of its own (its own part's extract is what its map test
 * checks the surveys against) or OSM of its own.
 */
export const osmFiles = (region: Region): Array<string> =>
  inputParts(region).map((part) => osmFile(part))

/** Build region for this Node invocation, fixed before the geometry modules load. */
export const REGION = regionFromArgs(globalThis.process?.argv?.slice(2) ?? [])

/** Every part in Lunigiana's frame, each once (`lunigiana-lucido` shares lucido): its own, then its test regions'. */
const LUNIGIANA_PARTS = [...new Set([...PARTS, ...TEST_REGIONS.flatMap((r) => r.parts)])]

/**
 * The region a Lunigiana part belongs to: Lunigiana for its own parts, lucido too though
 * `lunigiana-lucido` is built of it, and the test region for a test region's.
 */
export const regionOfPart = (part: Part): Region =>
  PARTS.includes(part) ? LUNIGIANA : (TEST_REGIONS.find((r) => r.parts.includes(part)) ?? LUNIGIANA)

/**
 * The Lunigiana part with `key`, a test region's included; throws naming the known keys, so a tool
 * run without one says what to pass, and when the build region is not Lunigiana, whose local frame
 * the parts' rectangles are in.
 */
export const partOf = (key: string | undefined): Part => {
  if (REGION.id !== LUNIGIANA.id)
    throw new Error(`parts belong to the Lunigiana map, not --region ${REGION.id}`)
  const part = LUNIGIANA_PARTS.find((p) => p.key === key)
  if (part === undefined)
    throw new Error(
      `unknown part ${key}: use one of ${LUNIGIANA_PARTS.map((p) => p.key).join(", ")}`,
    )
  return part
}
