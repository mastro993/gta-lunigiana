// Draws a Regione Toscana orthophoto crop with the built map over it, for tracing the hand tables
// (STONE_CORES and the stream widths in features.ts, LANDMARKS in districts.ts) as step 5 of the
// runbook in issue #3 describes. Run:
// node src/tools/ortho.ts <x0>,<y0>,<x1>,<y1> [layer] [out.svg] [--px <m>] [--refresh]
// (pnpm ortho ...). The rectangle is in local metres; the layer defaults to rt_ofc.2k10, the 2010
// 1:2000 flight the stone cores were traced on; --px is metres per pixel (default 0.5). Writes an
// SVG (default .research/ortho/<x0>_<y0>_<x1>_<y1>_<layer>.svg) with the photo embedded and, over
// it, from src/sim/map/monzone.bin: the buildings' outlines, the STONE_CORES discs, each stream's
// water width and bed; then a metre grid, a scale bar, the corners' local coordinates and the
// photo's licence. The photo is a WMS 1.1.1 GetMap in EPSG:4326: the local frame is
// equirectangular, so the photo maps linearly onto it and the overlay needs no reprojection. Over
// 4096 px a side the request is split into tiles (`ortho-wms.ts`); over MAX_PIXELS the resolution
// drops, and the tool says so. Both services' capabilities and every tile are cached under
// .research/ortho/ (--refresh asks again); an answer listing no layer, a WMS error, is never kept.
// A layer is traceable only when its abstract names Regione Toscana (or IGM-RT) as owner and it
// links an RT metadata record granting CC BY (the licence table, ORTHO_LICENCES in ortho-wms.ts);
// AGEA's flights, Blom's (10k07, 2k11.aulla), IGM-RT's 1960s flights (10k63/65/68), the layers
// without an RT record (10k88, 2k06, 5k12) and any layer not in the table are look only, drawn
// with a warning on the console and on the image.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import type { Water } from "../sim/map/index.ts"
import { decodeMap, mapFile } from "../sim/map/packed.ts"
import { STONE_CORES } from "./features.ts"
import { fromLocal, r1, ringBox } from "./geometry.ts"
import { getBytes, pool, request } from "./net.ts"
import {
  type Frame,
  frameOf,
  getMapUrl,
  licenceOf,
  ORTHO_SERVICES,
  type OrthoLicence,
  parseCapabilities,
  type Tile,
  tilesOf,
  toPx,
  type WmsLayer,
} from "./ortho-wms.ts"
import type { Rect } from "./region.ts"

/** The widest tile requested, px: the services take 5000 and 5130. */
const MAX_SIDE = 4096
/** Beyond this many pixels (a 3.2 km square at 0.5 m) the resolution drops: a bigger SVG is slow to open. */
const MAX_PIXELS = 40e6
const ROOT = join(import.meta.dirname, "../..")
const RESEARCH = join(ROOT, ".research/ortho")

/** The command line. */
export interface Args {
  readonly rect: Rect
  readonly layer: string
  /** The output path as given; absent: under .research/ortho/. */
  readonly out?: string
  /** Metres per pixel. */
  readonly px: number
  readonly refresh: boolean
}

const USAGE =
  "usage: node src/tools/ortho.ts <x0>,<y0>,<x1>,<y1> [layer=rt_ofc.2k10] [out.svg] [--px <m>] [--refresh]"

/** Reads the arguments: negative coordinates are positional, the path is the one ending in .svg. */
export const readArgs = (argv: ReadonlyArray<string>): Args => {
  const rest: Array<string> = []
  let px = 0.5,
    refresh = false
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] === "--px") px = Number(argv[++k])
    else if (argv[k] === "--refresh") refresh = true
    else rest.push(argv[k]!)
  }
  const rect = (rest[0] ?? "").split(",").map(Number)
  const [x0, y0, x1, y1] = rect
  if (rect.length !== 4 || !rect.every(Number.isFinite) || !(x1! > x0! && y1! > y0!) || !(px > 0))
    throw new Error(USAGE)
  const out = rest.slice(1).find((a) => a.endsWith(".svg")),
    layer = rest.slice(1).find((a) => !a.endsWith(".svg")) ?? "rt_ofc.2k10"
  return { rect: [x0!, y0!, x1!, y1!], layer, ...(out === undefined ? {} : { out }), px, refresh }
}

