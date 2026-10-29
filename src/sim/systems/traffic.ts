import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { forwardSpeed, wrapAngle } from "../body.ts"
import { GRAVITY, rigFor, RIGS } from "../chassis.ts"
import { FAUNA } from "../fauna.ts"
import { type HandlingValue, REAL_HANDLING } from "../handling.ts"
import { graph } from "../map/index.ts"
import { onLevel, trainCars } from "../rail/bodies.ts"
import { atCrossings, backRoom, busyBoxes, nearTrack, type Occupant } from "../rail/roads.ts"
import {
  allowsModel,
  alongLane,
  cruiseSpeed,
  distanceToEdge,
  edgeIndex,
  endNode,
  facesForward,
  type Lane,
  laneOf,
  lanePoint,
  laneSide,
  leadsToDeadEnd,
  nextTrafficEdge,
  roadOf,
  walkSide,
} from "../route.ts"
import {
  Animal,
  Autopilot,
  CarInput,
  Chassis,
  type ChassisValue,
  Dead,
  Driving,
  Game,
  GameClock,
  Handling,
  Honk,
  LevelCrossings,
  Motion,
  Person,
  Pose,
  Rng,
  Route,
  STEP,
  Time,
  Traffic,
  Train,
  TrainMotion,
  Vehicle,
  Weather,
} from "../schema.ts"
import { airAt } from "../sky/climate.ts"
import { groundAt } from "../sky/local.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { weatherFactor } from "../tyres.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { steerLimit } from "./physics.ts"
import { inReach, playerPose } from "./reach.ts"

/** Look-ahead along the route: base metres plus seconds of speed. */
const LOOK_BASE = 6
const LOOK_TIME = 0.6
/**
 * Braking cone: base metres plus seconds of speed ahead, bent along the arc the front wheels steer, as wide as the car plus this
 * clearance to either side. Anything whose footprint reaches into it (a car's sideways body as well as its centre) holds the
 * driver back.
 */
const CONE_BASE = 8
const CONE_TIME = 1.2
const CONE_CLEARANCE = 0.15
/** Backing up with something this close alongside (m, body to body), a driver keeps the wheel straight. */
const ALONGSIDE = 0.6
/** Backing up, a driver stops this far short of anything behind (m, body to body). */
export const BACK_GAP = 0.5
/** Gap kept to whatever is ahead, m. */
const GAP = 2
/** Corner approach: slowest corner speed and the speed allowed per metre before the corner. */
const CORNER_MIN = 3
const CORNER_RAMP = 0.5
/** Below STUCK_SPEED (m/s) a car counts as stuck until it is faster than MOVING_SPEED again. */
const STUCK_SPEED = 1
const MOVING_SPEED = 2.5
/** Steps stuck before unsticking, and steps reversing then. */
const STUCK_STEPS = Clock.steps(Clock.duration(STEP, 3))
/** Waiting for a person ahead on the road counts as stuck only every this many steps (12 s instead of 3 s): they usually move on. */
const PERSON_PATIENCE = 4
const REVERSE_STEPS = Clock.steps(Clock.duration(STEP, 1.5))
/** Stuck steps after which the driver sounds the horn, once per stuck episode (half-way to unsticking). */
export const HONK_STEPS = Clock.steps(Clock.duration(STEP, 1.5))
/** Heading within this cosine of the lane counts as lined up with it. */
const LINED_UP = 0.7
/** Unstick attempts after which a car always turns round (dead end or not), and after which Populate gives up on it. */
const TURN_TRIES = 2
export const GIVE_UP_TRIES = 4
/**
 * AI drivers keep their sideways acceleration under this (m/s²), or under this share of what would
 * tip their vehicle over (the Ape, the laden truck): they slow for the curve they are steering.
 */
const COMFORT = 3.5
const COMFORT_TIP = 0.45
/**
 * Rolled sideways more than this share of its tipping angle (the Ape ≈ 14°, the laden truck ≈ 16°, a
 * Panda ≈ 26°), a wheel up a bank or the road falling away to one side, a driver brakes, and once
 * stopped holds the handbrake with the wheel straight, rather than tip over; stuck there, it backs off.
 */
const LEANING = 0.5
/** Speed backing up to get unstuck, m/s (negative: reverse). */
const REVERSE_SPEED = -3
/** Within this distance of its edge's end node a car moves on to the next edge, m. */
const ARRIVE = 4
/** Farther than this from its edge, a car finds the nearest road again, m. */
export const LOST = 12

const usable = (model: VehicleModel) =>
  edgeIndex(graph.trafficEdges.filter((e) => allowsModel(e, model)))
