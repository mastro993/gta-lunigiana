/**
 * What scares the animals and how they run from it: each species' fears (a vehicle or a train's car going by near, a person,
 * a horn, a train's whistle, a crash), the point it runs from, and the fright itself (a run of a few seconds, a cry now and
 * then). `Animals` asks `scare` each step; `Startle` sends cats and pigs running from a crash in the step it happens.
 *
 * @module systems/fright
 */
import { Random, Vec2 } from "@typeonce/ritmo-math"

import { nearCar, offCar, onLevel, type TrainCar } from "../rail/bodies.ts"
import {
  Animal,
  Cry,
  Dead,
  Down,
  type Feeling,
  Follows,
  type FootingValue,
  Game,
  Impact,
  Pose,
  Rng,
  Roam,
  type RoamValue,
  type Species,
  STEP,
  Time,
} from "../schema.ts"
import { footingAt } from "./footing.ts"

/** `seconds` as whole steps. */
const stepsOf = (seconds: number): number => Math.round(seconds * STEP.hz)

/** How long a scared animal runs, s; scared again while running, it runs at least `FLEE[0]` s more. */
const FLEE = [2, 5] as const
/**
 * What scares each species into running (TUNED; 0 is never): a vehicle faster than `speed` m/s within `car` m (of a train's car,
 * of its body), a person within `person` m (only one on the move for a cat), a horn within `horn` m, a train's whistle within
 * `whistle` m (it is some 20 dB over a car's horn), a crash or a struck body within `crash` m (`Startle`).
 */
const FEARS = {
  cat: { speed: 3, car: 8, person: 2.5, horn: 0, whistle: 30, crash: 20 },
  dog: { speed: 8, car: 6, person: 0, horn: 0, whistle: 20, crash: 0 },
  cow: { speed: 8, car: 10, person: 0, horn: 15, whistle: 40, crash: 0 },
  pig: { speed: 5, car: 8, person: 3, horn: 0, whistle: 30, crash: 20 },
} as const satisfies Record<
  Species,
  {
    readonly speed: number
    readonly car: number
    readonly person: number
    readonly horn: number
    readonly whistle: number
    readonly crash: number
  }
>
/** A scared animal cries out (the audio voices it) this often: a cat's hiss, a dog's yelp, a cow's moo, a pig's squeal (TUNED). */
const CRIES = {
  cat: { feeling: "fright", chance: 0.5 },
  dog: { feeling: "fright", chance: 0.3 },
  cow: { feeling: "surprise", chance: 0.5 },
  pig: { feeling: "fright", chance: 0.8 },
} as const satisfies Record<Species, { readonly feeling: Feeling; readonly chance: number }>
/** A person faster than this is on the move, m/s. */
export const MOVING = 0.3
/** A vehicle hitting a wall, a car or the ground at this closing speed or more is a crash, m/s (TUNED). */
const CRASH_SPEED = 4
/** A moving vehicle: where it is and its velocity. */
export interface Car {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
}
/** A person on their feet: where they are, where they were at the start of the step, and their speed. */
export interface Folk {
  readonly x: number
  readonly y: number
  readonly px: number
  readonly py: number
  readonly speed: number
  readonly player: boolean
}

/**
 * The point to run from to get out of `car`'s way: beside the animal on the car's path ahead (running from it is running
 * off the path), or the car itself once it has passed; a side picked at random when the animal stands right on the path.
 */
const pathPoint = (car: Car, at: Vec2.Vec2, random: Random.Random): Vec2.Vec2 => {
  const ux = car.vx / car.speed,
    uy = car.vy / car.speed
  const along = (at.x - car.x) * ux + (at.y - car.y) * uy
  if (along <= 0) return car
  const off = (at.x - car.x) * -uy + (at.y - car.y) * ux
  const nudge = Math.abs(off) < 0.2 ? (random.next() < 0.5 ? -0.5 : 0.5) : 0
  return { x: car.x + ux * along + uy * nudge, y: car.y + uy * along - ux * nudge }
}

