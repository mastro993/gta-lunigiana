import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { carClear, clearOf, wallsAlong } from "../body.ts"
import { destroyed } from "../damage.ts"
import { FAUNA } from "../fauna.ts"
import { peopledIndex, residentsAlong, residentsNear } from "../population/density.ts"
import { indoors } from "../population/farms.ts"
import { type Follower, randomParty } from "../population/parties.ts"
import { nearCrossing } from "../rail/roads.ts"
import {
  allowsModel,
  cruiseSpeed,
  distanceToEdge,
  endNode,
  laneOf,
  lanePoint,
  laneSide,
  leadsToDeadEnd,
  nextTrafficEdge,
  roadOf,
  trafficIndex,
  walkSide,
} from "../route.ts"
import {
  Animal,
  type AnimalValue,
  Autopilot,
  CarInput,
  Damage,
  Dead,
  Driving,
  Follows,
  Game,
  type Look,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rng,
  Roam,
  Route,
  type RouteValue,
  STEP,
  Time,
  Traffic,
  Vehicle,
} from "../schema.ts"
import { animal, pedestrian, randomColor, trafficCar } from "../spawning.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import type { VehicleModel } from "../vehicles.ts"
import { VIEW_REACH } from "../view.ts"
import { GIVE_UP_STEPS } from "./pedestrians.ts"
import { GIVE_UP_TRIES, LOST } from "./traffic.ts"

const PERIOD = Clock.duration(STEP, 0.5)
/**
 * Traffic: at most this many alive (all within `despawn` m of the player), spawned `spawn` m away, `spacing` m apart and never
 * within `SPAWN_CLEAR` m of a level crossing (rail/roads.ts), despawned beyond `despawn` m (or beyond `unseen` m, out of view,
 * when lost off the road or given up unsticking).
 */
export const TRAFFIC = {
  max: 10,
  spawn: [110, 220],
  spacing: 15,
  despawn: 320,
  unseen: VIEW_REACH,
  perTick: 2,
} as const
/**
 * Pedestrians, in parties: at most `max` living people, spawned out of view (`spawn` m away) on the streets people live on, despawned
 * beyond `despawn` m (the dead too), or beyond `unseen` m (out of view) when blocked for good; a party's followers out of view go
 * with their leader. The most crowded spot on the map, in Gragnola's centre at (−1700, 3367), calls for 19 (`peopleOut`), so `max` leaves
 * room for a party's followers and never binds in practice.
 */
export const PEDESTRIANS = {
  max: 22,
  spawn: [VIEW_REACH, 120],
  despawn: 140,
  unseen: VIEW_REACH,
  perTick: 3,
} as const
/**
 * Share of the residents around the player who are out on the street: an estimate for a village by day. With the residents within
 * `PEDESTRIANS.despawn` m (`residentsNear`) it gives 18 people out in Gragnola's centre, 15 in Vinca, 10 in Monzone Alto, 9 at
 * Monzone's start and in Equi Terme, and nobody on a country road or by a lone house or two.
 */
const OUT_SHARE = 0.09
/** How many people are out around (x, y): `OUT_SHARE` of the residents within `PEDESTRIANS.despawn` m, at most `PEDESTRIANS.max`. */
export const peopleOut = (x: number, y: number): number =>
  Math.min(PEDESTRIANS.max, Math.round(residentsNear(x, y, PEDESTRIANS.despawn) * OUT_SHARE))
/** Spots tried for a party before giving up on its slot (until the next period, or in the first fill, for good). */
const TRIES = 4
/** Everyone spawns calm: walking, or talking with the neighbour at `other.pose` for `other.seconds` from step `step`. */
const talking = (
  other: { readonly pose: Vec2.Vec2; readonly seconds: number } | undefined,
  step: number,
) =>
  other === undefined
    ? ({ mood: "walk", until: 0, fx: 0, fy: 0 } as const)
    : ({
        mood: "chat",
        until: step + Math.round(other.seconds * STEP.hz),
        fx: other.pose.x,
        fy: other.pose.y,
      } as const)

/** One who walks with a party's leader, placed: its look, its spot and its place beside the leader (see `Follows`). */
interface Beside<L> {
  readonly look: L
  readonly pose: PoseValue
  readonly side: number
  readonly back: number
}
/** A neighbour placed face to face with a party's leader, talking for `seconds`: its look, spot and own way home. */
interface Facing {
  readonly look: Look
  readonly pose: PoseValue
  readonly route: RouteValue
  readonly seconds: number
}
/** A party placed on a street: its leader's look, spot and route, the followers that found room beside it, and a neighbour talking. */
interface Placed {
  readonly leader: Look
  readonly pose: PoseValue
  readonly route: RouteValue
  readonly people: ReadonlyArray<Beside<Look>>
  readonly dog?: Beside<AnimalValue>
  readonly neighbour?: Facing
}
/** Two neighbours talking stand this far apart along the verge, m (about a conversation's distance). */
const FACE_TO_FACE = 1.1

