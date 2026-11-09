import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { crossesAny, walkBy, wallsAlong, wrapAngle } from "../body.ts"
import { MEAN_HEIGHT } from "../population/looks.ts"
import {
  alongLane,
  endNode,
  type Lane,
  laneOf,
  lanePoint,
  nextWalkEdge,
  roadOf,
  walkSide,
} from "../route.ts"
import {
  Dead,
  Down,
  Follows,
  Footing,
  Game,
  InWater,
  type Look,
  Motion,
  Pedestrian,
  type PedestrianValue,
  Person,
  Pose,
  type PoseValue,
  Rivers,
  Rng,
  Route,
  type RouteValue,
  STEP,
  Time,
} from "../schema.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { FLOW, specificDischarge } from "../water/flow.ts"
import { waterUnder, walkDry } from "../water/rivers.ts"
import { outOfDepth, STROKE, waterVelocity } from "../water/swim.ts"
import { slide } from "./foot.ts"
import { personBuild } from "./water.ts"

/**
 * Comfortable walking pace by age group, men then women, m/s: Bohannon & Andrews 2011 ("Normal walking speed: a descriptive
 * meta-analysis", Physiotherapy 97(3), 23,111 people) measured 1.36–1.43 for men and 1.31–1.39 for women from their 20s to
 * their 50s, and 1.34/1.24 in their 60s, 1.26/1.13 in their 70s. A child's own pace is an estimate: children walk at a grown-up's
 * side, and keep it only when left alone.
 */
const WALK_PACE = { kid: [1.2, 1.2], adult: [1.4, 1.35], elder: [1.25, 1.15] } as const
/** A taller person strides longer: the pace scales with height over its group's mean, within this share either way. */
const HEIGHT_SPREAD = 0.1
/** Running pace by age group, m/s (TUNED): a grown-up's flight, a child's run, an elder's hurry. */
const RUN_PACE = { kid: 3.5, adult: 4.5, elder: 2.5 } as const

/** A person's walking and running pace, m/s. */
export const paceOf = (look: Look): { readonly walk: number; readonly run: number } => {
  const sex = look.female ? 1 : 0
  const scale = Math.min(
    1 + HEIGHT_SPREAD,
    Math.max(1 - HEIGHT_SPREAD, look.height / MEAN_HEIGHT[look.age][sex]),
  )
  return { walk: WALK_PACE[look.age][sex] * scale, run: RUN_PACE[look.age] * scale }
}

/** How long a scared pedestrian runs. */
export const FLEE_TIME = Clock.duration(STEP, 4)
/** Walkers aim this far ahead along their lane, m. */
const LOOK = 1.5
/** Making less than this share of the wanted speed along the lane counts as blocked. */
const PROGRESS = 0.5
/** Every this long blocked, a walker tries the other verge, then turns back. */
const BLOCKED_STEPS = Clock.steps(Clock.duration(STEP, 0.5))
/** Blocked this long, a walker out of sight is despawned (Populate). */
export const GIVE_UP_STEPS = Clock.steps(Clock.duration(STEP, 5))
/** Someone who stops to talk or watch slows at this rate, m/s² (TUNED: about half a second from a walk). */
const STOP = 3
/**
 * A person changes velocity at most this fast, m/s² (estimate: an untrained adult starts into a 4.5 m/s run in about 1.3 s), so
 * someone startled by a car needs time to get out of its way.
 */
const ACCEL = 3.5
/** Turning on the spot to face something, rad/s (TUNED: a half turn in about half a second). */
const TURN = 6
/** Moving slower than this (m/s), a person faces what it attends to rather than where it drifts. */
const STILL = 0.3
/**
 * Gatherers stand from GATHER_NEAR to GATHER_NEAR + GATHER_SPREAD m from the victim, each at its own distance, so a crowd
 * forms a loose ring; a child stays close, KID_BESIDE m. Within ARRIVED m of its spot a gatherer stands.
 */
const GATHER_NEAR = 2
const GATHER_SPREAD = 0.8
const KID_BESIDE = 1
const ARRIVED = 0.1
/** A follower closes on its place beside the leader at this rate (1/s, TUNED), up to its running pace. */
const FOLLOW_GAIN = 2
/** Farther than this from its place (m), a follower heads for the leader itself, whose path is walkable, not a spot past a wall. */
const CATCH_UP = 3

/** The same verge of `route`, travelled the other way. */
const turnBack = (route: RouteValue): RouteValue => ({
  ...route,
  forward: !route.forward,
  side: -route.side,
})

