// The differences between two built maps, category by category, for checking that a pipeline
// change moves only what it should. Run: node src/tools/map-diff.ts <a.bin> <b.bin>  (pnpm map-diff
// <a.bin> <b.bin>). Reads two monzone.bin files (gzipped or not) of one format version, decodes
// them (`decodeMap`, which throws on any other version) and prints one block per category that
// differs, or "no differences". Exits 0 when the maps are the same, 1 when anything differs, 2 on
// bad arguments or a file it cannot read.
// - A key it does not compare, at the top level or inside a part it reads key by key (heightmap,
//   graph, walls, railway, spawns), is listed under "unhandled keys" whether or not it differs, so
//   a key a later map adds is never passed over as "no differences".
// - Order is ignored: lists compare as multisets of their items (wall segments, trees, areas,
//   barriers, graph nodes and edges), or matched by id where items have one (roads, buildings,
//   water, rail, pois; districts by name), the pieces that share an id in order of occurrence.
// - Indices into other lists are compared as what they point at: a graph edge as its two nodes'
//   coordinates and its road's id, a level crossing's road as its id, so inserting one road does
//   not renumber every edge into a difference.
// - The heightmap compares the nodes both grids share (they must line up: one cell size, origins
//   whole cells apart): how many differ, by how much at most and RMS (m), and where.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import type { MonzoneMap } from "../sim/map/index.ts"
import { decodeMap } from "../sim/map/packed.ts"
import {
  addFlat,
  type Bag,
  bagDiff,
  type Box,
  boxText,
  canon,
  emptyBox,
  fieldChanges,
  flatDiff,
  keyedDiff,
  num,
} from "./diff-lists.ts"

/** One category that differs: its name and the report's lines for it. */
interface Block {
  readonly category: string
  readonly lines: ReadonlyArray<string>
}

/** Items listed per kind of change before "... and n more". */
const LIST = 10

type Heightmap = MonzoneMap["heightmap"]

const TOP_FIELDS = ["origin", "mPerDeg", "bounds"] as const
const WALL_KINDS = ["walk", "shore", "drive"] as const
const RAILWAY_PARTS = ["lines", "stations", "crossings", "platforms"] as const

/** The keys `diffMaps` compares, per part it reads key by key ("" the top level); any other key is unhandled. */
const COMPARED: ReadonlyArray<readonly [string, (m: MonzoneMap) => object, ReadonlyArray<string>]> =
  [
    [
      "",
      (m) => m,
      [
        // decodeMap reads one version only, so both maps have the same
        "version",
        ...TOP_FIELDS,
        "heightmap",
        "walls",
        "trees",
        "roads",
        "buildings",
        "water",
        "rail",
        "railway",
        "areas",
        "barriers",
        "pois",
        "districts",
        "spawns",
        "graph",
      ] satisfies ReadonlyArray<keyof MonzoneMap>,
    ],
    ["heightmap", (m) => m.heightmap, ["cell", "cols", "rows", "x0", "y0", "data"]],
    ["graph", (m) => m.graph, ["xy", "edges", "traffic", "walk"]],
    ["walls", (m) => m.walls, WALL_KINDS],
    ["railway", (m) => m.railway, RAILWAY_PARTS],
    ["spawns", (m) => m.spawns, ["player", "parked"]],
  ]

/** Each key in either map that `COMPARED` does not list, as `part.key: differs` or `: the same in both`. */
const unhandledKeys = (a: MonzoneMap, b: MonzoneMap): Array<string> =>
  COMPARED.flatMap(([part, of, keys]) => {
    const u: Record<string, unknown> = { ...of(a) },
      v: Record<string, unknown> = { ...of(b) }
    return [...new Set([...Object.keys(u), ...Object.keys(v)])]
      .filter((k) => !keys.includes(k))
      .map(
        (k) =>
          `${part === "" ? k : `${part}.${k}`}: ${canon(u[k]) === canon(v[k]) ? "the same in both" : "differs"}`,
      )
  })

