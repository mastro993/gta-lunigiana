/**
 * The stations, drawn chunk by chunk: the platforms (render/platforms), one blue RFI name board per
 * platform people wait on, a canopy along a station building's track side where a platform runs
 * along it, and where the platforms' lamp poles stand (`platformLamps`, which render/sky/lamps adds
 * to the street lamps, so the night lights and the glow read one list). Nothing here is placed by
 * hand: every spot comes from the platforms, the station buildings and the track.
 *
 * @module render/stations
 */
import { pointInRing, segDist2 } from "../sim/collide.ts"
import { buildingStyleOf, MAP, type Platform } from "../sim/map/index.ts"
import { boxOver, type Piece } from "./geometry.ts"
import { groundY } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { along, dirOf, type P2, platformPiece, ringPoints, topOf } from "./platforms.ts"
import { block } from "./ribbons.ts"
import { trackNear } from "./track-index.ts"

/** A name board (RFI: white capitals on blue): per character and its length's bounds, its middle's and half its height over the platform, how far back from the track-side edge it stands, m. */
const BOARD = {
  char: 0.16,
  shortest: 2,
  longest: 6,
  up: 2.35,
  half: 0.25,
  back: [1.8, 1.2, 2.4],
} as const
/** Where a board may move along its platform from the middle to fit, m. */
const SHIFTS = [0, -4, 4, -8, 8, -12, 12] as const
/** Pole lamps: apart along a platform, their poles in from the track-side edge, lanterns over the top and the room kept from a board and a canopy, m. */
const LAMP = { every: 18, back: 1, up: 4, board: 1.5, canopy: 1.5 } as const
/** Points tested inside a platform stand this far in from its rim, m. */
const MARGIN = 0.3
/**
 * A canopy along a station building's wall facing the track, a flat metal one like Gragnola's (photos of the station): its
 * depth, its roof's underside over the platform and its posts at most `every` m apart, m. It keeps `CLEAR` m off the nearest
 * track centreline (a train's half width, 1.44 m, and a margin), and stands where a platform or walkway covers `COVERED` of
 * the strip `STRIP` m out from the wall: a wall with the platform running along it, not one with a forecourt or a garden
 * between it and the track.
 */
const ALONG = { deep: 4.5, under: 3.4, every: 6 } as const
const CLEAR = 1.95
const STRIP = [0.5, 1.5, 2.5] as const
const COVERED = 0.8
/** A station building stands within this many metres of its track. */
const TRACK_REACH = 100

/** Whether (x, y) and the four points `MARGIN` m round it lie on platform `p` (inside its rim, outside its holes). */
const onPlatform = (p: Platform, x: number, y: number): boolean => {
  const [outer, ...holes] = MAP.areas[p.area]!.rings
  return [
    [0, 0],
    [MARGIN, 0],
    [-MARGIN, 0],
    [0, MARGIN],
    [0, -MARGIN],
  ].every(
    ([dx, dy]) =>
      pointInRing(x + dx!, y + dy!, outer!) &&
      !holes.some((hole) => pointInRing(x + dx!, y + dy!, hole)),
  )
}

/** A frame along a platform at `u` m along its axis direction: the axis point there, the track's direction and the unit across it toward the platform. */
const frameAt = (p: Platform, u: number) => {
  const dir = dirOf(p),
    n = p.axis.length / 2
  let k = 0
  while (k + 2 < n && along([p.axis[2 * k + 2]!, p.axis[2 * k + 3]!], dir) < u) k++
  const a: P2 = [p.axis[2 * k]!, p.axis[2 * k + 1]!],
    b: P2 = [p.axis[2 * k + 2]!, p.axis[2 * k + 3]!]
  const t = Math.max(0, Math.min(1, (u - along(a, dir)) / (along(b, dir) - along(a, dir) || 1)))
  const x = a[0] + (b[0] - a[0]) * t,
    y = a[1] + (b[1] - a[1]) * t,
    l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const tx = (b[0] - a[0]) / l,
    ty = (b[1] - a[1]) / l
  // The platform's side of its axis: where the middle of its rim lies.
  const outer = MAP.areas[p.area]!.rings[0]!
  let cx = 0,
    cy = 0
  for (let i = 0; i < outer.length; i += 2) [cx, cy] = [cx + outer[i]!, cy + outer[i + 1]!]
  cx /= outer.length / 2
  cy /= outer.length / 2
  const side = tx * (cy - y) - ty * (cx - x) >= 0 ? 1 : -1
  return { x, y, tx, ty, ox: -ty * side, oy: tx * side }
}