/**
 * Up to `slots` parties to bring out `band` m from the player at `at` while fewer than `peopleOut` are out (`out` now), each on a
 * spot out of the houses and clear of walls (`TRIES` spots a party), on a street drawn by the residents along it.
 */
const placeParties = (
  random: Random.Random,
  at: Vec2.Vec2,
  band: readonly [number, number],
  out: number,
  slots: number,
): Array<Placed> => {
  const far = (p: Vec2.Vec2, range: number) => Vec2.distanceSquared(p, at) > range * range
  /** Whether a body of radius `r` may appear at `p`: beyond the band's inner edge, out of the houses, clear of walls. */
  const free = (p: Vec2.Vec2, r: number) =>
    far(p, band[0]) &&
    !indoors(p.x, p.y) &&
    clearOf(wallsAlong("land", p.x, p.y, 0, 0, 1), p.x, p.y, r)
  const target = peopleOut(at.x, at.y)
  const streets = peopledIndex.around(at.x, at.y, band)
  const placed: Array<Placed> = []
  let people = out
  for (let slot = 0; slot < slots && people < target; slot++)
    for (let k = 0; k < TRIES; k++) {
      // The streets more people live on fill first; one by a lone house or two is not in `peopledIndex`, so it stays empty.
      const edge = random.weighted(streets, residentsAlong)
      if (edge === undefined) break
      const forward = random.next() < 0.5
      const lane = laneOf(edge, forward)
      const side = walkSide(roadOf(edge)) * (random.next() < 0.5 ? 1 : -1)
      const along = random.range(0, lane.length)
      const spot = lanePoint(lane, along, side)
      // The edge's midpoint is in the band, but the spot may not be.
      if (far(spot, band[1]) || !free(spot, PERSON_RADIUS)) continue
      const party = randomParty(random)
      const angle = Ops.atan2(lane.dy, lane.dx)
      people++
      // A follower stands at its place beside the leader, or the mirror of it where that is taken; with room for neither it stays home.
      const beside = <L>(f: Follower<L>, r: number): Beside<L> | undefined =>
        [f.side, -f.side]
          .map((s) => ({
            look: f.look,
            pose: { ...lanePoint(lane, along - f.back, side + s), angle },
            side: s,
            back: f.back,
          }))
          .find((p) => free(p.pose, r))
      const followers: Array<Beside<Look>> = []
      for (const f of party.people) {
        const place = beside(f, PERSON_RADIUS)
        if (place === undefined || people >= PEDESTRIANS.max) continue
        followers.push(place)
        people++
      }
      const dog = party.dog && beside(party.dog, FAUNA.dog.radius * party.dog.look.size)
      // A neighbour stands a step up the verge, facing the leader; when they part, each walks on away from the other: the neighbour
      // up the lane, the leader back down it (the same verge, travelled the other way).
      const facing =
        party.neighbour && people < PEDESTRIANS.max
          ? { ...lanePoint(lane, along + FACE_TO_FACE, side), angle: angle + Math.PI }
          : undefined
      const neighbour =
        party.neighbour !== undefined && facing !== undefined && free(facing, PERSON_RADIUS)
          ? {
              look: party.neighbour.look,
              pose: facing,
              route: { edge, forward, side },
              seconds: party.neighbour.seconds,
            }
          : undefined
      if (neighbour !== undefined) people++
      const route =
        neighbour === undefined ? { edge, forward, side } : { edge, forward: !forward, side: -side }
      placed.push({
        leader: party.leader,
        pose: { ...spot, angle },
        route,
        people: followers,
        dog,
        neighbour,
      })
      break
    }
  return placed
}

/** A random traffic model for `edge` (panda 75%, ape 15%, truck 10%), falling back to smaller ones that fit; undefined if none does. */
/**
 * Whether a traffic car of `model` may be brought out at `pose`, the vehicles `taken` standing about: `TRAFFIC.spacing` m from each,
 * clear of walls, and not by a level crossing, where it could stand on the box. A spot is drawn first and then turned down.
 */
