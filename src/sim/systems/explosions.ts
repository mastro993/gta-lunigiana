import { Clock } from "@typeonce/ritmo"
import { Random, Vec2 } from "@typeonce/ritmo-math"

import { offBody } from "../body.ts"
import { afterHit, destroyed } from "../damage.ts"
import { atGrade, footZ } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import {
  CarInput,
  Chassis,
  Damage,
  Dead,
  Down,
  Driving,
  Explosion,
  Footing,
  Game,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rng,
  Route,
  STEP,
  Time,
  Vehicle,
} from "../schema.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { DOWN_TIME } from "./contacts.ts"
import { freeDoor } from "./enter-exit.ts"
import { FLEE_TIME, runFrom } from "./pedestrians.ts"

/** A wreck burns 5–10 s before it blows up: drawn from the world's Rng when it catches fire. */
const FUSE = [Clock.duration(STEP, 5), Clock.duration(STEP, 10)] as const
/**
 * The blast: people on foot within `kill` m of the wreck's body die (beside a truck's tail as beside a Panda's), within `knock` m
 * are knocked down, and both are thrown away from its centre, up to `throw` m/s right by it and less with distance; walkers
 * within `scare` m of its centre flee. A vehicle whose body is within `reach` m of the wreck's (their lengths' halves apart) takes
 * a hit as hard as a crash at up to `speed` m/s (barrier-equivalent) and a shove of up to `impulse` N·s away from it and a third
 * as much again upward; the wreck itself leaps `leap` m/s and tumbles at up to `tumble` rad/s.
 */
const BLAST = {
  kill: 5,
  knock: 12,
  scare: 30,
  throw: 9,
  reach: 10,
  speed: 45,
  impulse: 12000,
  leap: 4,
  tumble: 1.5,
} as const
/** How long the dead player lies before coming back at the start. */
export const WASTED = Clock.duration(STEP, 4)

/**
 * Burning wrecks blow up. A destroyed vehicle's fuse is lit the step after it catches fire, 5–10 s long; when it burns down the
 * wreck explodes (an Explosion event) and is left a charred shell, leaping up and tumbling. The blast hits every other vehicle
 * whose body is within reach, harder the nearer (one destroyed by it catches fire in turn), and shoves it away; it kills the people
 * on foot nearby and the player sitting in the wreck, knocks down and throws those a little farther, and sends the walkers
 * around running. People inside other vehicles are shielded by them. It runs after getting in and out are applied and before
 * anything moves, so it knows who sits in which vehicle, and the dead are down (a killed player out of the wreck, which is left
 * on its handbrake) by the time the step's movement reads them.
 */