/** How far out from the axis point of `frame` the platform begins (its track-side edge), m; undefined when none lies within 15 m. */
const edgeOf = (p: Platform, frame: ReturnType<typeof frameAt>): number | undefined => {
  const [outer, ...holes] = MAP.areas[p.area]!.rings
  for (let d = 0; d < 15; d += 0.05) {
    const x = frame.x + frame.ox * d,
      y = frame.y + frame.oy * d
    if (pointInRing(x, y, outer!) && !holes.some((hole) => pointInRing(x, y, hole))) return d
  }
  return undefined
}

/** The range of a platform's rim along its axis direction, m. */
const spanOf = (p: Platform): readonly [number, number] => {
  const dir = dirOf(p),
    us = ringPoints(MAP.areas[p.area]!.rings[0]!).map((q) => along(q, dir))
  return [Math.min(...us), Math.max(...us)]
}

/** A name board: its middle (map), its direction along the track, its length and the station's words. */
interface Board {
  readonly x: number
  readonly y: number
  readonly tx: number
  readonly ty: number
  readonly length: number
  readonly words: ReadonlyArray<string>
}

/** The platforms people wait on (not the rail-level walkways), with their station's name. */
const platforms = (): Array<Platform & { readonly name: string }> =>
  MAP.railway.platforms.flatMap((p) =>
    p.walkway === true || p.name === undefined ? [] : [{ ...p, name: p.name }],
  )

/** A platform's name board: as near its middle as fits, `BOARD.back` m back from the track-side edge, along the track. */
const boardOf = (p: Platform & { readonly name: string }): Board | undefined => {
  const words = p.name.split(/[\s-]+/).filter((w) => w.length > 0)
  const length = Math.min(BOARD.longest, Math.max(BOARD.shortest, 0.6 + BOARD.char * p.name.length))
  const [u0, u1] = spanOf(p)
  for (const shift of SHIFTS) {
    const frame = frameAt(p, (u0 + u1) / 2 + shift),
      edge = edgeOf(p, frame)
    if (edge === undefined) continue
    for (const back of BOARD.back) {
      const x = frame.x + frame.ox * (edge + back),
        y = frame.y + frame.oy * (edge + back)
      const ends = [-1, 1].map(
        (s) => [x + frame.tx * (length / 2) * s, y + frame.ty * (length / 2) * s] as const,
      )
      if (onPlatform(p, x, y) && ends.every(([ex, ey]) => onPlatform(p, ex, ey)))
        return { x, y, tx: frame.tx, ty: frame.ty, length, words }
    }
  }
  return undefined
}