export const roomFor = (
  model: VehicleModel,
  pose: PoseValue,
  taken: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): boolean =>
  !taken.some((p) => Vec2.distanceSquared(p, pose) < TRAFFIC.spacing ** 2) &&
  carClear(model, pose) &&
  !nearCrossing(pose.x, pose.y)

const pickModel = (random: Random.Random, edge: number): VehicleModel | undefined => {
  const roll = random.next()
  const choices: ReadonlyArray<VehicleModel> = [
    roll < 0.75 ? "panda" : roll < 0.9 ? "ape" : "truck",
    "panda",
    "ape",
  ]
  return choices.find((model) => allowsModel(edge, model))
}

/**
 * Every half second, keeps the world around the player alive: traffic on
 * random traffic edges, and as many people as live nearby go out (`peopleOut`)
 * in parties on the streets they live on, spawning out of view; both despawn
 * once far behind, or out of sight when stuck for good (never the player's own
 * car). Destroyed vehicles go once out of sight; the dead count for nobody
 * and go once far behind.
 */
export const Populate = Game.System(
  "Lunigiana/Populate",
  {
    queries: {
      player: Game.Query({
        selection: { pose: Game.Query.read(Pose), driving: Game.Query.optional(Driving) },
        with: [Player],
      }),
      traffic: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          route: Game.Query.read(Route),
          pilot: Game.Query.read(Autopilot),
        },
        with: [Traffic],
      }),
      vehicles: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Vehicle] }),
      wrecks: Game.Query({
        selection: { pose: Game.Query.read(Pose), damage: Game.Query.read(Damage) },
        with: [Vehicle],
        without: [Traffic],
      }),
      peds: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          ped: Game.Query.read(Pedestrian),
          follows: Game.Query.optional(Follows),
          dead: Game.Query.optional(Dead),
        },
      }),
      leashed: Game.Query({
        selection: { pose: Game.Query.read(Pose), follows: Game.Query.read(Follows) },
        with: [Animal],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.spawns(
        Vehicle,
        Pose,
        PrevPose,
        Motion,
        CarInput,
        Traffic,
        Route,
        Autopilot,
        Pedestrian,
        Person,
        Follows,
        Animal,
        Roam,
      ),
      Game.System.despawns(Traffic, Vehicle, Pedestrian, Animal),
    ),
  },
  ({ queries, resources, commands }) => {
    if (!Clock.every(resources.time.get(), PERIOD)) return
    const { step } = resources.time.get()
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const driving = found.value.data.driving.value()
    const mine = driving === undefined ? undefined : Game.Entity.id(driving.vehicle)
    const far = (p: Vec2.Vec2, range: number) => Vec2.distanceSquared(p, at) > range * range
    const random = Random.draw(resources.rng)

    let cars = 0
    for (const { entity, data } of queries.traffic.each()) {
      const pose = data.pose.get()
      // A car wedged off the road or stuck for good goes too, once nobody can see it go.
      const lost =
        distanceToEdge(data.route.get().edge, pose.x, pose.y) > LOST ||
        data.pilot.get().tries >= GIVE_UP_TRIES
      const wrecked = lost && far(pose, TRAFFIC.unseen)
      if ((far(pose, TRAFFIC.despawn) || wrecked) && entity.id !== mine) commands.despawn(entity)
      else cars++
    }
    // A wreck, burning or a charred shell, stays where it stopped until nobody can see it go.
    for (const { entity, data } of queries.wrecks.each()) {
      if (destroyed(data.damage.get().amount) && far(data.pose.get(), TRAFFIC.unseen))
        commands.despawn(entity)
    }
    const taken = queries.vehicles.each().map(({ data }) => data.pose.get())
    const roads = trafficIndex.around(at.x, at.y, TRAFFIC.spawn)
    for (let slot = 0; slot < TRAFFIC.perTick && cars < TRAFFIC.max; slot++)
      for (let k = 0; k < TRIES; k++) {
        const edge = random.pick(roads)
        if (edge === undefined) break
        const model = pickModel(random, edge)
        if (model === undefined) continue
        const oneway = roadOf(edge).oneway === true
        const coin = oneway || random.next() < 0.5
        // Head out of dead-end spurs rather than into them.
        const forward = oneway || !leadsToDeadEnd({ edge, forward: coin }, model) ? coin : !coin
        const lane = laneOf(edge, forward)
        const side = laneSide({ edge, forward }, model)
        const pose = {
          ...lanePoint(lane, lane.length / 2, side),
          angle: Ops.atan2(lane.dy, lane.dx),
        }
        if (!roomFor(model, pose, taken)) continue
        const next = nextTrafficEdge(endNode(edge, forward), edge, model, random)
        commands.spawn(
          trafficCar(
            model,
            randomColor(random),
            pose,
            cruiseSpeed(roadOf(edge)) * 0.6,
            { edge, forward, side },
            next,
          ),
        )
        taken.push(pose)
        cars++
        break
      }

    const gone = new Set<number>()
    for (const { entity, data } of queries.peds.each()) {
      const pose = data.pose.get()
      // A walker blocked for good goes once nobody can see it go; a body lies where it fell until far behind, like the living.
      const stranded =
        !data.dead.present &&
        far(pose, PEDESTRIANS.unseen) &&
        data.ped.get().blocked > GIVE_UP_STEPS
      if (far(pose, PEDESTRIANS.despawn) || stranded) {
        commands.despawn(entity)
        gone.add(entity.id)
      }
    }
    // A party leaves together: its followers go with their leader, once out of view.
    const left = (leader: number, pose: Vec2.Vec2) =>
      gone.has(leader) && far(pose, PEDESTRIANS.unseen)
    let people = 0
    for (const { entity, data } of queries.peds.each()) {
      const follows = data.follows.value()
      if (gone.has(entity.id)) continue
      if (follows !== undefined && left(Game.Entity.id(follows.leader), data.pose.get()))
        commands.despawn(entity)
      else if (!data.dead.present) people++
    }
    for (const { entity, data } of queries.leashed.each())
      if (left(Game.Entity.id(data.follows.get().leader), data.pose.get())) commands.despawn(entity)

    for (const party of placeParties(random, at, PEDESTRIANS.spawn, people, PEDESTRIANS.perTick)) {
      const leader = Game.Entity.handle(
        commands.spawn(
          pedestrian(party.leader, party.pose, party.route, talking(party.neighbour, step)),
        ),
        Pedestrian,
      )
      const neighbour = party.neighbour
      if (neighbour !== undefined)
        commands.spawn(
          pedestrian(
            neighbour.look,
            neighbour.pose,
            neighbour.route,
            talking({ ...neighbour, pose: party.pose }, step),
          ),
        )
      for (const f of party.people)
        commands.spawn(
          Game.Command.extend(pedestrian(f.look, f.pose, party.route, talking(undefined, step)), [
            Follows,
            { leader, side: f.side, back: f.back },
          ]),
        )
      const dog = party.dog
      if (dog !== undefined)
        commands.spawn(
          Game.Command.extend(animal(dog.look, dog.pose), [
            Follows,
            { leader, side: dog.side, back: dog.back },
          ]),
        )
    }
  },
)

