import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { standClear, walkBy } from "../body.ts"
import { footZ } from "../map/ground.ts"
import { boardable, boarded, boardingAt, cabOf, cabSides, exitSpot } from "../rail/boarding.ts"
import { LINES } from "../rail/lines.ts"
import { facesForward, laneOf, roadOf, walkIndex, walkSide } from "../route.ts"
import {
  Autopilot,
  CarInput,
  Chassis,
  Damage,
  Down,
  Driving,
  Footing,
  Game,
  Input,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rng,
  Route,
  Score,
  Stolen,
  Time,
  Traffic,
  Train,
  TrainMotion,
  TrainRun,
  Vehicle,
} from "../schema.ts"
import { pedestrian, randomLook } from "../spawning.ts"
import { DOOR_GAP } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { footingAt } from "./footing.ts"
import { FLEE_TIME } from "./pedestrians.ts"

/** Where a person stands to get out of a vehicle: left door (the driver's, in Italy), right door, front, back. */
const doors = (pose: PoseValue, model: VehicleModel) => {
  const { length, width } = VEHICLES[model]
  const fx = Ops.cos(pose.angle),
    fy = Ops.sin(pose.angle)
  const side = width / 2 + DOOR_GAP,
    end = length / 2 + DOOR_GAP
  return [
    { x: pose.x - fy * side, y: pose.y + fx * side },
    { x: pose.x + fy * side, y: pose.y - fx * side },
    { x: pose.x + fx * end, y: pose.y + fy * end },
    { x: pose.x - fx * end, y: pose.y - fy * end },
  ]
}

/** The first door someone can get out at: clear of walk walls, with no wall between it and the vehicle's centre. */
export const freeDoor = (pose: PoseValue, model: VehicleModel) =>
  doors(pose, model).find(
    (door) => standClear(door) && !walkBy(pose, Vec2.subtract(door, pose)).blocked,
  )

/**
 * A driver who got out at `door` of a vehicle (or a train's cab) at `pose` standing on `level` (m a.s.l.), as a pedestrian with a
 * look drawn from `random` who flees from it along the verge on that side (so they do not run back through it) until step `until`,
 * on the ground there on that level.
 */
const fleeingFrom = (
  door: Vec2.Vec2,
  pose: PoseValue,
  level: number,
  random: Random.Random,
  until: number,
) => {
  const edge = walkIndex.nearest(door.x, door.y)
  const forward = facesForward(edge, pose.angle)
  const lane = laneOf(edge, forward)
  const right = (door.x - pose.x) * lane.rx + (door.y - pose.y) * lane.ry > 0
  return Game.Command.extend(
    pedestrian(
      randomLook(random),
      { x: door.x, y: door.y, angle: Ops.atan2(door.y - pose.y, door.x - pose.x) },
      { edge, forward, side: (right ? 1 : -1) * walkSide(roadOf(edge)) },
      { mood: "flee", until, fx: pose.x, fy: pose.y },
    ),
    [Footing, { z: footZ(door.x, door.y, level) }],
  )
}

/**
 * The driver of a vehicle of `model` at `pose` whose wheels stand on `level` (m a.s.l.) getting out at its first free door and
 * fleeing from it (`fleeingFrom`) until step `until`; none when no door is free.
 */
export const fleeingDriver = (
  pose: PoseValue,
  model: VehicleModel,
  level: number,
  random: Random.Random,
  until: number,
) => {
  const door = freeDoor(pose, model)
  return door === undefined ? undefined : fleeingFrom(door, pose, level, random, until)
}

/**
 * The action key (once per press): on foot, get into what is in reach (`boardingAt`): a vehicle within ENTER_GAP of its body (no
 * wall in between, not overturned or destroyed), carjacking a traffic driver, who flees out of the first free door; or a train
 * slower than BOARD_SPEED (`boardable`) at one of its crew doors, its AI driver fleeing out of the active cab (or the far one,
 * where the active one has no door to step down from), the cab boarded at becoming the active one. The first entry of a vehicle
 * or a train scores a theft. Driving, get out at the first free door (none: stay in) and leave it on its handbrake: a train's
 * emergency brake, and only while `boardable`, at a door of the active cab at grade inside the map (`exitSpot`), onto the
 * platform where there is one; where there is none, walk through to the far cab, which becomes the active one.
 */