/** A name board whole in its chunk: two posts, a white-rimmed blue board, and the station's words as white bars on both faces. */
const boardPiece = (board: Board): Piece => ({
  pts: [board.x, board.y],
  draw: (at) => {
    const tris = at(board.x, board.y).solid,
      { x, y, tx, ty, length, words } = board
    const ground = groundY(x, y),
      mid = ground + BOARD.up
    block(
      tris,
      x,
      mid,
      -y,
      tx,
      -ty,
      length / 2 + 0.05,
      BOARD.half + 0.05,
      0.03,
      PALETTE.marbleWhite,
    )
    block(tris, x, mid, -y, tx, -ty, length / 2, BOARD.half, 0.04, PALETTE.rfiBlue)
    for (const s of [-1, 1]) {
      const px = x + tx * (length / 2 - 0.2) * s,
        py = y + ty * (length / 2 - 0.2) * s,
        foot = groundY(px, py) - 0.05
      block(
        tris,
        px,
        (foot + mid + BOARD.half) / 2,
        -py,
        tx,
        -ty,
        0.04,
        (mid + BOARD.half - foot) / 2,
        0.04,
        PALETTE.signalPole,
      )
    }
    // A character's room, one between words; each word a bar its letters long.
    const chars = words.reduce((n, w) => n + w.length, 0) + words.length - 1,
      unit = (length - 0.4) / chars
    let from = -(length - 0.4) / 2
    for (const word of words) {
      const half = (word.length * unit) / 2,
        c = from + half
      block(
        tris,
        x + tx * c,
        mid,
        -(y + ty * c),
        tx,
        -ty,
        half - unit * 0.1,
        BOARD.half * 0.4,
        0.05,
        PALETTE.marbleWhite,
      )
      from += (word.length + 1) * unit
    }
  },
})

/** A canopy: its footprint (map ring, for keeping lamps out) and the piece drawing it. */
interface Canopy {
  readonly ring: ReadonlyArray<number>
  readonly piece: Piece
}

/** The wall of the station's building facing the track (its outer edge whose outward side looks at the nearest track centreline, the nearest such), with that track's distance, m. */
const trackWall = (outer: ReadonlyArray<number>) => {
  let best:
    | { ax: number; ay: number; bx: number; by: number; ox: number; oy: number; d: number }
    | undefined
  for (let k = 0; k < outer.length; k += 2) {
    const ax = outer[k]!,
      ay = outer[k + 1]!,
      bx = outer[(k + 2) % outer.length]!,
      by = outer[(k + 3) % outer.length]!
    const l = Math.hypot(bx - ax, by - ay),
      ox = (by - ay) / l,
      oy = -(bx - ax) / l
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2
    let d = Number.MAX_VALUE,
      facing = 0
    for (const track of trackNear(mx, my, TRACK_REACH)) {
      const { d2, t } = segDist2(mx, my, track.ax, track.ay, track.bx, track.by)
      if (d2 >= d * d) continue
      d = Math.sqrt(d2)
      const rx = track.ax + (track.bx - track.ax) * t,
        ry = track.ay + (track.by - track.ay) * t
      facing = ((rx - mx) * ox + (ry - my) * oy) / (d || 1)
    }
    if (facing > 0.7 && (best === undefined || d < best.d)) best = { ax, ay, bx, by, ox, oy, d }
  }
  return best
}

/**
 * The share of the strip `STRIP` m out from the wall a → b (outward normal o) inside the rim of a platform or walkway: a
 * platform wrapping round its building has it as a hole, the eaves' footprint, a little wider than the walls.
 */
const platformAlong = (ax: number, ay: number, bx: number, by: number, ox: number, oy: number) => {
  let on = 0,
    n = 0
  for (let t = 0.05; t < 1; t += 0.1)
    for (const d of STRIP) {
      const x = ax + (bx - ax) * t + ox * d,
        y = ay + (by - ay) * t + oy * d
      n++
      if (MAP.railway.platforms.some((p) => pointInRing(x, y, MAP.areas[p.area]!.rings[0]!))) on++
    }
  return on / n
}

