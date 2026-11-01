/**
 * The weather plan tests' days: Rome's midnights from 2001-01-01, the lowland places at the
 * calibration latitudes, and the plans drawn day after day. Shared by `plan.test.ts` and
 * `plan.long-test.ts`.
 *
 * @module sim/sky/__tests__/plans
 */
import type { PlanValue } from "../../schema.ts"
import { DAY, daysFromCivil, utcFromRome } from "../calendar.ts"
import type { Place } from "../place.ts"
import { calmPlan, planFor } from "../plan.ts"

/** An hour, s. */
export const HOUR = 3600
/** Rome's midnight starting day `day` (days since 1970-01-01). */
export const midnight = (day: number) => utcFromRome(day * DAY)
/** 2001-01-01, the day the plans start, in days since 1970-01-01. */
const FIRST = daysFromCivil(2001, 1, 1)
/** Lowland places at the calibration latitudes: Sicily, Lazio, the Po plain. */
export const PLACES: ReadonlyArray<Place> = [
  { lat: 38, lon: 15, floor: 0, downslope: 0 },
  { lat: 42, lon: 12.5, floor: 0, downslope: 0 },
  { lat: 45.5, lon: 9.2, floor: 0, downslope: 0 },
]

/** `days` plans from 2001-01-01, each drawn at its Rome midnight under the weather seed `seed`, starting from a new game's. */
export const plans = (days: number, seed: number): Array<PlanValue> => {
  const list: Array<PlanValue> = []
  let plan = calmPlan(midnight(FIRST))
  for (let d = 0; d < days; d++) list.push((plan = planFor(plan, midnight(FIRST + d), seed)))
  return list
}