/** "2 changed, 1 added, 3 removed", leaving out the zero counts. */
const counts = (changed: number, added: number, removed: number): string =>
  [
    changed > 0 ? `${changed} changed` : "",
    added > 0 ? `${added} added` : "",
    removed > 0 ? `${removed} removed` : "",
  ]
    .filter((s) => s !== "")
    .join(", ")

/** Appends up to `LIST` entries, indented, then how many more there are. */
const listed = (out: Array<string>, entries: ReadonlyArray<string>): void => {
  for (const e of entries.slice(0, LIST)) out.push(`  ${e}`)
  if (entries.length > LIST) out.push(`  ... and ${entries.length - LIST} more`)
}

/** Grows `box` round an item's geometry: `pts`, `outer`, `axis`, `rings` or its `x`, `y`. */
const itemBox = (box: Box, item: object): void => {
  const v = item as {
    readonly pts?: ReadonlyArray<number>
    readonly outer?: ReadonlyArray<number>
    readonly axis?: ReadonlyArray<number>
    readonly rings?: ReadonlyArray<ReadonlyArray<number>>
    readonly x?: number
    readonly y?: number
  }
  for (const flat of [v.pts, v.outer, v.axis, ...(v.rings ?? [])])
    if (flat !== undefined) addFlat(box, flat)
  if (v.x !== undefined && v.y !== undefined) addFlat(box, [v.x, v.y])
}

const gridOf = ({ cell, cols, rows, x0, y0 }: Heightmap) => ({ cell, cols, rows, x0, y0 })
const extent = ({ cell, cols, rows, x0, y0 }: Heightmap): string =>
  `x ${num(x0)}..${num(x0 + (cols - 1) * cell)}, y ${num(y0)}..${num(y0 + (rows - 1) * cell)}`

/** The grid's change, then the nodes both grids share: how many differ, the largest and RMS difference (m), and their box. */
const diffHeightmap = (a: Heightmap, b: Heightmap): Array<string> => {
  const out: Array<string> = []
  const grid = fieldChanges(gridOf(a), gridOf(b))
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

/** The counts of a multiset diff of flat tuples and the box round the first `coords` numbers of each changed tuple. */
const flatLine = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  stride: number,
  coords: number,
): string | undefined => {
  const bag = flatDiff(a, b, stride)
  if (bag.added.length + bag.removed.length === 0) return undefined
  const box = emptyBox()
  for (const i of bag.removed) addFlat(box, a, i * stride, i * stride + coords)
  for (const j of bag.added) addFlat(box, b, j * stride, j * stride + coords)
  return `${counts(0, bag.added.length, bag.removed.length)}${boxText(box)}`
}

/** One line per named part that differs, `name: counts, box`. */
const partLines = (parts: ReadonlyArray<readonly [string, string | undefined]>): Array<string> =>
  parts.flatMap(([name, line]) => (line === undefined ? [] : [`${name}: ${line}`]))

/** A multiset diff of items by their content. */
const bagOf = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): Bag => {
  const ja = a.map(canon),
    jb = b.map(canon)
  return bagDiff(
    a.length,
    b.length,
    (i) => ja[i]!,
    (j) => jb[j]!,
  )
}

/** The counts and box of a multiset diff of items by their content. */
const bagLine = (
  a: ReadonlyArray<object>,
  b: ReadonlyArray<object>,
): readonly [string | undefined, Bag] => {
  const bag = bagOf(a, b)
  if (bag.added.length + bag.removed.length === 0) return [undefined, bag]
  const box = emptyBox()
  for (const i of bag.removed) itemBox(box, a[i]!)
  for (const j of bag.added) itemBox(box, b[j]!)
  return [`${counts(0, bag.added.length, bag.removed.length)}${boxText(box)}`, bag]
}

/** Areas or barriers as a multiset by content, the counts also per kind (`forest +1 -2`). */
const kindLines = (
  a: ReadonlyArray<{ readonly kind: string }>,
  b: ReadonlyArray<{ readonly kind: string }>,
): Array<string> => {
  const [line, bag] = bagLine(a, b)
  if (line === undefined) return []
  const kinds = new Map<string, { plus: number; minus: number }>()
  const count = (kind: string, plus: number, minus: number) => {
    const c = kinds.get(kind) ?? { plus: 0, minus: 0 }
    kinds.set(kind, { plus: c.plus + plus, minus: c.minus + minus })
  }
  for (const j of bag.added) count(b[j]!.kind, 1, 0)
  for (const i of bag.removed) count(a[i]!.kind, 0, 1)
  const per = [...kinds].map(
    ([kind, { plus, minus }]) =>
      `${kind}${plus > 0 ? ` +${plus}` : ""}${minus > 0 ? ` -${minus}` : ""}`,
  )
  return [`${line} (${per.join(", ")})`]
}