/** Whether `p` is within `r` m of `at`; never when `r` is 0 (the species does not fear it). */
const near = (p: Vec2.Vec2, at: Vec2.Vec2, r: number) =>
  r > 0 && Vec2.distanceSquared(p, at) <= r * r

/** What `species` at `at`, standing on `footing`, runs from this step, if anything: the point to run away from. */
export const scare = (
  species: Species,
  at: Vec2.Vec2,
  footing: FootingValue | undefined,
  cars: ReadonlyArray<Car>,
  folks: ReadonlyArray<Folk>,
  honks: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  random: Random.Random,
  trains: ReadonlyArray<TrainCar>,
  whistles: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): Vec2.Vec2 | undefined => {
  const fear = FEARS[species]
  const car = cars.find((c) => c.speed > fear.speed && near(c, at, fear.car))
  if (car !== undefined) return pathPoint(car, at, random)
  let ground: number | undefined
  const train = trains.find(
    (c) =>
      c.speed > fear.speed &&
      nearCar(c, at.x, at.y, fear.car + c.r) &&
      offCar(c, at.x, at.y) <= fear.car &&
      onLevel((ground ??= footingAt(footing, at.x, at.y)), c.z),
  )
  if (train !== undefined) return pathPoint(train, at, random)
  return (
    folks.find((f) => near(f, at, fear.person) && (species !== "cat" || f.speed > MOVING)) ??
    honks.find((h) => near(h, at, fear.horn)) ??
    whistles.find((h) => near(h, at, fear.whistle))
  )
}

/**
 * `roam` running from `threat`: a fresh fright (crying out now and then) runs FLEE s, one already running runs at least
 * `FLEE[0]` s more.
 */
export const fright = (
  roam: RoamValue,
  species: Species,
  threat: Vec2.Vec2,
  step: number,
  random: Random.Random,
  cry: (feeling: Feeling) => void,
): RoamValue => {
  if (roam.mood === "flee")
    return {
      ...roam,
      until: Math.max(roam.until, step + stepsOf(FLEE[0])),
      tx: threat.x,
      ty: threat.y,
    }
  if (random.next() < CRIES[species].chance) cry(CRIES[species].feeling)
  return {
    ...roam,
    mood: "flee",
    until: step + stepsOf(random.range(FLEE[0], FLEE[1])),
    tx: threat.x,
    ty: threat.y,
  }
}

/**
 * Cats and pigs run from a crash or a body struck within `FEARS[species].crash` m, in the step it happens: scheduled after
 * Contacts, it reads this step's Impact events, which a save does not keep (read a step later, a restored game would miss them).
 */
export const Startle = Game.System(
  "Lunigiana/Startle",
  {
    queries: {
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          roam: Game.Query.write(Roam),
          animal: Game.Query.read(Animal),
        },
        without: [Follows, Down, Dead],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    events: {
      impacts: Game.System.thisTick(Game.System.readEvent(Impact)),
      cries: Game.System.writeEvent(Cry),
    },
  },
  ({ queries, resources, events }) => {
    const crashes = events.impacts
      .all()
      .filter((i) => i.hit === "person" || i.hit === "animal" || i.speed >= CRASH_SPEED)
    if (crashes.length === 0) return
    const { step } = resources.time.get()
    const random = Random.draw(resources.rng)
    // The struck animals themselves are down (their Down lands at the end of the step): Recover sends them running when they get up.
    const struck = new Set(crashes.map((i) => i.other))
    for (const { entity, data } of queries.animals.each()) {
      const at = data.pose.get(),
        { species } = data.animal.get()
      const crash = struck.has(entity.id)
        ? undefined
        : crashes.find((c) => near(c, at, FEARS[species].crash))
      if (crash === undefined) continue
      data.roam.set(
        fright(data.roam.get(), species, crash, step, random, (feeling) =>
          events.cries.emit({ who: entity.id, x: at.x, y: at.y, feeling }),
        ),
      )
    }
  },
)
