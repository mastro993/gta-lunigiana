/**
 * What a train does to what it meets on its level (`TrainContacts`, right after `Contacts`): every car is a
 * fixed capsule that nothing shoves, so the other body takes the whole separation and, with no bounce
 * (restitution 0), the train's speed along the contact. A vehicle a train strikes faster than
 * `WRECK_SPEED`, or one it pins against a wall and drags along (sliding along the wall) faster than
 * `IMPACT_SPEED`, is wrecked (a train creeping on at a walk only shoves it along), a contact one Impact
 * as it begins; a person or an animal the train's own speed strikes faster than `KNOCK_SPEED` is
 * knocked down and thrown aside, and dies by the train's death curve (`trainDeath`), the player on
 * foot too: running into a standing train only stops the runner. The train keeps its speed: a car is
 * under a hundredth of its mass.
 *
 * @module rail/strikes
 */
import { Clock } from "@typeonce/ritmo"
import { Ops, Random, type Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius, moveCar, walkBy, wallsAlong } from "../body.ts"
import { destroyed } from "../damage.ts"
import { FAUNA } from "../fauna.ts"
import {
  Animal,
  Chassis,
  Damage,
  Dead,
  Down,
  Driving,
  Footing,
  type FootingValue,
  Game,
  Impact,
  Motion,
  Person,
  Player,
  Pose,
  PrevPose,
  Rng,
  Score,
  Time,
  Train,
  TrainMotion,
  Vehicle,
} from "../schema.ts"
import { deathChance, DOWN_TIME, halfOf } from "../systems/contacts.ts"
import { footingAt } from "../systems/footing.ts"
import { inReach, playerPose } from "../systems/reach.ts"
import { KNOCK_SPEED, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { axisNear, nearCar, onLevel, type TrainCar, trainCars } from "./bodies.ts"
import { MOVING, TRAINS } from "./models.ts"

/** A train striking a vehicle faster than this (its speed into it, m/s: 50 km/h) wrecks it, whatever the vehicle (estimate: a train's broadside crushes a car that a wall at that speed would only dent). */
export const WRECK_SPEED = 14
/**
 * The train's death curve: someone a train strikes at v m/s dies with a chance 1 / (1 + e^((TRAIN_HALF − v) / TRAIN_SPREAD)), or
 * a car's at that speed (`deathChance`) where that is higher, nobody under 5 m/s. Fitted by weighted least squares in log-odds to
 * the 2136 train–pedestrian casualties of Southwest China in 2011–2020 by train speed ("Characteristics of Train–Pedestrian
 * Collisions in Southwest China, 2011–2020", Int. J. Environ. Res. Public Health 2022, 19(10), 6104): 57.3 % died at up to
 * 50 km/h, 57.7 % at 51–60, 71.7 % at 61–70, 80.0 % at 71–80 and 89.7 % above 80 (taken at 40, 55.5, 65.5, 75.5 and 90 km/h);
 * the curve gives 52, 65, 72, 78 and 86 %, and 43 % at 30 km/h, where a tram kills almost 40 % (Gaca & Franek 2021, "Pedestrian
 * fatality risk as a function of tram impact speed", Open Engineering 11). An estimate: the data pools every age, and animals
 * take it as people do.
 */
const TRAIN_HALF = 10.5
const TRAIN_SPREAD = 8.1
/** A person or an animal a train knocks down is thrown on with this share of its velocity and this fast to the side, away from the track (m/s). */
const CARRY = 0.6
const THROW = 3
/** A vehicle touched by a train closing faster than this, m/s, is an Impact; one a wall pins, dragged faster than this, is wrecked: slower, the train only shoves it along, its tyres dragging. */
const IMPACT_SPEED = KNOCK_SPEED

/** The chance a train striking a body at `speed` (m/s) kills it, for whom `half` is the speed at which a car kills half the time. */
export const trainDeath = (speed: number, half: number): number =>
  Math.max(deathChance(speed, half), deathChance(speed, TRAIN_HALF, TRAIN_SPREAD))

/** The unit normal from `car`'s axis at (px, py) to (x, y) at distance `d`; on the axis itself, its left. */
const normalFrom = (car: TrainCar, x: number, y: number, px: number, py: number, d: number) =>
  d > 1e-9
    ? { x: (x - px) / d, y: (y - py) / d }
    : { x: -Ops.sin(car.angle), y: Ops.cos(car.angle) }

/** Away from `car`'s axis across the track along (nx, ny), the train's way taken out: the side a struck body is thrown to. */
const aside = (car: TrainCar, nx: number, ny: number): Vec2.Vec2 => {
  const fx = Ops.cos(car.angle),
    fy = Ops.sin(car.angle),
    along = nx * fx + ny * fy
  const sx = nx - along * fx,
    sy = ny - along * fy,
    l = Math.sqrt(sx * sx + sy * sy)
  return l > 1e-6 ? { x: sx / l, y: sy / l } : { x: -fy, y: fx }
}

/** The deepest overlap of a vehicle of `model` at (x, y, `angle`) with `car`: its depth, normal from the train and contact point. */
const overlap = (model: VehicleModel, x: number, y: number, angle: number, car: TrainCar) => {
  const r = carRadius(model)
  let depth = 0,
    nx = 0,
    ny = 0,
    px = 0,
    py = 0
  for (const o of carCircles(model, angle)) {
    const cx = x + o.x,
      cy = y + o.y,
      near = axisNear(car, cx, cy),
      pen = car.r + r - near.d
    if (pen <= depth) continue
    const n = normalFrom(car, cx, cy, near.x, near.y, near.d)
    ;[depth, nx, ny, px, py] = [pen, n.x, n.y, near.x + n.x * car.r, near.y + n.y * car.r]
  }
  return { depth, nx, ny, px, py }
}

/**
 * Trains strike what stands in their way on their level: vehicles (shoved clear, or dragged along when a wall holds them, and
 * wrecked so faster than IMPACT_SPEED; a `train` Impact as a contact begins, the two apart where the step began, and the blow
 * that wrecks it), people and animals (pushed aside, or knocked down, thrown and maybe killed when the train's own speed into
 * them is over KNOCK_SPEED: a `person` or `animal` Impact with the train as its `car`, and a point for the player when they
 * drive the train). A vehicle beyond the player's reach (`inReach`) stands frozen: the train passes through it.
 */
export const TrainContacts = Game.System(
  "Lunigiana/TrainContacts",
  {
    queries: {
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          prev: Game.Query.read(PrevPose),
          motion: Game.Query.write(Motion),
          vehicle: Game.Query.read(Vehicle),
          chassis: Game.Query.read(Chassis),
          damage: Game.Query.read(Damage),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          look: Game.Query.read(Person),
          down: Game.Query.optional(Down),
          footing: Game.Query.optional(Footing),
        },
        without: [Driving],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          animal: Game.Query.read(Animal),
          down: Game.Query.optional(Down),
          footing: Game.Query.optional(Footing),
        },
      }),
      driver: Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
      player: playerPose(),
    },
    resources: {
      score: Game.System.writeResource(Score),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      rng: Game.System.writeResource(Rng),
    },
    commands: Game.System.commands(Game.System.inserts(Down, Dead)),
    events: { impact: Game.System.writeEvent(Impact) },
  },
  ({ queries, resources, commands, events }) => {
    const trains = queries.trains.each().map(({ entity, data }) => ({
      id: entity.id,
      motion: data.motion.get(),
      model: data.train.get().model,
    }))
    const cars = trainCars(trains),
      { step, dt } = resources.time.get()
    if (cars.length === 0 || dt <= 0) return
    // The same cars where the step began (`prev`), found only when a contact may be a new one.
    let before: ReadonlyArray<TrainCar> | undefined
    const at = (k: number) =>
      (before ??= trainCars(
        trains.map((train) => ({ ...train, motion: { ...train.motion, s: train.motion.prev } })),
      ))[k]
    const mine = new Set<number>(
      queries.driver.each().map(({ data }) => Game.Entity.id(data.driving.get().vehicle) as number),
    )
    const player = queries.player.each()[0]?.data.pose.get()

    for (const { entity, data } of queries.vehicles.each()) {
      let pose = data.pose.get()
      if (!inReach(pose, player)) continue
      const { model } = data.vehicle.get(),
        spec = VEHICLES[model],
        ground = data.chassis.get().z - spec.cg
      let { vx, vy } = data.motion.get(),
        moved = false
      const prev = data.prev.get()
      for (const [k, car] of cars.entries()) {
        if (!nearCar(car, pose.x, pose.y, spec.length / 2 + car.r) || !onLevel(ground, car.z))
          continue
        const { depth, nx, ny, px, py } = overlap(model, pose.x, pose.y, pose.angle, car)
        if (depth <= 0) continue
        const into = car.vx * nx + car.vy * ny,
          closing = into - (vx * nx + vy * ny)
        // The whole separation, walls permitting; a wall holding it, a moving train drags it along with it.
        const want = depth + 0.01,
          delta = { x: nx * want, y: ny * want }
        const to =
          moveCar(
            model,
            pose,
            pose.angle,
            delta,
            wallsAlong("drive", pose.x, pose.y, delta.x, delta.y, spec.length / 2 + 0.5),
          )?.position ?? pose
        const got = (to.x - pose.x) * nx + (to.y - pose.y) * ny,
          dragged = want - got > 1e-3 && car.speed > MOVING
        pose = { x: to.x, y: to.y, angle: pose.angle }
        if (dragged) {
          // Carried along at the train's pace, as far as the walls let it slide along them.
          const along = { x: car.vx * dt, y: car.vy * dt },
            slid =
              moveCar(
                model,
                pose,
                pose.angle,
                along,
                wallsAlong("drive", pose.x, pose.y, along.x, along.y, spec.length / 2 + 0.5),
              )?.position ?? pose
          ;[vx, vy] = [(slid.x - pose.x) / dt, (slid.y - pose.y) / dt]
        } else if (closing > 0) [vx, vy] = [vx + closing * nx, vy + closing * ny]
        moved = true
        // Dragged against a wall at a walk (a train creeping on), it is only shoved along.
        const crushed = dragged && car.speed > IMPACT_SPEED,
          wrecks = into > WRECK_SPEED || crushed
        // One Impact a contact: as it begins (the two apart where the step began: no wall held it against the train), or the
        // blow that wrecks it.
        const begins = () => overlap(model, prev.x, prev.y, prev.angle, at(k)!).depth <= 0
        if (
          (closing > IMPACT_SPEED && begins()) ||
          (wrecks && !destroyed(data.damage.get().amount))
        )
          events.impact.emit({
            hit: "train",
            x: px,
            y: py,
            speed: Math.max(0, closing),
            mass: 1 / (1000 / spec.mass + 1000 / TRAINS[car.model].mass),
            car: entity.id,
            other: car.train,
            fatal: wrecks,
          })
      }
      if (!moved) continue
      data.pose.set(pose)
      data.motion.update((motion) => ({ ...motion, vx, vy }))
    }

    const random = Random.draw(resources.rng)
    // Knocked down, or killed: the dead lie `Down` too (the schema requires it), and `Recover` never lifts them.
    const knocked = { until: step + Clock.steps(DOWN_TIME) },
      died = [
        [Down, { until: step }],
        [Dead, { since: step }],
      ] as const
    type Struck = "person" | "animal"
    /** One person or animal standing on `footing` against every car: shoved clear, or knocked down and thrown, maybe killed. */
    const strike = (
      id: number,
      fall: (killed: boolean) => void,
      hit: Struck,
      at: { x: number; y: number },
      velocity: { vx: number; vy: number },
      r: number,
      down: boolean,
      half: number,
      footing: FootingValue | undefined,
    ) => {
      let ground: number | undefined,
        moved = false
      for (const car of cars) {
        if (!nearCar(car, at.x, at.y, r + car.r)) continue
        const near = axisNear(car, at.x, at.y),
          depth = car.r + r - near.d
        if (depth <= 0) continue
        ground ??= footingAt(footing, at.x, at.y)
        if (!onLevel(ground, car.z)) continue
        const n = normalFrom(car, at.x, at.y, near.x, near.y, near.d)
        // The train's own speed into the body decides, as a car's does: running into a standing train must not floor the runner.
        const into = car.vx * n.x + car.vy * n.y,
          closing = into - (velocity.vx * n.x + velocity.vy * n.y)
        const position = walkBy(
          at,
          { x: n.x * (depth + 0.01), y: n.y * (depth + 0.01) },
          r,
        ).position
        at.x = position.x
        at.y = position.y
        moved = true
        if (down || into <= KNOCK_SPEED) {
          if (closing > 0) {
            velocity.vx += closing * n.x
            velocity.vy += closing * n.y
          }
          continue
        }
        down = true
        const killed = random.next() < trainDeath(into, half)
        fall(killed)
        const side = aside(car, n.x, n.y)
        velocity.vx = car.vx * CARRY + side.x * THROW
        velocity.vy = car.vy * CARRY + side.y * THROW
        events.impact.emit({
          hit,
          x: at.x,
          y: at.y,
          speed: into,
          mass: TRAINS[car.model].mass / 1000,
          car: car.train,
          other: id,
          fatal: killed,
        })
        if (hit === "person" && mine.has(car.train))
          resources.score.update((score) => ({ ...score, knocked: score.knocked + 1 }))
      }
      return moved
    }

    for (const { entity, data } of queries.people.each()) {
      const pose = data.pose.get(),
        at = { x: pose.x, y: pose.y },
        velocity = { ...data.motion.get() }
      const fall = (killed: boolean) =>
        killed ? commands.insert(entity, ...died) : commands.insert(entity, [Down, knocked])
      if (
        !strike(
          entity.id,
          fall,
          "person",
          at,
          velocity,
          PERSON_RADIUS,
          data.down.present,
          halfOf(data.look.get().age),
          data.footing.value(),
        )
      )
        continue
      data.pose.set({ ...pose, ...at })
      data.motion.set(velocity)
    }
    for (const { entity, data } of queries.animals.each()) {
      const pose = data.pose.get(),
        { species, size } = data.animal.get(),
        at = { x: pose.x, y: pose.y },
        velocity = { ...data.motion.get() }
      const fauna = FAUNA[species]
      const fall = (killed: boolean) =>
        killed ? commands.insert(entity, ...died) : commands.insert(entity, [Down, knocked])
      if (
        !strike(
          entity.id,
          fall,
          "animal",
          at,
          velocity,
          fauna.radius * size,
          data.down.present,
          fauna.lethal,
          data.footing.value(),
        )
      )
        continue
      data.pose.set({ ...pose, ...at })
      data.motion.set(velocity)
    }
  },
)
