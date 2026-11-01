// Minimal PNG encoders on node:zlib, 8 bits a channel: RGB with filter 0 for the map preview, and
// RGBA with each row's filter chosen for the full map's overview (overview.ts); and the image data
// of a PNG inflated, which is the same on every machine whichever zlib compressed it. Run:
// node src/tools/png.ts <file.png>…  writes each file's image data to stdout, in order (CI hashes
// the overviews' this way, .github/actions/maps/action.yml).
import { readFileSync } from "node:fs"
import { crc32, deflateSync, inflateSync } from "node:zlib"

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

const chunk = (type: string, data: Uint8Array): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** A PNG of `width` × `height` px of colour type `type` (2 RGB, 6 RGBA) whose filtered rows are `raw`. */
const png = (width: number, height: number, type: number, raw: Uint8Array, level: number) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = type
  return Buffer.concat([
    Buffer.from(SIG),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ])
}

/** Encodes 8-bit RGB pixels (row-major, top row first) as a PNG with filter 0. */
export const encodePngRgb = (width: number, height: number, rgb: Uint8Array): Buffer => {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
  return png(width, height, 2, raw, 6)
}

/** The Paeth predictor of PNG's filter 4. */
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * The image data of 8-bit straight RGBA pixels (row-major, top row first) before zlib, as
 * `pngData` gives it back: each row under whichever of the five filters leaves the least sum of its
 * bytes taken as signed (libpng's heuristic; the first on a tie), after that filter's byte.
 */
export const filteredRgba = (width: number, height: number, rgba: Uint8Array): Buffer => {
  const stride = 4 * width,
    raw = Buffer.alloc((stride + 1) * height),
    rows = Array.from({ length: 5 }, () => new Uint8Array(stride)),
    none = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride),
      up = y === 0 ? none : rgba.subarray((y - 1) * stride, y * stride)
    let best = 0,
      least = Infinity
    for (let f = 0; f < 5; f++) {
      const out = rows[f]!
      let sum = 0
      for (let k = 0; k < stride; k++) {
        const a = k < 4 ? 0 : line[k - 4]!,
          b = up[k]!,
          c = k < 4 ? 0 : up[k - 4]!
        const predicted =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
        const byte = (line[k]! - predicted) & 255
        out[k] = byte
        sum += byte < 128 ? byte : 256 - byte
      }
      if (sum < least) [best, least] = [f, sum]
    }
    raw[y * (stride + 1)] = best
    raw.set(rows[best]!, y * (stride + 1) + 1)
  }
  return raw
}

/** Encodes 8-bit straight RGBA pixels (row-major, top row first) as a PNG (`filteredRgba`) at zlib level 9. */
export const encodePngRgba = (width: number, height: number, rgba: Uint8Array): Buffer =>
  png(width, height, 6, filteredRgba(width, height, rgba), 9)

/** A PNG's size and image data: its IDAT chunks inflated, each row's filter byte then its filtered bytes. */
export const pngData = (file: Uint8Array): { width: number; height: number; data: Buffer } => {
  const bytes = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  const idat: Array<Buffer> = []
  let width = 0,
    height = 0
  for (let at = SIG.length; at < bytes.length;) {
    const length = bytes.readUInt32BE(at),
      type = bytes.toString("latin1", at + 4, at + 8),
      data = bytes.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") [width, height] = [data.readUInt32BE(0), data.readUInt32BE(4)]
    if (type === "IDAT") idat.push(data)
    at += 12 + length
  }
  return { width, height, data: inflateSync(Buffer.concat(idat)) }
}

if (import.meta.main)
  for (const file of process.argv.slice(2)) process.stdout.write(pngData(readFileSync(file)).data)
