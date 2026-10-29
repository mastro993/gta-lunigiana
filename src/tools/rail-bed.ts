// The rail's level in the terrain: the tracks only the CTR has take the level of the nearest
// running track (the old yards lie level with the line), and a last pass brings the terrain under
// every at-grade centreline to the rail, so a train riding the profile never meets ground above it
// (roads that keep their cells beside the line left 0.75 m of terrain over the rail by Via Riolo)
// and the track never hangs over a hole.
import type { RailF } from "./features.ts"
import { segIndex, type V } from "./geometry.ts"
import { keepSamples, resample, type Grid, type Profile } from "./terrain.ts"

/** A piece as written to the map: its vertices plus the profile samples where the elevation bends. */
export interface Dense {
  readonly pts: ReadonlyArray<V>
  readonly z: ReadonlyArray<number>
}

/** Rail profile samples kept in the output where the elevation bends by more than this, m. */
export const RAIL_TOL = 0.03
/** Terrain may stand this far over an at-grade rail centreline, m (the grid is stored to 0.1 m). */
const BED = 0.05
/**
 * And lie this far under it, m: the corners of a cell the line clips stand up to 5.7 m off it,
 * outside the 4.3 m the profile writes, and a river's carve left one 7 m under the track north of
 * the Aulella bridge.
 */
const BANK = 0.5
/** Within this distance of a level crossing (m), the road's level decides the terrain. */
const BED_CLEAR = 6
/** The running track whose level an extra track takes lies within this distance, m (Equi's yard: 17 m). */
const REACH = 40

/**
 * Per-vertex elevations, output polylines and grid profiles (every 4 m) of the extra tracks: each
 * point takes the elevation of the nearest at-grade or bridge running track (`running`, as profiled),
 * a vertex with an id the one `nodeZ` already holds (switches on the line), and sets it otherwise
 * (a road crossing it is pinned there, as at the line's level crossings).
 */
export const extraLevels = (
  extra: ReadonlyArray<RailF>,
  running: ReadonlyArray<{ readonly piece: RailF; readonly dense: Dense }>,
  nodeZ: Map<string, number>,
): Map<RailF, { readonly z: Array<number>; readonly dense: Dense; readonly profile: Profile }> => {
  const idx = segIndex<{ za: number; zb: number }>(32)
  for (const { piece, dense } of running) {
    if (piece.tunnel === true) continue
    for (let k = 0; k + 1 < dense.pts.length; k++) {
      const a = dense.pts[k]!,
        b = dense.pts[k + 1]!
      idx.add(a.x, a.y, b.x, b.y, REACH, { za: dense.z[k]!, zb: dense.z[k + 1]! })
    }
  }
  const level = (x: number, y: number) => {
    let best = Number.MAX_VALUE,
      z = Number.NaN
    idx.within(x, y, (s, d2, t) => {
      if (d2 < best) [best, z] = [d2, s.data.za + (s.data.zb - s.data.za) * t]
    })
    if (Number.isNaN(z))
      throw new Error(`no running track within ${REACH} m of (${x.toFixed(1)}, ${y.toFixed(1)})`)
    return z
  }
  const out = new Map<RailF, { z: Array<number>; dense: Dense; profile: Profile }>()
  for (const piece of extra) {
    const p = resample(piece.pts, 4, level)
    const z = piece.pts.map((v, j) => {
      const k = p.vertexSample[j]!
      if (v.id !== undefined) {
        if (!nodeZ.has(v.id)) nodeZ.set(v.id, p.z[k]!)
        p.z[k] = nodeZ.get(v.id)!
      }
      return p.z[k]!
    })
    const vks = p.vertexSample,
      vertexAt = new Map(vks.map((k, j) => [k, j]))
    const ks = piece.bridge === true ? vks : keepSamples(p, vks, RAIL_TOL)
    const dense = {
      pts: ks.map((k) =>
        vertexAt.has(k) ? piece.pts[vertexAt.get(k)!]! : { x: p.x[k]!, y: p.y[k]! },
      ),
      z: ks.map((k) => p.z[k]!),
    }
    out.set(piece, { z, dense, profile: p })
  }
  return out
}

