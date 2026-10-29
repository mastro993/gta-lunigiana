/**
 * The level crossings' automatic full-barrier cycle (CdS art. 44 and DPR 495/1992 art. 186, the
 * Wegh TD96/2 box): a train's demand sets off `WARNING` s of the steady red light and the bell, then
 * the arms come down over `LOWERING` s; once no train has demanded the box for `RELEASE` s they rise
 * over `RAISING` s. A demand while they rise lowers them again from where they are. A train demands a
 * box from its strike-in point (`strikeIn`), sized from the line speed so the arms are down before a
 * train at that speed would begin to brake for them. A foot crossing (a path over the track) runs the
 * same cycle with no arms, light or bell, for walkers to keep off while a train is near. Pure
 * functions; the boxes are in ./crossings.ts, and `Crossings` (./systems.ts) runs the cycle.
 *
 * @module rail/barriers
 */
import { Clock } from "@typeonce/ritmo"

import { STEP } from "../schema.ts"
import { brakingDistance } from "./driver.ts"
import { type CrossingPhase, MOVING } from "./models.ts"

/** Light and bell before the arms move, s (law ≥ 5 s; the TD96/2 sets 4–60 s). */
export const WARNING = 7
/** The arms' travel down, s (the TD96/2 sets 10–15 s). */
export const LOWERING = 12
/** And up, s. */
export const RAISING = 12
/** How long without demand a closed box waits before its arms rise, s: the logic's delay once the train has cleared. */
export const RELEASE = 2
/** How far past the box along the track a train still holds it, m. */
export const MARGIN = 2
/** An AI train waits with its nose this far short of a level crossing whose arms are not down, m: its protection signal. */
export const CROSSING_HOLD = 30
/** A dwelling AI train demands the boxes ahead this long before it leaves, s: the 19 s to close, and 1 to spare. */
export const DEPARTURE = 20
/** The arms are down this long before a train at line speed would begin to brake for the box, s: room for the driver's slack. */
const SPARE = 4

const WARNING_STEPS = Clock.steps(Clock.duration(STEP, WARNING)),
  LOWERING_STEPS = Clock.steps(Clock.duration(STEP, LOWERING)),
  RAISING_STEPS = Clock.steps(Clock.duration(STEP, RAISING)),
  RELEASE_STEPS = Clock.steps(Clock.duration(STEP, RELEASE))

/**
 * How far ahead of a box a train coming at `v` m/s demands it, m (its strike-in point): it runs the warning, the lowering and
 * `SPARE` s at `v`, then its braking distance to `CROSSING_HOLD` m short of the box, so the arms are down before it would
 * brake for them. 1073 m at 85 km/h, 45 s at that speed, as a strike-in set for 45 s of warning at line speed (the law asks
 * for at least 30 s); 2.0 km at 130 km/h.
 */
export const strikeIn = (v: number): number =>
  v * (WARNING + LOWERING + SPARE) + brakingDistance(v) + CROSSING_HOLD

/** Where a line crosses a box at grade: the line (index into `LINES`), its s there, how far either side of s the road's carriageway reaches along it, and the strike-in at the line speed there, m. */
export interface CrossedLine {
  readonly line: number
  readonly s: number
  readonly half: number
  readonly reach: number
}

/** Whether the near edge of crossing `at` (its carriageway and `MARGIN`), for a train running `dir`, lies past the s `stop` its head stops at: that box waits for the train's departure. */
export const beyond = (at: CrossedLine, dir: 1 | -1, stop: number): boolean =>
  (at.s - dir * (at.half + MARGIN) - stop) * dir > 0

/** A box's saved state (`LevelCrossings`): its phase since step `since`, its arms' share down `from` (0 up … 1 down) then (read only as they move), and the last step a train `demanded` it. */
export interface CrossingState {
  readonly phase: CrossingPhase
  readonly since: number
  readonly from: number
  readonly demanded: number
}

/** A box at rest: open, its arms up. */
export const OPEN: CrossingState = { phase: "open", since: 0, from: 0, demanded: 0 }

/** What shows of a box at step `now`: its arms' share down (0 up … 1 down), whether the road light and the arms' lamps are lit, whether the bell rings. */
export interface CrossingShow {
  readonly arm: number
  readonly lit: boolean
  readonly ringing: boolean
}

