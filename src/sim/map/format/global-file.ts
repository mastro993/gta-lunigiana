/**
 * The global file, `<name>.bin` (docs/map.md, "The global file"): its line is `MonzoneMapJson`,
 * everything sparse (the roads' attributes, the railway, the tile list, the baked tables); its
 * sections, `GLOBAL_LAYOUT`, hold the coarse grid and the line's bulk arrays, whose counts the line
 * holds in their place, so the line that `JSON.parse` reads at load stays short (issue #5's 8 MB).
 * Decoding is exact: a graph coordinate is an integer number of decimetres divided by 10, the same
 * double JSON would give for a one-decimal number, a lane is its table's double and a resident its
 * float32. The graph's, the lanes' and the residents' sections decode as the plain arrays the line
 * gave before them, so the game reads the same arrays.
 *
 * @module map/format/global-file
 */
import type { VehicleModel } from "../../vehicles.ts"
import type { Derived } from "../derived.ts"
import type { Coarse, MonzoneMap } from "../index.ts"
import {
  decodeFile,
  encodeFile,
  fromRowDeltas,
  type Layout,
  MAP_VERSION,
  rowDeltas,
  type Section,
} from "./sections.ts"

/**
 * The JSON line that opens the global file: `MonzoneMap` with its bulk arrays left to the sections
 * after it (the coarse grid's heights and cover, the graph, the lanes and the residents), and how
 * many values each of those sections holds in their place.
 */
export interface MonzoneMapJson extends Omit<MonzoneMap, "coarse" | "graph" | "lanes" | "derived"> {
  readonly coarse: Omit<Coarse, "heights" | "cover">
  /** How many values each of the graph's arrays holds. */
  readonly graph: Readonly<Record<keyof MonzoneMap["graph"], number>>
  /** Every distinct lane offset, ascending (a lane is its index here), and how many lanes each model has, in the decoded map's order of the models. */
  readonly lanes: {
    readonly table: ReadonlyArray<number>
    readonly counts: Readonly<Record<VehicleModel, number>>
  }
  /** `derived` with the residents' count in their place. */
  readonly derived: Omit<Derived, "residents"> & { readonly residents: number }
}

/** How many distinct lane offsets the table holds at most: an index fits 2 bytes zigzag-coded. */
const LANE_TABLE = 0x8000

/** Every distinct lane offset, ascending. */
const laneTable = (lanes: MonzoneMap["lanes"]): Array<number> => {
  const table = [...new Set(Object.values(lanes).flat())].sort((a, b) => a - b)
  if (table.length > LANE_TABLE)
    throw new Error(
      `lanes: ${table.length} distinct values, past the ${LANE_TABLE} their 2-byte indices hold`,
    )
  return table
}

// A loop each for the plain arrays: a third of `Array.from`'s time.

/** A section's integers as a plain array. */
const listOf = (values: Int32Array): Array<number> => {
  const out: Array<number> = []
  for (let k = 0; k < values.length; k++) out.push(values[k]!)
  return out
}

/** A graph array's section: its integers as they are, ascending or (a, b, road) per edge. */
const graphList = (
  name: "edges" | "traffic" | "walk",
  stride: number,
): Section<MonzoneMap, MonzoneMapJson, Array<number>> => ({
  label: `graph ${name}`,
  bytes: 4,
  stride,
  count: (line) => line.graph[name],
  encode: (map) => map.graph[name],
  decode: listOf,
})

