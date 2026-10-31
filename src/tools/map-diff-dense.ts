// The dense layers' differences, for map-diff.ts: the heightmap's grid and the nodes both grids
// share, the land cover's cells, the coarse grid, a kind of wall or the trees as a multiset and in
// order, and the trees whose id differs on a spot both maps plant.
import { anchorOf } from "../sim/map/kinds.ts"
import {
  addFlat,
  type Box,
  boxText,
  emptyBox,
  fieldChanges,
  flatDiff,
  flatLine,
  num,
  outOfOrder,
} from "./diff-lists.ts"
import type { JoinedMap } from "./map-file.ts"

type Heightmap = JoinedMap["heightmap"]

const gridOf = ({ cell, cols, rows, x0, y0 }: Omit<Heightmap, "data">) => ({
  cell,
  cols,
  rows,
  x0,
  y0,
})
/**
 * The two heightmaps' grids, each with the node its lookups count from (`anchorOf`) where either
 * names one: else both count from (x0, y0), which the grid already says.
 */
const latticesOf = (a: Omit<Heightmap, "data">, b: Omit<Heightmap, "data">) => {
  const named = [a, b].some((hm) => hm.ax !== undefined || hm.ay !== undefined)
  const of = (hm: Omit<Heightmap, "data">) => {
    const { x, y } = anchorOf(hm)
    return named ? { ...gridOf(hm), ax: x, ay: y } : gridOf(hm)
  }
  return [of(a), of(b)] as const
}
const extent = ({ cell, cols, rows, x0, y0 }: Omit<Heightmap, "data">): string =>
  `x ${num(x0)}..${num(x0 + (cols - 1) * cell)}, y ${num(y0)}..${num(y0 + (rows - 1) * cell)}`

/** The grid's change, then the nodes both grids share: how many differ, the largest and RMS difference (m), and their box. */
export const diffHeightmap = (a: Heightmap, b: Heightmap): Array<string> => {
  const out: Array<string> = []
  const grid = fieldChanges(...latticesOf(a, b))
  if (grid.length > 0) out.push(`grid: ${grid.join(", ")}; extent ${extent(a)} -> ${extent(b)}`)
  // a's node (i, j) is b's node (i - di, j - dj)
  const di = (b.x0 - a.x0) / a.cell,
    dj = (b.y0 - a.y0) / a.cell
  if (a.cell !== b.cell || !Number.isInteger(di) || !Number.isInteger(dj)) {
    out.push("nodes: the grids do not line up, so no node is compared")
    return out
  }
  const i0 = Math.max(0, di),
    i1 = Math.min(a.cols, b.cols + di),
    j0 = Math.max(0, dj),
    j1 = Math.min(a.rows, b.rows + dj)
  if (i0 >= i1 || j0 >= j1) {
    out.push("nodes: the grids do not overlap")
    return out
  }
  let changed = 0,
    max = 0,
    sum2 = 0,
    iMin = i1,
    iMax = i0,
    jMin = j1,
    jMax = j0
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const d = a.data[j * a.cols + i]! - b.data[(j - dj) * b.cols + i - di]!
      if (d === 0) continue
      changed++
      sum2 += d * d
      max = Math.max(max, Math.abs(d))
      iMin = Math.min(iMin, i)
      iMax = Math.max(iMax, i)
      jMin = Math.min(jMin, j)
      jMax = Math.max(jMax, j)
    }
  if (changed > 0) {
    const box: Box = [
      a.x0 + iMin * a.cell,
      a.y0 + jMin * a.cell,
      a.x0 + iMax * a.cell,
      a.y0 + jMax * a.cell,
    ]
    out.push(
      `nodes: ${changed} of ${(i1 - i0) * (j1 - j0)} shared nodes differ, max ${num(max / 10)} m, RMS ${num(Math.sqrt(sum2 / changed) / 10)} m over them${boxText(box)}`,
    )
  }
  return out
}