/** The arms' share down at step `now`: up until they lower, down once closed, moving from `from` between. */
const armAt = (state: CrossingState, now: number): number => {
  switch (state.phase) {
    case "open":
    case "warning":
      return 0
    case "lowering":
      return Math.min(1, state.from + (now - state.since) / LOWERING_STEPS)
    case "closed":
      return 1
    case "raising":
      return Math.max(0, state.from - (now - state.since) / RAISING_STEPS)
  }
}

/** What a box shows in `state` at step `now`: lit from the warning until the arms are up, ringing in the warning and while they come down; a foot crossing (`walk`) shows nothing. */
export const crossingAt = (
  box: { readonly walk: boolean },
  state: CrossingState,
  now: number,
): CrossingShow =>
  box.walk
    ? { arm: 0, lit: false, ringing: false }
    : {
        arm: armAt(state, now),
        lit: state.phase !== "open",
        ringing: state.phase === "warning" || state.phase === "lowering",
      }

/** A box's state at step `now`, from its state the step before and whether a train demands it now. */
export const advanceCrossing = (
  state: CrossingState,
  demand: boolean,
  now: number,
): CrossingState => {
  const demanded = demand ? now : state.demanded
  const at = (phase: CrossingPhase, from: number): CrossingState => ({
    phase,
    since: now,
    from,
    demanded,
  })
  const kept = demand ? { ...state, demanded } : state
  switch (state.phase) {
    case "open":
      return demand ? at("warning", 0) : state
    case "warning":
      return now - state.since >= WARNING_STEPS ? at("lowering", 0) : kept
    case "lowering":
      return armAt(state, now) >= 1 ? at("closed", 1) : kept
    case "closed":
      return now - demanded >= RELEASE_STEPS ? at("raising", 1) : kept
    case "raising":
      if (demand) return at("lowering", armAt(state, now))
      return armAt(state, now) <= 0 ? at("open", 0) : state
  }
}

/**
 * A train as the crossings see it: on `line`, its ends at s `head` (the active cab's nose) and
 * `tail`, moving `v` m/s toward +s. A driven train also says which way it runs (`dir`), the s its head
 * stops at next on this run (an AI train's: none past its last station), and whether it is `ready` to
 * move off (the player's: its lever forward).
 */
export interface RailTrain {
  readonly line: number
  readonly head: number
  readonly tail: number
  readonly v: number
  readonly ai?: { readonly dir: 1 | -1; readonly stop?: number; readonly ready: boolean }
}

/** Whether `train` demands the box where line `at.line` crosses it (see `demands`). */
const demandsAt = (at: CrossedLine, train: RailTrain): boolean => {
  const lo = Math.min(train.head, train.tail),
    hi = Math.max(train.head, train.tail)
  if (lo <= at.s + at.half + MARGIN && hi >= at.s - at.half - MARGIN) return true
  const { ai } = train
  if (ai?.stop !== undefined && beyond(at, ai.dir, ai.stop)) return false
  const reach = Math.max(at.reach, strikeIn(Math.abs(train.v)))
  if (Math.abs(train.v) > MOVING) {
    const way = Math.sign(train.v),
      ahead = (at.s - (way > 0 ? hi : lo)) * way
    return ahead >= 0 && ahead <= reach
  }
  if (ai?.ready !== true) return false
  const ahead = (at.s - train.head) * ai.dir
  return ahead >= 0 && ahead <= reach
}

/**
 * Whether any train demands a box: one on a line that crosses it (`on`, at grade: no train on a bridge over the road or in a
 * tunnel under it) with any part within the box and MARGIN m; one moving toward it with the end leading its motion within the
 * box's strike-in (at the line speed there, or at the train's own speed if faster); or a train standing ready to go with
 * the box ahead within it. An AI train demands only the boxes whose near edge is short of its next stop: the one beyond a
 * station waits for its departure.
 */
export const demands = (
  box: { readonly on: ReadonlyArray<CrossedLine> },
  trains: ReadonlyArray<RailTrain>,
): boolean =>
  box.on.some((at) => trains.some((train) => train.line === at.line && demandsAt(at, train)))
