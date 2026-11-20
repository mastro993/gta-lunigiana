/**
 * The buffer stop at each terminus inside the map, where a line's track ends and its trains turn round (Aulla Lunigiana's
 * track 4, the Lucca–Aulla line's): a beam of rail steel across the track on two posts, at the height of a train's buffers, and a
 * red board over it facing the train coming in, the stop signal a terminus track ends at. The sim's driven train stops
 * dead there (`buffersOf` in sim/rail/collisions.ts): its head at the line's end, against the beam's face. A chunk piece,
 * drawn with the track; it reads no ground, standing on the line's own profile.
 *
 * @module render/buffers
 */
import { RAIL_LIFT } from "../sim/map/index.ts"
import { LINES, pointAt } from "../sim/rail/lines.ts"
import type { Piece } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { block } from "./ribbons.ts"

/**
 * A buffer stop as drawn, m: its beam's centre over the rail head (a UIC buffer's 1.065 m), its height, thickness along
 * the track and half its width across it (wider than a train's 1.44 m half width), its posts' half size and where they
 * stand across the track (on the rails), and the red board's half side and thickness, standing on the beam, behind its
 * face.
 */
export const BUFFER = {
  beam: 1.065,
  tall: 0.2,
  thick: 0.3,
  half: 1.5,
  post: 0.12,
  posts: 0.72,
  side: 0.3,
  plate: 0.04,
} as const

/** A buffer stop: where its beam's face meets a train's head (the line's end) and the unit heading a train comes in along. */
export interface BufferStop {
  readonly x: number
  readonly y: number
  /** The rail head there, m a.s.l. */
  readonly z: number
  readonly ux: number
  readonly uy: number
}

/** The buffer stop at the end of every line that ends at a terminus inside the map. */
export const bufferStops = (): Array<BufferStop> =>
  LINES.filter((line) => line.terminus).map((line) => {
    const { x, y, z, angle } = pointAt(line, line.length)
    return { x, y, z, ux: Math.cos(angle), uy: Math.sin(angle) }
  })

/** A buffer stop's piece: the beam and its posts of old rail, the red board over it facing the train coming in. */
const bufferPiece = ({ x, y, z, ux, uy }: BufferStop): Piece => {
  const B = BUFFER,
    // The beam's and the board's centre, half the beam's thickness past its face.
    cx = x + (ux * B.thick) / 2,
    cy = y + (uy * B.thick) / 2,
    head = yOf(z),
    bed = head - RAIL_LIFT
  return {
    pts: [cx, cy],
    draw: (at) => {
      const tris = at(cx, cy).solid
      block(
        tris,
        cx,
        head + B.beam,
        -cy,
        ux,
        -uy,
        B.thick / 2,
        B.tall / 2,
        B.half,
        PALETTE.railSteel,
      )
      for (const s of [-1, 1]) {
        const px = cx - uy * B.posts * s,
          py = cy + ux * B.posts * s,
          top = head + B.beam
        block(
          tris,
          px,
          (bed + top) / 2,
          -py,
          ux,
          -uy,
          B.post,
          (top - bed) / 2,
          B.post,
          PALETTE.railSteel,
        )
      }
      const board = head + B.beam + B.tall / 2 + B.side
      block(tris, cx, board, -cy, ux, -uy, B.plate / 2, B.side, B.side, PALETTE.signalRed)
    },
  }
}

/** Every buffer stop's piece. */
export const bufferPieces = (): Array<Piece> => bufferStops().map(bufferPiece)