/** The global file's sections, in file order (docs/map.md, "The global file"). */
const GLOBAL_LAYOUT = {
  /** The coarse grid's nodes, decimetres, each row delta-coded from its first node, then from the node to the south. */
  heights: {
    label: "coarse heights",
    bytes: 2,
    stride: (line) => line.coarse.cols,
    count: (line) => line.coarse.cols * line.coarse.rows,
    encode: (map, line, what) => rowDeltas(map.coarse.heights, line.coarse.cols, what),
    decode: (deltas, line) => fromRowDeltas(deltas, line.coarse.cols),
  },
  /** The land cover of the 4 m cell north-east of each coarse node, from the node to the south. */
  cover: {
    label: "coarse cover",
    bytes: 1,
    stride: (line) => line.coarse.cols,
    count: (line) => line.coarse.cols * line.coarse.rows,
    encode: (map) => map.coarse.cover,
    decode: (cover) => Uint8Array.from(cover),
  },
  /** The graph's node coordinates in decimetres (the build rounds the map to 0.1 m), each from the previous x or y. */
  xy: {
    label: "graph xy",
    bytes: 4,
    stride: 2,
    count: (line) => line.graph.xy,
    encode: (map, _, what) =>
      Array.from(map.graph.xy, (v, k) => {
        const dm = Math.round(v * 10)
        if (dm / 10 !== v)
          throw new Error(`${what}: ${v} at ${k} is not a whole number of decimetres`)
        return dm
      }),
    decode: (dm) => {
      const out: Array<number> = []
      for (let k = 0; k < dm.length; k++) out.push(dm[k]! / 10)
      return out
    },
  },
  edges: graphList("edges", 3),
  traffic: graphList("traffic", 1),
  walk: graphList("walk", 1),
  /** Each model's lanes, model by model in the line's order: each lane's index in the line's table. */
  lanes: {
    label: "lanes",
    bytes: 2,
    stride: null,
    count: (line) => Object.values(line.lanes.counts).reduce((sum, n) => sum + n, 0),
    encode: (map, line) => {
      const index = new Map(line.lanes.table.map((v, k) => [v, k]))
      return Object.values(map.lanes)
        .flat()
        .map((v) => index.get(v)!)
    },
    decode: (indices, line): MonzoneMap["lanes"] => {
      const { table, counts } = line.lanes,
        lanes: Partial<Record<VehicleModel, ReadonlyArray<number>>> = {}
      let at = 0
      for (const [model, n] of Object.entries(counts) as Array<[VehicleModel, number]>) {
        const of: Array<number> = []
        for (const stop = at + n; at < stop; at++) of.push(table[indices[at]!]!)
        lanes[model] = of
      }
      return lanes as MonzoneMap["lanes"]
    },
  },
  /** Per walk edge, its resident count's float32 bit pattern (`derived.residents`), so each comes back to the bit. */
  residents: {
    label: "residents",
    bytes: 4,
    stride: null,
    count: (line) => line.derived.residents,
    encode: (map, _, what) => {
      const values = map.derived.residents,
        f32 = Float32Array.from(values)
      f32.forEach((v, k) => {
        if (v !== values[k]) throw new Error(`${what}: ${values[k]} at ${k} is not a float32`)
      })
      return new Int32Array(f32.buffer)
    },
    decode: (bits) => {
      const f32 = new Float32Array(bits.buffer, bits.byteOffset, bits.length),
        out: Array<number> = []
      for (let k = 0; k < f32.length; k++) out.push(f32[k]!)
      return out
    },
  },
} satisfies Layout<MonzoneMap, MonzoneMapJson>

/** The gunzipped global file `decodeMap` reads back into `map`, and the bytes of its line (`json`) and of each section. */
export const encodeMap = (
  map: MonzoneMap,
): { readonly file: Uint8Array; readonly sizes: Readonly<Record<string, number>> } => {
  const {
    coarse: { heights: _, cover: __, ...coarse },
    graph,
    lanes,
    derived,
  } = map
  const line: MonzoneMapJson = {
    ...map,
    version: MAP_VERSION,
    coarse,
    graph: {
      xy: graph.xy.length,
      edges: graph.edges.length,
      traffic: graph.traffic.length,
      walk: graph.walk.length,
    },
    lanes: {
      table: laneTable(lanes),
      counts: Object.fromEntries(
        Object.entries(lanes).map(([model, sides]) => [model, sides.length]),
      ) as MonzoneMapJson["lanes"]["counts"],
    },
    derived: { ...derived, residents: derived.residents.length },
  }
  return encodeFile(GLOBAL_LAYOUT, line, map, "")
}

/** The global map from its gunzipped file. */
export const decodeMap = (file: Uint8Array): MonzoneMap => {
  const { line, values } = decodeFile<MonzoneMapJson, typeof GLOBAL_LAYOUT>(
    file,
    GLOBAL_LAYOUT,
    "the global map file",
  )
  return {
    ...line,
    coarse: { ...line.coarse, heights: values.heights, cover: values.cover },
    graph: { xy: values.xy, edges: values.edges, traffic: values.traffic, walk: values.walk },
    lanes: values.lanes,
    derived: { ...line.derived, residents: values.residents },
  }
}