/** `px`, or the coarser resolution (to the centimetre) that keeps `rect` within `max` pixels. */
export const fitPx = ([x0, y0, x1, y1]: Rect, px: number, max = MAX_PIXELS): number => {
  const area = (x1 - x0) * (y1 - y0)
  return area / (px * px) > max ? Math.ceil(Math.sqrt(area / max) * 100) / 100 : px
}

/** What the SVG draws over the photo, in local metres. */
export interface Overlay {
  /** Building outer rings, flat. */
  readonly buildings: ReadonlyArray<ReadonlyArray<number>>
  /** Discs (x, y, r). */
  readonly cores: ReadonlyArray<readonly [number, number, number]>
  readonly water: ReadonlyArray<Pick<Water, "name" | "kind" | "w" | "bed" | "pts">>
}

/** The text under the photo: the layer, its credit and, for a layer we may not trace, why. */
export interface Caption {
  readonly layer: string
  readonly title: string
  /** The credit line: the attribution and the licence. */
  readonly credit: string
  /** Set for a look-only layer. */
  readonly lookOnly?: string
}

/** A fetched tile. */
export interface Photo {
  readonly tile: Tile
  readonly jpeg: Uint8Array
}

/** The largest of 1, 2 and 5 times a power of ten that is at most `v`. */
export const niceStep = (v: number): number => {
  const p = 10 ** Math.floor(Math.log10(v))
  return [5, 2, 1].map((m) => m * p).find((s) => s <= v) ?? p
}

/** An SVG path through flat local points, in the frame's pixels to 0.1 px, closed with Z when `closed`. */
export const pathOf = (f: Frame, pts: ReadonlyArray<number>, closed: boolean): string => {
  let d = ""
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const [u, v] = toPx(f, pts[k]!, pts[k + 1]!)
    d += `${k === 0 ? "M" : "L"}${r1(u)} ${r1(v)}`
  }
  return closed && d !== "" ? `${d}Z` : d
}

const esc = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** Words of `s` in lines of at most `n` characters. */
const wrap = (s: string, n: number): Array<string> =>
  s.split(" ").reduce<Array<string>>((lines, word) => {
    const last = lines.at(-1)
    if (last !== undefined && last.length + 1 + word.length <= n)
      lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
    return lines
  }, [])

/** Whether the box [x0, y0, x1, y1] meets the rectangle widened by `pad`. */
const meets = (b: Rect, r: Rect, pad: number): boolean =>
  b[0] <= r[2] + pad && b[2] >= r[0] - pad && b[1] <= r[3] + pad && b[3] >= r[1] - pad

const BUILDING = "#ffd400",
  CORE = "#ff3fd8",
  WATER = "#1e90ff",
  BED = "#e0b060"

