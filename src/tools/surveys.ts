// The surveys of the ground merged into one (`Survey`, ctr.ts) by priority: each source's buildings
// and road surfaces stand where no source before it maps the ground, and its buildings off those an
// earlier source keeps (overlap.ts). The build reads them here.
import { join } from "node:path"

import { staticGrid } from "../sim/collide.ts"
import { type RoadArea, type Survey, type SurveyBuilding, readCtr, readOldCtr } from "./ctr.ts"
import { readDbt } from "./dbt.ts"
import { centroid, pointInRing, ringBox, TERRAIN_BOX } from "./geometry.ts"
import { readNc5 } from "./nc5.ts"
import { apartFrom } from "./overlap.ts"

/** A region with no survey: Cesena. */
export const NO_SURVEY: Survey = { buildings: [], roadAreas: [], mapped: [] }

/**
 * The surveys in priority order, merged: each source's buildings and road surfaces are kept where
 * no source before it maps the ground (by the centroid of the building's outline or the surface's
 * outer ring), a building only where it shares less than half the smaller one's area with every
 * building a source before it keeps (`apartFrom`: one outside its own mapped area, as at the 2019
 * CTR's edge or the Tuscany-Liguria border), and every source's mapped area is kept.
 */
export const bySourcePriority = (surveys: ReadonlyArray<Survey>): Survey => {
  const buildings: Array<SurveyBuilding> = [],
    roadAreas: Array<RoadArea> = [],
    mapped: Array<ReadonlyArray<number>> = []
  for (const survey of surveys) {
    const before = mapped.slice(),
      grid = staticGrid(before.length, (k) => ringBox(before[k]!), 64)
    const free = (ring: ReadonlyArray<number>) => {
      const [x, y] = centroid(ring)
      let hit = false
      grid(x, y, x, y, (k) => (hit ||= pointInRing(x, y, before[k]!)))
      return !hit
    }
    const kept = apartFrom(
      buildings,
      survey.buildings.filter((b) => free(b.outer)),
    )
    buildings.push(...kept)
    roadAreas.push(...survey.roadAreas.filter((a) => free(a.rings[0]!)))
    mapped.push(...survey.mapped)
  }
  return { buildings, roadAreas, mapped }
}

/**
 * Every survey under `rt` (data/raw/rt) and the parts' Liguria folders `lig` (data/raw/lig/<part>),
 * clipped to `box`, merged by `bySourcePriority` in the order of their precision and age: the CTR
 * 1:2000 of 2019, then the DBT 1:2000 (2010), then the CTR 1:2000 of 2009, then Liguria's NC5 1:5000
 * (2018), then the CTR 1:10 000 of 2010 (fetched only where the part's manifest lists it). Regione
 * Toscana's surveys stop at its border and the NC5 at Liguria's. OSM's buildings stand where none
 * maps the ground (features.ts). `ctr2019` alone is the 2019 CTR, whose sheets also map the rail
 * (`ctr-rail.ts`).
 */
export const readSurveys = (
  rt: string,
  lig: ReadonlyArray<string>,
  box = TERRAIN_BOX,
): { readonly survey: Survey; readonly ctr2019: Survey } => {
  const ctr2019 = readCtr(join(rt, "ctr"), box)
  return {
    survey: bySourcePriority([
      ctr2019,
      readDbt(join(rt, "dbt2k"), box),
      readOldCtr(join(rt, "ctr2009"), "ctr2009", box),
      readNc5(
        lig.map((dir) => join(dir, "nc5")),
        box,
      ),
      readOldCtr(join(rt, "ctr10k"), "ctr10k", box),
    ]),
    ctr2019,
  }
}