/** Per model, the traffic edges it may drive, for finding the road again. */
const usableByModel = {
  panda: usable("panda"),
  ape: usable("ape"),
  truck: usable("truck"),
  carabinieri: usable("carabinieri"),
} satisfies Record<VehicleModel, ReturnType<typeof edgeIndex>>

/**
 * The fastest an AI driver takes the curve it steers with `steer` at `speed` (m/s): its sideways acceleration within comfort. The
 * wheels turn as far as the physics turns them under `handling` on ground leaving `weather` of the dry grip; the comfort is the
 * vehicle's real one, scaled by that share too.
 */
export const comfortSpeed = (
  model: VehicleModel,
  steer: number,
  speed: number,
  handling: HandlingValue = REAL_HANDLING,
  weather = 1,
): number => {
  const rig = RIGS[model],
    wheel = Math.abs(steer) * steerLimit(rigFor(model, handling), Math.abs(speed), weather)
  return wheel < 1e-3
    ? Number.MAX_VALUE
    : Math.sqrt(
        (Math.min(COMFORT, COMFORT_TIP * rig.tipping * GRAVITY) * weather * rig.wheelbase) /
          Ops.tan(wheel),
      )
}

/** Whether a vehicle rolls far enough over to fear tipping (a wheel up a bank, down a stream's edge). */
export const leans = (model: VehicleModel, chassis: Pick<ChassisValue, "roll">): boolean =>
  Math.abs(chassis.roll) > LEANING * Ops.atan(RIGS[model].tipping)

/** Lifted roads: a bridge deck or a tunnel. */
const lifted = (edge: number): boolean =>
  roadOf(edge).bridge === true || roadOf(edge).tunnel === true

/** Whether a car may turn round on `edge`: never on a bridge or in a tunnel, nor on an edge next to one (a circle there leaves the deck), nor beside a railway's track at grade (it would sweep over it). */
export const roomToTurn = (edge: number): boolean =>
  !lifted(edge) &&
  !nearTrack(edge) &&
  [graph.edges[edge]!.a, graph.edges[edge]!.b].every((node) => !graph.adjacency[node]!.some(lifted))

/** Throttle (or brake) toward a wanted speed. */
const throttleFor = (want: number, speed: number): number =>
  Math.max(-1, Math.min(1, (want - speed) * 0.4))

/**
 * Past the lane's end, close to its end node (so a car circling a U-turn
 * still moves on), or nearer the next edge than this one (a corner cut short).
 */
const arrived = (
  lane: Lane,
  along: number,
  at: { readonly x: number; readonly y: number },
  edge: number,
  next: number,
): boolean => {
  const end = lanePoint(lane, lane.length, 0)
  return (
    along >= lane.length - 0.5 ||
    Vec2.distanceSquared(end, at) < ARRIVE ** 2 ||
    distanceToEdge(next, at.x, at.y) < distanceToEdge(edge, at.x, at.y)
  )
}

/**
 * AI drivers on graph.trafficEdges: keep right (Route.side), steer at a point
 * ahead along this edge and the next, pick the next edge at random at each
 * node, slow for sharp turns and for anything in a cone ahead (people and
 * animals, living or dead, and the cars of a train on their level included),
 * and back up along the lane after standing still for 3 s (sometimes turning
 * round, and always from its second time on, dead end or not); waiting for a
 * living person or animal, or a train, ahead on the carriageway counts four
 * times slower. Half-way to backing up it honks, once (a Honk event). The cone
 * follows the arc its wheels steer and sees the whole footprint of what stands
 * in it (a car across the road as well as one ahead); backing up, it stops
 * short of what is behind and keeps the wheel straight past what is alongside.
 * On wet or snowy roads it drives slower by the square root of the grip left
 * (as a curve's speed goes), and looks and keeps further ahead by the grip
 * lost. At a level crossing it keeps to the crossing rules (rail/roads.ts):
 * it stops for a box not open, keeps the box and the junction before it
 * clear, and waits patiently while the box is closed for a train. A car
 * beyond the player's reach (`inReach`) stands frozen, its driver too.
 */
