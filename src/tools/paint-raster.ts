// A painter for the build's pictures of the map (the full map's overview, overview.ts): the
// `MapPen` the HUD's canvases paint through (src/render/map-style.ts), over premultiplied RGBA
// pixels. It fills rings by the even-odd or non-zero rule, strokes polylines with round caps and
// joins, both antialiased, and clips as a canvas clips (the clip's coverage times the paint's).
// Fills sample `SUB` sub-scanlines a row, each covered exactly across; a stroke covers a pixel by
// how far inside its edge the pixel's centre lies, once per polyline however many of its segments
// reach it. Only + − × ÷, sqrt, floor, ceil and round: every machine paints the same bits
// (docs/map.md).
import type { MapPen } from "../render/map-style.ts"

/** Sub-scanlines a fill samples per row of pixels (across a row its coverage is exact). */
const SUB = 4
/** The longest piece of a stroked segment whose box is scanned at once, px: a long diagonal scans a strip, not its whole box. */
const PIECE = 16

/** Premultiplied RGBA pixels, row 0 at the top. */
export interface Raster {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
}

/** A transparent raster `width` × `height` px. */
export const makeRaster = (width: number, height: number): Raster => ({
  width,
  height,
  pixels: new Uint8Array(4 * width * height),
})

/** The raster's pixels as straight (not premultiplied) RGBA, for a PNG. */
export const straightRgba = ({ pixels }: Raster): Uint8Array => {
  const out = new Uint8Array(pixels.length)
  for (let k = 0; k < pixels.length; k += 4) {
    const a = pixels[k + 3]!
    if (a === 0) continue
    for (let c = 0; c < 3; c++)
      out[k + c] =
        a === 255 ? pixels[k + c]! : Math.min(255, Math.round((pixels[k + c]! * 255) / a))
    out[k + 3] = a
  }
  return out
}

/** Where a map point lands on the raster: x, y (m) to u, v (px). */
export interface Projection {
  readonly u: (x: number) => number
  readonly v: (y: number) => number
}

/**
 * Calls `row` with each pixel row the rings (px) cover, by the fill rule: its index, the coverage
 * of each pixel (0 to 1) and the first and last column holding any. `acc` (one per raster column,
 * all 0) holds the coverage while `row` runs, and is 0 again after.
 */
const coverRows = (
  rings: ReadonlyArray<Float64Array>,
  rule: "evenodd" | "nonzero",
  width: number,
  height: number,
  acc: Float64Array,
  row: (j: number, c0: number, c1: number) => void,
): void => {
  // Each edge that is not level, from its top (least v) down: its top, bottom, u at the top, du/dv and winding.
  const top: Array<number> = [],
    bottom: Array<number> = [],
    u0: Array<number> = [],
    slope: Array<number> = [],
    wind: Array<number> = []
  let lowest = -Infinity
  for (const ring of rings) {
    const n = ring.length >> 1
    for (let k = 0; k < n; k++) {
      const m = (k + 1) % n,
        au = ring[2 * k]!,
        av = ring[2 * k + 1]!,
        bu = ring[2 * m]!,
        bv = ring[2 * m + 1]!
      if (av === bv) continue
      const down = av < bv
      top.push(down ? av : bv)
      bottom.push(down ? bv : av)
      lowest = Math.max(lowest, down ? bv : av)
      u0.push(down ? au : bu)
      slope.push((bu - au) / (bv - av))
      wind.push(down ? 1 : -1)
    }
  }
  if (top.length === 0) return
  const order = top.map((_, e) => e).sort((a, b) => top[a]! - top[b]! || a - b)
  const j0 = Math.max(0, Math.floor(top[order[0]!]!)),
    j1 = Math.min(height, Math.ceil(lowest))
  const share = 1 / SUB
  let c0 = width,
    c1 = -1
  /** Adds the span u = a … b of one sub-scanline to `acc`. */
  const span = (a: number, b: number) => {
    if (a < 0) a = 0
    if (b > width) b = width
    if (!(b > a)) return
    const ia = Math.floor(a),
      ib = Math.floor(b)
    if (ia === ib) acc[ia]! += (b - a) * share
    else {
      acc[ia]! += (ia + 1 - a) * share
      for (let i = ia + 1; i < ib; i++) acc[i]! += share
      if (ib < width) acc[ib]! += (b - ib) * share
    }
    if (ia < c0) c0 = ia
    const last = ib < width ? ib : width - 1
    if (last > c1) c1 = last
  }
  const active: Array<number> = [],
    us: Array<number> = [],
    ws: Array<number> = []
  let next = 0
  for (let j = j0; j < j1; j++) {
    c0 = width
    c1 = -1
    for (let s = 0; s < SUB; s++) {
      const v = j + (s + 0.5) * share
      while (next < order.length && top[order[next]!]! <= v) active.push(order[next++]!)
      // The crossings of the edges spanning v, in u order (an insertion sort: they come nearly sorted).
      let n = 0
      for (let a = 0; a < active.length;) {
        const e = active[a]!
        if (bottom[e]! <= v) {
          active[a] = active.at(-1)!
          active.pop()
          continue
        }
        const u = u0[e]! + (v - top[e]!) * slope[e]!
        let p = n++
        for (; p > 0 && us[p - 1]! > u; p--) {
          us[p] = us[p - 1]!
          ws[p] = ws[p - 1]!
        }
        us[p] = u
        ws[p] = wind[e]!
        a++
      }
      if (rule === "evenodd") for (let p = 0; p + 1 < n; p += 2) span(us[p]!, us[p + 1]!)
      else
        for (let p = 0, w = 0, from = 0; p < n; p++) {
          const was = w
          w += ws[p]!
          if (was === 0) from = us[p]!
          else if (w === 0) span(from, us[p]!)
        }
    }
    if (c1 < c0) continue
    row(j, c0, c1)
    acc.fill(0, c0, c1 + 1)
  }
}