interface Named {
  readonly id?: number
  readonly name?: string
}

/** Items matched by `key`: the counts and box, then each changed item with its changed fields, each removed and each added item. */
const keyedLines = <T extends Named>(
  noun: string,
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  key: (item: T) => string | number,
): Array<string> => {
  const d = keyedDiff(a, b, key)
  if (d.changed.length + d.added.length + d.removed.length === 0) return []
  const label = (t: T) =>
    [noun, t.id === undefined ? "" : String(t.id), t.name === undefined ? "" : `"${t.name}"`]
      .filter((s) => s !== "")
      .join(" ")
  const box = emptyBox()
  for (const t of [...d.removed, ...d.added, ...d.changed.flat()]) itemBox(box, t)
  const out = [`${counts(d.changed.length, d.added.length, d.removed.length)}${boxText(box)}`]
  listed(
    out,
    d.changed.map(([p, q]) => `changed ${label(p)}: ${fieldChanges(p, q).join(", ")}`),
  )
  listed(
    out,
    d.removed.map((t) => `removed ${label(t)}`),
  )
  listed(
    out,
    d.added.map((t) => `added ${label(t)}`),
  )
  return out
}

/** `list[k]`, or an error naming the list when an index points past it (the map's parts disagree). */
const at = <T>(list: ReadonlyArray<T>, k: number, what: string): T => {
  const item = list[k]
  if (item === undefined) throw new Error(`an index points at ${what} ${k} of ${list.length}`)
  return item
}

/** Graph node `n`'s coordinates. */
const nodeXy = (m: MonzoneMap, n: number): [number, number] => [
  at(m.graph.xy, 2 * n, "graph coordinate"),
  at(m.graph.xy, 2 * n + 1, "graph coordinate"),
]

/** The graph with its indices resolved: nodes (x, y), edges and the traffic and walk sets as (ax, ay, bx, by, road id). */
const graphTuples = (m: MonzoneMap) => {
  const { edges } = m.graph
  const all = Array.from({ length: edges.length / 3 }, (_, e) => [
    ...nodeXy(m, edges[3 * e]!),
    ...nodeXy(m, edges[3 * e + 1]!),
    at(m.roads, edges[3 * e + 2]!, "road").id,
  ])
  return {
    nodes: m.graph.xy,
    edges: all.flat(),
    traffic: m.graph.traffic.flatMap((e) => at(all, e, "graph edge")),
    walk: m.graph.walk.flatMap((e) => at(all, e, "graph edge")),
  }
}

/** The railway with its indices resolved: a rail piece as its id and first vertex, a road as its id, graph nodes as coordinates, an area as its kind and first vertex. */
const railwayParts = (m: MonzoneMap) => {
  const railRef = (r: number) => {
    const piece = at(m.rail, r, "rail piece")
    return `${piece.id}@${piece.pts[0]},${piece.pts[1]}`
  }
  const areaRef = (k: number) => {
    const area = at(m.areas, k, "area")
    return `${area.kind}@${area.rings[0]?.[0]},${area.rings[0]?.[1]}`
  }
  const { lines, stations, crossings, platforms } = m.railway
  return {
    lines: lines.map((l) => ({
      ...l,
      pieces: l.pieces.map((p) => ({ rail: railRef(p.rail), rev: p.rev })),
    })),
    stations,
    crossings: crossings.map((c) => ({
      ...c,
      road: at(m.roads, c.road, "road").id,
      nodes: c.nodes.map((n) => nodeXy(m, n)),
    })),
    platforms: platforms.map((p) => ({ ...p, area: areaRef(p.area) })),
  }
}