/** The land-cover cells both maps' grids share that differ: how many, and their box. */
export const diffCover = (a: JoinedMap, b: JoinedMap): Array<string> => {
  const ga = a.heightmap,
    gb = b.heightmap,
    di = (gb.x0 - ga.x0) / ga.cell,
    dj = (gb.y0 - ga.y0) / ga.cell
  if (ga.cell !== gb.cell || !Number.isInteger(di) || !Number.isInteger(dj)) return []
  const ca = ga.cols - 1,
    cb = gb.cols - 1
  const i0 = Math.max(0, di),
    i1 = Math.min(ca, cb + di),
    j0 = Math.max(0, dj),
    j1 = Math.min(ga.rows - 1, gb.rows - 1 + dj)
  let changed = 0
  const box = emptyBox()
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++)
      if (a.cover[j * ca + i] !== b.cover[(j - dj) * cb + i - di]) {
        changed++
        addFlat(box, [ga.x0 + (i + 0.5) * ga.cell, ga.y0 + (j + 0.5) * ga.cell])
      }
  return changed > 0
    ? [
        `cells: ${changed} of ${Math.max(0, (i1 - i0) * (j1 - j0))} shared cells differ${boxText(box)}`,
      ]
    : []
}

/** The coarse grid's change: its lattice, then how many of the nodes' heights and covers differ (the grids must match). */
export const diffCoarse = (a: JoinedMap["coarse"], b: JoinedMap["coarse"]): Array<string> => {
  const grid = fieldChanges(gridOf(a), gridOf(b))
  if (grid.length > 0) return [`grid: ${grid.join(", ")}`]
  const count = (u: ArrayLike<number>, v: ArrayLike<number>) => {
    let n = 0
    for (let k = 0; k < u.length; k++) if (u[k] !== v[k]) n++
    return n
  }
  const heights = count(a.heights, b.heights),
    cover = count(a.cover, b.cover)
  return [
    ...(heights > 0 ? [`heights: ${heights} of ${a.heights.length} nodes differ`] : []),
    ...(cover > 0 ? [`cover: ${cover} of ${a.cover.length} nodes differ`] : []),
  ]
}

/**
 * A flat list compared in order (a kind of wall, the trees): its multiset line (`flatLine`), then
 * the fewest of the `noun` both maps hold that must move to restore their order (`outOfOrder`) and
 * their box, each line after `label` when there is one (`walk: …`, `walk order: …`).
 */
export const orderedLines = (
  label: string,
  noun: string,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  stride: number,
  coords: number,
): Array<string> => {
  const bag = flatDiff(a, b, stride),
    line = flatLine(a, b, stride, coords, bag),
    moved = outOfOrder(a, b, stride, bag),
    out = line === undefined ? [] : [label === "" ? line : `${label}: ${line}`]
  if (moved.length > 0) {
    const box = emptyBox()
    for (const i of moved) addFlat(box, a, i * stride, i * stride + coords)
    out.push(
      `${label === "" ? "" : `${label} `}order: ${moved.length} of ${a.length / stride - bag.removed.length} shared ${noun} moved${boxText(box)}`,
    )
  }
  return out
}

/** The trees on a spot both maps plant (one tree a spot) whose id differs there, and their box. */
export const idLines = (a: JoinedMap, b: JoinedMap): Array<string> => {
  // Whole metres well inside ±2^20 m: a spot's key is exact.
  const spot = (flat: ArrayLike<number>, k: number) =>
    (flat[3 * k]! + 2 ** 20) * 2 ** 21 + flat[3 * k + 1]! + 2 ** 20
  const idAt = new Map<number, number>()
  for (let k = 0; k < a.treeIds.length; k++) idAt.set(spot(a.trees, k), a.treeIds[k]!)
  let shared = 0,
    renumbered = 0
  const box = emptyBox()
  for (let k = 0; k < b.treeIds.length; k++) {
    const id = idAt.get(spot(b.trees, k))
    if (id === undefined) continue
    shared++
    if (id === b.treeIds[k]) continue
    renumbered++
    addFlat(box, b.trees, 3 * k, 3 * k + 2)
  }
  return renumbered === 0
    ? []
    : [`ids: ${renumbered} of ${shared} trees on a spot both maps plant renumbered${boxText(box)}`]
}
