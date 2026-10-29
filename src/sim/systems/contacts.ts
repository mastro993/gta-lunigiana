import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius, moveCar, walkBy, wallsAlong } from "../body.ts"
import { FAUNA } from "../fauna.ts"
import {
  type Age,
  Animal,
  Dead,
  Down,
  Driving,
  Follows,
  Game,
  Impact,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  Rng,
  Roam,
  Route,
  Score,
  STEP,
  Time,
  Vehicle,
} from "../schema.ts"
import { KNOCK_SPEED, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { FLEE_TIME, runFrom } from "./pedestrians.ts"
import { inReach, playerPose } from "./reach.ts"

/** How long a knocked-down person or animal stays on the ground. */
export const DOWN_TIME = Clock.duration(STEP, 2.5)
/** Car-to-car (and car-to-cow) restitution. */
const RESTITUTION = 0.2
/** A knocked person slides with this share of the car's velocity, plus this push away from it (m/s). */
const CARRY = 0.6
const THROW = 3
/** A person's mass, kg, for stepping apart from animals (an adult's). */
const PERSON_MASS = 70
/** An animal this heavy (kg) or more meets a car like another vehicle would: a cow. */
const HEAVY = 200
/** An animal that gets up runs from the nearest vehicle this long. */
const BEAST_FLEE = Clock.duration(STEP, 3)

/**
 * A vehicle that knocks a pedestrian down kills them with a chance logistic in its speed v, 1 / (1 + e^((DEATH_HALF − v) /
 * DEATH_SPREAD)), fitted by least squares in log-odds to Tefft 2011 (AAA Foundation for Traffic Safety, "Impact speed and a
 * pedestrian's risk of severe injury or death"): 10 % at 23 mph (10.3 m/s), 25 % at 32 (14.3), 50 % at 42 (18.8), 75 % at 50
 * (22.4), 90 % at 58 (25.9); these constants give 9.7, 24.7, 53.3, 75.6 and 89.3 %. Children take the adult curve (an estimate).
 */
const DEATH_HALF = 18.3
const DEATH_SPREAD = 3.59
/**
 * An elder's death curve sits this much lower, m/s: an estimate after Tefft's age comparison, in which a 70-year-old struck at
 * 25 mph runs a risk of severe injury or death similar to a 30-year-old's at 35 mph (10 mph, 4.5 m/s), carried over to death alone.
 */
const ELDER_FRAILTY = 4.5
/** Under this impact speed (m/s) nobody dies: a knockdown is all. */
const NO_DEATH = 5

/** The chance that a vehicle hitting someone at `speed` (m/s) kills them, for whom `half` is the speed that kills half the time, the curve rising over `spread` m/s (a car's, unless given). */
export const deathChance = (speed: number, half: number, spread = DEATH_SPREAD): number =>
  speed < NO_DEATH ? 0 : 1 / (1 + Ops.exp((half - speed) / spread))
/** The speed (m/s) that kills a person of `age` half the time (an animal's is its species' `lethal`). */
export const halfOf = (age: Age): number => DEATH_HALF - (age === "elder" ? ELDER_FRAILTY : 0)

/** The deepest overlap between two circle sets: penetration, unit normal from `b` to `a`, and the contact point (px, py) on `b`'s surface. */
const deepest = (
  as: ReadonlyArray<Vec2.Vec2>,
  ra: number,
  bs: ReadonlyArray<Vec2.Vec2>,
  rb: number,
) => {
  let depth = 0,
    nx = 0,
    ny = 0,
    px = 0,
    py = 0
  for (const a of as)
    for (const b of bs) {
      const dx = a.x - b.x,
        dy = a.y - b.y
      const d = Math.sqrt(dx * dx + dy * dy)
      const pen = ra + rb - d
      if (pen <= depth) continue
      depth = pen
      nx = d > 1e-9 ? dx / d : 1
      ny = d > 1e-9 ? dy / d : 0
      px = b.x + nx * rb
      py = b.y + ny * rb
    }
  return { depth, nx, ny, px, py }
}

/** A body's working copy for this step (written back once, if `moved`). */
interface Mover {
  x: number
  y: number
  vx: number
  vy: number
  moved: boolean
}
interface Car extends Mover {
  readonly model: VehicleModel
  /** Tonnes, as Impact carries it. */
  readonly mass: number
  readonly r: number
  readonly reach: number
  readonly angle: number
}
/** A person or an animal: one circle. */
interface Body extends Mover {
  /** On the ground: knocked down or dead. */
  down: boolean
  readonly hit: "person" | "animal"
  readonly r: number
  /** Tonnes. */
  readonly mass: number
  /** The impact speed (m/s) that kills it half the time; undefined: no vehicle kills it (the player). */
  readonly half: number | undefined
  /** Meets a car like another vehicle (a cow): shoved by mass share, knocked down only by a hit twice KNOCK_SPEED. */
  readonly heavy: boolean
  /** Its party (the leader's entity id, or its own): a parent and child, or a dog on its lead, walk touching. */
  readonly party: number
}

/** Moves `body` `by` metres along (nx, ny), as far as `move` lets it go; returns how far it got. */
const shove = (
  body: Mover,
  nx: number,
  ny: number,
  by: number,
  move: (delta: Vec2.Vec2) => Vec2.Vec2,
): number => {
  const position = move({ x: nx * by, y: ny * by })
  const got = (position.x - body.x) * nx + (position.y - body.y) * ny
  body.x = position.x
  body.y = position.y
  body.moved = true
  return got
}
/** Shoves a car without passing through (or deeper into) drive walls. */
const shoveCar = (car: Car, nx: number, ny: number, by: number): number =>
  shove(
    car,
    nx,
    ny,
    by,
    (delta) =>
      moveCar(
        car.model,
        car,
        car.angle,
        delta,
        wallsAlong("drive", car.x, car.y, delta.x, delta.y, car.reach + 0.5),
      )?.position ?? car,
  )
/** Shoves a person or an animal without passing through walk walls. */
const shoveBody = (body: Body, nx: number, ny: number, by: number): number =>
  shove(body, nx, ny, by, (delta) => walkBy(body, delta, body.r).position)
/** A standing body stops walking into what pushed it along (nx, ny), so a walker can tell it is blocked. */
const stopInto = (body: Body, nx: number, ny: number) => {
  const into = body.vx * nx + body.vy * ny
  if (body.down || into >= 0) return
  body.vx -= into * nx
  body.vy -= into * ny
}

/**
 * Bodies touching after physics, never shoved through walls: vehicles shove each other (mass-weighted separation and an
 * impulse); a vehicle hitting a standing person or a light animal faster than KNOCK_SPEED knocks them down and throws them, and
 * may kill them (`deathChance`: a point for the player when it was their car and a person), slower it pushes them aside, and one
 * pinned against a wall stops the vehicle instead; a cow meets a vehicle like another vehicle, falling only to a hit twice
 * KNOCK_SPEED; people and animals step apart. Vehicles closing on each other, hits on people and animals, and a vehicle stopped
 * against a wall through one pinned (faster than KNOCK_SPEED) are Impact events. A vehicle beyond the player's reach (`inReach`)
 * touches nothing, frozen.
 */
export const Contacts = Game.System(
  "Lunigiana/Contacts",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          vehicle: Game.Query.read(Vehicle),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          look: Game.Query.read(Person),
          down: Game.Query.optional(Down),
          player: Game.Query.optional(Player),
          follows: Game.Query.optional(Follows),
        },
        without: [Driving],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          animal: Game.Query.read(Animal),
          down: Game.Query.optional(Down),
          follows: Game.Query.optional(Follows),
        },
      }),
      driver: Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
      player: playerPose(),
    },
    resources: {
      score: Game.System.writeResource(Score),
      time: Game.System.readResource(Time),
      rng: Game.System.writeResource(Rng),
    },
    commands: Game.System.commands(Game.System.inserts(Down, Dead)),
    events: { impact: Game.System.writeEvent(Impact) },
  },
  ({ queries, resources, commands, events }) => {
    const mine = new Set(
      queries.driver.each().map(({ data }) => Game.Entity.id(data.driving.get().vehicle)),
    )
    const random = Random.draw(resources.rng),
      player = queries.player.each()[0]?.data.pose.get()
    const cars = queries.vehicles.each().flatMap((match) => {
      const pose = match.data.pose.get(),
        motion = match.data.motion.get()
      if (!inReach(pose, player)) return []
      const { model } = match.data.vehicle.get()
      const car: Car = {
        model,
        mass: VEHICLES[model].mass / 1000,
        r: carRadius(model),
        reach: VEHICLES[model].length / 2,
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        vx: motion.vx,
        vy: motion.vy,
        moved: false,
      }
      return [{ match, car }]
    })
    const circlesOf = (car: Car) =>
      carCircles(car.model, car.angle).map((o) => ({ x: car.x + o.x, y: car.y + o.y }))

    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i]!.car,
          b = cars[j]!.car
        if (Vec2.distanceSquared(a, b) > (a.reach + b.reach) ** 2) continue
        const { depth, nx, ny, px, py } = deepest(circlesOf(a), a.r, circlesOf(b), b.r)
        if (depth <= 0) continue
        // a takes its mass share of the separation; b the rest, including what a's walls refused.
        const share = depth * (b.mass / (a.mass + b.mass))
        const rest = depth - shoveCar(a, nx, ny, share)
        shoveCar(b, -nx, -ny, rest)
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        if (closing < 0) {
          const impulse = (-(1 + RESTITUTION) * closing) / (1 / a.mass + 1 / b.mass)
          a.vx += (nx * impulse) / a.mass
          a.vy += (ny * impulse) / a.mass
          b.vx -= (nx * impulse) / b.mass
          b.vy -= (ny * impulse) / b.mass
          const mass = 1 / (1 / a.mass + 1 / b.mass)
          events.impact.emit({
            hit: "car",
            x: px,
            y: py,
            speed: -closing,
            mass,
            car: cars[i]!.match.entity.id,
            other: cars[j]!.match.entity.id,
          })
        }
      }

    const { step } = resources.time.get()
    const people = queries.people.each().map((match) => {
      const { data } = match
      const pose = data.pose.get(),
        motion = data.motion.get(),
        follows = data.follows.value()
      const half = data.player.present ? undefined : halfOf(data.look.get().age)
      const body: Body = {
        x: pose.x,
        y: pose.y,
        vx: motion.vx,
        vy: motion.vy,
        moved: false,
        down: data.down.present,
        hit: "person",
        r: PERSON_RADIUS,
        mass: PERSON_MASS / 1000,
        half,
        heavy: false,
        party: follows === undefined ? match.entity.id : Game.Entity.id(follows.leader),
      }
      return { match, body }
    })
    const animals = queries.animals.each().map((match) => {
      const { data } = match
      const pose = data.pose.get(),
        motion = data.motion.get(),
        follows = data.follows.value(),
        { species, size } = data.animal.get()
      const fauna = FAUNA[species]
      const body: Body = {
        x: pose.x,
        y: pose.y,
        vx: motion.vx,
        vy: motion.vy,
        moved: false,
        down: data.down.present,
        hit: "animal",
        r: fauna.radius * size,
        mass: (fauna.mass * size * size * size) / 1000,
        half: fauna.lethal,
        heavy: fauna.mass >= HEAVY,
        party: follows === undefined ? match.entity.id : Game.Entity.id(follows.leader),
      }
      return { match, body }
    })
    const bodies = [...people, ...animals]

    /** Knocks `body` down, or kills it, as a hit at `speed` decides; returns whether it died. */
    const fell = (match: (typeof bodies)[number]["match"], body: Body, speed: number): boolean => {
      body.down = true
      const killed =
        body.half !== undefined &&
        speed >= NO_DEATH &&
        random.next() < deathChance(speed, body.half)
      // The dead lie `Down` too (the schema requires it), and `Recover` never lifts them.
      if (killed) commands.insert(match.entity, [Down, { until: step }], [Dead, { since: step }])
      else commands.insert(match.entity, [Down, { until: step + Clock.steps(DOWN_TIME) }])
      return killed
    }

    for (const { match, body } of bodies)
      for (const { match: owner, car } of cars) {
        if (Vec2.distanceSquared(body, car) > (car.reach + body.r) ** 2) continue
        const { depth, nx, ny } = deepest([body], body.r, circlesOf(car), car.r)
        if (depth <= 0) continue
        if (body.heavy) {
          // Like two vehicles: the cow takes its mass share of the separation (walls permitting), the car the rest, and an impulse.
          const rest = depth - shoveBody(body, nx, ny, depth * (car.mass / (body.mass + car.mass)))
          shoveCar(car, -nx, -ny, rest)
          const closing = (car.vx - body.vx) * nx + (car.vy - body.vy) * ny
          if (closing <= 0) continue
          const impulse = ((1 + RESTITUTION) * closing) / (1 / body.mass + 1 / car.mass)
          body.vx += (nx * impulse) / body.mass
          body.vy += (ny * impulse) / body.mass
          car.vx -= (nx * impulse) / car.mass
          car.vy -= (ny * impulse) / car.mass
          if (closing <= KNOCK_SPEED) continue
          const killed = !body.down && closing > 2 * KNOCK_SPEED && fell(match, body, closing)
          events.impact.emit({
            hit: "animal",
            x: body.x,
            y: body.y,
            speed: closing,
            mass: car.mass,
            car: owner.entity.id,
            other: match.entity.id,
            fatal: killed,
          })
          continue
        }
        // The car's own speed decides: running into a parked car must not floor the runner. Taken before a pin stops the car.
        const speed2 = car.vx * car.vx + car.vy * car.vy
        const knocked = !body.down && car.vx * nx + car.vy * ny > 0 && speed2 > KNOCK_SPEED ** 2
        // Out of the car's way; whatever a wall behind them refuses, the car gives back.
        const want = depth + 0.01
        const short = want - shoveBody(body, nx, ny, want)
        if (short > 1e-3) {
          shoveCar(car, -nx, -ny, short)
          const into = car.vx * nx + car.vy * ny
          if (into > 0) {
            car.vx -= into * nx
            car.vy -= into * ny
          }
          // Pinned, the body stops the car against the wall behind it: a wall hit as hard as it was going into it.
          if (into > KNOCK_SPEED) {
            events.impact.emit({
              hit: "wall",
              x: body.x + nx * body.r,
              y: body.y + ny * body.r,
              speed: into,
              mass: car.mass,
              car: owner.entity.id,
            })
          }
        }
        if (!knocked) {
          stopInto(body, nx, ny)
          continue
        }
        const speed = Math.sqrt(speed2)
        const killed = fell(match, body, speed)
        body.vx = car.vx * CARRY + nx * THROW
        body.vy = car.vy * CARRY + ny * THROW
        events.impact.emit({
          hit: body.hit,
          x: body.x,
          y: body.y,
          speed,
          mass: car.mass,
          car: owner.entity.id,
          other: match.entity.id,
          fatal: killed,
        })
        if (body.hit === "person" && mine.has(owner.entity.id))
          resources.score.update((score) => ({ ...score, knocked: score.knocked + 1 }))
      }

    // People and animals step apart, each moving by the other's share of the mass; a party walks touching.
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!.body,
          b = bodies[j]!.body
        if (a.party === b.party) continue
        const dx = a.x - b.x,
          dy = a.y - b.y
        const d2 = dx * dx + dy * dy,
          reach = a.r + b.r
        if (d2 >= reach * reach) continue
        const d = Math.sqrt(d2)
        const push = (reach - d) * 0.5
        const nx = d > 1e-9 ? dx / d : 1,
          ny = d > 1e-9 ? dy / d : 0
        shoveBody(a, nx, ny, (push * b.mass) / (a.mass + b.mass))
        shoveBody(b, -nx, -ny, (push * a.mass) / (a.mass + b.mass))
        stopInto(a, nx, ny)
        stopInto(b, -nx, -ny)
      }

    for (const { match, car } of cars) {
      if (
        !car.moved &&
        car.vx === match.data.motion.get().vx &&
        car.vy === match.data.motion.get().vy
      )
        continue
      match.data.pose.set({ x: car.x, y: car.y, angle: car.angle })
      match.data.motion.update((motion) => ({ ...motion, vx: car.vx, vy: car.vy }))
    }
    for (const { match, body } of bodies) {
      if (
        !body.moved &&
        body.vx === match.data.motion.get().vx &&
        body.vy === match.data.motion.get().vy
      )
        continue
      match.data.pose.update((pose) => ({ ...pose, x: body.x, y: body.y }))
      match.data.motion.update((motion) => ({ ...motion, vx: body.vx, vy: body.vy }))
    }
  },
)