/** `route` turned, if need be, so that it leads from `at` away from `threat` (keeping to the same verge). */
export const runFrom = (route: RouteValue, at: Vec2.Vec2, threat: Vec2.Vec2): RouteValue => {
  const lane = laneOf(route.edge, route.forward)
  return lane.dx * (threat.x - at.x) + lane.dy * (threat.y - at.y) > 0 ? turnBack(route) : route
}

/** Where a follower walks: `side` m to the right of `leader` and `back` m behind it, in the leader's heading frame. */
export const placeBeside = (leader: PoseValue, side: number, back: number): Vec2.Vec2 => {
  const fx = Ops.cos(leader.angle),
    fy = Ops.sin(leader.angle)
  return { x: leader.x + side * fy - back * fx, y: leader.y - side * fx - back * fy }
}

/** The point LOOK m on from `along` down `lane`, on its verge `side`, kept within the lane and short of `most` m along it. */
const vergeAhead = (lane: Lane, along: number, side: number, most = lane.length) =>
  lanePoint(lane, Math.max(0, Math.min(lane.length, most, along + LOOK)), side)

/**
 * A follower's velocity: the leader's own plus FOLLOW_GAIN × the gap to its `place`, at most `run` m/s, so it keeps pace, catches
 * up when behind and stands when the leader stands. Farther than CATCH_UP from its place it makes for the leader itself. When
 * a wall stands in the way of either (the leader has turned a corner, or skirts one on the follower's side), it heads LOOK m on
 * along the leader's lane (`route`, the leader's), on the line through the leader rather than the verge (which may run into the
 * wall the leader slides along), and no nearer the leader than its place is: in single file round the corner. The walls are those
 * the follower meets on its ground at `z` (m a.s.l.; every one when left out).
 */
export const followVelocity = (
  at: Vec2.Vec2,
  place: Vec2.Vec2,
  leader: Vec2.Vec2,
  leaderVelocity: Vec2.Vec2,
  run: number,
  route: RouteValue,
  z?: number,
): Vec2.Vec2 => {
  const goal = Vec2.distanceSquared(at, place) > CATCH_UP ** 2 ? leader : place
  const way = Vec2.subtract(goal, at)
  if (crossesAny(wallsAlong("land", at.x, at.y, way.x, way.y, 0, z), at, goal)) {
    const lane = laneOf(route.edge, route.forward),
      side = (leader.x - lane.x) * lane.rx + (leader.y - lane.y) * lane.ry
    const target = vergeAhead(
      lane,
      alongLane(lane, at.x, at.y),
      side,
      alongLane(lane, leader.x, leader.y) - Vec2.distance(place, leader),
    )
    const speed = Math.min(
      run,
      Vec2.length(leaderVelocity) + FOLLOW_GAIN * Vec2.distance(target, at),
    )
    return Vec2.scale(Vec2.normalizeOr(Vec2.subtract(target, at), Vec2.zero), speed)
  }
  const wish = Vec2.add(leaderVelocity, Vec2.scale(way, FOLLOW_GAIN))
  const speed = Vec2.length(wish)
  return speed > run ? Vec2.scale(wish, run / speed) : wish
}

/** `angle` turned toward `target` by at most `most` rad. */
const turnToward = (angle: number, target: number, most: number): number =>
  angle + Math.max(-most, Math.min(most, wrapAngle(target - angle)))

/** A gatherer's distance from the victim: its own, stable for its entity id. */
const gatherDistance = (id: number, look: Look): number =>
  look.age === "kid" ? KID_BESIDE : GATHER_NEAR + GATHER_SPREAD * ((id * 0.6180339887) % 1)

/**
 * One step along `route` at `speed`: the velocity toward a point LOOK ahead on its verge, the route (on to a random next edge
 * at a junction, to the other verge or back when blocked), and the steps it has been getting nowhere.
 */
