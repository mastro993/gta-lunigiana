// The runbook's critic aid (issue #3, step 1): what a part's edges cut through.
// Run: node src/tools/footprint-check.ts <part> [--refresh]  (pnpm footprint-check <part>).
// - It judges the part's play area: its mask where it has one, else the union of its rectangles
//   (region.ts). The outline is cut into straight edges, each labelled by the way it faces out
//   (N/S/E/W, or on a slanted mask edge the nearest compass point and its bearing, with its ends);
//   an edge is cut wherever another part's play area starts or stops beside it, and a piece whose
//   outer side lies in another part's play area (its mask, or its rectangles without one) is a
//   seam with that part: listed, never a finding.
// - One Overpass query over the box round the part's rectangles + 1 km: place nodes, building
//   centres and highway ways with their geometry. The answer is kept in
//   .research/<part>/footprint-osm.json and queried again only with --refresh or when its box no
//   longer holds the part's box + 500 m.
// - Findings, against the edges that are not seams: places within 300 m of an edge (either side);
//   clusters of 5+ buildings chained at 50 m with a member within 300 m of one; roads that leave
//   the play area across one and come back. The play area is every built part's (the region's
//   union), so a road out through a seam and back never leaves it, and one that only leaves
//   another part and comes back is that part's to judge. Ways join where they share a node, so a
//   road split into several ways, or two roads that meet outside, count: from each crossing of the
//   outline, the shortest way outside to another crossing. Drivable classes are findings; paths,
//   footways, steps, cycleways and bridleways, searched on their own, are notes.
// - Unresolved, apart from the findings and notes: roads and paths that leave across one of the
//   part's edges and come within 50 m of the queried box's edge without coming back. What lies
//   beyond the box was not asked, so such a road may come back there; ask again over a wider box
//   (QUERY_PAD) to follow it.
// Prints the report (footprint-report.ts) and writes .research/<part>/footprint.json, which the
// critic reads; exits 0. A mistyped flag throws.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import {
  DRIVEN,
  type OsmCache,
  type OsmElement,
  WALKED,
  footprintReport,
  reportLines,
} from "./footprint-report.ts"
import { fromLocal } from "./geometry.ts"
import { overpass } from "./net.ts"
import { PARTS, type Part, type Rect, partOf, rectsBox } from "./region.ts"

/** The Overpass box: the part's box + QUERY_PAD m, queried again once it no longer holds + KEEP_PAD. */
const QUERY_PAD = 1000
const KEEP_PAD = 500
const PLACES = "^(city|town|village|hamlet|isolated_dwelling|locality)$"

const holds = (outer: Rect, inner: Rect) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
const padded = ([x0, y0, x1, y1]: Rect, pad: number): Rect => [
  x0 - pad,
  y0 - pad,
  x1 + pad,
  y1 + pad,
]

const readOsm = async (part: Part, path: string, refresh: boolean): Promise<OsmCache> => {
  const need = padded(rectsBox(part.rects), KEEP_PAD)
  if (!refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as OsmCache
    if (holds(cached.box, need)) return cached
  }
  const box = padded(rectsBox(part.rects), QUERY_PAD)
  const [s, w] = fromLocal(box[0], box[1]),
    [n, e] = fromLocal(box[2], box[3])
  const bb = `(${[s, w, n, e].map((v) => v.toFixed(6)).join(",")})`
  const query = [
    "[out:json][timeout:180];",
    `node["place"~"${PLACES}"]${bb};`,
    "out;",
    `(way["building"]${bb};relation["building"]${bb};);`,
    "out ids center;",
    `way["highway"~"^(${DRIVEN}|${WALKED})$"]["area"!="yes"]${bb};`,
    "out tags geom;",
  ].join("")
  console.log(`${part.key}: querying Overpass over ${bb}`)
  const { elements } = JSON.parse(await overpass(query)) as { elements: Array<OsmElement> }
  const cache: OsmCache = { box, elements }
  writeFileSync(path, `${JSON.stringify(cache)}\n`)
  return cache
}

const { values, positionals } = parseArgs({
  strict: true,
  allowPositionals: true,
  options: { refresh: { type: "boolean" } },
})
const part = partOf(positionals[0])
const dir = join(import.meta.dirname, "../../.research", part.key)
mkdirSync(dir, { recursive: true })
const osm = await readOsm(part, join(dir, "footprint-osm.json"), values.refresh === true)

const report = footprintReport(
  part,
  PARTS.filter((p) => p.key !== part.key),
  osm,
)
const out = join(dir, "footprint.json")
writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`)
for (const line of reportLines(part, report)) console.log(line)
// Relative, so a report pasted into a PR names no local path (AGENTS.md).
console.log(`wrote ${relative(process.cwd(), out)}`)
