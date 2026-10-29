/**
 * The railway's static parts, drawn chunk by chunk like the roads: every `MAP.rail` piece (the
 * lines' running track, loops and sidings), the fixed parts of each level crossing, and the tunnel
 * portals (render/portals). Drawn widths are reading widths, not real ones: at 5 texels/m, the zoom a
 * driven train lives at, a real sleeper every 0.6 m is 1.5 texels a period on the screen's vertical
 * and breaks into a crawling moiré, and a real 0.07 m rail head flickers (at 0.18 m, 0.9 texel,
 * the rails still broke into dashes that crawled from frame to frame), so sleepers are 0.6 m every
 * 1.2 m and rails 0.24 m wide, 1.2 texels, both decals on a low 3D ballast bed people walk over. Nothing
 * 3D stands in a crossing's box (its road's carriageway, a metre wider for the bed): the road decal
 * floats over its profile and hides decal rails, so the box draws its panels and rails over it.
 * What moves or lights at a crossing (the arms and the lenses) is render/crossings'; the housings, the
 * lights' plates and poles and the cabinets here stand round them.
 *
 * @module render/rail
 */
import { MAP, RAIL_LIFT } from "../sim/map/index.ts"
import { CROSSINGS } from "../sim/rail/crossings.ts"
import { BARRIER, ROAD_LIGHT } from "./crossings.ts"
import { type Piece, type Sink, Triangles, WaterTriangles } from "./geometry.ts"
import { atGradeY, surfaceY, terrainY, yOf } from "./ground.ts"
import { deck } from "./lines.ts"
import { PALETTE } from "./palette.ts"
import { portalPieces } from "./portals.ts"
import { append, block, strips, surfaceNear, throughApron } from "./ribbons.ts"
import { BOX_REACH, BOXES, boxAt, PANEL, trackNear } from "./track-index.ts"

/** Rail centres apart, m (the 1.435 m gauge). */
const GAUGE = 1.435
/** Sleepers across, along (every other `dash` m: a 1.2 m pitch) and over the bed's profile, m. */
const SLEEPER = { width: 2.4, dash: 0.6, lift: 0.07 } as const
/** A rail's width, m; its head lies `RAIL_LIFT` over the bed's profile, where the sim's trains ride. */
const RAIL = 0.24
/**
 * The ballast bed, m: its top over the profile (at most 0.15 m over the terrain on 90 % of the line at grade, so feet
 * crossing it stay in sight; the sim's ground has no track), its top's half width, and its shoulders' foot, out from
 * the centreline and at least `drop` under the top, down to the terrain where the line runs on a bank.
 */
const BED = { top: 0.02, half: 1.6, foot: 2.1, drop: 0.25 } as const
/** On a bridge the ballast is a flat strip over the deck, m. */
const DECK_BALLAST = { width: 3.2, lift: 0.04 } as const
/** The bed stops this far short of a box's carriageway, m. */
const BED_CLEAR = 1
/** How far over the road ribbon a crossing's panel (`PANEL` m across the track), its rails and the stop lines lie, m. */
const OVER = { panel: 0.02, rail: 0.03, stop: 0.025 } as const
/** A stop line's width along the road, m (DPR 495/1992 art. 144: a continuous one is at least 0.5 m). */
const STOP_LINE = 0.5
/**
 * A barrier's housing (Wegh TD96/2: 0.6 m square), its top over the road and its gap to the arm's face, m; the road light's
 * black back plate (its rim round the lens, and its depth between the arm's plane and the lens's 6 cm back) and the hood
 * over it, and the light's pole's half width.
 */
const HOUSING = { half: 0.3, top: 1.3, gap: 0.02 } as const
const PLATE = { rim: 0.05, depth: 0.02, hood: 0.18, pole: 0.04 } as const
/** A box's equipment cabinet, m: half its sides, its height, and where it stands from the first approach's pivot. */
const CABINET = { along: 0.45, across: 0.25, high: 1.5, off: 1.3, back: 1.8 } as const
/** A three-space point. */
type Point3 = readonly [number, number, number]

/** The left unit normal of segment k of a flat polyline. */
const leftOf = (pts: ReadonlyArray<number>, k: number): readonly [number, number] => {
  const dx = pts[2 * k + 2]! - pts[2 * k]!,
    dy = pts[2 * k + 3]! - pts[2 * k + 1]!,
    l = Math.hypot(dx, dy) || 1
  return [-dy / l, dx / l]
}