export const EnterExit = Game.System(
  "Lunigiana/EnterExit",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          driving: Game.Query.optional(Driving),
          down: Game.Query.optional(Down),
          footing: Game.Query.optional(Footing),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          chassis: Game.Query.read(Chassis),
          damage: Game.Query.read(Damage),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.write(CarInput),
          traffic: Game.Query.optional(Traffic),
          stolen: Game.Query.optional(Stolen),
        },
        without: [Pedestrian],
      }),
      trains: Game.Query({
        selection: {
          motion: Game.Query.write(TrainMotion),
          train: Game.Query.read(Train),
          input: Game.Query.write(CarInput),
          run: Game.Query.optional(TrainRun),
          stolen: Game.Query.optional(Stolen),
        },
      }),
    },
    resources: {
      input: Game.System.readResource(Input),
      score: Game.System.writeResource(Score),
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.inserts(Driving, Stolen, Footing),
      Game.System.removes(Driving, Traffic, Route, Autopilot, TrainRun),
      Game.System.spawns(Pedestrian, Person, Pose, PrevPose, Motion, Route, Footing),
    ),
  },
  ({ queries, resources, commands }) => {
    if (!resources.input.get().actions.action.pressed) return
    const until = () => resources.time.get().step + Clock.steps(FLEE_TIME)
    for (const { entity, data } of queries.player.each()) {
      if (data.down.present) continue
      const driving = data.driving.value()
      if (driving !== undefined) {
        const car = queries.vehicles.getHandle(driving.vehicle)
        if (car.ok) {
          const pose = car.value.data.pose.get(),
            { model } = car.value.data.vehicle.get()
          const door = freeDoor(pose, model)
          if (door === undefined) continue
          data.pose.set({ x: door.x, y: door.y, angle: pose.angle })
          // On the ground beside it, on the level its wheels stand on.
          const wheels = car.value.data.chassis.get().z - VEHICLES[model].cg
          commands.insert(entity, [Footing, { z: footZ(door.x, door.y, wheels) }])
          car.value.data.input.set({ throttle: 0, steer: 0, handbrake: true })
        } else {
          const train = queries.trains.getHandle(driving.vehicle)
          if (!train.ok) continue
          const motion = train.value.data.motion.get(),
            line = LINES[motion.line]
          if (line === undefined || !boardable(motion.v)) continue
          const model = train.value.data.train.get().model,
            spot = exitSpot(line, motion, model, 0, cabSides(motion.facing), true)
          // Nowhere to step down: through the train to its far cab, which becomes the active one.
          if (spot === undefined) {
            train.value.data.motion.set(boarded(motion, model, 1))
            continue
          }
          data.pose.set(spot)
          // On the ground beside the cab, on the rail's level.
          const { z } = cabOf(line, motion, model)
          commands.insert(entity, [Footing, { z: footZ(spot.x, spot.y, z) }])
          train.value.data.input.set({ throttle: 0, steer: 0, handbrake: true })
        }
        data.motion.set({ vx: 0, vy: 0, spin: 0 })
        commands.remove(entity, Driving)
        continue
      }
      const pose = data.pose.get()
      const near = boardingAt(
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
      if (near === undefined) continue
      const { entity: target, data: got } = near.kind === "vehicle" ? near.vehicle : near.train
      commands.insert(entity, [Driving, { vehicle: Game.Entity.handle(target, CarInput) }])
      data.motion.set({ vx: 0, vy: 0, spin: 0 })
      if (!got.stolen.present) {
        commands.insert(target, [Stolen, {}])
        resources.score.update((score) => ({ ...score, stolen: score.stolen + 1 }))
      }
      if (near.kind === "vehicle") {
        const { entity: vehicle, data: car } = near.vehicle
        if (!car.traffic.present) continue
        commands.remove(vehicle, Traffic, Route, Autopilot)
        const { model } = car.vehicle.get()
        const driver = fleeingDriver(
          car.pose.get(),
          model,
          car.chassis.get().z - VEHICLES[model].cg,
          Random.draw(resources.rng),
          until(),
        )
        if (driver !== undefined) commands.spawn(driver)
        continue
      }
      const { data: train } = near.train,
        motion = train.motion.get(),
        { model } = train.train.get(),
        line = LINES[motion.line]!
      const aboard = boarded(motion, model, near.door.end)
      if (aboard !== motion) train.motion.set(aboard)
      if (!train.run.present) continue
      // The AI driver gets out of the active cab (on the side away from the player when they board there), or, with no door to
      // step down from there, the far one, and runs.
      commands.remove(target, TrainRun)
      const [left, right] = cabSides(motion.facing),
        away = near.door.end === 0 && near.door.side === left,
        sides = away ? [right, left] : [left, right]
      const out = exitSpot(line, motion, model, 0, sides) ?? exitSpot(line, motion, model, 1, sides)
      if (out === undefined) continue
      const cab = cabOf(line, motion, model)
      commands.spawn(
        fleeingFrom(
          out,
          { x: cab.x, y: cab.y, angle: cab.angle },
          cab.z,
          Random.draw(resources.rng),
          until(),
        ),
      )
    }
  },
)
