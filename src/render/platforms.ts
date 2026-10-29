/**
 * Station platforms and the rail-level walkways between tracks (`MAP.railway.platforms`), drawn
 * chunk by chunk: each a slab whose top follows the rail profile (the map's platform top, the rail
 * head beside it + 0.25 m, which is also the ground the sim stands people on), a kerb down to the
 * ground under every edge, and on a platform a yellow line along its edges beside running track or
 * a loop. The furniture on them is render/stations'.
 *
 * @module render/platforms
 */
import { ShapeUtils, Vector2 } from "three"

import { segDist2 } from "../sim/collide.ts"
import { MAP, type Platform } from "../sim/map/index.ts"
import { boxOver, type Piece, Triangles } from "./geometry.ts"
import { terrainY, yOf } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { append } from "./ribbons.ts"
import { trackNear } from "./track-index.ts"

/** The slab's top is cut into strips this long along its track, m, so a strip's flat top stays within 2 cm of the rail profile. */
const CUT = 2
/** A platform's yellow line: its band in from the track-side edge, m (a reading width), and how far over the top it lies. */
const LINE = { from: 0.45, to: 0.65, over: 0.01 } as const
/** A ring edge is track-side when it lies this near the centreline of a running track or loop, m (the map keeps platforms 1.6–1.7 m off). */
const TRACK_SIDE = 2.2

/** A map point. */
export type P2 = readonly [number, number]

/** The top of platform `p` over (x, y), render y: at the nearest point of its axis, as the sim's `platformTop` has it. */
export const topOf = (p: Platform, x: number, y: number): number => {
  let best = Number.MAX_VALUE,
    top = p.top[0]!
  for (let k = 0; k + 1 < p.top.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      p.axis[2 * k]!,
      p.axis[2 * k + 1]!,
      p.axis[2 * k + 2]!,
      p.axis[2 * k + 3]!,
    )
    if (d2 < best) [best, top] = [d2, p.top[k]! + (p.top[k + 1]! - p.top[k]!) * t]
  }
  return yOf(top)
}