/** The mitred left normal at vertex k of a polyline of `n` vertices, scaled so a strip keeps its width round a bend. */
const mitre = (pts: ReadonlyArray<number>, n: number, k: number): readonly [number, number] => {
  const a = leftOf(pts, Math.max(0, k - 1)),
    b = leftOf(pts, Math.min(n - 2, k))
  const mx = a[0] + b[0],
    my = a[1] + b[1],
    ml = Math.hypot(mx, my) || 1
  const scale = 1 / ml / Math.max((mx * b[0] + my * b[1]) / ml, 0.5)
  return [mx * scale, my * scale]
}

/** The bed's cross-section at (x, y) on profile z with left normal n: its top's edges and its shoulders' feet, left then right. */
const section = (x: number, y: number, z: number, [nx, ny]: readonly [number, number]) => {
  const top = yOf(z) + BED.top
  const edge = (side: number, out: number, h: number): Point3 => [
    x + nx * out * side,
    h,
    -(y + ny * out * side),
  ]
  const foot = (side: number): Point3 => {
    const fx = x + nx * BED.foot * side,
      fy = y + ny * BED.foot * side
    return [fx, Math.min(terrainY(fx, fy) - 0.05, top - BED.drop), -fy]
  }
  return { lt: edge(1, BED.half, top), rt: edge(-1, BED.half, top), lf: foot(1), rf: foot(-1) }
}

/**
 * The ballast bed under segments k0..k1 of an at-grade line, densified every 2 m, each stretch in the chunk of its
 * midpoint: a top `BED.half` m either side and shoulders sloping to the terrain, no corner of it within `BED_CLEAR` m of a box.
 */
const bed = (line: {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}): Piece => ({
  pts: line.pts,
  draw: (at, k0, k1) => {
    const { pts, z } = line,
      n = z.length
    for (let k = k0; k <= k1 && k + 1 < n; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        bx = pts[2 * k + 2]!,
        by = pts[2 * k + 3]!
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2)),
        normal = leftOf(pts, k)
      let from = section(ax, ay, z[k]!, mitre(pts, n, k))
      for (let j = 1; j <= steps; j++) {
        const t = j / steps,
          x = ax + (bx - ax) * t,
          y = ay + (by - ay) * t
        const to = section(
          x,
          y,
          z[k]! + (z[k + 1]! - z[k]!) * t,
          j === steps ? mitre(pts, n, k + 1) : normal,
        )
        const mx = ax + (bx - ax) * (t - 0.5 / steps),
          my = ay + (by - ay) * (t - 0.5 / steps)
        const corners = [from.lt, from.rt, from.lf, from.rf, to.lt, to.rt, to.lf, to.rf]
        if (corners.every(([cx, , cz]) => boxAt(cx, -cz, BED_CLEAR) < 0)) {
          const tris = at(mx, my).solid,
            [nx, ny] = normal
          tris.face(from.rt, to.rt, to.lt, from.lt, [0, 1, 0], PALETTE.ballast)
          tris.face(from.lt, to.lt, to.lf, from.lf, [nx, 0.6, -ny], PALETTE.ballast)
          tris.face(from.rf, to.rf, to.rt, from.rt, [-nx, 0.6, ny], PALETTE.ballast)
        }
        from = to
      }
    }
  },
})

/** Every rail piece's track: the bed at grade (a deck on a bridge), sleepers (wooden on a siding) and rails; tunnels are dark. */
const track = (): Array<Piece> =>
  MAP.rail.flatMap((rail) => {
    if (rail.tunnel === true) return []
    const lifted = rail.bridge === true,
      line = throughApron(rail.pts, rail.z)
    const y = (lift: number) => (x: number, y: number, z: number) => surfaceY(z, x, y, lift, lifted)
    const inBox = (x: number, y: number) => boxAt(x, y, 0) >= 0
    const sleepers = rail.kind === "siding" ? PALETTE.woodBrown : PALETTE.sleeperConcrete
    return [
      lifted
        ? deck(
            rail.pts,
            (k) => yOf(rail.z[k]!) + DECK_BALLAST.lift,
            DECK_BALLAST.width,
            PALETTE.stoneMid,
          )
        : bed(line),
      strips(line, [
        ...(lifted
          ? [{ ...line, width: DECK_BALLAST.width, hex: PALETTE.ballast, y: y(DECK_BALLAST.lift) }]
          : []),
        {
          ...line,
          width: SLEEPER.width,
          hex: sleepers,
          dash: SLEEPER.dash,
          y: y(SLEEPER.lift),
          skip: inBox,
        },
        ...[-1, 1].map((side) => ({
          ...line,
          width: RAIL,
          hex: PALETTE.railSteel,
          offset: (side * GAUGE) / 2,
          y: y(RAIL_LIFT),
          skip: inBox,
        })),
      ]),
    ]
  })

