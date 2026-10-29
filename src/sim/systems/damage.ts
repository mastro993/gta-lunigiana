import { Clock } from "@typeonce/ritmo"
import { Random } from "@typeonce/ritmo-math"

import { afterHit, barrierSpeeds, destroyed, DURABILITY, groundHit } from "../damage.ts"
import { FAUNA } from "../fauna.ts"
import {
  Animal,
  Autopilot,
  CarInput,
  Chassis,
  Damage,
  Footing,
  Game,
  Impact,
  Motion,
  Pedestrian,
  Person,
  Pose,
  PrevPose,
  Rng,
  Route,
  Time,
  Traffic,
  Vehicle,
} from "../schema.ts"
import { VEHICLES } from "../vehicles.ts"
import { fleeingDriver } from "./enter-exit.ts"
import { FLEE_TIME } from "./pedestrians.ts"

/**
 * Crashes wear vehicles out: this step's Impacts add to every vehicle they struck the share of its
 * durability the crash used up (`afterHit`), at the vehicle's barrier-equivalent speed: a wall hit
 * at the impact's speed, the ground as `groundHit` takes it (a landing on the wheels less the bump
 * stops, a roll by the body's speed too), two vehicles each by the other's share of their masses, a
 * train as a wall at the closing speed (a train that wrecks a vehicle, `fatal`, destroys it outright). A
 * crash's further contacts with the same thing cost only what a harder one adds. Knocking a person
 * down costs nothing; an animal struck costs its share of the two masses, as a vehicle would (a cow
 * dents the car, a cat does not). A traffic car destroyed, by a crash or by a blast (`Explode`), is abandoned:
 * its driver gets out at the first free door and flees, and it stays where it stops, its handbrake
 * on.
 */
export const CrashDamage = Game.System(
  "Lunigiana/CrashDamage",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          vehicle: Game.Query.read(Vehicle),
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          damage: Game.Query.write(Damage),
          input: Game.Query.write(CarInput),
          traffic: Game.Query.optional(Traffic),
          chassis: Game.Query.read(Chassis),
        },
        without: [Pedestrian],
      }),
      animals: Game.Query({ selection: { animal: Game.Query.read(Animal) } }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    events: { impacts: Game.System.thisTick(Game.System.readEvent(Impact)) },
    commands: Game.System.commands(
      Game.System.removes(Traffic, Route, Autopilot),
      Game.System.spawns(Pedestrian, Person, Pose, PrevPose, Motion, Route, Footing),
    ),
  },
  ({ queries, resources, events, commands }) => {
    const matches = queries.vehicles.each(),
      { step } = resources.time.get()
    const impacts = events.impacts.all()
    if (impacts.length > 0) {
      const vehicles = new Map<number, (typeof matches)[number]>(
        matches.map((match) => [match.entity.id, match]),
      )
      const massOf = (id: number) => {
        const found = vehicles.get(id)
        return found === undefined ? undefined : VEHICLES[found.data.vehicle.get().model].mass
      }
      const animals = new Map<number, number>(
        queries.animals.each().map(({ entity, data }) => {
          const { species, size } = data.animal.get()
          return [entity.id, FAUNA[species].mass * size * size * size]
        }),
      )
      // Each vehicle's hardest hit this step on each thing it struck (another vehicle's id, −1 a wall or the ground).
      const hardest = new Map<number, Map<number, number>>()
      const hit = (id: number, speed: number, struck: number) => {
        if (!vehicles.has(id)) return
        const hits = hardest.get(id) ?? new Map<number, number>()
        hits.set(struck, Math.max(speed, hits.get(struck) ?? 0))
        hardest.set(id, hits)
      }
      for (const impact of impacts) {
        if (impact.hit === "person") continue
        if (impact.hit === "ground") {
          const motion = vehicles.get(impact.car)?.data.motion.get()
          if (motion !== undefined)
            hit(
              impact.car,
              groundHit(
                impact.face ?? "under",
                impact.speed,
                Math.sqrt(motion.vx * motion.vx + motion.vy * motion.vy),
              ),
              -1,
            )
          continue
        }
        if (impact.hit === "animal") {
          const a = massOf(impact.car),
            b = impact.other === undefined ? undefined : animals.get(impact.other)
          if (a !== undefined && b !== undefined && impact.other !== undefined)
            hit(impact.car, barrierSpeeds(impact.speed, a, b)[0], impact.other)
          continue
        }
        if (impact.hit === "train") {
          // As a wall (the train is about 100 times a Panda), at the full closing speed; a wreck at once when the train wrecked it.
          const model = vehicles.get(impact.car)?.data.vehicle.get().model
          if (model !== undefined)
            hit(
              impact.car,
              impact.fatal === true ? Math.max(impact.speed, DURABILITY[model]) : impact.speed,
              impact.other ?? -1,
            )
          continue
        }
        if (impact.hit !== "car" || impact.other === undefined) {
          hit(impact.car, impact.speed, -1)
          continue
        }
        const a = massOf(impact.car),
          b = massOf(impact.other)
        if (a === undefined || b === undefined) continue
        const [onA, onB] = barrierSpeeds(impact.speed, a, b)
        hit(impact.car, onA, impact.other)
        hit(impact.other, onB, impact.car)
      }
      for (const [id, hits] of hardest) {
        const { data } = vehicles.get(id)!
        const model = data.vehicle.get().model,
          was = data.damage.get()
        let now = was
        for (const [struck, speed] of hits) now = afterHit(model, now, speed, step, struck)
        if (now !== was) data.damage.set(now)
      }
    }
    // A traffic car destroyed, by a crash or by a blast (`Explode`), is abandoned.
    for (const { entity, data } of matches) {
      if (!data.traffic.present || !destroyed(data.damage.get().amount)) continue
      data.input.set({ throttle: 0, steer: 0, handbrake: true })
      commands.remove(entity, Traffic, Route, Autopilot)
      const { model } = data.vehicle.get()
      const driver = fleeingDriver(
        data.pose.get(),
        model,
        data.chassis.get().z - VEHICLES[model].cg,
        Random.draw(resources.rng),
        step + Clock.steps(FLEE_TIME),
      )
      if (driver !== undefined) commands.spawn(driver)
    }
  },
)