/** Setup's first fill of people and animals comes this close to the player, m: it places them round the player, none on them. */
export const FILL_NEAR = 4

/**
 * Setup: as many people as live around the player's start are out (`peopleOut`), in parties on the streets they live on, from
 * `FILL_NEAR` m of the player to the edge of `Populate`'s spawn band, so the player sees the village peopled from the first
 * frame; the title card hides them coming. `Populate` then keeps it so.
 */
export const FillPeople = Game.System(
  "Lunigiana/FillPeople",
  {
    queries: { player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }) },
    resources: { rng: Game.System.writeResource(Rng), time: Game.System.readResource(Time) },
    commands: Game.System.commands(
      Game.System.spawns(Pedestrian, Person, Pose, PrevPose, Motion, Route, Follows, Animal, Roam),
    ),
  },
  ({ queries, resources, commands }) => {
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const { step } = resources.time.get()
    const random = Random.draw(resources.rng)
    for (const party of placeParties(
      random,
      at,
      [FILL_NEAR, PEDESTRIANS.spawn[1]],
      0,
      PEDESTRIANS.max,
    )) {
      const leader = Game.Entity.handle(
        commands.spawn(
          pedestrian(party.leader, party.pose, party.route, talking(party.neighbour, step)),
        ),
        Pedestrian,
      )
      const neighbour = party.neighbour
      if (neighbour !== undefined)
        commands.spawn(
          pedestrian(
            neighbour.look,
            neighbour.pose,
            neighbour.route,
            talking({ ...neighbour, pose: party.pose }, step),
          ),
        )
      for (const f of party.people)
        commands.spawn(
          Game.Command.extend(pedestrian(f.look, f.pose, party.route, talking(undefined, step)), [
            Follows,
            { leader, side: f.side, back: f.back },
          ]),
        )
      const dog = party.dog
      if (dog !== undefined)
        commands.spawn(
          Game.Command.extend(animal(dog.look, dog.pose), [
            Follows,
            { leader, side: dog.side, back: dog.back },
          ]),
        )
    }
  },
)
