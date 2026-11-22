/**
 * The global file, `<name>.bin` (docs/map.md, "The global file"): its line is `MonzoneMapJson`,
 * everything sparse (the roads' attributes, the railway, the tile list, the smaller baked tables);
 * its sections, `GLOBAL_LAYOUT`, hold the coarse grid and the line's bulk arrays and tables, whose
 * counts the line holds in their place, so the line that `JSON.parse` reads at load stays short
 * (issue #5's 8 MB). Decoding is exact: a graph coordinate or a parked spot's is an integer number
 * of decimetres divided by 10 and a spot's angle of milliradians divided by 1000, the same double
 * JSON would give for a one-decimal or three-decimal number, a lane is its table's double, a
 * resident its float32, and a rest, a farm's centre and a lamp's numbers come back to the bit from
 * their doubles' two int32 words. The sections decode as the plain arrays and objects the line gave
 * before them, keys in the same order, so the game reads the same values. The parked spots', the
 * farms' and the lamps' fields' places in their sections, the doubles' words and those tables built
 * back from their sections are in `./baked-tables.ts`.
 *
 * @module map/format/global-file
 */
import { VEHICLE_MODELS, type VehicleModel } from "../../vehicles.ts"
import type { Derived } from "../derived.ts"
import type { Coarse, MonzoneMap } from "../index.ts"
import {
  FARM_FLAGS,
  farmsOf,
  fromWords,
  LAMP_FIELDS,
  LAMP_KINDS,
  LAMP_WORDS,
  lampsOf,
  PARKED_FIELDS,
  parkedOf,
  restsOf,
  toWords,
  TRUCK,
} from "./baked-tables.ts"
import {
  decodeFile,
  encodeFile,
  fromRowDeltas,
  type Layout,
  MAP_VERSION,
  offGrid,
  onGrid,
  rowDeltas,
  type Section,
} from "./sections.ts"

/**
 * The JSON line that opens the global file: `MonzoneMap` with its bulk arrays and tables left to
 * the sections after it (the coarse grid's heights and cover, the graph, the lanes, the residents,
 * the parked spots, the farms, their centres and the lamps), and how many of each those sections
 * hold in their place.
 */
export interface MonzoneMapJson extends Omit<
  MonzoneMap,
  "coarse" | "graph" | "lanes" | "spawns" | "farms" | "lamps" | "derived"
