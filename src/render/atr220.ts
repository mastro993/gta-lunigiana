/**
 * The ATR 220 "Swing" as drawn (render/train places it): its cab car and its middle car, built from
 * their lengths, and a cab's head and tail lamps, in Trenitalia's DPR livery. Each car faces local
 * +X, stands on y = 0 at the rail head and is centred on its middle; a cab car's cab is at +X. The
 * body is the silver side with its dark window band, the blue cantrail band and roof, the cab's raked
 * front (the red band under the windscreen, the glass and dome in the middle, the blue hood either
 * side), the swoosh rising to the nose, the lines along the low floor, the lime doors, the roof's
 * air-conditioning unit and cooler, and the dark bogies, power pack and gangway bellows at the
 * joints, at reading sizes for this game's pixels; and its windows as lit at night.
 *
 * @module render/atr220
 */
import { BoxGeometry, type BufferGeometry, ExtrudeGeometry, Shape, Vector2 } from "three"

import { TRAINS } from "../sim/rail/models.ts"
import { paint } from "./geometry.ts"
import { PALETTE } from "./palette.ts"

/** A side profile: (x along the car, y over the rail head) points, m. */
type Outline = ReadonlyArray<readonly [x: number, y: number]>

/** A box from x0 to x1 along the car and y0 to y1 over the rail head, `d` m across, centred `z` m to its right. */
const block = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  d: number,
  hex: number,
  z = 0,
): BufferGeometry =>
  paint(new BoxGeometry(x1 - x0, y1 - y0, d).translate((x0 + x1) / 2, (y0 + y1) / 2, z), hex)

/** The side profile `outline` extruded across the car from z0 to z1. */
const across = (outline: Outline, z0: number, z1: number, hex: number): BufferGeometry =>
  paint(
    new ExtrudeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y))), {
      depth: z1 - z0,
      bevelEnabled: false,
    }).translate(0, 0, z0),
    hex,
  )

/** A livery patch: `outline` on both sides of a body `half` m either side of its centreline, standing `proud` m out of it. */
const patch = (outline: Outline, half: number, proud: number, hex: number) => [
  across(outline, half, half + proud, hex),
  across(outline, -half - proud, -half, hex),
]

/** The rectangle x0…x1 by y0…y1. */
const rect = (x0: number, x1: number, y0: number, y1: number): Outline => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

/** A band from x0 to x1 whose bottom and top rise from `from` to `to` (each [bottom, top]) on a curve steepening toward x1. */
const sweep = (
  x0: number,
  x1: number,
  from: readonly [number, number],
  to: readonly [number, number],
): Outline => {
  const at = (t: number, edge: 0 | 1) =>
    [x0 + (x1 - x0) * t, from[edge] + (to[edge] - from[edge]) * t * t] as const
  const ts = Array.from({ length: 9 }, (_, i) => i / 8)
  return [...ts.map((t) => at(t, 0)), ...ts.toReversed().map((t) => at(t, 1))]
}

/**
 * The ATR 220's body over the rail head, m: pesa.pl's width and height, pl.wikipedia's 0.6 m floor at the doors (1.2 m over
 * the bogies), the rest read off Commons photos and the FSE poster's side drawing at this game's pixel size.
 */
const SWING = {
  /** Each body ends this short of its Jacobs joint; the gangway's dark bellows fills the gap. */
  gap: 0.35,
  /** The bellows' width, and its bottom and top. */
  bellows: [2.4, 0.95, 3.3],
  /** The cab's front, raked back from the nose: this far back at the roof. */
  nose: 1.6,
  /** The body's bottom along the low floor, over a Jacobs bogie, and over the powered bogie under a cab. */
  low: 0.45,
  over: 1,
  cab: 0.85,
  /** How far in from its joint a Jacobs bogie's half reaches, and the body rides at `over` (the bogie's half and a step). */
  jacobs: 1.7,
  /** A bogie: half its length, its top, its width. */
  bogie: [1.4, 0.8, 2.3],
  /** The window band, and the silver side's top: the blue cantrail band is above, then the roof, a little narrower. */
  windows: [1.5, 2.45],
  band: 3,
  eaves: 3.45,
  roof: 3.8,
  /** The blue line, then the yellow, along the low floor: bottom, between, top. */
  lines: [0.45, 0.7, 0.95],
  /** A passenger door: its width and top; on an end car its middle is this far back from the nose (the drawing's ≈ 60 %). */
  door: [1.4, 2.65],
  doorFromNose: 11.75,
  /** Livery patches stand this far out of the side (a door this twice, over the band it cuts). */
  proud: 0.012,
  /** The windscreen's and the dome's middle, as wide as the glass: either side, the blue hood wraps it. */
  glass: 1.05,
} as const

