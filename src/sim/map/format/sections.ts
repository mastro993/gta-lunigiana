/**
 * What every map file shares (docs/map.md, "Map files"): gzip of one JSON line, a newline, then
 * the sections of its layout in order. A section holds n integers as the zigzag-coded difference
 * from the value `stride` places back (from 0 for the first `stride`), split into byte planes: the
 * low byte of every value, then the next byte of every value. Neighbours differ little and like
 * bytes sit together, which is what gzip compresses best.
 *
 * A layout declares each section once, with its width, stride, count and transform both ways, and
 * `encodeFile` and `decodeFile` walk it in the same order, so the encoder and the decoder cannot
 * disagree on where a section lies (`./global-file.ts`, `./tile-file.ts`). Everything here runs in
 * the browser too: the build encodes with the same module the game decodes with.
 *
 * @module map/format/sections
 */

/** The map files' format version (`MonzoneMap.version`): 3 cut the dense layers into tiles and baked the tables built from them, 4 the vectors, 5 gave the walls their levels, 6 moved the graph, the lanes and the residents off the global file's line and gave the lines their run-outs. */
export const MAP_VERSION = 6

/**
 * One section of a layout, in a file whose line is `L`: packed from an `E`, decoded as a `D`. Both
 * transforms take and give whole arrays (a tile's heightmap is 251,001 values), never a value at a
 * time.
 */
export interface Section<E, L, D> {
  /** What an error calls it, after the file's prefix ("walk walls"). */
  readonly label: string
  /** Bytes per value. */
  readonly bytes: 1 | 2 | 4
  /** How many values back each value is coded from, or how the line says; `null`: each value itself. */
  readonly stride: number | null | ((line: L) => number)
  /** How many integers it holds, from the line. */
  readonly count: (line: L) => number
  /** Its integers, from what the file is packed from; a value that does not fit throws, naming `what`. */
  readonly encode: (from: E, line: L, what: string) => ArrayLike<number>
  /** Its value, from its integers. */
  readonly decode: (values: Int32Array, line: L) => D
}

/** A kind of map file's sections, by name, in file order: the keys' order. */
export type Layout<E, L> = Readonly<Record<string, Section<E, L, unknown>>>

/** What `decodeFile` gives for each section of a layout. */
type Decoded<S> = {
  readonly [K in keyof S]: S[K] extends Section<never, never, infer D> ? D : never
}

/** One past the largest zigzag delta that fits in 1, 2 or 4 bytes. */
const BYTES_LIMIT = { 1: 0x100, 2: 0x1_0000, 4: 0x1_0000_0000 } as const

/** `values` as `size` byte planes of zigzag deltas from the value `stride` back (`Infinity`: each value itself), each an int32 whose delta fits. */
const pack = (values: ArrayLike<number>, size: 1 | 2 | 4, stride: number, what: string) => {
  const n = values.length,
    out = new Uint8Array(n * size)
  for (let k = 0; k < n; k++) {
    const v = values[k]!,
      d = v - (k >= stride ? values[k - stride]! : 0),
      z = d < 0 ? -2 * d - 1 : 2 * d
    if ((v | 0) !== v) throw new Error(`${what}: ${v} at ${k} is not an int32`)
    if (z >= BYTES_LIMIT[size])
      throw new Error(
        `${what}: ${v} at ${k} is ${d} from the value ${stride} back, too far for ${size} bytes`,
      )
    for (let p = 0; p < size; p++) out[p * n + k] = (z >>> (8 * p)) & 255
  }
  return out
}

/** The `n` integers of the section at byte `at`: `size` byte planes of zigzag deltas from the value `stride` back (`Infinity`: each value itself). */
const unpack = (
  file: Uint8Array,
  at: number,
  n: number,
  size: number,
  stride: number,
): Int32Array => {
  const out = new Int32Array(n)
  for (let p = 0; p < size; p++)
    for (let k = 0; k < n; k++) out[k] = out[k]! | (file[at + p * n + k]! << (8 * p)) // plane by plane: a third faster
  for (let k = 0; k < n; k++) {
    const z = out[k]!
    out[k] = ((z >>> 1) ^ -(z & 1)) + (k >= stride ? out[k - stride]! : 0)
  }
  return out
}

