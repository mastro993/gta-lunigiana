/**
 * The railway as plain data for the dev debug menu's "Trains" area and `gta.trains()`: each line's
 * service, each train and who drives it, each level crossing's phase and what it shows. An inspector:
 * it changes nothing.
 *
 * @module rail/view
 */
import { MAP } from "../map/index.ts"
import {
  Driving,
  Game,
  LevelCrossings,
  Player,
  Railway,
  STEP,
  Stolen,
  Time,
  Train,
  TrainMotion,
  TrainRun,
  type TrainRunValue,
} from "../schema.ts"
import { crossingAt, type CrossingShow, OPEN } from "./barriers.ts"
import { CROSSINGS } from "./crossings.ts"
import { LINES, nextStop } from "./lines.ts"
import { type CrossingPhase, TRAINS, trainLength } from "./models.ts"

/** The railway as the dev debug menu shows it. */
export interface TrainViewModel {
  /** Each line (`LINES` order): seconds until its next train may enter (0 once due; null when none is due: one runs, or no service), and the end it enters from (0 the line's start, 1 its end). */
  readonly lines: ReadonlyArray<{ readonly due: number | null; readonly from: 0 | 1 }>
  /**
   * Each train: its entity id, its model's label, line, its active cab's nose `s` (m), speed `v` toward +s (m/s) and `facing`;
   * its AI driver's `state` (none when no AI drives it), the station it calls at next or stands at (`next`, its name; none past
   * the last), who drives it, and whether the player has stolen it.
   */
  readonly trains: ReadonlyArray<{
    readonly id: number
    readonly label: string
    readonly line: number
    readonly s: number
    readonly v: number
    readonly facing: 1 | -1
    readonly state: TrainRunValue["state"] | undefined
    readonly next: string | undefined
    readonly driver: "ai" | "player" | "none"
    readonly stolen: boolean
  }>
  /** Each level crossing (`CROSSINGS` order): its centre, its road's name, whether it is a foot crossing, its phase, and its arms, light and bell now (`crossingAt`). */
  readonly crossings: ReadonlyArray<
    CrossingShow & {
      readonly x: number
      readonly y: number
      readonly road: string
      readonly walk: boolean
      readonly phase: CrossingPhase
    }
  >
}

/** The railway now: lines, trains and crossings. */
export const TrainView = Game.Inspector(
  "Lunigiana/TrainView",
  {
    queries: {
      trains: Game.Query({
        selection: {
          train: Game.Query.read(Train),
          motion: Game.Query.read(TrainMotion),
          run: Game.Query.optional(TrainRun),
          stolen: Game.Query.optional(Stolen),
        },
      }),
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
    },
    resources: {
      railway: Game.System.readResource(Railway),
      crossings: Game.System.readResource(LevelCrossings),
      time: Game.System.readResource(Time),
    },
  },
  ({ queries, resources }): TrainViewModel => {
    const { step } = resources.time.get(),
      states = resources.crossings.get()
    const mine = new Set<number>(
      queries.player.each().flatMap(({ data }) => {
        const driving = data.driving.value()
        return driving === undefined ? [] : [Game.Entity.id(driving.vehicle)]
      }),
    )
    return {
      lines: resources.railway.get().map(({ due, from }) => ({
        due: due === null ? null : Math.max(0, due - step) * STEP.dt,
        from,
      })),
      trains: queries.trains.each().map(({ entity, data }) => {
        const motion = data.motion.get(),
          { model } = data.train.get(),
          run = data.run.value(),
          line = LINES[motion.line]
        const stop =
          run?.stop ??
          (line === undefined ? -1 : nextStop(line, motion.s, motion.facing, trainLength(model)))
        return {
          id: entity.id,
          label: TRAINS[model].label,
          line: motion.line,
          s: motion.s,
          v: motion.v,
          facing: motion.facing,
          state: run?.state,
          next: MAP.railway.stations[stop]?.name,
          driver: run === undefined ? (mine.has(entity.id) ? "player" : "none") : "ai",
          stolen: data.stolen.present,
        }
      }),
      crossings: CROSSINGS.map((box, i) => {
        const state = states[i] ?? OPEN
        return {
          x: box.x,
          y: box.y,
          road: MAP.roads[box.road]?.name ?? "",
          walk: box.walk,
          phase: state.phase,
          ...crossingAt(box, state, step),
        }
      }),
    }
  },
)
