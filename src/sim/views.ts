import type { Vec2 } from "@typeonce/ritmo-math"

import { forwardSpeed } from "./body.ts"
import { boardingAt, cabOf } from "./rail/boarding.ts"
import { LINES } from "./rail/lines.ts"
import { TRAINS } from "./rail/models.ts"
import {
  CarInput,
  Chassis,
  Damage,
  Dead,
  Down,
  Driving,
  Footing,
  Game,
  GameClock,
  Handling,
  Motion,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rivers,
  Stolen,
  Traffic,
  Train,
  TrainMotion,
  TrainRun,
  Vehicle,
  View,
  Weather,
  type WeatherValue,
} from "./schema.ts"
import { type RomeTime, romeTime } from "./sky/calendar.ts"
import { footingAt } from "./systems/footing.ts"
import { VEHICLES } from "./vehicles.ts"
import { FLOW, specificDischarge } from "./water/flow.ts"

/** Plain view data for the camera and HUD. */
export interface PlayerViewModel {
  /** Player pose at the start and end of the last step (lerp with the frame alpha). */
  readonly prev: PoseValue
  readonly pose: PoseValue
  /** Player velocity, m/s (the vehicle's while driving; zero on the step they get in or out). */
  readonly velocity: Vec2.Vec2
  readonly mode: "foot" | "driving" | "down" | "dead"
  /** The vehicle being driven: label, forward speed in m/s (negative when reversing), and `kind` "train" for a train. */
  readonly vehicle:
    | { readonly label: string; readonly speed: number; readonly kind?: "train" }
    | undefined
  /** Driving a train, the ground under its active cab: the rail head there, m a.s.l. (on a rail bridge too, which the map's ground has not). */
  readonly z?: number
  /** The vehicle or train the action key would enter right now, when on foot (not knocked down). */
  readonly nearby:
    | { readonly label: string; readonly occupied: boolean; readonly stolen: boolean }
    | undefined
  /** Net quarter turns of the view to the left of its home seat (the `View` resource). */
  readonly turns: number
}

/** The one projection the host reads for the camera and HUD. */
export const PlayerView = Game.Inspector(
  "Lunigiana/PlayerView",
  {
    queries: {
      player: Game.Query({
        selection: {
          prev: Game.Query.read(PrevPose),
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          driving: Game.Query.optional(Driving),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          footing: Game.Query.optional(Footing),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          vehicle: Game.Query.read(Vehicle),
          pose: Game.Query.read(Pose),
          chassis: Game.Query.read(Chassis),
          damage: Game.Query.read(Damage),
          motion: Game.Query.read(Motion),
          traffic: Game.Query.optional(Traffic),
          stolen: Game.Query.optional(Stolen),
        },
        with: [CarInput],
      }),
      trains: Game.Query({
        selection: {
          train: Game.Query.read(Train),
          motion: Game.Query.read(TrainMotion),
          run: Game.Query.optional(TrainRun),
          stolen: Game.Query.optional(Stolen),
        },
        with: [CarInput],
      }),
    },
    resources: { view: Game.System.readResource(View) },
  },
  ({ queries, resources }): PlayerViewModel | undefined => {
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return undefined
    const { data } = found.value
    const pose = data.pose.get()
    const motion = data.motion.get()
    const driving = data.driving.value()
    const car = driving === undefined ? undefined : queries.vehicles.getHandle(driving.vehicle)
    const train =
      driving === undefined || car?.ok === true
        ? undefined
        : queries.trains.getHandle(driving.vehicle)
    const driven =
      train?.ok === true
        ? { motion: train.value.data.motion.get(), model: train.value.data.train.get().model }
        : undefined
    const line = driven === undefined ? undefined : LINES[driven.motion.line]
    const vehicle =
      car?.ok === true
        ? {
            label: VEHICLES[car.value.data.vehicle.get().model].label,
            speed: forwardSpeed(car.value.data.motion.get(), car.value.data.pose.get().angle),
          }
        : driven === undefined
          ? undefined
          : {
              label: TRAINS[driven.model].label,
              // 0 − v, not −v: a standing train reads 0, not −0.
              speed: driven.motion.facing > 0 ? driven.motion.v : 0 - driven.motion.v,
              kind: "train" as const,
            }
    const near =
      driving !== undefined || data.down.present
        ? undefined
        : boardingAt(
            pose,
            footingAt(data.footing.value(), pose.x, pose.y),
            queries.vehicles.each(),
            ({ data: v }) => ({
              model: v.vehicle.get().model,
              pose: v.pose.get(),
              chassis: v.chassis.get(),
              damage: v.damage.get().amount,
            }),
            queries.trains.each(),
            ({ data: t }) => ({ motion: t.motion.get(), model: t.train.get().model }),
          )
    return {
      prev: data.prev.get(),
      pose,
      velocity: { x: motion.vx, y: motion.vy },
      mode:
        driving === undefined
          ? data.dead.present
            ? "dead"
            : data.down.present
              ? "down"
              : "foot"
          : "driving",
      vehicle,
      ...(driven === undefined || line === undefined
        ? {}
        : { z: cabOf(line, driven.motion, driven.model).z }),
      nearby:
        near === undefined
          ? undefined
          : near.kind === "vehicle"
            ? {
                label: VEHICLES[near.vehicle.data.vehicle.get().model].label,
                occupied: near.vehicle.data.traffic.present,
                stolen: near.vehicle.data.stolen.present,
              }
            : {
                label: TRAINS[near.train.data.train.get().model].label,
                occupied: near.train.data.run.present,
                stolen: near.train.data.stolen.present,
              },
      turns: resources.view.get().turns,
    }
  },
)

/** The handling knobs' current values, for the host's handling store (the settings and the dev debug menu). */
export const HandlingView = Game.Inspector(
  "Lunigiana/HandlingView",
  {
    resources: { handling: Game.System.readResource(Handling) },
  },
  ({ resources }) => resources.handling.get(),
)

/** The game clock, the weather and the rivers, as plain data for the render's sky, the audio, the HUD clock and the dev debug menu. */
export interface SkyViewModel {
  /** Game time (Unix UTC seconds) and game seconds per step: the sky moves smoothly drawn at `seconds + alpha · rate`. */
  readonly seconds: number
  readonly rate: number
  /** The Europe/Rome wall clock at `seconds`. */
  readonly local: RomeTime
  /** The `Weather` resource: the sky module's pure functions (`conditionsAt`, `fogLayers`, `windAt`, `sunAt`…) take it. */
  readonly weather: WeatherValue
  /** What the rivers carry, m³/s per km² of catchment: `waterAt` and `channelOf` turn it into the water's depth and current. */
  readonly flow: number
}

/** The sky the host draws, plays and shows: the clock, Rome's wall clock, the weather and what the rivers carry. */
export const SkyView = Game.Inspector(
  "Lunigiana/SkyView",
  {
    resources: {
      clock: Game.System.readResource(GameClock),
      weather: Game.System.readResource(Weather),
      rivers: Game.System.readResource(Rivers),
    },
  },
  ({ resources }): SkyViewModel => {
    const { seconds, rate } = resources.clock.get()
    return {
      seconds,
      rate,
      local: romeTime(seconds),
      weather: resources.weather.get(),
      flow: specificDischarge(resources.rivers.get(), FLOW),
    }
  },
)