/** The pose of the vehicle nearest `at`, if any. */
const nearestOf = (at: Vec2.Vec2, poses: ReadonlyArray<Vec2.Vec2>): Vec2.Vec2 | undefined => {
  let found: Vec2.Vec2 | undefined,
    best = Number.MAX_VALUE
  for (const p of poses) {
    const d = Vec2.distanceSquared(p, at)
    if (d < best) [found, best] = [p, d]
  }
  return found
}

/**
 * Knocked-down people and animals get up when their time is over (the dead never do): a pedestrian then runs off along its
 * route, and an animal bolts, away from the nearest vehicle.
 */
export const Recover = Game.System(
  "Lunigiana/Recover",
  {
    queries: {
      peds: Game.Query({
        selection: {
          down: Game.Query.read(Down),
          pose: Game.Query.read(Pose),
          ped: Game.Query.write(Pedestrian),
          route: Game.Query.write(Route),
        },
        without: [Dead],
      }),
      beasts: Game.Query({
        selection: {
          down: Game.Query.read(Down),
          pose: Game.Query.read(Pose),
          roam: Game.Query.write(Roam),
        },
        with: [Animal],
        without: [Dead],
      }),
      others: Game.Query({
        selection: { down: Game.Query.read(Down) },
        without: [Pedestrian, Animal, Dead],
      }),
      vehicles: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Vehicle] }),
    },
    resources: { time: Game.System.thisTick(Game.System.readResource(Time)) },
    commands: Game.System.commands(Game.System.removes(Down)),
  },
  ({ queries, resources, commands }) => {
    const { step } = resources.time.get()
    const vehicles = queries.vehicles.each().map(({ data }) => data.pose.get())
    for (const { entity, data } of queries.peds.each()) {
      if (step < data.down.get().until) continue
      commands.remove(entity, Down)
      const at = data.pose.get()
      const threat = nearestOf(at, vehicles)
      if (threat !== undefined) data.route.set(runFrom(data.route.get(), at, threat))
      data.ped.set({
        mood: "flee",
        until: step + Clock.steps(FLEE_TIME),
        blocked: 0,
        fx: threat?.x ?? at.x,
        fy: threat?.y ?? at.y,
      })
    }
    for (const { entity, data } of queries.beasts.each()) {
      if (step < data.down.get().until) continue
      commands.remove(entity, Down)
      const at = data.pose.get(),
        threat = nearestOf(at, vehicles) ?? at
      data.roam.update((roam) => ({
        ...roam,
        mood: "flee",
        until: step + Clock.steps(BEAST_FLEE),
        tx: threat.x,
        ty: threat.y,
      }))
    }
    for (const { entity, data } of queries.others.each())
      if (step >= data.down.get().until) commands.remove(entity, Down)
  },
)
