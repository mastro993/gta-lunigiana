// Picks a part's CTR 1:2000 sheets: the 2019 sheets whose mapped area (the AZR layer) meets the
// play area, the union of the part's rectangles, by a positive area. Run:
// node src/tools/pick-sheets.ts <part> [--write]  (pnpm pick-sheets <part> [--write]).
// Reads .research/<part>/index.json (`rt-index` writes it) and downloads each 2019 sheet the index
// lists as available into the cache (`rt-cache.ts`; needs `unzip` on the PATH). Prints each sheet's
// frame and AZR area inside the play area and whether it is kept, the frames that meet the play area
// with older sheets only (the 2019 flight did not map them), and how the picks differ from
// data/parts/<part>.json. --write stores the picks there as `ctr`, sorted by name.

import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import { gaussBoagaToLatLon, utm32ToLatLon } from "./crs.ts"
import { type P, clipRing, signedArea, toLocal } from "./geometry.ts"
import { manifestPath, readManifest, updateManifest } from "./manifest.ts"
import { pool } from "./net.ts"
import { diffLines, diffList } from "./pick-diff.ts"
import { type Rect, partOf } from "./region.ts"
import { fetchZip, mustFind } from "./rt-cache.ts"
import { readIndex } from "./rt-index-file.ts"
import { parseShp } from "./shp.ts"

/** How far beyond the play area a sheet's frame is still downloaded, m. */
const GATE = 10

/** `p` less `q`: up to four rectangles, `p` itself when they do not overlap. */
const minus = (p: Rect, q: Rect): Array<Rect> => {
  if (q[0] >= p[2] || q[2] <= p[0] || q[1] >= p[3] || q[3] <= p[1]) return [p]
  const mx0 = Math.max(p[0], q[0]),
    mx1 = Math.min(p[2], q[2])
  const pieces: Array<Rect> = [
    [p[0], p[1], q[0], p[3]],
    [q[2], p[1], p[2], p[3]],
    [mx0, p[1], mx1, q[1]],
    [mx0, q[3], mx1, p[3]],
  ]
  return pieces.filter((r) => r[2] > r[0] && r[3] > r[1])
}

/** The rectangles' union as disjoint rectangles (each less the ones before it), so no area counts twice. */
export const disjointRects = (rects: ReadonlyArray<Rect>): Array<Rect> => {
  const out: Array<Rect> = []
  for (const r of rects)
    out.push(...out.reduce((pieces, q) => pieces.flatMap((p) => minus(p, q)), [r]))
  return out
}

/**
 * The area, m², of `polygons` (each its rings, holes wound against the outer ring as shapefiles and
 * GML have them) inside disjoint `rects`: each ring clipped to each rectangle, signed areas summed.
 */
export const areaInRects = (
  polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<P>>>,
  rects: ReadonlyArray<Rect>,
): number =>
  polygons.reduce(
    (sum, rings) =>
      sum +
      Math.abs(
        rings.reduce(
          (s, ring) => s + rects.reduce((t, rect) => t + signedArea(clipRing(ring, rect)), 0),
          0,
        ),
      ),
    0,
  )

/** The 2019 sheets kept: those whose AZR area in the play area is positive, by name. */
export const pickSheets = (areas: ReadonlyArray<{ sheet: string; azr: number }>): Array<string> =>
  areas
    .filter((a) => a.azr > 0)
    .map((a) => a.sheet)
    .toSorted()

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { write: { type: "boolean" } },
    allowPositionals: true,
  })
  const part = partOf(positionals[0])
  const index = readIndex(part.key)
  const rects = disjointRects(part.rects)
  const km2 = (m2: number): string => (m2 / 1e6).toFixed(4)
  /** A flat EPSG:3003 polygon list (the index's) in local metres. */
  const gbLocal = (polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>) =>
    polygons.map((rings) =>
      rings.map((flat) =>
        Array.from({ length: flat.length / 2 }, (_, i) =>
          toLocal(...gaussBoagaToLatLon(flat[2 * i]!, flat[2 * i + 1]!)),
        ),
      ),
    )

  const gate = disjointRects(
    part.rects.map(([x0, y0, x1, y1]): Rect => [x0 - GATE, y0 - GATE, x1 + GATE, y1 + GATE]),
  )
  const frames = index.ctr
    .filter((c) => c.year === 2019)
    .toSorted((a, b) => (a.sheet < b.sheet ? -1 : 1))
  const unavailable = frames.filter((f) => f.status !== 200 || f.url === undefined)
  const areas = await pool(
    frames.filter((f) => !unavailable.includes(f)),
    4,
    async (f) => {
      const frame = areaInRects(gbLocal(f.polygons), rects)
      // A sheet maps only inside its frame: a frame clear of the play area (by more than GATE, for
      // the frames' and the AZR's projections, a metre apart at most) needs no download.
      if (areaInRects(gbLocal(f.polygons), gate) === 0) return { sheet: f.sheet, frame, azr: 0 }
      const dir = await fetchZip(f.url!),
        name = `S_${f.sheet}_2019_AZR`
      const azr = parseShp(
        readFileSync(mustFind(dir, `${name}.shp`)),
        readFileSync(mustFind(dir, `${name}.dbf`)),
        name,
      )
      const local = azr.map((rec) =>
        rec.parts.map((ring) => ring.map(([e, n]) => toLocal(...utm32ToLatLon(e, n)))),
      )
      return { sheet: f.sheet, frame, azr: areaInRects(local, rects) }
    },
  )
  const picks = pickSheets(areas)
  console.log(`${part.key}: ${frames.length} sheets of 2019 in the index; km² inside the play area`)
  for (const a of areas)
    console.log(
      `  ${a.sheet}  frame ${km2(a.frame)}  AZR ${km2(a.azr)}  ${a.azr > 0 ? "kept" : "dropped"}`,
    )
  for (const f of unavailable)
    console.log(`  ${f.sheet}  not downloadable: HEAD ${f.status ?? "none"}`)
  console.log(`${picks.length} kept`)

  // Frames with older sheets only: the newest frame of each sheet name the 2019 flight lacks.
  const newest = new Map<string, (typeof index.ctr)[number]>()
  for (const c of index.ctr)
    if (c.year > (newest.get(c.sheet)?.year ?? -Infinity)) newest.set(c.sheet, c)
  const older = [...newest.values()]
    .filter((c) => c.year < 2019)
    .map((c) => ({ ...c, area: areaInRects(gbLocal(c.polygons), rects) }))
    .filter((c) => c.area > 0)
    .toSorted((a, b) => (a.sheet < b.sheet ? -1 : 1))
  console.log(`${older.length} frames meet the play area with older sheets only:`)
  for (const c of older) console.log(`  ${c.sheet}  newest ${c.year}  frame ${km2(c.area)}`)

  const path = relative(join(import.meta.dirname, "../.."), manifestPath(part.key))
  for (const line of diffLines(diffList(readManifest(part.key).ctr, picks), path)) console.log(line)
  if (values.write === true) {
    updateManifest(part.key, { ctr: picks })
    console.log(`wrote ${path}`)
  }
}