/** The origin, metres per degree and bounds. */
const diffTop = (a: MonzoneMap, b: MonzoneMap): Array<string> =>
  TOP_FIELDS.flatMap((k) => {
    const changes = fieldChanges(a[k], b[k])
    return changes.length > 0 ? [`${k}: ${changes.join(", ")}`] : []
  })

/** Every category in which `a` and `b` differ, in a fixed order; none when the maps are the same. */
export const diffMaps = (a: MonzoneMap, b: MonzoneMap): ReadonlyArray<Block> => {
  const ga = graphTuples(a),
    gb = graphTuples(b)
  const ra = railwayParts(a),
    rb = railwayParts(b)
  const player = fieldChanges(a.spawns.player, b.spawns.player)
  const blocks: ReadonlyArray<Block> = [
    { category: "unhandled keys", lines: unhandledKeys(a, b) },
    { category: "top level", lines: diffTop(a, b) },
    { category: "heightmap", lines: diffHeightmap(a.heightmap, b.heightmap) },
    {
      category: "walls",
      lines: partLines(WALL_KINDS.map((k) => [k, flatLine(a.walls[k], b.walls[k], 4, 4)])),
    },
    { category: "trees", lines: [flatLine(a.trees, b.trees, 3, 2) ?? []].flat() },
    { category: "roads", lines: keyedLines("road", a.roads, b.roads, (r) => r.id) },
    { category: "buildings", lines: keyedLines("building", a.buildings, b.buildings, (r) => r.id) },
    { category: "water", lines: keyedLines("water", a.water, b.water, (r) => r.id) },
    { category: "rail", lines: keyedLines("rail", a.rail, b.rail, (r) => r.id) },
    {
      category: "railway",
      lines: partLines(RAILWAY_PARTS.map((k) => [k, bagLine(ra[k], rb[k])[0]])),
    },
    { category: "areas", lines: kindLines(a.areas, b.areas) },
    { category: "barriers", lines: kindLines(a.barriers, b.barriers) },
    { category: "pois", lines: keyedLines("poi", a.pois, b.pois, (p) => p.id) },
    {
      category: "districts",
      lines: keyedLines("district", a.districts, b.districts, (d) => d.name),
    },
    {
      category: "spawns",
      lines: [
        ...(player.length > 0 ? [`player: ${player.join(", ")}`] : []),
        ...partLines([["parked", bagLine(a.spawns.parked, b.spawns.parked)[0]]]),
      ],
    },
    {
      category: "graph",
      lines: partLines([
        ["nodes", flatLine(ga.nodes, gb.nodes, 2, 2)],
        ["edges", flatLine(ga.edges, gb.edges, 5, 4)],
        ["traffic", flatLine(ga.traffic, gb.traffic, 5, 4)],
        ["walk", flatLine(ga.walk, gb.walk, 5, 4)],
      ]),
    },
  ]
  return blocks.filter((block) => block.lines.length > 0)
}

/** The report: each block's category, then its lines indented, then which categories differ; "no differences" when there are no blocks. */
export const formatDiff = (blocks: ReadonlyArray<Block>): string =>
  blocks.length === 0
    ? "no differences"
    : [
        ...blocks.flatMap((block) => [
          `${block.category}:`,
          ...block.lines.map((line) => `  ${line}`),
        ]),
        `${blocks.length} ${blocks.length === 1 ? "category differs" : "categories differ"}: ${blocks.map((block) => block.category).join(", ")}`,
      ].join("\n")

/** The decoded map in a monzone.bin file, gzipped (as the build writes it) or not; errors name the file. */
const readMap = (path: string): MonzoneMap => {
  try {
    const bytes = readFileSync(path)
    return decodeMap(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes)
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

if (import.meta.main) {
  try {
    const [pathA, pathB, ...rest] = process.argv.slice(2)
    if (pathA === undefined || pathB === undefined || rest.length > 0)
      throw new Error("usage: node src/tools/map-diff.ts <a.bin> <b.bin>")
    const blocks = diffMaps(readMap(pathA), readMap(pathB))
    console.log(formatDiff(blocks))
    process.exitCode = blocks.length > 0 ? 1 : 0
  } catch (error) {
    console.error(`map-diff: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