> {
  readonly coarse: Omit<Coarse, "heights" | "cover">
  /** How many values each of the graph's arrays holds. */
  readonly graph: Readonly<Record<keyof MonzoneMap["graph"], number>>
  /** Every distinct lane offset, ascending (a lane is its index here), and how many lanes each model has, in the decoded map's order of the models. */
  readonly lanes: {
    readonly table: ReadonlyArray<number>
    readonly counts: Readonly<Record<VehicleModel, number>>
  }
  /** `spawns` with how many parked spots and rests there are in their place, and the models a spot's flags name, bit by bit, in the order its `rest` lists them. */
  readonly spawns: Omit<MonzoneMap["spawns"], "parked"> & {
    readonly parked: {
      readonly spots: number
      readonly rests: number
      readonly models: ReadonlyArray<VehicleModel>
    }
  }
  /** How many farms there are. */
  readonly farms: number
  /** How many lamps there are. */
  readonly lamps: number
  /** `derived` with how many residents and farm centre values there are in their place. */
  readonly derived: Omit<Derived, "residents" | "farms"> & {
    readonly residents: number
    readonly farms: number
  }
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

/** A section's integers as a plain array (a loop: a third of `Array.from`'s time). */
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

/** A section of flags or codes under 128, a byte each as they are (no stride), decoded as its integers. */
const byteSection = (
  label: string,
  count: (line: MonzoneMapJson) => number,
  encode: (map: MonzoneMap, line: MonzoneMapJson, what: string) => ArrayLike<number>,
): Section<MonzoneMap, MonzoneMapJson, Int32Array> => ({
  label,
  bytes: 1,
  stride: null,
  count,
  encode,
  decode: (values) => values,
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
    encode: (map, _, what) => onGrid(map.graph.xy, 10, "decimetres", what),
    decode: (dm) => offGrid(dm, 10),
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
  /** Each parked spot's (x, y) in decimetres (the build rounds them to 0.1 m), each from the previous x or y; a spot's key not in `PARKED_FIELDS` throws. */
  parkedXy: {
    label: "parked xy",
    bytes: 4,
    stride: 2,
    count: (line) => 2 * line.spawns.parked.spots,
    encode: (map, _, what) =>
      onGrid(
        map.spawns.parked.flatMap((s, k) => {
          const other = Object.keys(s).find((key) => !Object.hasOwn(PARKED_FIELDS, key))
          if (other !== undefined)
            throw new Error(`${what}: spot ${k}'s ${other} has no place in the file`)
          return [s.x, s.y]
        }),
        10,
        "decimetres",
        what,
      ),
    decode: (dm) => dm,
  },
  /** Each parked spot's angle in milliradians (the build rounds them so). */
  parkedAngles: {
    label: "parked angles",
    bytes: 2,
    stride: null,
    count: (line) => line.spawns.parked.spots,
    encode: (map, _, what) =>
      onGrid(
        map.spawns.parked.map((s) => s.angle),
        1000,
        "milliradians",
        what,
      ),
    decode: (mrad) => mrad,
  },
  /** Each parked spot's flags: bit k where the line's k-th model has a rest there, `TRUCK` where a truck fits. */
  parkedFlags: byteSection(
    "parked flags",
    (line) => line.spawns.parked.spots,
    (map, line, what) => {
      const { models } = line.spawns.parked
      if (1 << models.length > TRUCK)
        throw new Error(`${what}: ${models.length} models, past the bits under the truck's`)
      return map.spawns.parked.map(
        (s) =>
          models.reduce((bits, m, k) => bits | (s.rest[m] === undefined ? 0 : 1 << k), 0) |
          (s.truck === true ? TRUCK : 0),
      )
    },
  ),
  /** Each rest's z, then each one's pitch, then each one's roll (spot by spot, model by model), as `toWords`. */
  parkedRests: {
    label: "parked rests",
    bytes: 4,
    stride: null,
    count: (line) => 6 * line.spawns.parked.rests,
    encode: (map, line, what) => {
      const rests = restsOf(map.spawns.parked, line.spawns.parked.models, what)
      return toWords(
        [0, 1, 2].flatMap((c) => rests.map((r) => r[c]!)),
        what,
      )
    },
    decode: fromWords,
  },
  /** Each farm's building (its index in the whole map's), each from the previous farm's: they are ascending. */
  farmBuildings: {
    label: "farm buildings",
    bytes: 4,
    stride: 1,
    count: (line) => line.farms,
    encode: (map) => map.farms.map((f) => f.building),
    decode: (buildings) => buildings,
  },
  /** Each farm's `FARM_FLAGS`: 1 where it is rural, 2 where pigs are kept by it. */
  farmFlags: byteSection(
    "farm flags",
    (line) => line.farms,
    (map) => map.farms.map((f) => (f.rural ? FARM_FLAGS.rural : 0) | (f.pen ? FARM_FLAGS.pen : 0)),
  ),
  /** Each farm's building centre (`derived.farms`, flat x, y), as `toWords`. */
  farmCentres: {
    label: "farm centres",
    bytes: 4,
    stride: null,
    count: (line) => 2 * line.derived.farms,
    encode: (map, _, what) => toWords(map.derived.farms, what),
    decode: fromWords,
  },
  /** Every lamp's x, then every one's y, z, nx and ny (`LAMP_WORDS`), as `toWords`. */
  lamps: {
    label: "lamps",
    bytes: 4,
    stride: null,
    count: (line) => 2 * LAMP_FIELDS.length * line.lamps,
    encode: (map, _, what) => {
      const n = map.lamps.length,
        values = new Float64Array(LAMP_FIELDS.length * n)
      for (const field of LAMP_FIELDS)
        map.lamps.forEach((lamp, k) => (values[LAMP_WORDS[field] * n + k] = lamp[field]))
      return toWords(values, what)
    },
    decode: fromWords,
  },
  /** Each lamp's kind, its index in `LAMP_KINDS`. */
  lampKinds: byteSection(
    "lamp kinds",
    (line) => line.lamps,
    (map, _, what) =>
      map.lamps.map(({ kind }, k) => {
        const index = LAMP_KINDS.indexOf(kind)
        if (index < 0) throw new Error(`${what}: ${kind} at ${k} is not ${LAMP_KINDS.join(" or ")}`)
        return index
      }),
  ),
} satisfies Layout<MonzoneMap, MonzoneMapJson>

/** The gunzipped global file `decodeMap` reads back into `map`, and the bytes of its line (`json`) and of each section. */
export const encodeMap = (
  map: MonzoneMap,
): { readonly file: Uint8Array; readonly sizes: Readonly<Record<string, number>> } => {
  const {
    coarse: { heights: _, cover: __, ...coarse },
    graph,
    lanes,
    spawns,
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
    spawns: {
      ...spawns,
      parked: {
        spots: spawns.parked.length,
        rests: restsOf(spawns.parked, VEHICLE_MODELS, "parked rests").length,
        models: VEHICLE_MODELS,
      },
    },
    farms: map.farms.length,
    lamps: map.lamps.length,
    derived: { ...derived, residents: derived.residents.length, farms: derived.farms.length },
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
    spawns: {
      ...line.spawns,
      parked: parkedOf(
        values.parkedXy,
        values.parkedAngles,
        values.parkedFlags,
        values.parkedRests,
        line.spawns.parked.models,
      ),
    },
    farms: farmsOf(values.farmBuildings, values.farmFlags),
    lamps: lampsOf(values.lamps, values.lampKinds),
    derived: { ...line.derived, residents: values.residents, farms: values.farmCentres },
  }
}