/** A cab car of the ATR 220 `length` m long (nose to joint), its cab at +X. */
const cab = (length: number): Array<BufferGeometry> => {
  const { width, height, bogie } = TRAINS.atr220,
    S = SWING
  const n = length / 2,
    j = -length / 2,
    h = width / 2
  const back = j + S.gap,
    jacobs = j + S.jacobs,
    front = n - S.nose,
    powered = n - bogie - S.bogie[0] - 0.2,
    door = n - S.doorFromNose,
    [doorW, doorTop] = S.door
  // The raked front in three slices across: the glass and the dome's dark grey in the middle, the blue hood either side.
  const raked = (outline: Outline, middle: number) => [
    across(outline, -S.glass, S.glass, middle),
    across(outline, S.glass, h, PALETTE.dprBlue),
    across(outline, -h, -S.glass, PALETTE.dprBlue),
  ]
  return [
    // Running gear: the powered bogie under the cab, the Jacobs bogie's half at the joint, the power pack between, the bellows.
    block(
      n - bogie - S.bogie[0],
      n - bogie + S.bogie[0],
      0,
      S.bogie[1],
      S.bogie[2],
      PALETTE.dprUnder,
    ),
    block(j, j + S.bogie[0], 0, S.bogie[1], S.bogie[2], PALETTE.dprUnder),
    block(n - 8.2, powered, 0.15, S.low, 2.2, PALETTE.dprUnder),
    block(j, back, S.bellows[1], S.bellows[2], S.bellows[0], PALETTE.dprUnder),
    // The silver body, low between the bogies, then the cantrail band and the roof.
    block(back, jacobs, S.over, S.band, width, PALETTE.dprSilver),
    block(jacobs, powered, S.low, S.band, width, PALETTE.dprSilver),
    block(powered, front, S.cab, S.band, width, PALETTE.dprSilver),
    block(back, front, S.band, S.eaves, width, PALETTE.dprBlue),
    block(back, front, S.eaves, S.roof, width - 0.3, PALETTE.dprBlue),
    // The front: the skirt and the red coupler cover, the silver lower front, the red band, the lamps' dark band, the windscreen
    // raked back, and the dome over it.
    block(n - 0.5, n - 0.08, 0.2, S.cab, 2.6, PALETTE.dprUnder),
    block(n - 0.12, n, 0.6, 0.95, 0.45, PALETTE.dprRed),
    block(front, n - 0.08, S.cab, 1.25, width, PALETTE.dprSilver),
    block(front, n - 0.04, 1.25, 1.6, width, PALETTE.dprRed),
    ...raked(rect(front, n - 0.06, 1.6, 2), PALETTE.dprWindow),
    ...raked(
      [
        [front, 2],
        [n - 0.06, 2],
        [n - 0.8, 3.2],
        [front, 3.2],
      ],
      PALETTE.dprWindow,
    ),
    ...raked(
      [
        [front, 3.2],
        [n - 0.8, 3.2],
        [front, S.roof],
      ],
      PALETTE.dprWindow,
    ),
    // The sides: the window band up to the cab, where the blue hood sweeps down over the cab's flank round its side window.
    ...patch(
      [
        [back, S.windows[0]],
        [n - 2.74, S.windows[0]],
        [n - 3.29, S.windows[1]],
        [back, S.windows[1]],
      ],
      h,
      S.proud,
      PALETTE.dprWindow,
    ),
    ...patch(
      [
        [n - 2.8, 1.6],
        [front, 1.6],
        [front, S.band],
        [n - 3.6, S.band],
      ],
      h,
      S.proud,
      PALETTE.dprBlue,
    ),
    ...patch(
      [
        [n - 2.55, 1.75],
        [front - 0.05, 1.75],
        [front - 0.05, 2.7],
        [n - 2.25, 2.7],
      ],
      h,
      2 * S.proud,
      PALETTE.dprWindow,
    ),
    // The thin blue and yellow lines from the joint to the door, and from the door the swoosh rising to the nose: the blue
    // fills from the body's bottom up to the sweep's top edge, which runs back from the front to the door.
    ...patch(rect(jacobs, door - doorW / 2, S.lines[0], S.lines[1]), h, S.proud, PALETTE.dprBlue),
    ...patch(rect(jacobs, door - doorW / 2, S.lines[1], S.lines[2]), h, S.proud, PALETTE.dprYellow),
    ...patch(
      [
        [door + doorW / 2, S.low],
        [powered, S.cab],
        [front, 0.95],
        ...sweep(door + doorW / 2, front, [S.lines[0], S.lines[1]], [0.95, 1.2]).slice(9),
      ],
      h,
      S.proud,
      PALETTE.dprBlue,
    ),
    ...patch(
      sweep(door + doorW / 2, front, [S.lines[1], S.lines[2]], [1.2, 1.6]),
      h,
      S.proud,
      PALETTE.dprYellow,
    ),
    ...patch(
      rect(door - doorW / 2, door + doorW / 2, S.low, doorTop),
      h,
      2 * S.proud,
      PALETTE.dprLime,
    ),
    // On the roof: the air-conditioning unit, the engine's cooler and its exhaust stack.
    block(j + 2.5, j + 6.5, S.roof, S.roof + 0.3, 1.9, PALETTE.dprSilver),
    block(n - 8, n - 4.6, S.roof, height, 2.1, PALETTE.dprWindow),
    block(n - 4.45, n - 4.2, S.roof, height, 0.25, PALETTE.outline),
  ]
}