/**
 * Moves grid nodes so the terrain stays within BED over and BANK under every at-grade rail
 * centreline more than BED_CLEAR m from a level crossing: each stretch of centreline inside a cell
 * caps that cell's four corners at the lower rail elevation of its two ends plus BED, floored to
 * the grid's 0.1 m, so any interpolation of the cell (bilinear, or the drawn mesh's triangles)
 * stays under the rail, and raises them to the higher one less BANK, unless `keep` holds them (a
 * road's core, a river's bed). `lines` are the shipped (rounded) polylines and elevations; returns
 * the nodes lowered and the deepest cut, and the nodes raised and the highest fill.
 */
export const railBed = (
  g: Grid,
  lines: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly z: ReadonlyArray<number> }>,
  levelCrossings: ReadonlyArray<readonly [number, number]>,
  keep: (n: number) => boolean = () => false,
): { nodes: number; deepest: number; raised: number; fill: number } => {
  const cap = new Map<number, number>(),
    floor = new Map<number, number>()
  const clear = (x: number, y: number) =>
    levelCrossings.every(([cx, cy]) => Math.hypot(x - cx, y - cy) > BED_CLEAR)
  for (const { pts, z } of lines)
    for (let k = 0; k + 1 < z.length; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        bx = pts[2 * k + 2]!,
        by = pts[2 * k + 3]!
      // Parameters where the segment crosses a grid line, so each stretch lies in one cell.
      const ts = [0, 1]
      for (const [a, b, o] of [
        [ax, bx, g.x0],
        [ay, by, g.y0],
      ] as const) {
        if (a === b) continue
        for (let n = Math.ceil((Math.min(a, b) - o) / g.cell); o + n * g.cell < Math.max(a, b); n++)
          ts.push((o + n * g.cell - a) / (b - a))
      }
      ts.sort((p, q) => p - q)
      for (let m = 1; m < ts.length; m++) {
        const t0 = ts[m - 1]!,
          t1 = ts[m]!
        if (t1 - t0 < 1e-9) continue
        const at = (t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t] as const
        const [x0, y0] = at(t0),
          [x1, y1] = at(t1)
        if (!clear(x0, y0) && !clear(x1, y1)) continue
        const [mx, my] = at((t0 + t1) / 2)
        const i = Math.floor((mx - g.x0) / g.cell),
          j = Math.floor((my - g.y0) / g.cell)
        const za = z[k]! + (z[k + 1]! - z[k]!) * t0,
          zb = z[k]! + (z[k + 1]! - z[k]!) * t1
        const top = Math.floor((Math.min(za, zb) + BED) * 10 + 1e-6) / 10,
          bottom = Math.ceil((Math.max(za, zb) - BANK) * 10 - 1e-6) / 10
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const ii = Math.min(g.cols - 1, Math.max(0, i + di)),
            jj = Math.min(g.rows - 1, Math.max(0, j + dj))
          const n = jj * g.cols + ii
          cap.set(n, Math.min(cap.get(n) ?? Number.MAX_VALUE, top))
          floor.set(n, Math.max(floor.get(n) ?? -Number.MAX_VALUE, bottom))
        }
      }
    }
  let nodes = 0,
    deepest = 0,
    raised = 0,
    fill = 0
  for (const [n, top] of [...cap].sort((a, b) => a[0] - b[0])) {
    if (g.z[n]! > top + 1e-9) {
      deepest = Math.max(deepest, g.z[n]! - top)
      g.z[n] = top
      nodes++
    }
    // Never over the cap: a node two stretches share keeps under the lower rail.
    const bottom = Math.min(floor.get(n)!, top)
    if (g.z[n]! < bottom - 1e-9 && !keep(n)) {
      fill = Math.max(fill, bottom - g.z[n]!)
      g.z[n] = bottom
      raised++
    }
  }
  return { nodes, deepest, raised, fill }
}
