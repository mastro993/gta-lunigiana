// Every building of Lunigiana's map stands once (overlap.ts): no two of different sources (OSM and
// each survey, by the id's slot: survey-ids.ts), nor an old-schema ruin ring (ML_l) and a unit
// (AE_a) of its own sheet, share half the smaller one's area. Two of one source may: the 2019 CTR's
// volumetric units stand on each other.
import assert from "node:assert/strict"
import { test } from "node:test"

import { staticGrid } from "../../sim/collide.ts"
import { ringBox } from "../geometry.ts"
import { wholeMap } from "../map-file.ts"
import { overlapShare, SAME } from "../overlap.ts"
import { SOURCES } from "../survey-ids.ts"

/** An id's slot step (2^32) and a source's sections (2^16), as survey-ids.ts numbers them. */
const SLOT = 4294967296,
  SECTIONS = 65536
/** A 1:2000 sheet's record numbers, and its ML_l's from LAYER on; a 1:10 000 section's ML_l's from SECTION_LAYER (ctr.ts). */
const SHEET = 1e5,
  LAYER = 5e4,
  SECTION_LAYER = 5e6,
  UNIT = 1e7

/** A building's source (0 for OSM), and for an old-schema survey its sheet and whether it is a ruin ring. */
const originOf = (id: number) => {
  if (id > 0) return { source: 0 }
  const slot = Math.floor(-id / SLOT),
    source = Math.floor(slot / SECTIONS),
    unit = (-id - slot * SLOT) % UNIT
  if (source === SOURCES.ctr2009)
    return { source, sheet: slot * 100 + Math.floor(unit / SHEET), ring: unit % SHEET >= LAYER }
  if (source === SOURCES.ctr10k) return { source, sheet: slot * 100, ring: unit >= SECTION_LAYER }
  return { source }
}

test("no building of one source stands on one of another, nor a ruin ring on a unit of its sheet", () => {
  const { buildings } = wholeMap()
  const origins = buildings.map((b) => originOf(b.id))
  const grid = staticGrid(buildings.length, (k) => ringBox(buildings[k]!.outer), 32)
  const twice: Array<string> = []
  let pairs = 0
  buildings.forEach((b, i) => {
    const a = origins[i]!
    grid(...ringBox(b.outer), (j) => {
      const o = origins[j]!
      if (j <= i || buildings[j]!.id === b.id) return
      const apart = a.source !== o.source,
        ring = a.sheet !== undefined && a.sheet === o.sheet && a.ring !== o.ring
      if (!apart && !ring) return
      pairs++
      const share = overlapShare(b, buildings[j]!)
      if (share >= SAME) twice.push(`${b.id} and ${buildings[j]!.id}: ${share.toFixed(2)}`)
    })
  })
  // 331 with Fosdinovo's part (issue #18): the check reads the sources' ids as survey-ids.ts writes them.
  assert.ok(pairs > 300, `${pairs} pairs of buildings of two sources side by side`)
  assert.deepEqual(twice, [])
})