/** A section's stride in a file with `line`. */
const strideOf = <L>(section: Section<never, L, unknown>, line: L): number =>
  section.stride === null
    ? Infinity
    : typeof section.stride === "number"
      ? section.stride
      : section.stride(line)

const utf8 = new TextEncoder()
const text = new TextDecoder()

/** `parts` one after another. */
const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * The file (before gzip) of `line` and the sections of `layout` packed from `from`, and the bytes of
 * the line (`json`) and of each section. A section whose integers are not as many as its count throws (two
 * sections that share a count, a wall's segment and its id, must agree), and so does a value that
 * does not fit; `prefix` opens each error ("tile 0_0 ").
 */
export const encodeFile = <E, L>(
  layout: Layout<E, L>,
  line: L,
  from: E,
  prefix: string,
): { readonly file: Uint8Array; readonly sizes: Readonly<Record<string, number>> } => {
  const parts: Record<string, Uint8Array> = { json: utf8.encode(`${JSON.stringify(line)}\n`) }
  for (const [name, section] of Object.entries(layout)) {
    const what = `${prefix}${section.label}`,
      values = section.encode(from, line, what),
      n = section.count(line)
    if (values.length !== n)
      throw new Error(`${what}: ${values.length} values where the file holds ${n}`)
    parts[name] = pack(values, section.bytes, strideOf(section, line), what)
  }
  return {
    file: concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}

/** A file's JSON line, which must be of today's version (`what` names the file in the error), and the byte its sections start at. */
const lineAt = (
  file: Uint8Array,
  what: string,
): { readonly line: unknown; readonly at: number } => {
  const end = file.indexOf(10) // JSON.stringify escapes every newline inside strings
  const line: unknown = JSON.parse(text.decode(file.subarray(0, end)))
  const version = (line as { readonly version?: unknown }).version
  if (version !== MAP_VERSION)
    throw new Error(
      `map: ${what} is version ${String(version)}, this decoder reads ${MAP_VERSION}; run pnpm map`,
    )
  return { line, at: end + 1 }
}

/** A file's JSON line alone, its sections left unread; it must be of today's version. */
export const lineOf = (file: Uint8Array, what: string): unknown => lineAt(file, what).line

/** A file's JSON line, of type `L`, and the value of each section of `layout`, which must end with the file. */
export const decodeFile = <L, S extends Layout<never, L>>(
  file: Uint8Array,
  layout: S,
  what: string,
): { readonly line: L; readonly values: Decoded<S> } => {
  const read = lineAt(file, what),
    line = read.line as L,
    values: Record<string, unknown> = {}
  let at = read.at
  for (const [name, section] of Object.entries(layout)) {
    const n = section.count(line)
    values[name] = section.decode(unpack(file, at, n, section.bytes, strideOf(section, line)), line)
    at += n * section.bytes
  }
  if (at !== file.length)
    throw new Error(
      `map: ${what}'s sections end at byte ${at} of ${file.length}; the file and this decoder disagree`,
    )
  return { line, values: values as Decoded<S> }
}

/**
 * `file` with its JSON line's keys set to `patch`'s (in place, so the key order stays), the sections
 * after it unchanged: what packing it with those values gives.
 */
export const relined = (file: Uint8Array, patch: object): Uint8Array => {
  const end = file.indexOf(10)
  const line = JSON.parse(text.decode(file.subarray(0, end))) as Record<string, unknown>
  return concat([utf8.encode(JSON.stringify({ ...line, ...patch })), file.subarray(end)])
}

/** Integer decimetres (int16: the game keeps them in an `Int16Array`) in rows of `cols`, as a section packs them: each row's first value itself, the rest the difference from the one before. */
export const rowDeltas = (dm: ArrayLike<number>, cols: number, what: string): Array<number> =>
  Array.from(dm, (v, k) => {
    if (v < -32768 || v > 32767) throw new Error(`${what}: ${v} at ${k} does not fit int16`)
    return k % cols === 0 ? v : v - dm[k - 1]!
  })

/** Decimetres from `rowDeltas`' rows of `cols`. */
export const fromRowDeltas = (deltas: Int32Array, cols: number): Int16Array => {
  const out = new Int16Array(deltas.length)
  for (let k = 0; k < out.length; k++)
    out[k] = k % cols === 0 ? deltas[k]! : out[k - 1]! + deltas[k]!
  return out
}
