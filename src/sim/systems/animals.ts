import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { FAUNA } from "../fauna.ts"
import { grazing, indoors, openGround } from "../population/farms.ts"
import { ownSide, trainCars } from "../rail/bodies.ts"
import {
  Animal,
  Cry,
  Dead,
  Down,
  Driving,
  type Feeling,
  Follows,
  Footing,
  Game,
  Honk,
  InWater,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rivers,
  Rng,
  Roam,
  type RoamValue,
  Route,
  type Species,
  STEP,
  Time,
  Train,
  TrainMotion,
  Vehicle,
  Whistle,
} from "../schema.ts"
import { FLOW, specificDischarge } from "../water/flow.ts"
import { waterUnder, walkDry } from "../water/rivers.ts"
import { outOfDepth, waterVelocity } from "../water/swim.ts"
import { slide } from "./foot.ts"
import { type Car, type Folk, fright, MOVING, scare } from "./fright.ts"
import { followVelocity, placeBeside } from "./pedestrians.ts"
import { animalBuild } from "./water.ts"

/** How fast an animal wading changes its velocity, m/s² (its legs on the bed: as quick as on land). */
const WADE_ACCEL = 30

/** How long each species stands between walks, s (TUNED): a cat sits, a dog sniffs about, a cow grazes, a pig roots. */
const IDLE = { cat: [4, 20], dog: [3, 12], cow: [8, 40], pig: [4, 15] } as const satisfies Record<
  Species,
  readonly [number, number]
>
/**
 * A free dog barks (TUNED): at the player on foot within `player` m (`rate` times a second on average), at a pedestrian
 * coming within `person` m (`personChance` of them) or a vehicle faster than `vehicleSpeed` m/s coming within `vehicle` m
 * (`vehicleChance`); then it stands facing them for `hold` s, so it barks at most every `hold` s. A dog lying about
 * (idle) does not bother.
 */
const BARK = {
  player: 12,
  rate: 1,
  person: 6,
  personChance: 0.3,
  vehicle: 10,
  vehicleSpeed: 2,
  vehicleChance: 0.4,
  hold: 8,
} as const
/** A walking animal this close to its target has arrived, m. */
const ARRIVED = 0.3
/** Making less than this share of its walking speed counts as blocked; blocked this long, it picks another point. */
const PROGRESS = 0.5
const BLOCKED = Clock.duration(STEP, 1)
/** Points tried for each walk before standing a while longer. */
const TRIES = 4
/** A dog on a lead within this distance of its place by a standing walker stands too, m. */
const NEAR = 0.15
/** A dog whose owner was killed lies by the body this long before it wanders, s (TUNED). */
const MOURN = 60

/** `seconds` as whole steps. */
const stepsOf = (seconds: number): number => Math.round(seconds * STEP.hz)
/** The step a rest begun at `step` ends at: a random length in the species' `IDLE` range. */
const restUntil = (species: Species, step: number, random: Random.Random): number =>
  step + stepsOf(random.range(IDLE[species][0], IDLE[species][1]))

/** Where a species may walk to: herds keep to the grass, pigs to open ground, cats and dogs anywhere outdoors. */
const walkable = (species: Species, x: number, y: number): boolean =>
  species === "cow" ? grazing(x, y) : species === "pig" ? openGround(x, y) : !indoors(x, y)

/**
 * Animals: each species idles, then walks to a random point near its home (never onto or over the railway's track at grade),
 * and runs from what scares it (crying out now and then), a train on its level and a train's whistle too; free dogs bark at
 * strangers. A dog on a lead keeps its place by its walker and goes free (staying put) when the walker is gone, down or dead.
 * Down and dead animals slide to a stop.
 */
