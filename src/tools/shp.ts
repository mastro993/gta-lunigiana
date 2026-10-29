// Minimal ESRI shapefile + dBase III reader for the gzipped CTR layers: polygons and polylines
// (Z and M variants too; extra dimensions are skipped), attributes as trimmed latin-1 strings.
// `subsetShp` writes the records a filter keeps as a smaller shapefile (fetch-rt.ts pins the CTR's
// track centrelines that way).
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

/** One shape: its parts (rings or lines) as [x, y] pairs, and its attribute row. */
export interface ShpRecord {
  readonly parts: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  readonly attrs: Readonly<Record<string, string>>
}

/** Polyline and polygon shape types, plain, Z and M: the only ones the CTR layers use. */
const LINEAR_TYPES: ReadonlySet<number> = new Set([3, 5, 13, 15, 23, 25])
/** The Z variants: their records carry a z range after the points. */
const Z_TYPES: ReadonlySet<number> = new Set([13, 15])

const parseDbf = (b: Buffer): Array<Record<string, string>> => {
  const count = b.readUInt32LE(4),
    header = b.readUInt16LE(8),
    size = b.readUInt16LE(10)
  const fields: Array<{ name: string; len: number }> = []
  for (let o = 32; b[o] !== 0x0d; o += 32)
    fields.push({ name: b.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: b[o + 16]! })
  return Array.from({ length: count }, (_, i) => {
    let o = header + i * size + 1 // skip the deletion flag
    const row: Record<string, string> = {}
    for (const f of fields) {
      row[f.name] = b.toString("latin1", o, o + f.len).trim()
      o += f.len
    }
    return row
  })
}

/** Each record's byte offset in the main file (past the 100-byte header) and its total length. */
const recordSpans = (b: Buffer): Array<{ readonly at: number; readonly bytes: number }> => {
  const spans: Array<{ at: number; bytes: number }> = []
  for (let o = 100; o < b.length; o += spans.at(-1)!.bytes)
    spans.push({ at: o, bytes: 8 + b.readInt32BE(o + 4) * 2 })
  return spans
}

/** The records of a shapefile, from the raw bytes of its main file and its dBase table; `name` labels errors. */
export const parseShp = (shp: Buffer, dbf: Buffer, name = "shp"): Array<ShpRecord> => {
  const attrs = parseDbf(dbf)
  return recordSpans(shp).map(({ at }, i) => {
    const content = at + 8,
      type = shp.readInt32LE(content)
    const parts: Array<Array<readonly [number, number]>> = []
    if (type !== 0) {
      if (!LINEAR_TYPES.has(type)) throw new Error(`${name}: shape type ${type}`)
      const np = shp.readInt32LE(content + 36),
        nv = shp.readInt32LE(content + 40)
      const starts = Array.from({ length: np }, (_, k) => shp.readInt32LE(content + 44 + 4 * k))
      const xy = content + 44 + 4 * np
      for (let k = 0; k < np; k++) {
        const part: Array<readonly [number, number]> = []
        for (let v = starts[k]!; v < (starts[k + 1] ?? nv); v++)
          part.push([shp.readDoubleLE(xy + 16 * v), shp.readDoubleLE(xy + 16 * v + 8)])
        parts.push(part)
      }
    }
    return { parts, attrs: attrs[i]! }
  })
}

/** `base` without extension: reads base.shp.gz and base.dbf.gz. */
export const readShp = (base: string): Array<ShpRecord> =>
  parseShp(
    gunzipSync(readFileSync(`${base}.shp.gz`)),
    gunzipSync(readFileSync(`${base}.dbf.gz`)),
    `${base}.shp`,
  )

/**
 * The records whose attribute row `keep` accepts, as a new main file and dBase table (raw bytes),
 * or undefined when it keeps none. Records keep their bytes and order and are renumbered from 1;
 * the main file's length, bounding box and z range (Z types) are recomputed, its m range copied.
 * The table keeps its header, field list and date with the new record count.
 */
export const subsetShp = (
  shp: Buffer,
  dbf: Buffer,
  keep: (attrs: Readonly<Record<string, string>>) => boolean,
): { readonly shp: Buffer; readonly dbf: Buffer } | undefined => {
  const attrs = parseDbf(dbf),
    spans = recordSpans(shp)
  if (spans.length !== attrs.length)
    throw new Error(`${spans.length} shapes but ${attrs.length} attribute rows`)
  const kept = spans.flatMap((span, i) => (keep(attrs[i]!) ? [{ ...span, row: i }] : []))
  if (kept.length === 0) return undefined
  const out = Buffer.concat([
    shp.subarray(0, 100),
    ...kept.map((k) => shp.subarray(k.at, k.at + k.bytes)),
  ])
  out.writeInt32BE(out.length / 2, 24)
  const box = [Infinity, Infinity, -Infinity, -Infinity],
    z = [Infinity, -Infinity]
  for (let i = 0, o = 100; i < kept.length; o += kept[i]!.bytes, i++) {
    out.writeInt32BE(i + 1, o)
    const content = o + 8,
      type = out.readInt32LE(content)
    if (type === 0) continue
    if (!LINEAR_TYPES.has(type)) throw new Error(`shape type ${type}`)
    for (let k = 0; k < 4; k++) {
      const v = out.readDoubleLE(content + 4 + 8 * k)
      box[k] = k < 2 ? Math.min(box[k]!, v) : Math.max(box[k]!, v)
    }
    if (Z_TYPES.has(type)) {
      const np = out.readInt32LE(content + 36),
        nv = out.readInt32LE(content + 40),
        range = content + 44 + 4 * np + 16 * nv
      z[0] = Math.min(z[0]!, out.readDoubleLE(range))
      z[1] = Math.max(z[1]!, out.readDoubleLE(range + 8))
    }
  }
  if (Number.isFinite(box[0])) box.forEach((v, k) => out.writeDoubleLE(v, 36 + 8 * k))
  if (Number.isFinite(z[0])) z.forEach((v, k) => out.writeDoubleLE(v, 68 + 8 * k))
  const header = dbf.readUInt16LE(8),
    size = dbf.readUInt16LE(10)
  const table = Buffer.concat([
    dbf.subarray(0, header),
    ...kept.map((k) => dbf.subarray(header + k.row * size, header + (k.row + 1) * size)),
    dbf.subarray(header + attrs.length * size), // the end-of-file marker, when the file has one
  ])
  table.writeUInt32LE(kept.length, 4)
  return { shp: out, dbf: table }
}