/** The SVG: the photo tiles, the overlay clipped to the frame, the grid and scale bar, and the caption below. */
export const orthoSvg = (
  f: Frame,
  photos: ReadonlyArray<Photo>,
  overlay: Overlay,
  caption: Caption,
): string => {
  const [x0, y0, x1, y1] = f.rect
  const sx = f.w / (x1 - x0),
    sy = f.h / (y1 - y0)
  const font = Math.min(28, Math.max(11, Math.round(f.w / 70))),
    line = Math.round(font * 1.35)
  const halo = `stroke="#000" stroke-width="${r1(font / 5)}" paint-order="stroke"`
  const text = (u: number, v: number, s: string, anchor = "start", fill = "#fff") =>
    `<text x="${r1(u)}" y="${r1(v)}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`
  const out: Array<string> = []

  for (const { tile, jpeg } of photos)
    out.push(
      `<image x="${tile.i}" y="${tile.j}" width="${tile.w}" height="${tile.h}" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}"/>`,
    )

  // The grid every `step` metres, labelled along the top and left edges, clear of the corner labels.
  const step = niceStep(Math.min(x1 - x0, y1 - y0) / 5)
  const grid: Array<string> = [],
    labels: Array<string> = []
  const ticks = (a: number, b: number) =>
    Array.from({ length: Math.floor(b / step) - Math.ceil(a / step) + 1 }, (_, k) =>
      Number(((Math.ceil(a / step) + k) * step).toFixed(3)),
    )
  for (const x of ticks(x0, x1)) {
    const [u] = toPx(f, x, y1)
    grid.push(`M${r1(u)} 0V${f.h}`)
    if (u > font * 9 && u < f.w - font * 9) labels.push(text(u, font * 2.4, `${x}`, "middle"))
  }
  for (const y of ticks(y0, y1)) {
    const [, v] = toPx(f, x0, y)
    grid.push(`M0 ${r1(v)}H${f.w}`)
    if (v > font * 4 && v < f.h - font * 6) labels.push(text(font * 0.4, v - font * 0.3, `${y}`))
  }
  out.push(
    `<path d="${grid.join("")}" stroke="#fff" stroke-opacity="0.35" stroke-width="1" fill="none"/>`,
  )

  // Each stream's bed (both half-widths) under its water width, in metres on the photo.
  const water = overlay.water.filter((w) => meets(ringBox(w.pts), f.rect, w.bed))
  const stroke = (pts: ReadonlyArray<number>, color: string, opacity: number, width: number) =>
    `<path d="${pathOf(f, pts, false)}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${r1(width * sx)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  out.push(
    ...water.map((w) => stroke(w.pts, BED, 0.35, 2 * w.bed)),
    ...water.map((w) => stroke(w.pts, WATER, 0.55, w.w)),
  )

  const outlines = overlay.buildings
    .filter((b) => meets(ringBox(b), f.rect, 0))
    .map((b) => pathOf(f, b, true))
  out.push(`<path d="${outlines.join("")}" stroke="${BUILDING}" stroke-width="1.5" fill="none"/>`)

  const cores = overlay.cores.filter(([x, y, r]) => meets([x - r, y - r, x + r, y + r], f.rect, 0))
  for (const [x, y, r] of cores) {
    const [u, v] = toPx(f, x, y)
    out.push(
      `<ellipse cx="${r1(u)}" cy="${r1(v)}" rx="${r1(r * sx)}" ry="${r1(r * sy)}" stroke="${CORE}" stroke-width="2.5" fill="none"/>`,
      `<path d="M${r1(u - 6)} ${r1(v)}h12M${r1(u)} ${r1(v - 6)}v12" stroke="${CORE}" stroke-width="2"/>`,
    )
  }

  out.push(`<g font-family="Helvetica, Arial, sans-serif" font-size="${font}" ${halo}>`, ...labels)
  for (const [x, y, r] of cores) {
    const [u, v] = toPx(f, x, y)
    // Above the disc, or under its centre when the disc's top is off the photo.
    const top = v - r * sy - font * 0.4
    out.push(text(u, top > font * 3 ? top : v + font * 1.4, `${x},${y} r${r}`, "middle", CORE))
  }
  // Each stream named once, at its vertex nearest the crop's centre.
  for (const w of water) {
    let best = -1,
      bestD = Infinity
    for (let k = 0; k + 1 < w.pts.length; k += 2) {
      const [x, y] = [w.pts[k]!, w.pts[k + 1]!]
      const d = Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2)
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && d < bestD) [best, bestD] = [k, d]
    }
    if (best < 0) continue
    const [u, v] = toPx(f, w.pts[best]!, w.pts[best + 1]!)
    out.push(
      text(
        u + font * 0.5,
        v,
        `${w.name ?? w.kind}: w ${w.w} m, bed ±${w.bed} m`,
        "start",
        "#bfe0ff",
      ),
    )
  }
  out.push(
    text(font * 0.4, font * 1.1, `${x0}, ${y1}`),
    text(f.w - font * 0.4, font * 1.1, `${x1}, ${y1}`, "end"),
    text(font * 0.4, f.h - font * 0.4, `${x0}, ${y0}`),
    text(f.w - font * 0.4, f.h - font * 0.4, `${x1}, ${y0}`, "end"),
  )
  // The scale bar, above the south-west corner label.
  const bar = niceStep((x1 - x0) / 4),
    bu = font * 0.6,
    bv = f.h - font * 2.2
  out.push(
    `<path d="M${r1(bu)} ${r1(bv - 6)}v6h${r1(bar * sx)}v-6" stroke="#fff" stroke-width="3" fill="none"/>`,
    text(bu + (bar * sx) / 2, bv - 9, `${bar} m`, "middle"),
  )
  if (caption.lookOnly !== undefined)
    out.push(
      `<rect x="0" y="${r1(f.h / 2 - line)}" width="${f.w}" height="${line * 2}" fill="#c00000" fill-opacity="0.6" stroke="none"/>`,
      text(f.w / 2, f.h / 2 + font * 0.35, "LOOK ONLY: never trace from this layer", "middle"),
    )
  out.push("</g>")

  // The caption under the photo.
  const chars = Math.max(30, Math.floor(f.w / (font * 0.55)))
  const captionLines: Array<[string, string]> = [
    ...wrap(
      `${caption.title} (${caption.layer}), ${+(1 / sx).toPrecision(3)} m/px, ${f.w}×${f.h} px`,
      chars,
    ).map((s): [string, string] => [s, "#fff"]),
    ...wrap(caption.credit, chars).map((s): [string, string] => [s, "#fff"]),
    ...(caption.lookOnly === undefined
      ? []
      : wrap(caption.lookOnly, chars).map((s): [string, string] => [s, "#ff6060"])),
    ...wrap(
      "Overlay, the built map (OSM, ODbL; Regione Toscana CTR and LiDAR): yellow building outlines; magenta STONE_CORES (x,y r); blue water width w; tan the bed, ±bed m.",
      chars,
    ).map((s): [string, string] => [s, "#ccc"]),
  ]
  const footer = captionLines.length * line + font
  out.push(
    `<rect x="0" y="${f.h}" width="${f.w}" height="${footer}" fill="#111"/>`,
    `<g font-family="Helvetica, Arial, sans-serif" font-size="${font}">`,
    ...captionLines.map(([s, fill], k) => text(font * 0.4, f.h + line * (k + 1), s, "start", fill)),
    "</g>",
  )
  const height = f.h + footer
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f.w}" height="${height}" viewBox="0 0 ${f.w} ${height}">\n${out.join("\n")}\n</svg>\n`
}