export const Explode = Game.System(
  "Lunigiana/Explode",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          vehicle: Game.Query.read(Vehicle),
          pose: Game.Query.read(Pose),
          motion: Game.Query.write(Motion),
          chassis: Game.Query.write(Chassis),
          damage: Game.Query.write(Damage),
          input: Game.Query.write(CarInput),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.write(Motion),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
        with: [Person],
        without: [Driving],
      }),
      walkers: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          ped: Game.Query.write(Pedestrian),
          route: Game.Query.write(Route),
        },
        without: [Down],
      }),
      seated: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          driving: Game.Query.read(Driving),
        },
        with: [Player],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    events: { explosion: Game.System.writeEvent(Explosion) },
    commands: Game.System.commands(
      Game.System.inserts(Down, Dead, Footing),
      Game.System.removes(Driving),
    ),
  },
  ({ queries, resources, events, commands }) => {
    const { step } = resources.time.get()
    const vehicles = queries.vehicles.each()
    const blasts: Array<{
      readonly id: number
      readonly at: PoseValue
      readonly model: VehicleModel
    }> = []
    for (const { entity, data } of vehicles) {
      const damage = data.damage.get()
      if (!destroyed(damage.amount) || damage.exploded) continue
      if (damage.fuse === 0) {
        data.damage.set({
          ...damage,
          fuse:
            step +
            Random.draw(resources.rng).integer(Clock.steps(FUSE[0]), Clock.steps(FUSE[1]) + 1),
        })
        continue
      }
      if (step < damage.fuse) continue
      // It blows: a charred shell leaps and tumbles.
      const pose = data.pose.get(),
        chassis = data.chassis.get(),
        { model } = data.vehicle.get(),
        random = Random.draw(resources.rng)
      data.damage.set({ ...damage, exploded: true })
      data.chassis.set({
        ...chassis,
        vz: chassis.vz + BLAST.leap,
        pitchRate: chassis.pitchRate + random.range(-1, 1) * BLAST.tumble,
        rollRate: chassis.rollRate + random.range(-1, 1) * BLAST.tumble,
      })
      events.explosion.emit({ car: entity.id, model, x: pose.x, y: pose.y, z: chassis.z })
      blasts.push({ id: entity.id, at: pose, model })
    }
    if (blasts.length === 0) return

    // Who a blast killed or knocked down this step: their Down lands only after it, so the walkers query still matches them.
    const hit = new Set<number>()
    for (const blast of blasts) {
      // Every other vehicle near enough: a hit and a shove, by how near its body is.
      for (const { entity, data } of vehicles) {
        if (entity.id === blast.id) continue
        const pose = data.pose.get(),
          { model } = data.vehicle.get(),
          spec = VEHICLES[model]
        const away = Vec2.subtract(pose, blast.at),
          centre = Vec2.length(away),
          gap = Math.max(0, centre - spec.length / 2 - VEHICLES[blast.model].length / 2)
        if (gap >= BLAST.reach) continue
        const near = 1 - gap / BLAST.reach,
          dir = centre > 1e-6 ? Vec2.scale(away, 1 / centre) : { x: 1, y: 0 }
        data.damage.set(afterHit(model, data.damage.get(), BLAST.speed * near, step, blast.id))
        const kick = (BLAST.impulse * near) / spec.mass,
          motion = data.motion.get()
        data.motion.set({ ...motion, vx: motion.vx + dir.x * kick, vy: motion.vy + dir.y * kick })
        data.chassis.update((chassis) => ({ ...chassis, vz: chassis.vz + kick / 3 }))
      }
      // People on foot: killed, knocked down, thrown away from its centre, by how near the wreck's body they stand.
      for (const { entity, data } of queries.people.each()) {
        const at = data.pose.get(),
          gap = offBody(blast.model, blast.at, at.x, at.y)
        if (gap >= BLAST.knock) continue
        hit.add(entity.id)
        const away = Vec2.subtract(at, blast.at),
          dist = Vec2.length(away),
          dir = dist > 1e-6 ? Vec2.scale(away, 1 / dist) : { x: 1, y: 0 },
          fling = BLAST.throw * (1 - gap / BLAST.knock),
          motion = data.motion.get()
        data.motion.set({ ...motion, vx: motion.vx + dir.x * fling, vy: motion.vy + dir.y * fling })
        if (gap < BLAST.kill && !data.dead.present)
          commands.insert(entity, [Down, { until: step }], [Dead, { since: step }])
        else if (!data.down.present)
          commands.insert(entity, [Down, { until: step + Clock.steps(DOWN_TIME) }])
      }
      // The player sitting in the wreck dies with it, thrown out of a door.
      for (const { entity, data } of queries.seated.each()) {
        if (Game.Entity.id(data.driving.get().vehicle) !== blast.id) continue
        const car = vehicles.find((v) => v.entity.id === blast.id)!,
          pose = car.data.pose.get(),
          model = car.data.vehicle.get().model
        const out = freeDoor(pose, model) ?? pose,
          away = Vec2.normalizeOr(Vec2.subtract(out, pose), { x: 1, y: 0 })
        data.pose.set({ x: out.x, y: out.y, angle: pose.angle })
        data.motion.set({ vx: away.x * BLAST.throw, vy: away.y * BLAST.throw, spin: 0 })
        // Nobody's foot on the pedals any more: the shell is left on its handbrake, as when the player gets out.
        car.data.input.set({ throttle: 0, steer: 0, handbrake: true })
        commands.remove(entity, Driving)
        // On the ground beside the wreck, on the level its wheels stood on.
        const wheels = car.data.chassis.get().z - VEHICLES[model].cg
        commands.insert(
          entity,
          [Down, { until: step }],
          [Dead, { since: step }],
          [Footing, { z: footZ(out.x, out.y, wheels) }],
        )
      }
      // Walkers who heard it run.
      for (const { entity, data } of queries.walkers.each()) {
        const at = data.pose.get()
        if (hit.has(entity.id) || Vec2.distanceSquared(at, blast.at) >= BLAST.scare ** 2) continue
        data.ped.set({
          mood: "flee",
          until: step + Clock.steps(FLEE_TIME),
          blocked: 0,
          fx: blast.at.x,
          fy: blast.at.y,
        })
        data.route.set(runFrom(data.route.get(), at, blast.at))
      }
    }
  },
)

/** The dead player comes back on foot at the start (where a new game begins), on the ground there, once `WASTED` has passed. */
export const Respawn = Game.System(
  "Lunigiana/Respawn",
  {
    queries: {
      player: Game.Query({
        selection: {
          dead: Game.Query.read(Dead),
          pose: Game.Query.write(Pose),
          prev: Game.Query.write(PrevPose),
          motion: Game.Query.write(Motion),
        },
        with: [Player],
      }),
    },
    resources: { time: Game.System.thisTick(Game.System.readResource(Time)) },
    commands: Game.System.commands(Game.System.removes(Dead, Down), Game.System.inserts(Footing)),
  },
  ({ queries, resources, commands }) => {
    const { step } = resources.time.get()
    for (const { entity, data } of queries.player.each()) {
      if (step < data.dead.get().since + Clock.steps(WASTED)) continue
      const start = MAP.spawns.player
      data.pose.set(start)
      data.prev.set(start)
      data.motion.set({ vx: 0, vy: 0, spin: 0 })
      commands.remove(entity, Dead, Down)
      commands.insert(entity, [Footing, { z: atGrade(start.x, start.y) }])
    }
  },
)