/** The ATR 220's middle car, `length` m joint to joint. */
const middle = (length: number): Array<BufferGeometry> => {
  const { width } = TRAINS.atr220,
    S = SWING
  const n = length / 2,
    h = width / 2,
    [doorW, doorTop] = S.door
  const back = -n + S.gap,
    fore = n - S.gap,
    jacobs = n - S.jacobs
  return [
    ...[-1, 1].flatMap((end) => [
      block(
        end * n - (end > 0 ? S.bogie[0] : 0),
        end * n + (end < 0 ? S.bogie[0] : 0),
        0,
        S.bogie[1],
        S.bogie[2],
        PALETTE.dprUnder,
      ),
      block(
        end > 0 ? fore : -n,
        end > 0 ? n : back,
        S.bellows[1],
        S.bellows[2],
        S.bellows[0],
        PALETTE.dprUnder,
      ),
    ]),
    block(back, -jacobs, S.over, S.band, width, PALETTE.dprSilver),
    block(-jacobs, jacobs, S.low, S.band, width, PALETTE.dprSilver),
    block(jacobs, fore, S.over, S.band, width, PALETTE.dprSilver),
    block(back, fore, S.band, S.eaves, width, PALETTE.dprBlue),
    block(back, fore, S.eaves, S.roof, width - 0.3, PALETTE.dprBlue),
    ...patch(rect(back, fore, S.windows[0], S.windows[1]), h, S.proud, PALETTE.dprWindow),
    ...[-1, 1].flatMap((end) => {
      const x0 = end > 0 ? doorW / 2 : -jacobs,
        x1 = end > 0 ? jacobs : -doorW / 2
      return [
        ...patch(rect(x0, x1, S.lines[0], S.lines[1]), h, S.proud, PALETTE.dprBlue),
        ...patch(rect(x0, x1, S.lines[1], S.lines[2]), h, S.proud, PALETTE.dprYellow),
      ]
    }),
    ...patch(rect(-doorW / 2, doorW / 2, S.low, doorTop), h, 2 * S.proud, PALETTE.dprLime),
    block(-2, 2, S.roof, S.roof + 0.3, 1.9, PALETTE.dprSilver),
  ]
}

/**
 * A car's lit windows (`cab`: a cab car, its cab at +X), on both sides: its window band, standing out of the body between the
 * band and the doors, so a door's window stays its own; a cab's windscreen and side window, the driver's, stay dark.
 */
const windows = (length: number, cab: boolean): Array<BufferGeometry> => {
  const n = length / 2,
    h = TRAINS.atr220.width / 2,
    S = SWING,
    back = -n + S.gap
  const band: Outline = cab
    ? [
        [back, S.windows[0]],
        [n - 2.74, S.windows[0]],
        [n - 3.29, S.windows[1]],
        [back, S.windows[1]],
      ]
    : rect(back, n - S.gap, S.windows[0], S.windows[1])
  return patch(band, h + S.proud, S.proud / 2, PALETTE.cabinLit)
}

/** A cab's lamps, its nose at +X `length` / 2: three white head lamps (two at the windscreen's lower corners, one at its top) or two red tail lamps beside the lower ones. */
const lamps = (length: number, end: "head" | "tail"): Array<BufferGeometry> => {
  const n = length / 2
  return end === "head"
    ? [
        block(n - 0.09, n - 0.03, 1.66, 1.94, 0.3, PALETTE.marbleWhite, 0.95),
        block(n - 0.09, n - 0.03, 1.66, 1.94, 0.3, PALETTE.marbleWhite, -0.95),
        block(n - 0.77, n - 0.65, 3, 3.15, 0.4, PALETTE.marbleWhite),
      ]
    : [
        block(n - 0.09, n - 0.03, 1.66, 1.94, 0.2, PALETTE.signalRed, 1.25),
        block(n - 0.09, n - 0.03, 1.66, 1.94, 0.2, PALETTE.signalRed, -1.25),
      ]
}

/** The ATR 220 as drawn: its cab car, its middle car, their lit windows, a cab's lamps, and the head lamps' height over the rail head (their middle), m. */
export const ATR220 = { cab, middle, windows, lamps, headLamps: 1.8 } as const