const alongRoute = (
  pose: PoseValue,
  motion: Vec2.Vec2,
  start: RouteValue,
  wasBlocked: number,
  speed: number,
  random: Random.Random,
) => {
  let route = start
  let lane = laneOf(route.edge, route.forward)
  let along = alongLane(lane, pose.x, pose.y)
  if (along >= lane.length - 0.3) {
    const next = nextWalkEdge(endNode(route.edge, route.forward), route.edge, random)
    route = { ...next, side: (route.side < 0 ? -1 : 1) * walkSide(roadOf(next.edge)) }
    lane = laneOf(route.edge, route.forward)
    along = alongLane(lane, pose.x, pose.y)
  }
  const target = vergeAhead(lane, Math.max(0, along), route.side)
  const velocity = Vec2.scale(Vec2.normalizeOr(Vec2.subtract(target, pose), Vec2.zero), speed)
  // Motion is last step's real velocity (walls and Contacts' shoves included). Progress is measured along the lane:
  // crossing to the other verge counts, sliding sideways along a wall that blocks the way does not.
  const progress =
    (motion.x * lane.dx + motion.y * lane.dy) /
    Math.max(1e-9, velocity.x * lane.dx + velocity.y * lane.dy)
  const blocked = progress < PROGRESS ? wasBlocked + 1 : 0
  if (blocked > 0 && blocked % BLOCKED_STEPS === 0)
    route = (blocked / BLOCKED_STEPS) % 2 === 1 ? { ...route, side: -route.side } : turnBack(route)
  return { velocity, route, blocked }
}

/** Whether two routes are the same, so an unchanged one is not written back. */
export const sameRoute = (a: RouteValue, b: RouteValue) =>
  a.edge === b.edge && a.forward === b.forward && a.side === b.side

/**
 * Pedestrians move as their mood (set by Perceive) says, each at its own pace (`paceOf`): walking their lane along
 * graph.walkEdges (turning at nodes toward where people live), and running along it away from a threat when fleeing; getting
 * nowhere (walls, parked cars, other people) they try the other verge, then turn back. Chatting, watching or in shock they slow
 * to a stop facing what they attend to; gathering, they walk to a spot near the victim and stand facing them. A follower keeps
 * its place beside its leader and takes the leader's route, or stays by a leader on the ground. Knocked down or dead, they slide.
 * They keep out of the water unless fleeing; in it they wade on as they were, slower, or once off their feet swim for the nearer
 * bank, and the current takes the down and the dead.
 */
