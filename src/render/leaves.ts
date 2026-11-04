/**
 * When the woods are in leaf: what a deciduous crown wears on a day, by its kind and height, from the
 * climate's daily-mean normals at the map's latitude (src/sim/sky/climate.ts), so it holds on any map.
 * The renderer fixes it for a session at the day the game starts on: the trees never change while it
 * runs, so no chunk is built again.
 *
 * - Leaf-out (half the leaves unfolded): the first day from the spring equinox when the daily-mean
 *   normal at the tree's height reaches `LEAF_OUT`, then each kind's `LAG`.
 * - Leaf fall (half the leaves down): on day of the year `FALL.day` + `FALL.perDegree` × the
 *   September–November mean normal at the tree's height.
 * - An oak out of leaf holds its dead leaves (the downy oak's marcescence) instead of going bare.
 *
 * The constants rest on MeteoSwiss's phenology network south and north of the Alps, 1991–2020
 * (CC BY 4.0; docs/weather.md, "The woods' leaves").
 *
 * @module render/leaves
 */
import { civilFromDays, DAY, daysFromCivil, romeDay } from "../sim/sky/calendar.ts"
import { dailyMean, normalsAt } from "../sim/sky/climate.ts"
import { place } from "../sim/sky/place.ts"
import type { TreeKind } from "./trees.ts"

/** What a crown wears: its leaves, none, or (an oak) last year's dead ones. */
export type Crown = "leafy" | "bare" | "dead"

/**
 * Leaf-out: the daily-mean normal (°C) a beech's crown greens at, `at` on the coast and `perKm` less
 * for each km up, not before day of the year `from` (the spring equinox, a floor that never binds at
 * Lunigiana's latitude).
 */
const LEAF_OUT = { at: 13.5, perKm: 2.8, from: 80 } as const
/**
 * Days each deciduous kind greens after the beech: chestnut (most of the broadleaf) 6; the oaks 16, between the downy oak's 9
 * (9 days after the hop-hornbeam, which greens with the beech) and the Turkey oak's 23 (two weeks after the other oaks), taken as
 * half each.
 */
const LAG = { broadleaf: 6, oak: 16, beech: 0 } as const
/** Leaf fall: on day of the year `day` + `perDegree` × the September–November mean normal (°C) at the tree's height. */
const FALL = { day: 285, perDegree: 2.3 } as const

/** Whether trees of `kind` drop their leaves (`LAG` lists those that do). */
const deciduous = (kind: TreeKind): kind is keyof typeof LAG => kind in LAG

/** Noon (UTC) of day `day` (days since 1970-01-01). */
const noon = (day: number): number => day * DAY + DAY / 2

/**
 * The crowns on the Rome day UTC second `t` falls on, at latitude `lat`: for each deciduous kind, the
 * height below which it is in leaf that day (leaf-out climbs the slopes in spring, leaf fall comes
 * down them in autumn); above it a beech or a broadleaf is bare and an oak holds its dead leaves.
 * Conifers and pines are always in leaf.
 */
export const crownsOn = (
  t: number,
  lat: number = place().lat,
): ((kind: TreeKind, z: number) => Crown) => {
  const today = romeDay(t).day,
    { year } = civilFromDays(today),
    first = daysFromCivil(year, 1, 1)
  const dayOfYear = today - first + 1
  // The highest ground (m) green by each day of the year from the equinox to today: the most the normals had reached by then.
  const green: Array<number> = []
  for (let d = LEAF_OUT.from, most = Number.NEGATIVE_INFINITY; d <= dayOfYear; d++) {
    const n = normalsAt(noon(first + d - 1), lat)
    // The mean at z, sea − lapse·z, against the threshold, at − perKm·z: they meet at this height.
    most = Math.max(most, (1000 * (dailyMean(n, 0) - LEAF_OUT.at)) / (n.lapse - LEAF_OUT.perKm))
    green.push(most)
  }
  const greenBelow = (day: number): number =>
    day < LEAF_OUT.from ? Number.NEGATIVE_INFINITY : green[day - LEAF_OUT.from]!
  // The September–November mean normal at z, sea − lapse·z/1000; leaf fall reaches z when today's day of the year passes FALL's.
  const autumn = [9, 10, 11].map((month) => normalsAt(noon(daysFromCivil(year, month, 15)), lat))
  const sea = autumn.reduce((sum, n) => sum + dailyMean(n, 0), 0) / 3,
    lapse = autumn.reduce((sum, n) => sum + n.lapse, 0) / 3,
    fallBelow = (1000 * (sea - (dayOfYear - FALL.day) / FALL.perDegree)) / lapse
  const below = {
    broadleaf: Math.min(greenBelow(dayOfYear - LAG.broadleaf), fallBelow),
    oak: Math.min(greenBelow(dayOfYear - LAG.oak), fallBelow),
    beech: Math.min(greenBelow(dayOfYear - LAG.beech), fallBelow),
  }
  return (kind, z) =>
    !deciduous(kind) || z < below[kind] ? "leafy" : kind === "oak" ? "dead" : "bare"
}