/** A flat quad over the road from (ax, ay) to (bx, by), `width` m across, `offset` left, `over` m over `surface`. */
const overRoad = (
  tris: Triangles,
  surface: (x: number, y: number) => number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  offset: number,
  over: number,
  hex: number,
): void => {
  const [nx, ny] = leftOf([ax, ay, bx, by], 0)
  const p = (x: number, y: number, side: number): Point3 => {
    const px = x + nx * (offset + (side * width) / 2),
      py = y + ny * (offset + (side * width) / 2)
    return [px, surface(px, py) + over, -py]
  }
  tris.quad(p(ax, ay, -1), p(bx, by, -1), p(bx, by, 1), p(ax, ay, 1), hex)
}

/** The track inside box `b`: a panel under two rails over the road, every half metre of each rail piece through it. */
const panels = (tris: Triangles, b: number, surface: (x: number, y: number) => number): void => {
  const { x, y } = BOXES[b]!
  for (const { rail, ax, ay, bx, by } of trackNear(x, y, BOX_REACH)) {
    if (rail.bridge === true) continue
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5))
    for (let j = 0; j < steps; j++) {
      const [x0, y0, x1, y1] = [
        ax + ((bx - ax) * j) / steps,
        ay + ((by - ay) * j) / steps,
        ax + ((bx - ax) * (j + 1)) / steps,
        ay + ((by - ay) * (j + 1)) / steps,
      ]
      if (boxAt((x0 + x1) / 2, (y0 + y1) / 2, 0) !== b) continue
      overRoad(tris, surface, x0, y0, x1, y1, PANEL, 0, OVER.panel, PALETTE.crossingPanel)
      for (const side of [-1, 1])
        overRoad(
          tris,
          surface,
          x0,
          y0,
          x1,
          y1,
          RAIL,
          (side * GAUGE) / 2,
          OVER.rail,
          PALETTE.railHead,
        )
    }
  }
}

/** An approach's stop line: white, `STOP_LINE` m wide, across its lane (the whole carriageway on a one-way road). */
const stopLine = (
  tris: Triangles,
  b: number,
  approach: number,
  surface: (x: number, y: number) => number,
): void => {
  const crossing = CROSSINGS[b]!,
    road = MAP.roads[crossing.road]!
  const { stop, heading } = crossing.approaches[approach]!
  const ux = Math.cos(heading),
    uy = Math.sin(heading)
  // From the far end to the near end of the line, across the road: right of the approach.
  const reach = road.w / 2 - 0.15,
    from = road.oneway === true ? -reach : 0
  const steps = Math.max(1, Math.ceil((reach - from) / 1))
  for (let j = 0; j < steps; j++) {
    const a = from + ((reach - from) * j) / steps,
      c = from + ((reach - from) * (j + 1)) / steps
    // Along the right of the approach (its heading turned −90°), the line STOP_LINE wide along the road.
    overRoad(
      tris,
      surface,
      stop.x + uy * a,
      stop.y - ux * a,
      stop.x + uy * c,
      stop.y - ux * c,
      STOP_LINE,
      0,
      OVER.stop,
      PALETTE.marbleWhite,
    )
  }
}

/**
 * An approach's barrier housing and its road light's fixings, round what render/crossings moves and lights: the arm turning
 * on `Approach.pivot`, `BARRIER.pivot` over the road, in the plane square to the road there (`BARRIER.thick` along it), and
 * the lens `ROAD_LIGHT.proud` m from that plane toward the traffic coming in. The housing stands on the traffic's side of
 * the arm's plane and off the road from the pivot, the arm hinged on its face; the light's black back plate fills the gap
 * between the arm and the lens, a hood over it, on a pole standing on the housing beside the lens, clear of the arm as it
 * swings.
 */