/** The canopy along each station's building (the station-style building of its name), where a platform runs along its track wall. */
const canopies = (): Array<Canopy> =>
  MAP.railway.stations.flatMap((station): Array<Canopy> => {
    const building = MAP.buildings.find(
      (b) => buildingStyleOf(b) === "station" && b.name === station.name,
    )
    const wall = building === undefined ? undefined : trackWall(building.outer)
    if (wall === undefined) return []
    const { ax, ay, bx, by, ox, oy } = wall
    if (platformAlong(ax, ay, bx, by, ox, oy) < COVERED) return []
    const l = Math.hypot(bx - ax, by - ay),
      tx = (bx - ax) / l,
      ty = (by - ay) / l,
      wide = l - 0.6
    const deep = Math.min(ALONG.deep, wall.d - CLEAR),
      mx = (ax + bx) / 2,
      my = (ay + by) / 2
    if (deep < 1) return []
    const corner = (s: number, d: number) => [
      mx + tx * (wide / 2) * s + ox * d,
      my + ty * (wide / 2) * s + oy * d,
    ]
    const cx = mx + ox * (deep / 2),
      cy = my + oy * (deep / 2)
    const ring = [...corner(-1, 0), ...corner(1, 0), ...corner(1, deep), ...corner(-1, deep)]
    return [
      {
        ring,
        piece: {
          pts: [mx, my],
          reads: boxOver(ring),
          draw: (at) => {
            const tris = at(mx, my).solid,
              hex = PALETTE.canopyGrey,
              roof = groundY(mx + ox, my + oy) + ALONG.under
            block(tris, cx, roof + 0.08, -cy, tx, -ty, wide / 2, 0.08, deep / 2, hex)
            const posts = Math.ceil(wide / ALONG.every) + 1
            for (let i = 0; i < posts; i++) {
              const s = -1 + (2 * i) / (posts - 1),
                px = mx + tx * (wide / 2 - 0.2) * s + ox * (deep - 0.2),
                py = my + ty * (wide / 2 - 0.2) * s + oy * (deep - 0.2),
                foot = groundY(px, py) - 0.05
              block(tris, px, (foot + roof) / 2, -py, tx, -ty, 0.06, (roof - foot) / 2, 0.06, hex)
            }
          },
        },
      },
    ]
  })

let canopyList: ReadonlyArray<Canopy> | undefined
const allCanopies = (): ReadonlyArray<Canopy> => (canopyList ??= canopies())

/**
 * Where each platform's lamp poles stand: every `LAMP.every` m along it, `LAMP.back` m in from its track-side edge, on the
 * platform, clear of its name board and out from under the canopies; the lantern `LAMP.up` m over the top, its bracket
 * reaching toward the track. render/sky/lamps hangs the lanterns and draws the poles.
 */
export const platformLamps = (): Array<{
  readonly x: number
  readonly y: number
  readonly h: number
  readonly nx: number
  readonly ny: number
}> =>
  platforms().flatMap((p) => {
    const board = boardOf(p),
      [u0, u1] = spanOf(p)
    const count = Math.max(1, Math.floor((u1 - u0 - 6) / LAMP.every) + 1)
    return Array.from(
      { length: count },
      (_, i) => (u0 + u1) / 2 + (i - (count - 1) / 2) * LAMP.every,
    ).flatMap((u) => {
      const frame = frameAt(p, u),
        edge = edgeOf(p, frame)
      if (edge === undefined) return []
      const x = frame.x + frame.ox * (edge + LAMP.back),
        y = frame.y + frame.oy * (edge + LAMP.back)
      const nearBoard =
        board !== undefined && Math.hypot(x - board.x, y - board.y) < board.length / 2 + LAMP.board
      const covered = allCanopies().some(({ ring }) => {
        if (pointInRing(x, y, ring)) return true
        for (let k = 0; k < ring.length; k += 2) {
          const { d2 } = segDist2(
            x,
            y,
            ring[k]!,
            ring[k + 1]!,
            ring[(k + 2) % ring.length]!,
            ring[(k + 3) % ring.length]!,
          )
          if (d2 < LAMP.canopy ** 2) return true
        }
        return false
      })
      if (!onPlatform(p, x, y) || nearBoard || covered) return []
      return [{ x, y, h: topOf(p, x, y) + LAMP.up, nx: -frame.ox, ny: -frame.oy }]
    })
  })

/** Every station piece of the map: the platforms and walkways, their name boards and the canopies. */
export const stationPieces = (): Array<Piece> => [
  ...MAP.railway.platforms.map(platformPiece),
  ...platforms().flatMap((p) => {
    const board = boardOf(p)
    return board === undefined ? [] : [boardPiece(board)]
  }),
  ...allCanopies().map(({ piece }) => piece),
]