/** The unit direction of a platform's axis, first vertex to last. */
export const dirOf = (p: Platform): P2 => {
  const dx = p.axis.at(-2)! - p.axis[0]!,
    dy = p.axis.at(-1)! - p.axis[1]!,
    l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

/** The coordinate of `p` along unit direction `dir`, m. */
export const along = (p: P2, dir: P2): number => p[0] * dir[0] + p[1] * dir[1]

/** Where segment p–q crosses the line `along` = c, computed from the pair in a fixed order, so two faces sharing the edge get the very same point (no cracks). */
const cutAt = (p: P2, q: P2, c: number, dir: P2): P2 => {
  const [a, b] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p]
  const t = (c - along(a, dir)) / (along(b, dir) - along(a, dir))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** The convex polygon of triangle `tri` between the lines `along` = lo and hi. */
const slab = (tri: ReadonlyArray<P2>, lo: number, hi: number, dir: P2): Array<P2> => {
  const out: Array<P2> = []
  for (let i = 0; i < tri.length; i++) {
    const p = tri[i]!,
      q = tri[(i + 1) % tri.length]!,
      up = along(p, dir),
      uq = along(q, dir)
    if (up >= lo && up <= hi) out.push(p)
    const crossed = [lo, hi].filter((c) => (up - c) * (uq - c) < 0)
    if (uq < up) crossed.reverse()
    for (const c of crossed) out.push(cutAt(p, q, c, dir))
  }
  return out
}

/** Edge p–q cut where it crosses the strips' lines, from p to q. */
const cutEdge = (p: P2, q: P2, dir: P2): Array<P2> => {
  const up = along(p, dir),
    uq = along(q, dir),
    lines: Array<number> = []
  for (let k = Math.floor(Math.min(up, uq) / CUT) + 1; k * CUT < Math.max(up, uq); k++)
    lines.push(k * CUT)
  if (uq < up) lines.reverse()
  return [p, ...lines.map((c) => cutAt(p, q, c, dir)), q]
}

/** A flat ring as its points. */
export const ringPoints = (ring: ReadonlyArray<number>): Array<P2> =>
  Array.from({ length: ring.length / 2 }, (_, k) => [ring[2 * k]!, ring[2 * k + 1]!] as const)

/** Whether a running track or loop's centreline (not a siding's) passes within `reach` m of (x, y). */
const byTrack = (x: number, y: number, reach: number): boolean =>
  trackNear(x, y, reach).some(({ rail }) => rail.kind !== "siding")

/**
 * A platform's faces in two layers: its top (earcut, then cut into `CUT` m strips across its axis, each corner at the platform
 * top over it), a kerb face down to the ground under every edge, and on a platform the yellow line along its track-side edges.
 */
const platformFaces = (p: Platform): { readonly solid: Triangles; readonly decal: Triangles } => {
  const solid = new Triangles(),
    decal = new Triangles(),
    dir = dirOf(p)
  const rings = MAP.areas[p.area]!.rings.map(ringPoints)
  const h = (q: P2) => topOf(p, q[0], q[1])
  const point = (q: P2, y: number) => [q[0], y, -q[1]] as const
  const corners = rings.flat()
  const holes = rings.slice(1).map((ring) => ring.map(([x, y]) => new Vector2(x, y)))
  for (const [a, b, c] of ShapeUtils.triangulateShape(
    rings[0]!.map(([x, y]) => new Vector2(x, y)),
    holes,
  )) {
    const tri = [corners[a!]!, corners[b!]!, corners[c!]!],
      us = tri.map((q) => along(q, dir))
    for (let k = Math.floor(Math.min(...us) / CUT); k * CUT < Math.max(...us); k++) {
      const poly = slab(tri, k * CUT, (k + 1) * CUT, dir)
      for (let i = 1; i + 1 < poly.length; i++) {
        const [q0, q1, q2] = [poly[0]!, poly[i]!, poly[i + 1]!]
        if (Math.abs((q1[0] - q0[0]) * (q2[1] - q0[1]) - (q1[1] - q0[1]) * (q2[0] - q0[0])) < 1e-6)
          continue
        const [x0, y0, z0] = point(q0, h(q0)),
          [x1, y1, z1] = point(q1, h(q1)),
          [x2, y2, z2] = point(q2, h(q2))
        // Counter-clockwise seen from above (map x, y): a front face looking up.
        const ccw = (q1[0] - q0[0]) * (q2[1] - q0[1]) - (q1[1] - q0[1]) * (q2[0] - q0[0]) > 0
        if (ccw) solid.tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, PALETTE.asphaltWorn)
        else solid.tri(x0, y0, z0, x2, y2, z2, x1, y1, z1, PALETTE.asphaltWorn)
      }
    }
  }
  // Every ring keeps the platform on its left (outer rings counter-clockwise, holes clockwise): its kerb faces right.
  for (const ring of rings)
    for (let k = 0; k < ring.length; k++) {
      const cut = cutEdge(ring[k]!, ring[(k + 1) % ring.length]!, dir)
      for (let i = 0; i + 1 < cut.length; i++) {
        const [q0, q1] = [cut[i]!, cut[i + 1]!],
          dx = q1[0] - q0[0],
          dy = q1[1] - q0[1],
          l = Math.hypot(dx, dy)
        if (l < 1e-6) continue
        const ox = dy / l,
          oy = -dx / l
        const foot = (q: P2) => Math.min(terrainY(q[0] + ox * 0.15, q[1] + oy * 0.15), h(q)) - 0.1
        solid.face(
          point(q0, foot(q0)),
          point(q1, foot(q1)),
          point(q1, h(q1)),
          point(q0, h(q0)),
          [ox, 0, -oy],
          PALETTE.kerb,
        )
        if (p.walkway === true || !byTrack((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, TRACK_SIDE))
          continue
        const band = (q: P2, d: number) => {
          const at: P2 = [q[0] - ox * d, q[1] - oy * d]
          return point(at, h(at) + LINE.over)
        }
        decal.face(
          band(q0, LINE.from),
          band(q1, LINE.from),
          band(q1, LINE.to),
          band(q0, LINE.to),
          [0, 1, 0],
          PALETTE.signYellow,
        )
      }
    }
  return { solid, decal }
}

/**
 * A platform as a piece along its rim: built whole on its first draw (it reads the ground under its
 * whole rim) and kept, each triangle into the chunk of its middle, so a chunk keeps exactly its share.
 */
export const platformPiece = (p: Platform): Piece => {
  const outer = MAP.areas[p.area]!.rings[0]!
  let faces: ReturnType<typeof platformFaces> | undefined
  return {
    pts: [...outer, outer[0]!, outer[1]!],
    reads: boxOver(outer),
    draw: (at) => {
      faces ??= platformFaces(p)
      for (const layer of ["solid", "decal"] as const) {
        const tris = faces[layer]
        for (let i = 0; i < tris.position.length / 9; i++) {
          const x =
              (tris.position[9 * i]! + tris.position[9 * i + 3]! + tris.position[9 * i + 6]!) / 3,
            y =
              -(tris.position[9 * i + 2]! + tris.position[9 * i + 5]! + tris.position[9 * i + 8]!) /
              3
          append(tris, at(x, y)[layer], i)
        }
      }
    },
  }
}