export const Pedestrians = Game.System(
  "Lunigiana/Pedestrians",
  {
    queries: {
      peds: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          route: Game.Query.write(Route),
          ped: Game.Query.write(Pedestrian),
          look: Game.Query.read(Person),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          wet: Game.Query.optional(InWater),
          footing: Game.Query.read(Footing),
        },
      }),
      leaders: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          route: Game.Query.read(Route),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
        with: [Pedestrian],
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      rivers: Game.System.readResource(Rivers),
    },
  },
  ({ queries, resources }) => {
    const { dt } = resources.time.get()
    if (dt <= 0) return
    const q = specificDischarge(resources.rivers.get(), FLOW)
    const random = Random.draw(resources.rng)
    // Each leader's slowest follower on its feet, by its running pace: a leader fleeing runs no faster, so no kid is left behind.
    const slowest = new Map<number, number>()
    for (const { data } of queries.peds.each()) {
      const follows = data.follows.value()
      if (follows === undefined || data.down.present || data.dead.present) continue
      const leader = Game.Entity.id(follows.leader),
        run = paceOf(data.look.get()).run
      slowest.set(leader, Math.min(run, slowest.get(leader) ?? run))
    }
    for (const { entity, data } of queries.peds.each()) {
      const pose = data.pose.get()
      const motion = data.motion.get()
      const wet = data.wet.value(),
        water = wet === undefined ? undefined : waterUnder(pose.x, pose.y, true, q)
      const lying = data.down.present || data.dead.present,
        build = personBuild(data.look.get().height),
        ground = data.footing.get().z
      if (
        wet !== undefined &&
        water !== undefined &&
        (wet.swimming || lying || outOfDepth(water, build))
      ) {
        // Out of their depth: wading or swimming for the nearer bank; the down and the dead go where the current takes them.
        const look = data.look.get(),
          bank = { x: water.bankX, y: water.bankY }
        const velocity = waterVelocity(
          { x: motion.vx, y: motion.vy },
          lying ? Vec2.zero : Vec2.scale(bank, paceOf(look).walk),
          water,
          build,
          wet.swimming || lying,
          lying ? 0 : STROKE[look.age],
          ACCEL,
          dt,
        )
        const moved = walkBy(pose, Vec2.scale(velocity, dt), PERSON_RADIUS, ground)
        const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
        const angle =
          lying || Vec2.lengthSquared(real) <= STILL * STILL
            ? pose.angle
            : Ops.atan2(real.y, real.x)
        data.pose.set({ x: moved.position.x, y: moved.position.y, angle })
        data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
        continue
      }
      if (data.down.present || data.dead.present) {
        const velocity = slide({ x: motion.vx, y: motion.vy }, dt)
        const moved = walkBy(pose, Vec2.scale(velocity, dt), PERSON_RADIUS, ground)
        const angle =
          Vec2.lengthSquared(velocity) > 0.01 ? Ops.atan2(velocity.y, velocity.x) : pose.angle
        data.pose.set({ x: moved.position.x, y: moved.position.y, angle })
        data.motion.set({ vx: velocity.x, vy: velocity.y, spin: 0 })
        continue
      }
      const look = data.look.get()
      const pace = paceOf(look)
      const was = data.ped.get()
      let mood: PedestrianValue = was
      let route = data.route.get()
      const toward = Ops.atan2(mood.fy - pose.y, mood.fx - pose.x)
      const follows = data.follows.value()
      const found =
        follows === undefined || mood.mood === "gather"
          ? undefined
          : queries.leaders.getHandle(follows.leader)
      const leader =
        found?.ok === true && !found.value.data.down.present && !found.value.data.dead.present
          ? found.value.data
          : undefined
      // The heading to turn to when (all but) still; undefined: keep facing the way it moves.
      let face: number | undefined
      let velocity: Vec2.Vec2
      if (follows !== undefined && leader !== undefined) {
        const at = leader.pose.get(),
          going = leader.motion.get()
        if (!sameRoute(route, leader.route.get())) route = leader.route.get()
        velocity = followVelocity(
          pose,
          placeBeside(at, follows.side, follows.back),
          at,
          { x: going.vx, y: going.vy },
          pace.run,
          route,
          ground,
        )
        face = mood.mood === "walk" || mood.mood === "flee" ? at.angle : toward
        mood = { ...mood, blocked: 0 }
      } else if (mood.mood === "walk" || mood.mood === "flee") {
        const fleeing = mood.mood === "flee"
        const run = Math.min(pace.run, slowest.get(entity.id) ?? pace.run)
        const step = alongRoute(
          pose,
          { x: motion.vx, y: motion.vy },
          route,
          mood.blocked,
          fleeing ? run : pace.walk,
          random,
        )
        velocity = step.velocity
        route = step.route
        // Someone fleeing is turning and speeding up (ACCEL), which the count would take for a wall: it stays at zero, so they keep
        // to the way they chose until they walk again.
        mood = { ...mood, blocked: fleeing ? 0 : step.blocked }
      } else if (mood.mood === "gather") {
        const victim = { x: mood.fx, y: mood.fy }
        const spot = Vec2.add(
          victim,
          Vec2.scale(
            Vec2.normalizeOr(Vec2.subtract(pose, victim), { x: 1, y: 0 }),
            gatherDistance(entity.id, look),
          ),
        )
        const gap = Vec2.distance(spot, pose)
        velocity =
          gap < ARRIVED
            ? Vec2.zero
            : Vec2.scale(Vec2.subtract(spot, pose), Math.min(pace.walk, gap / dt) / gap)
        face = toward
        mood = { ...mood, blocked: 0 }
      } else {
        velocity = Vec2.moveToward({ x: motion.vx, y: motion.vy }, Vec2.zero, STOP * dt)
        face = toward
        mood = { ...mood, blocked: 0 }
      }

      // Wading, it keeps to what it was doing, slower and pushed by the current.
      velocity =
        water === undefined
          ? Vec2.moveToward({ x: motion.vx, y: motion.vy }, velocity, ACCEL * dt)
          : waterVelocity(
              { x: motion.vx, y: motion.vy },
              velocity,
              water,
              build,
              false,
              0,
              ACCEL,
              dt,
            )
      const moved = walkDry(
        pose,
        Vec2.scale(velocity, dt),
        PERSON_RADIUS,
        mood.mood !== "flee",
        wet !== undefined,
        q,
        ground,
      )
      const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
      const still = Vec2.lengthSquared(real) <= (face === undefined ? 0.01 : STILL * STILL)
      const angle = still
        ? face === undefined
          ? pose.angle
          : turnToward(pose.angle, face, TURN * dt)
        : Ops.atan2(real.y, real.x)
      data.pose.set({ x: moved.position.x, y: moved.position.y, angle })
      data.motion.set({ vx: real.x, vy: real.y, spin: 0 })
      if (!sameRoute(route, data.route.get())) data.route.set(route)
      if (mood.blocked !== was.blocked) data.ped.set(mood)
    }
  },
)