/** The caption of `layer`: its credit and licence, or why it is look only. */
export const captionOf = (
  layer: string,
  info: WmsLayer,
  licence: OrthoLicence | undefined,
): Caption => {
  const credit = `${info.attribution ?? "Fonte dei dati: Regione Toscana"} – ${info.title}`
  return licence?.licence === undefined
    ? {
        layer,
        title: info.title,
        credit: `${credit}. Owner: ${licence?.owner ?? "unknown"}.`,
        lookOnly: `LOOK ONLY, never trace: ${licence?.why ?? "the layer is not in ortho-wms.ts's licence table"}.`,
      }
    : { layer, title: info.title, credit: `${credit}, ${licence.licence} (${licence.why}).` }
}

/** The bytes at `file`, else `get()`'s, kept at `file`; `refresh` always asks again. */
const cached = async (
  file: string,
  refresh: boolean,
  get: () => Promise<Uint8Array>,
): Promise<Uint8Array> => {
  if (!refresh && existsSync(file)) return readFileSync(file)
  const bytes = await get()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  return bytes
}

/** A GetMap's JPEG; a WMS error comes back as XML with HTTP 200, so anything but an image throws. */
const getJpeg = async (url: string): Promise<Uint8Array> => {
  const res = await request(url)
  const type = res.headers.get("content-type") ?? ""
  if (!res.ok || !type.startsWith("image/"))
    throw new Error(
      `GetMap ${url}: HTTP ${res.status} ${type}: ${(await res.text()).slice(0, 400)}`,
    )
  return new Uint8Array(await res.arrayBuffer())
}