export const Animals = Game.System(
  "Lunigiana/Animals",
  {
    queries: {
      animals: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          roam: Game.Query.write(Roam),
          animal: Game.Query.read(Animal),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          wet: Game.Query.optional(InWater),
          footing: Game.Query.optional(Footing),
        },
      }),
      leaders: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          ped: Game.Query.read(Pedestrian),
          route: Game.Query.read(Route),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          prev: Game.Query.read(PrevPose),
          motion: Game.Query.read(Motion),
          player: Game.Query.optional(Player),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
        with: [Person],
        without: [Driving],
      }),
      vehicles: Game.Query({
        selection: { pose: Game.Query.read(Pose), motion: Game.Query.read(Motion) },
        with: [Vehicle],
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      rivers: Game.System.readResource(Rivers),
    },
    events: {
      honks: Game.System.readEvent(Honk),
      whistles: Game.System.thisTick(Game.System.readEvent(Whistle)),
      cries: Game.System.writeEvent(Cry),
    },
    commands: Game.System.commands(Game.System.removes(Follows)),
  },
  ({ queries, resources, events, commands }) => {
    const { step, dt } = resources.time.get()
    if (dt <= 0) return
    const random = Random.draw(resources.rng),
      q = specificDischarge(resources.rivers.get(), FLOW)
    // Vehicles are where last step's physics left them; parked ones scare nobody.
    const cars: ReadonlyArray<Car> = queries.vehicles.each().flatMap(({ data }) => {
      const { x, y } = data.pose.get(),
        { vx, vy } = data.motion.get(),
        speed = Math.sqrt(vx * vx + vy * vy)
      return speed > 1 ? [{ x, y, vx, vy, speed }] : []
    })
    const folks: ReadonlyArray<Folk> = queries.people.each().flatMap(({ data }) => {
      if (data.down.present || data.dead.present) return []
      const { x, y } = data.pose.get(),
        prev = data.prev.get(),
        { vx, vy } = data.motion.get()
      return [
        {
          x,
          y,
          px: prev.x,
          py: prev.y,
          speed: Math.sqrt(vx * vx + vy * vy),
          player: data.player.present,
        },
      ]
    })
    const honks = events.honks.all(),
      whistles = events.whistles.all()
    // The trains' moving cars, each feared by how near its body passes, on the animal's level.
    const trains = trainCars(
      queries.trains.each().map(({ entity, data }) => ({
        id: entity.id,
        motion: data.motion.get(),
        model: data.train.get().model,
      })),
    ).filter((car) => car.speed > 1)
    const within = (p: Vec2.Vec2, q: Vec2.Vec2, r: number) => Vec2.distanceSquared(p, q) <= r * r

    for (const { entity, data } of queries.animals.each()) {
      const pose = data.pose.get(),
        motion = data.motion.get(),
        { species, size } = data.animal.get(),
        fauna = FAUNA[species],
        r = fauna.radius * size
      const careful = data.roam.get().mood !== "flee"
      const wet = data.wet.value(),
        water = wet === undefined ? undefined : waterUnder(pose.x, pose.y, true, q),
        build = animalBuild(data.animal.get())
      const place = (wanted: Vec2.Vec2, facing?: Vec2.Vec2) => {
        // Wading, it keeps to what it was doing, slower and pushed by the current.
        const velocity =
          water === undefined
            ? wanted
            : waterVelocity(
                { x: motion.vx, y: motion.vy },
                wanted,
                water,
                build,
                false,
                0,
                WADE_ACCEL,
                dt,
              )
        const moved = walkDry(pose, Vec2.scale(velocity, dt), r, careful, wet !== undefined, q)
        const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
        const look = facing ?? (Vec2.lengthSquared(real) > 0.01 ? real : undefined)
        data.pose.set({
          x: moved.position.x,
          y: moved.position.y,
          angle: look === undefined ? pose.angle : Ops.atan2(look.y, look.x),
        })
        data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
        return real
      }
      const lying = data.down.present || data.dead.present
      if (
        wet !== undefined &&
        water !== undefined &&
        (wet.swimming || lying || outOfDepth(water, build))
      ) {
        // Out of its depth: wading or paddling for the nearer bank; the down and the dead go where the current takes them.
        const bank = { x: water.bankX, y: water.bankY }
        const velocity = waterVelocity(
          { x: motion.vx, y: motion.vy },
          lying ? Vec2.zero : Vec2.scale(bank, fauna.walk),
          water,
          build,
          wet.swimming || lying,
          lying ? 0 : fauna.swim,
          WADE_ACCEL,
          dt,
        )
        const moved = walkBy(pose, Vec2.scale(velocity, dt), r)
        const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
        data.pose.set({
          x: moved.position.x,
          y: moved.position.y,
          angle: lying || Vec2.lengthSquared(real) <= 0.01 ? pose.angle : Ops.atan2(real.y, real.x),
        })
        data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
        continue
      }
      if (data.down.present || data.dead.present) {
        const velocity = slide({ x: motion.vx, y: motion.vy }, dt)
        const moved = walkBy(pose, Vec2.scale(velocity, dt), r)
        data.pose.set({ x: moved.position.x, y: moved.position.y, angle: pose.angle })
        data.motion.set({ vx: velocity.x, vy: velocity.y, spin: 0 })
        continue
      }

      const follows = data.follows.value()
      if (follows !== undefined) {
        const found = queries.leaders.getHandle(follows.leader)
        const leader = found.ok ? found.value.data : undefined
        // A leader on the ground, knocked down or dead (the dead are down too), lets go of the lead.
        if (leader === undefined || leader.down.present) {
          // Let go: it stays where it is, or lies by its owner's body for a while.
          commands.remove(entity, Follows)
          const body = leader?.dead.present === true ? leader.pose.get() : undefined
          const home = body ?? pose
          data.roam.set({
            mood: "idle",
            until: body === undefined ? restUntil(species, step, random) : step + stepsOf(MOURN),
            hx: home.x,
            hy: home.y,
            tx: home.x,
            ty: home.y,
          })
          place(Vec2.zero)
          continue
        }
        const at = leader.pose.get(),
          { vx, vy } = leader.motion.get(),
          spot = placeBeside(at, follows.side, follows.back)
        const still = vx * vx + vy * vy < 0.01 && Vec2.distanceSquared(spot, pose) < NEAR * NEAR
        const velocity = still
          ? Vec2.zero
          : followVelocity(pose, spot, at, { x: vx, y: vy }, fauna.run, leader.route.get())
        const real = place(
          velocity,
          still ? { x: Ops.cos(at.angle), y: Ops.sin(at.angle) } : undefined,
        )
        const mood =
          leader.ped.get().mood === "flee"
            ? "flee"
            : Vec2.lengthSquared(real) > 0.01
              ? "walk"
              : "idle"
        data.roam.set({ mood, until: step, hx: pose.x, hy: pose.y, tx: spot.x, ty: spot.y })
        continue
      }

      let roam: RoamValue = data.roam.get()
      let facing: Vec2.Vec2 | undefined
      const cry = (feeling: Feeling) =>
        events.cries.emit({ who: entity.id, x: pose.x, y: pose.y, feeling })
      const threat = scare(
        species,
        pose,
        data.footing.value(),
        cars,
        folks,
        honks,
        random,
        trains,
        whistles,
      )
      if (threat !== undefined) roam = fright(roam, species, threat, step, random, cry)
      else if (species === "dog" && (roam.mood === "walk" || step >= roam.until)) {
        const coming = (f: Folk, r: number) =>
          within(f, pose, r) && !within({ x: f.px, y: f.py }, pose, r)
        const stranger =
          folks.find(
            (f) => f.player && within(f, pose, BARK.player) && random.next() < BARK.rate * dt,
          ) ??
          folks.find(
            (f) =>
              !f.player &&
              f.speed > MOVING &&
              coming(f, BARK.person) &&
              random.next() < BARK.personChance,
          ) ??
          cars.find(
            (car) =>
              car.speed > BARK.vehicleSpeed &&
              within(car, pose, BARK.vehicle) &&
              !within({ x: car.x - car.vx * dt, y: car.y - car.vy * dt }, pose, BARK.vehicle) &&
              random.next() < BARK.vehicleChance,
          )
        if (stranger !== undefined) {
          cry("anger")
          roam = {
            ...roam,
            mood: "idle",
            until: step + stepsOf(BARK.hold),
            tx: stranger.x,
            ty: stranger.y,
          }
          facing = Vec2.subtract(stranger, pose)
        }
      }

      if (roam.mood === "flee" && step >= roam.until)
        roam = { ...roam, mood: "idle", until: restUntil(species, step, random) }
      const arrived = roam.mood === "walk" && within({ x: roam.tx, y: roam.ty }, pose, ARRIVED)
      if (arrived) roam = { ...roam, mood: "idle", until: restUntil(species, step, random) }
      else if (roam.mood !== "flee" && step >= roam.until)
        roam = wander(roam, species, pose, step, random)

      const speed = roam.mood === "flee" ? fauna.run : roam.mood === "walk" ? fauna.walk : 0
      const away =
        roam.mood === "flee"
          ? Vec2.subtract(pose, { x: roam.tx, y: roam.ty })
          : Vec2.subtract({ x: roam.tx, y: roam.ty }, pose)
      const heading = Vec2.normalizeOr(away, { x: Ops.cos(pose.angle), y: Ops.sin(pose.angle) })
      const real = place(Vec2.scale(heading, speed), facing)
      // Blocked on a walk: give it a second, then pick another point.
      if (roam.mood === "walk" && real.x * heading.x + real.y * heading.y < PROGRESS * speed)
        roam = { ...roam, until: Math.min(roam.until, step + Clock.steps(BLOCKED)) }
      data.roam.set(roam)
    }
  },
)

/** The walk after a rest: to a point within its home range it may stand on, or another rest when none is found. */
const wander = (
  roam: RoamValue,
  species: Species,
  at: PoseValue,
  step: number,
  random: Random.Random,
): RoamValue => {
  const { home, walk } = FAUNA[species]
  for (let k = 0; k < TRIES; k++) {
    const r = home * Math.sqrt(random.next()),
      a = random.range(0, 2 * Math.PI)
    const drawn = { x: roam.hx + r * Ops.cos(a), y: roam.hy + r * Ops.sin(a) }
    if (!walkable(species, drawn.x, drawn.y)) continue
    // Never onto the track or over it: as near as its own side allows.
    const { x, y } = ownSide(at, drawn)
    // As long as the walk should take, and a little more: it gives up on a point it cannot reach.
    return {
      ...roam,
      mood: "walk",
      until: step + stepsOf(Vec2.distance(at, { x, y }) / walk + 2),
      tx: x,
      ty: y,
    }
  }
  return { ...roam, mood: "idle", until: restUntil(species, step, random) }
}