/**
 * A pen over `raster`: map points land where `project` puts them, and widths are `ratio` raster px
 * per px of the paint (the look's pixels, as a canvas's transform scales them).
 */
export const rasterPen = (raster: Raster, project: Projection, ratio: number): MapPen => {
  const { width, height, pixels } = raster
  const acc = new Float64Array(width)
  /** The clip's coverage per pixel, 0 to 255; none: everything. */
  let clip: Uint8Array | undefined
  /** Per pixel, the coverage of the polyline being stroked, 0 to 255 (0 again after), and the pixels it touched. */
  const cover = new Uint8Array(width * height)
  let touched = new Int32Array(1 << 16),
    count = 0
  const projected = (flat: ReadonlyArray<number>) => {
    const out = new Float64Array(flat.length)
    for (let k = 0; k + 1 < flat.length; k += 2) {
      out[k] = project.u(flat[k]!)
      out[k + 1] = project.v(flat[k + 1]!)
    }
    return out
  }
  /** Paints pixel `p` in `hex` over what is there, at opacity `a` (0 to 1) times the clip's. */
  const blend = (p: number, a: number, hex: number) => {
    const o = clip === undefined ? a : (a * clip[p]!) / 255
    if (o <= 0) return
    const k = 4 * p,
      keep = 1 - o
    pixels[k] = Math.round(((hex >> 16) & 255) * o + pixels[k]! * keep)
    pixels[k + 1] = Math.round(((hex >> 8) & 255) * o + pixels[k + 1]! * keep)
    pixels[k + 2] = Math.round((hex & 255) * o + pixels[k + 2]! * keep)
    pixels[k + 3] = Math.round(255 * o + pixels[k + 3]! * keep)
  }
  return {
    clip: (rings) => {
      const mask = new Uint8Array(width * height)
      coverRows(rings.map(projected), "evenodd", width, height, acc, (j, c0, c1) => {
        for (let i = c0; i <= c1; i++) {
          const p = j * width + i
          mask[p] = Math.round(Math.min(1, acc[i]!) * (clip === undefined ? 255 : clip[p]!))
        }
      })
      clip = mask
    },
    fill: (rings, hex, rule) =>
      coverRows(rings.map(projected), rule, width, height, acc, (j, c0, c1) => {
        for (let i = c0; i <= c1; i++)
          if (acc[i]! > 0) blend(j * width + i, Math.min(1, acc[i]!), hex)
      }),
    stroke: (flat, lineWidth, hex, alpha) => {
      const pts = projected(flat),
        reach = (lineWidth * ratio) / 2 + 0.5,
        reach2 = reach * reach
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const au = pts[k]!,
          av = pts[k + 1]!,
          du = pts[k + 2]! - au,
          dv = pts[k + 3]! - av,
          len2 = du * du + dv * dv
        if (len2 === 0) continue
        const pieces = Math.max(1, Math.ceil(Math.sqrt(len2) / PIECE))
        for (let q = 0; q < pieces; q++) {
          const t0 = q / pieces,
            t1 = (q + 1) / pieces
          const ua = au + du * t0,
            ub = au + du * t1,
            va = av + dv * t0,
            vb = av + dv * t1
          const i0 = Math.max(0, Math.floor(Math.min(ua, ub) - reach)),
            i1 = Math.min(width - 1, Math.floor(Math.max(ua, ub) + reach)),
            j0 = Math.max(0, Math.floor(Math.min(va, vb) - reach)),
            j1 = Math.min(height - 1, Math.floor(Math.max(va, vb) + reach))
          for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
              const cu = i + 0.5,
                cv = j + 0.5
              let t = ((cu - au) * du + (cv - av) * dv) / len2
              t = Math.min(1, Math.max(0, t))
              const eu = au + du * t - cu,
                ev = av + dv * t - cv,
                d2 = eu * eu + ev * ev
              if (d2 >= reach2) continue
              const c = reach - Math.sqrt(d2),
                level = c >= 1 ? 255 : Math.round(c * 255),
                p = j * width + i
              if (level <= cover[p]!) continue
              if (cover[p] === 0) {
                if (count === touched.length) {
                  const grown = new Int32Array(2 * count)
                  grown.set(touched)
                  touched = grown
                }
                touched[count++] = p
              }
              cover[p] = level
            }
        }
      }
      for (let n = 0; n < count; n++) {
        const p = touched[n]!
        blend(p, (cover[p]! / 255) * alpha, hex)
        cover[p] = 0
      }
      count = 0
    },
  }
}