if (import.meta.main) {
  const args = readArgs(process.argv.slice(2))
  const services = await pool(ORTHO_SERVICES, 2, async (service) => {
    const file = join(RESEARCH, `capabilities-${service.split("map=")[1]}.xml`)
    const xml = await cached(file, args.refresh, async () => {
      const bytes = await getBytes(`${service}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`)
      parseCapabilities(bytes.toString("utf8")) // throws on a WMS error before it is cached
      return bytes
    })
    return { service, caps: parseCapabilities(Buffer.from(xml).toString("utf8")) }
  })
  const found = services.find((s) => s.caps.layers.has(args.layer))
  if (found === undefined) {
    const names = services.flatMap((s) =>
      [...s.caps.layers.keys()].filter((n) => n.startsWith("rt_ofc.") && !n.endsWith(".qu")),
    )
    throw new Error(
      `no layer ${args.layer} in either service; the orthophotos are: ${names.join(" ")}`,
    )
  }
  const { service, caps } = found,
    info = caps.layers.get(args.layer)!
  if (!caps.crs.includes("EPSG:4326") || !caps.formats.includes("image/jpeg"))
    throw new Error(`${service} offers no EPSG:4326 JPEG GetMap`)

  const licence = licenceOf(args.layer)
  if (licence?.licence === undefined)
    console.warn(
      `WARNING: ${args.layer} is LOOK ONLY, never trace from it: ${licence?.why ?? "not in the licence table (ortho-wms.ts)"}`,
    )
  const [x0, y0, x1, y1] = args.rect
  const px = fitPx(args.rect, args.px)
  if (px !== args.px)
    console.warn(
      `the crop is over ${MAX_PIXELS / 1e6} MP at ${args.px} m/px: drawing it at ${px} m/px`,
    )
  const [lat0, lon0] = fromLocal(x0, y0),
    [lat1, lon1] = fromLocal(x1, y1),
    [west, south, east, north] = info.box
  if (lon1 < west || lon0 > east || lat1 < south || lat0 > north)
    console.warn(
      `the crop lies outside ${args.layer}'s box (lon ${west}–${east}, lat ${south}–${north}): it will be blank`,
    )

  const frame = frameOf(args.rect, px)
  const tiles = tilesOf(frame, Math.min(MAX_SIDE, caps.maxWidth, caps.maxHeight))
  const photos = await pool(tiles, 4, async (tile): Promise<Photo> => {
    const url = getMapUrl(service, args.layer, tile)
    const key = createHash("sha256").update(url).digest("hex").slice(0, 20)
    return {
      tile,
      jpeg: await cached(join(RESEARCH, "tiles", `${key}.jpg`), args.refresh, () => getJpeg(url)),
    }
  })

  const map = decodeMap(mapFile())
  const svg = orthoSvg(
    frame,
    photos,
    { buildings: map.buildings.map((b) => b.outer), cores: STONE_CORES, water: map.water },
    captionOf(args.layer, info, licence),
  )
  const out =
    args.out === undefined
      ? join(RESEARCH, `${args.rect.join("_")}_${args.layer}.svg`)
      : resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, svg)
  const bytes = photos.reduce((s, p) => s + p.jpeg.length, 0)
  // Relative to the repository: the line may be pasted into a PR.
  console.log(
    `${relative(ROOT, out)}: ${args.layer}, ${frame.w}×${frame.h} px at ${+((x1 - x0) / frame.w).toPrecision(3)} m/px in ${tiles.length} tile(s), ${(bytes / 1e6).toFixed(2)} MB of JPEG; ${licence?.licence === undefined ? "LOOK ONLY" : `traceable, ${licence.licence}`}`,
  )
}