const housing = (sink: Sink, b: number, approach: number): void => {
  const { pivot, entry, heading } = CROSSINGS[b]!.approaches[approach]!
  const road = atGradeY(entry.x, entry.y),
    ux = Math.cos(heading),
    uy = Math.sin(heading)
  // Map x, y `u` m into the box from the pivot and `r` m right of the approach.
  const at = (u: number, r: number) =>
    [pivot.x + ux * u + uy * r, pivot.y + uy * u - ux * r] as const
  const face = BARRIER.thick / 2,
    [hx, hy] = at(-(face + HOUSING.gap + HOUSING.half), HOUSING.half)
  const foot = Math.min(terrainY(hx, hy), road) - 0.3,
    top = road + HOUSING.top
  block(
    sink.solid,
    hx,
    (foot + top) / 2,
    -hy,
    ux,
    -uy,
    HOUSING.half,
    (top - foot) / 2,
    HOUSING.half,
    PALETTE.barrierWhite,
  )
  const lens = road + ROAD_LIGHT.up,
    half = ROAD_LIGHT.size / 2 + PLATE.rim,
    back = ROAD_LIGHT.proud - ROAD_LIGHT.deep / 2
  const [px, py] = at(-(face + back) / 2, 0)
  block(sink.solid, px, lens, -py, ux, -uy, PLATE.depth / 2, half, half, PALETTE.signalBlack)
  const [qx, qy] = at(-(face + PLATE.hood / 2), 0)
  block(
    sink.solid,
    qx,
    lens + half + 0.02,
    -qy,
    ux,
    -uy,
    PLATE.hood / 2,
    0.02,
    half,
    PALETTE.signalBlack,
  )
  const [sx, sy] = at(-ROAD_LIGHT.proud, half + PLATE.pole)
  block(
    sink.solid,
    sx,
    (top + lens + half) / 2,
    -sy,
    ux,
    -uy,
    PLATE.pole,
    (lens + half - top) / 2,
    PLATE.pole,
    PALETTE.signalPole,
  )
}

/** A box's equipment cabinet, beside its first approach's housing and back from it, away from the track. */
const cabinet = (sink: Sink, b: number): void => {
  const crossing = CROSSINGS[b]!,
    { pivot, heading } = crossing.approaches[0]!
  const ux = Math.cos(heading),
    uy = Math.sin(heading)
  const x = pivot.x + uy * CABINET.off - ux * CABINET.back,
    y = pivot.y - ux * CABINET.off - uy * CABINET.back
  const foot = terrainY(x, y) - 0.3
  block(
    sink.solid,
    x,
    foot + CABINET.high / 2 + 0.15,
    -y,
    ux,
    -uy,
    CABINET.along,
    CABINET.high / 2 + 0.15,
    CABINET.across,
    PALETTE.cabinetGrey,
  )
}

/**
 * Each level crossing as one piece at its middle, whole in its chunk: the panels and rails over its road, and per approach
 * the stop line and the housing. Built once with the pieces (the road ribbons under it are drawn again for it), then copied.
 */
const crossings = (roads: ReadonlyArray<Piece>): Array<Piece> =>
  MAP.railway.crossings.map((crossing, b) => {
    const built: Sink = {
      solid: new Triangles(),
      decal: new Triangles(),
      water: new WaterTriangles(),
      glow: new Triangles(),
      pieces: [],
    }
    const { x, y } = BOXES[b]!,
      surface = surfaceNear(roads, x, y, BOX_REACH)
    panels(built.decal, b, surface)
    for (const approach of CROSSINGS[b]!.approaches.keys()) {
      stopLine(built.decal, b, approach, surface)
      housing(built, b, approach)
    }
    if (CROSSINGS[b]!.approaches.length > 0) cabinet(built, b)
    return {
      pts: [crossing.x, crossing.y],
      draw: (at) => {
        const sink = at(crossing.x, crossing.y)
        for (const layer of ["solid", "decal"] as const) append(built[layer], sink[layer])
      },
    }
  })

/** Every static railway piece of the map: the track, the crossings' fixed parts (laid over `roads`, the world's road pieces from `linePieces`) and the tunnel portals. */
export const railPieces = (roads: ReadonlyArray<Piece>): Array<Piece> => [
  ...track(),
  ...crossings(roads),
  ...portalPieces(),
]