export const TrafficAI = Game.System(
  "Lunigiana/TrafficAI",
  {
    queries: {
      cars: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          chassis: Game.Query.read(Chassis),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.write(CarInput),
          route: Game.Query.write(Route),
          pilot: Game.Query.write(Autopilot),
        },
        with: [Traffic],
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          vehicle: Game.Query.read(Vehicle),
        },
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
      }),
      people: Game.Query({
        selection: { pose: Game.Query.read(Pose), dead: Game.Query.optional(Dead) },
        with: [Person],
        without: [Driving],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          animal: Game.Query.read(Animal),
          dead: Game.Query.optional(Dead),
        },
      }),
      player: playerPose(),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      handling: Game.System.readResource(Handling),
      weather: Game.System.readResource(Weather),
      clock: Game.System.readResource(GameClock),
      crossings: Game.System.thisTick(Game.System.readResource(LevelCrossings)),
    },
    events: { honk: Game.System.writeEvent(Honk) },
  },
  ({ queries, resources, events }) => {
    const { step } = resources.time.get(),
      handling = resources.handling.get(),
      weather = resources.weather.get(),
      air = airAt(resources.clock.get().seconds, weather)
    const random = Random.draw(resources.rng)
    const states = resources.crossings.get()
    const trains = queries.trains.each().map(({ entity, data }) => ({
      id: entity.id as number,
      motion: data.motion.get(),
      model: data.train.get().model,
    }))
    const busy = busyBoxes(trains)
    // The vehicles as the crossing rules see them: footprints and speeds.
    const occupants: ReadonlyArray<Occupant> = queries.vehicles.each().map(({ entity, data }) => {
      const { length, width } = VEHICLES[data.vehicle.get().model],
        { vx, vy } = data.motion.get()
      return {
        id: entity.id,
        ...data.pose.get(),
        long: length / 2,
        wide: width / 2,
        speed: Math.sqrt(vx * vx + vy * vy),
      }
    })
    // Each obstacle's footprint, half its length and half its width (a person or an animal a circle), and whether it moves on: the
    // living do, and a train; a body lying dead is waited for no longer than a parked car, not queued behind until it is gone. A
    // train's car is an obstacle only to a car on its level (`z`, its rail head).
    const obstacles: ReadonlyArray<{
      readonly id: number
      readonly x: number
      readonly y: number
      readonly angle: number
      readonly long: number
      readonly wide: number
      readonly movesOn: boolean
      readonly z?: number
    }> = [
      ...occupants.map((o) => ({ ...o, movesOn: false })),
      ...trainCars(trains).map((car) => ({
        id: car.train,
        x: car.x,
        y: car.y,
        angle: car.angle,
        long: car.length / 2,
        wide: car.width / 2,
        movesOn: true,
        z: car.z,
      })),
      ...queries.people.each().map(({ entity, data }) => ({
        id: entity.id,
        ...data.pose.get(),
        long: PERSON_RADIUS,
        wide: PERSON_RADIUS,
        movesOn: !data.dead.present,
      })),
      // An animal, standing or knocked down in the road, is waited for as a person is: it usually moves on.
      ...queries.animals.each().map(({ entity, data }) => {
        const { species, size } = data.animal.get(),
          r = FAUNA[species].radius * size
        return {
          id: entity.id,
          ...data.pose.get(),
          long: r,
          wide: r,
          movesOn: !data.dead.present,
        }
      }),
    ]
    /** How far `other`'s footprint reaches along a heading of (fx, fy) and across it, m. */
    const reach = (other: (typeof obstacles)[number], fx: number, fy: number) => {
      const along = Math.abs(Ops.cos(other.angle) * fx + Ops.sin(other.angle) * fy),
        across = Math.sqrt(Math.max(0, 1 - along * along))
      return {
        along: along * other.long + across * other.wide,
        across: across * other.long + along * other.wide,
      }
    }
    const player = queries.player.each()[0]?.data.pose.get()
    for (const { entity, data } of queries.cars.each()) {
      const pose = data.pose.get()
      if (!inReach(pose, player)) continue
      const { model } = data.vehicle.get()
      const spec = VEHICLES[model]
      const speed = forwardSpeed(data.motion.get(), pose.angle)
      // What stands on its level: the ground under it.
      const ground = data.chassis.get().z - spec.cg,
        level = (other: (typeof obstacles)[number]) =>
          other.z === undefined || onLevel(ground, other.z)
      let route = data.route.get()
      let pilot = data.pilot.get()
      if (distanceToEdge(route.edge, pose.x, pose.y) > LOST) {
        const edge = usableByModel[model].nearest(pose.x, pose.y)
        const forward = roadOf(edge).oneway === true || facesForward(edge, pose.angle)
        const after = nextTrafficEdge(endNode(edge, forward), edge, model, random)
        route = { edge, forward, side: laneSide({ edge, forward }, model) }
        pilot = { ...pilot, next: after.edge, nextForward: after.forward }
      }
      let lane = laneOf(route.edge, route.forward)
      let along = alongLane(lane, pose.x, pose.y)
      for (let hop = 0; hop < 2 && arrived(lane, along, pose, route.edge, pilot.next); hop++) {
        const after = nextTrafficEdge(
          endNode(pilot.next, pilot.nextForward),
          pilot.next,
          model,
          random,
        )
        route = {
          edge: pilot.next,
          forward: pilot.nextForward,
          side: laneSide({ edge: pilot.next, forward: pilot.nextForward }, model),
        }
        pilot = { ...pilot, next: after.edge, nextForward: after.forward }
        lane = laneOf(route.edge, route.forward)
        along = alongLane(lane, pose.x, pose.y)
      }
      const next = laneOf(pilot.next, pilot.nextForward)
      const ahead = Math.max(0, along) + LOOK_BASE + Math.max(0, speed) * LOOK_TIME
      const target =
        ahead <= lane.length
          ? lanePoint(lane, ahead, route.side)
          : lanePoint(
              next,
              Math.min(next.length, ahead - lane.length),
              laneSide({ edge: pilot.next, forward: pilot.nextForward }, model),
            )
      const error = wrapAngle(Ops.atan2(target.y - pose.y, target.x - pose.x) - pose.angle)
      const steer = Math.max(-1, Math.min(1, error * 2.5))
      const fx = Ops.cos(pose.angle),
        fy = Ops.sin(pose.angle)
      // The share of its dry grip the road leaves (wet or snowy): it drives, follows and backs up that much more carefully.
      const grip = weatherFactor(
        groundAt(weather, pose.x, pose.y, data.chassis.get().z - spec.cg, air),
        handling.weatherGrip,
      )

      if (step < pilot.reverseUntil) {
        // Backing up, the tail aims at a point behind on the lane (steering works mirrored in reverse). With anything close behind the
        // tail (the car queued there, a person) it stops instead of backing into it; with anything alongside it backs straight, so the
        // swinging nose does not sweep into it.
        const behind = lanePoint(lane, along - LOOK_BASE, route.side)
        const tail = wrapAngle(
          Ops.atan2(behind.y - pose.y, behind.x - pose.x) - pose.angle - Math.PI,
        )
        let back = REVERSE_SPEED,
          beside = false
        for (const other of obstacles) {
          if (other.id === entity.id || !level(other)) continue
          const rx = other.x - pose.x,
            ry = other.y - pose.y,
            front = rx * fx + ry * fy,
            extent = reach(other, fx, fy)
          const clear = Math.abs(ry * fx - rx * fy) - extent.across - spec.width / 2
          // Behind the tail: slower the nearer it is, as when following forward, stopping `BACK_GAP` short of it.
          if (front < 0 && clear < CONE_CLEARANCE)
            back = Math.max(
              back,
              -Math.max(0, (-front - extent.along - spec.length / 2 - BACK_GAP) * 0.8 * grip),
            )
          if (Math.abs(front) < spec.length / 2 + extent.along && clear < ALONGSIDE) beside = true
        }
        // Never back onto a line's track at a level crossing that is not open (stuck in the queue past one it has cleared).
        const room = backRoom(
          { x: pose.x, y: pose.y, angle: pose.angle, length: spec.length, width: spec.width },
          states,
        )
        back = Math.max(back, -Math.max(0, room * 0.8 * grip))
        const held = back > -0.5 && Math.abs(speed) < 0.5
        data.input.set(
          held
            ? { throttle: 0, steer: 0, handbrake: true }
            : {
                throttle: throttleFor(back, speed),
                steer: beside ? 0 : Math.max(-1, Math.min(1, -tail * 2.5)),
                handbrake: false,
              },
        )
        data.route.set(route)
        data.pilot.set(pilot)
        continue
      }

      const cruise = cruiseSpeed(roadOf(route.edge))
      const sharp = (1 - (lane.dx * next.dx + lane.dy * next.dy)) / 2
      let want = Math.min(
        cruise,
        Math.max(CORNER_MIN, cruise * (1 - 1.2 * sharp)) +
          CORNER_RAMP * Math.max(0, lane.length - along),
      )
      // Pointing away from the target (turning round, a corner gone wide): corner speed, for the tightest circle.
      want = Math.min(want, CORNER_MIN + (cruise - CORNER_MIN) * Math.max(0, Ops.cos(error)))
      // Wet or snowy road: slower by the square root of the grip left, as the speed a curve allows goes.
      want = Math.min(want * Math.sqrt(grip), comfortSpeed(model, steer, speed, handling, grip))
      const range = (CONE_BASE + Math.max(0, speed) * CONE_TIME) / grip
      // The path the front wheels steer: a circle of radius `radius` m, its centre to the left (+) or right; nearly straight, a line (0).
      const bend = Ops.tan(data.chassis.get().steer) / RIGS[model].wheelbase,
        radius = Math.abs(bend) < 1e-3 ? 0 : 1 / bend
      // The carriageway or its verge, where walkers keep (`walkSide`).
      const inWay = (edge: number, p: { readonly x: number; readonly y: number }) =>
        distanceToEdge(edge, p.x, p.y) <
        Math.max(roadOf(edge).w / 2, walkSide(roadOf(edge))) + PERSON_RADIUS
      const onRoad = (p: { readonly x: number; readonly y: number }) =>
        inWay(route.edge, p) || inWay(pilot.next, p)
      // Whether the nearest thing held back for is a living person or animal in the way (ahead of the bumper, on the carriageway or
      // its verge), or a train across it, which moves on.
      let forPerson = false
      for (const other of obstacles) {
        if (other.id === entity.id || !level(other)) continue
        const rx = other.x - pose.x,
          ry = other.y - pose.y
        const front = rx * fx + ry * fy,
          extent = reach(other, fx, fy)
        if (front <= 0 || front > range + extent.along) continue
        const across = ry * fx - rx * fy,
          off =
            radius === 0
              ? Math.abs(across)
              : Math.abs(Ops.hypot(front, across - radius) - Math.abs(radius))
        if (off - extent.across >= spec.width / 2 + CONE_CLEARANCE) continue
        const limit = Math.max(0, (front - spec.length / 2 - extent.along - GAP) * 0.8 * grip)
        if (limit < want)
          [want, forPerson] = [
            limit,
            other.movesOn && front > spec.length / 2 && (other.z !== undefined || onRoad(other)),
          ]
      }
      // The level crossings: a stop for a box not open, or to keep one or the junction before it clear; patience at a closed one.
      const was = data.input.get()
      const crossing = atCrossings(
        {
          id: entity.id,
          x: pose.x,
          y: pose.y,
          angle: pose.angle,
          speed,
          length: spec.length,
          width: spec.width,
          side: route.side,
          route,
          next: { edge: pilot.next, forward: pilot.nextForward },
          lane,
          along,
          grip,
          braking: was.throttle < 0 || was.handbrake,
        },
        occupants,
        states,
        busy,
        step,
      )
      want = Math.min(want, crossing.limit)

      const holding = want < 0.5 && Math.abs(speed) < 0.5,
        slow = Math.abs(speed) < 0.5
      data.input.set(
        leans(model, data.chassis.get())
          ? { throttle: slow ? 0 : throttleFor(0, speed), steer: slow ? 0 : steer, handbrake: slow }
          : holding
            ? { throttle: 0, steer, handbrake: true }
            : { throttle: throttleFor(want, speed), steer, handbrake: false },
      )

      // Stopped (or grinding along a wall) counts up, waiting for a living person or animal (or a train) in the way only every
      // PERSON_PATIENCE steps, and not at all waiting at a closed level crossing; only real progress resets it.
      const counts = !crossing.patient && (!forPerson || step % PERSON_PATIENCE === 0)
      const stuck =
        Math.abs(speed) < STUCK_SPEED
          ? pilot.stuck + (counts ? 1 : 0)
          : Math.abs(speed) > MOVING_SPEED
            ? 0
            : pilot.stuck
      if (stuck >= HONK_STEPS && pilot.stuck < HONK_STEPS)
        events.honk.emit({ car: entity.id, model, x: pose.x, y: pose.y })
      if (stuck < STUCK_STEPS) pilot = { ...pilot, stuck }
      else {
        pilot = { ...pilot, stuck: 0, reverseUntil: step + REVERSE_STEPS, tries: pilot.tries + 1 }
        const back = { edge: route.edge, forward: !route.forward }
        // Turn round only when lined up with the route (mid-turn, backing up helps it round instead), and where there is room.
        const linedUp = lane.dx * fx + lane.dy * fy > LINED_UP
        // Trucks never do: they keep to loops of the network because they cannot.
        const turn =
          linedUp &&
          model !== "truck" &&
          roomToTurn(route.edge) &&
          (pilot.tries >= TURN_TRIES || (!leadsToDeadEnd(back, model) && random.next() < 0.5))
        if (roadOf(route.edge).oneway !== true && turn) {
          route = { ...route, forward: back.forward, side: laneSide(back, model) }
          const after = nextTrafficEdge(
            endNode(route.edge, route.forward),
            route.edge,
            model,
            random,
          )
          pilot = { ...pilot, next: after.edge, nextForward: after.forward }
        }
      }
      data.route.set(route)
      data.pilot.set(pilot)
    }
  },
)
