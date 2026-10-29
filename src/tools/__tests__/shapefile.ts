// Writes tiny synthetic shapefiles for the tool tests: polyline Z (13) or polygon Z (15) records
// with character attributes, laid out as the CTR's files are (no end-of-file marker unless asked).

/** A record: its parts as [x, y, z] vertices and its attribute row. */
export interface TestRecord {
  readonly parts: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>
  readonly attrs: Readonly<Record<string, string>>
}

/** The main file and dBase table of `records`, all of shape `type`; `eof` appends the 0x1a marker. */
export const shapefile = (
  type: 13 | 15,
  records: ReadonlyArray<TestRecord>,
  eof = false,
): { readonly shp: Buffer; readonly dbf: Buffer } => {
  const all = records.flatMap((r) => r.parts.flat())
  const box = (pts: ReadonlyArray<readonly [number, number, number]>) =>
    [0, 1].flatMap((k) => [Math.min(...pts.map((p) => p[k]!)), Math.max(...pts.map((p) => p[k]!))])
  const bodies = records.map((r, i) => {
    const pts = r.parts.flat(),
      np = r.parts.length,
      nv = pts.length
    const content = 44 + 4 * np + 16 * nv + 16 + 8 * nv
    const b = Buffer.alloc(8 + content)
    b.writeInt32BE(i + 1, 0)
    b.writeInt32BE(content / 2, 4)
    b.writeInt32LE(type, 8)
    const [x0, x1, y0, y1] = box(pts)
    ;[x0!, y0!, x1!, y1!].forEach((v, k) => b.writeDoubleLE(v, 12 + 8 * k))
    b.writeInt32LE(np, 44)
    b.writeInt32LE(nv, 48)
    let start = 0
    r.parts.forEach((part, k) => {
      b.writeInt32LE(start, 52 + 4 * k)
      start += part.length
    })
    const xy = 52 + 4 * np,
      zs = xy + 16 * nv
    pts.forEach(([x, y, z], v) => {
      b.writeDoubleLE(x, xy + 16 * v)
      b.writeDoubleLE(y, xy + 16 * v + 8)
      b.writeDoubleLE(z, zs + 16 + 8 * v)
    })
    b.writeDoubleLE(Math.min(...pts.map((p) => p[2])), zs)
    b.writeDoubleLE(Math.max(...pts.map((p) => p[2])), zs + 8)
    return b
  })
  const head = Buffer.alloc(100)
  head.writeInt32BE(9994, 0)
  head.writeInt32BE((100 + bodies.reduce((s, b) => s + b.length, 0)) / 2, 24)
  head.writeInt32LE(1000, 28)
  head.writeInt32LE(type, 32)
  const [x0, x1, y0, y1] = box(all)
  ;[x0!, y0!, x1!, y1!].forEach((v, k) => head.writeDoubleLE(v, 36 + 8 * k))
  head.writeDoubleLE(Math.min(...all.map((p) => p[2])), 68)
  head.writeDoubleLE(Math.max(...all.map((p) => p[2])), 76)

  const names = [...new Set(records.flatMap((r) => Object.keys(r.attrs)))]
  const lens = names.map((n) => Math.max(1, ...records.map((r) => (r.attrs[n] ?? "").length)))
  const header = 32 + 32 * names.length + 1,
    size = 1 + lens.reduce((s, l) => s + l, 0)
  const dbf = Buffer.alloc(header + size * records.length + (eof ? 1 : 0), 0x20)
  dbf.fill(0, 0, header)
  dbf[0] = 3
  dbf.writeUInt32LE(records.length, 4)
  dbf.writeUInt16LE(header, 8)
  dbf.writeUInt16LE(size, 10)
  names.forEach((n, k) => {
    dbf.write(n, 32 + 32 * k, "latin1")
    dbf[32 + 32 * k + 11] = "C".codePointAt(0)!
    dbf[32 + 32 * k + 16] = lens[k]!
  })
  dbf[header - 1] = 0x0d
  records.forEach((r, i) => {
    let o = header + i * size + 1
    names.forEach((n, k) => {
      dbf.write((r.attrs[n] ?? "").padEnd(lens[k]!), o, "latin1")
      o += lens[k]!
    })
  })
  if (eof) dbf[dbf.length - 1] = 0x1a
  return { shp: Buffer.concat([head, ...bodies]), dbf }
}
