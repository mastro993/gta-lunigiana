// The check ground.map-test.ts runs on each built map: the ground, surface and water lookups, which
// read the roads and rivers from the tiles, answer to the bit as the old ones over the whole map did
// (`oracle`), over seeded points (half of them by the tiles' seams), every road and river vertex and
// every 16 m bucket of road. Import it once the map is loaded.
import assert from "node:assert/strict"
import { isDeepStrictEqual } from "node:util"

import { Ops } from "@typeonce/ritmo-math"

import type { JoinedMap } from "../../../tools/map-file.ts"
import { segDist2 } from "../../collide.ts"
import { reachOf } from "../../water/channel.ts"
import { waterAt, waterUnder } from "../../water/rivers.ts"
import {
  atGrade,
  deckNear,
  drawnZ,
  footZ,
  groundZ,
  platformTop,
  roadLevel,
  terrainZ,
} from "../ground.ts"
import { MAP } from "../index.ts"
import { HALO, TILE } from "../kinds.ts"
import { surfaceAt } from "../surface.ts"
import { placeAt, TILE_RANGE } from "../tiles.ts"
import { oracle } from "./ground-oracle.ts"

/** The rivers dry, at their mean, in a spate (water.test.ts's) and in a great flood, m³/s per km². */
const FLOWS = [0, 0.041, 0.6, 2.5]

/** Fails unless `got` is `want` to the bit (a number by `Object.is`, an object field by field). */
const same = (got: unknown, want: unknown, what: () => string): void => {
  if (!isDeepStrictEqual(got, want))
    assert.fail(`${what()}: ${JSON.stringify(got)}, was ${JSON.stringify(want)}`)
}

/**
 * Asserts that every lookup answers at seeded points over `whole` (the loaded map, joined back
 * from its tiles) as the old whole-map lookups do; returns how many points it checked.
 */
export const assertGroundAsBefore = (whole: JoinedMap, seed: number): number => {
  const old = oracle(whole)
  let state = seed
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let points = 0

  /** Every lookup at (x, y), with levels round the ground there and road `road` (index), if given. */
  const check = (x: number, y: number, road?: number) => {
    points++
    const at = () => `(${x}, ${y})`
    const ground = old.groundZ(x, y),
      terrain = terrainZ(x, y)
    same(groundZ(x, y), ground, () => `groundZ ${at()}`)
    same(footZ(x, y), old.footZ(x, y), () => `footZ ${at()}`)
    same(atGrade(x, y), old.atGrade(x, y), () => `atGrade ${at()}`)
    same(platformTop(x, y), old.platformTop(x, y), () => `platformTop ${at()}`)
    for (const near of [terrain, ground + 0.3, terrain + (next() - 0.5) * 16]) {
      same(groundZ(x, y, near), old.groundZ(x, y, near), () => `groundZ ${at()} near ${near}`)
      same(
        groundZ(x, y, near, true),
        old.groundZ(x, y, near, true),
        () => `groundZ ${at()} near ${near}, verges`,
      )
      same(footZ(x, y, near), old.footZ(x, y, near), () => `footZ ${at()} near ${near}`)
      same(drawnZ(x, y, near), old.drawnZ(x, y, near), () => `drawnZ ${at()} over ${near}`)
    }
    for (const pad of [1, next() * 24])
      same(deckNear(x, y, pad), old.deckNear(x, y, pad), () => `deckNear ${at()} pad ${pad}`)
    for (const level of [undefined, ground, terrain, terrain + 30])
      same(surfaceAt(x, y, level), old.surfaceAt(x, y, level), () => `surfaceAt ${at()} ${level}`)
    const q = FLOWS[Math.floor(next() * FLOWS.length)]!,
      floor = ground - next() * 2
    same(
      waterAt(x, y, floor, q),
      old.waterAt(x, y, floor, q),
      () => `waterAt ${at()} over ${floor} q ${q}`,
    )
    for (const inWater of [true, false])
      same(
        waterUnder(x, y, inWater, q),
        old.waterUnder(x, y, inWater, q),
        () => `waterUnder ${at()} ${inWater} q ${q}`,
      )
    if (road !== undefined) {
      levelOf(road, x, y)
      levelOf(road, x + (next() - 0.5) * 80, y + (next() - 0.5) * 80)
    }
    // and two roads of the point's tile, wherever they run in it
    const { ids } = placeAt(x, y).vectors.roads
    for (let k = 0; k < 2 && ids.length > 0; k++)
      levelOf(ids[Math.floor(next() * ids.length)]!, x, y)
  }
  /** Road `road`'s level at (x, y) is the old one within `HALO` of it, and none farther off. */
  const levelOf = (road: number, x: number, y: number) => {
    const { pts } = whole.roads[road]!
    let d2 = Infinity
    for (let k = 0; k + 3 < pts.length; k += 2)
      d2 = Math.min(d2, segDist2(x, y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!).d2)
    same(
      roadLevel(road, x, y),
      d2 > HALO * HALO ? undefined : old.roadLevel(road, x, y),
      () => `roadLevel ${road} (${x}, ${y}), ${Math.sqrt(d2)} m off`,
    )
  }

  // Seeded points over the map and 50 m past it, half of them within 40 m of a seam between tiles.
  const { minX, minY, maxX, maxY } = MAP.bounds,
    { i0, i1, j0, j1 } = TILE_RANGE
  for (let k = 0; k < 6000; k++) {
    const seam = k % 2 === 0
    const x = seam
        ? TILE * (i0 + Math.floor(next() * (i1 - i0 + 2))) + (next() - 0.5) * 80
        : minX - 50 + next() * (maxX - minX + 100),
      y = seam
        ? TILE * (j0 + Math.floor(next() * (j1 - j0 + 2))) + (next() - 0.5) * 80
        : minY - 50 + next() * (maxY - minY + 100)
    check(x, y)
  }
  // Every road vertex and segment midpoint, and a bridge's or tunnel's walkers' verges either side of it.
  whole.roads.forEach((road, index) => {
    const { pts } = road
    for (let k = 0; k + 1 < pts.length; k += 2) {
      check(pts[k]!, pts[k + 1]!, index)
      if (k + 3 >= pts.length) continue
      const ax = pts[k]!,
        ay = pts[k + 1]!,
        dx = pts[k + 2]! - ax,
        dy = pts[k + 3]! - ay,
        l = Ops.hypot(dx, dy) || 1
      check(ax + dx / 2, ay + dy / 2, index)
      if (road.bridge !== true && road.tunnel !== true) continue
      const t = next(),
        off = road.w / 2 + 0.3 + next()
      for (const side of [-1, 1])
        check(ax + dx * t - (dy / l) * off * side, ay + dy * t + (dx / l) * off * side, index)
    }
  })
  // Every river vertex, and a point across its bed out to a little past it.
  for (const water of whole.water) {
    const { pts } = water,
      reach = reachOf(water)
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const dx = pts[k + 2]! - pts[k]!,
        dy = pts[k + 3]! - pts[k + 1]!,
        l = Ops.hypot(dx, dy) || 1,
        t = next(),
        off = (next() * 2 - 1) * reach * 1.1
      check(pts[k]!, pts[k + 1]!)
      check(pts[k]! + dx * t - (dy / l) * off, pts[k + 1]! + dy * t + (dx / l) * off)
    }
  }
  // A point in every 16 m bucket the old broad phase had road in.
  for (const key of old.buckets.keys()) {
    const bx = Math.floor(key / 65536) - 32768,
      by = (key % 65536) - 32768
    check(16 * (bx + next()), 16 * (by + next()))
  }
  return points
}
