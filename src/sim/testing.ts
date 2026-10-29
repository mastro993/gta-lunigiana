/**
 * Headless test kit for the simulation tests: a world inspector, a staging
 * schedule that clears the map and places exactly what a test needs, and a
 * runner over scripted keys that also collects the events the systems emit.
 *
 * @module testing
 */
import assert from "node:assert/strict"

import type { Descriptor } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { clearOf, wallsAlong } from "./body.ts"
import { settle } from "./chassis.ts"
import { UNDAMAGED, type Wear } from "./damage.ts"
import { gearFor } from "./drivetrain.ts"
import type { Ground, StepResult } from "./dynamics.ts"
import type { HandlingValue } from "./handling.ts"
import {
  Animal,
  Autopilot,
  bindings,
  CarInput,
  Chassis,
  type ChassisValue,
  Cry,
  Damage,
  Dead,
  Down,
  Explosion,
  Follows,
  Game,
  GameClock,
  Handling,
  Honk,
  Impact,
  InWater,
  KeyboardInput,
  Lightning,
  type Look,
  makeRuntime,
  Motion,
  Pedestrian,
  Person,
  Player,
  PlayerView,
  Pose,
  type PoseValue,
  PrevPose,
  Rivers,
  type RiversValue,
  Rng,
  Roam,
  Route,
  Score,
  setup,
  Stolen,
  Traffic,
  Train,
  TrainMotion,
  TrainRun,
  update,
  Vehicle,
  Weather,
  Whistle,
  Witness,
} from "./index.ts"
import { graph } from "./map/index.ts"
import type { Surface } from "./map/surface.ts"
import type { trainDraft } from "./rail/service.ts"
import { noTrains, TrainWorld } from "./rail/testing.ts"
import {
  edgeIndex,
  endNode,
  facesForward,
  laneOf,
  lanePoint,
  laneSide,
  nextTrafficEdge,
  roadOf,
  type Step,
} from "./route.ts"
import { DRY, type GroundWeather } from "./sky/local.ts"
import {
  type animal,
  type parkedCar,
  type pedestrian,
  rollingChassis,
  trafficCar,
} from "./spawning.ts"
import { advance } from "./systems/physics.ts"
import { PERSON_RADIUS } from "./tuning.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"
import { FLOW } from "./water/flow.ts"

/** The runtime's save as a host stores it, through JSON; fails the test when a schema cannot encode a value. */
export const jsonSave = <Saved>(runtime: {
  snapshot():
    | { readonly ok: true; readonly value: Saved }
    | { readonly ok: false; readonly error: unknown }
}): Saved => {
  const saved = runtime.snapshot()
  assert.ok(saved.ok, saved.ok ? "" : `the world does not save: ${JSON.stringify(saved.error)}`)
  return JSON.parse(JSON.stringify(saved.value)) as Saved
}

/** A grown man's look, for the people tests stage: what he looks like does not matter to them. */
export const LOOK: Look = {
  skin: 0xc68e6a,
  hair: 0x2b1d14,
  shirt: 0xb8312b,
  pants: 0x1d2b4f,
  age: "adult",
  female: false,
  outfit: "trousers",
  hairdo: "short",
  height: 1.75,
}

/** Scripted keys, frame by frame. */
export type Timeline = Keyboard.Timeline<typeof bindings>

/** Everything a test asserts on, as plain data. */
export const World = Game.Inspector(
  "Test/World",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.read(CarInput),
          chassis: Game.Query.read(Chassis),
          damage: Game.Query.read(Damage),
          traffic: Game.Query.optional(Traffic),
          stolen: Game.Query.optional(Stolen),
          route: Game.Query.optional(Route),
          pilot: Game.Query.optional(Autopilot),
        },
      }),
      peds: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          ped: Game.Query.read(Pedestrian),
          look: Game.Query.read(Person),
          route: Game.Query.read(Route),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          witness: Game.Query.optional(Witness),
          wet: Game.Query.optional(InWater),
        },
      }),
      player: Game.Query({
        selection: { wet: Game.Query.optional(InWater) },
        with: [Player],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          animal: Game.Query.read(Animal),
          roam: Game.Query.read(Roam),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          wet: Game.Query.optional(InWater),
        },
      }),
    },
    resources: {
      score: Game.System.readResource(Score),
      handling: Game.System.readResource(Handling),
      clock: Game.System.readResource(GameClock),
      weather: Game.System.readResource(Weather),
      rivers: Game.System.readResource(Rivers),
      rng: Game.System.readResource(Rng),
    },
  },
  ({ queries, resources }) => ({
    vehicles: queries.vehicles.each().map(({ entity, data }) => ({
      id: entity.id,
      ...data.pose.get(),
      ...data.motion.get(),
      ...data.vehicle.get(),
      input: data.input.get(),
      chassis: data.chassis.get(),
      damage: data.damage.get(),
      traffic: data.traffic.present,
      stolen: data.stolen.present,
      route: data.route.value(),
      pilot: data.pilot.value(),
    })),
    peds: queries.peds.each().map(({ entity, data }) => {
      const follows = data.follows.value()
      return {
        id: entity.id,
        ...data.pose.get(),
        ...data.motion.get(),
        ...data.ped.get(),
        look: data.look.get(),
        route: data.route.get(),
        leader: follows === undefined ? undefined : Game.Entity.id(follows.leader),
        down: data.down.present,
        dead: data.dead.value()?.since,
        witness: data.witness.present,
        wet: data.wet.value(),
      }
    }),
    animals: queries.animals.each().map(({ entity, data }) => ({
      id: entity.id,
      ...data.pose.get(),
      ...data.motion.get(),
      ...data.animal.get(),
      ...data.roam.get(),
      leader:
        data.follows.value() === undefined
          ? undefined
          : Game.Entity.id(data.follows.value()!.leader),
      down: data.down.present,
      dead: data.dead.value()?.since,
      wet: data.wet.value(),
    })),
    /** The player in the water: `wading`, `swimming`, or undefined out of it. */
    water: queries.player.each().map(({ data }) => {
      const wet = data.wet.value()
      return wet === undefined ? undefined : wet.swimming ? "swimming" : "wading"
    })[0],
    score: resources.score.get(),
    handling: resources.handling.get(),
    clock: resources.clock.get(),
    weather: resources.weather.get(),
    rivers: resources.rivers.get(),
    /** The world's random stream's state: what traffic, pedestrians and parking have drawn. */
    rng: resources.rng.get(),
  }),
)

/** What a test puts on the cleared map. */
interface Cast {
  readonly cars?: ReadonlyArray<ReturnType<typeof parkedCar>>
  readonly traffic?: ReadonlyArray<ReturnType<typeof trafficCar>>
  readonly peds?: ReadonlyArray<ReturnType<typeof pedestrian>>
  readonly animals?: ReadonlyArray<ReturnType<typeof animal>>
  /** People and animals lying dead since the first step. */
  readonly bodies?: ReadonlyArray<ReturnType<typeof pedestrian>>
  readonly carcasses?: ReadonlyArray<ReturnType<typeof animal>>
  /** Trains (`trainDraft`), AI-driven or not. */
  readonly trains?: ReadonlyArray<ReturnType<typeof trainDraft>>
  /** A leader (lying dead, when `dead`) and who walks with it, people and animals (a dog on a lead), each at its place (see `Follows`). */
  readonly parties?: ReadonlyArray<{
    readonly leader: ReturnType<typeof pedestrian>
    readonly dead?: boolean
    readonly people?: ReadonlyArray<{
      readonly draft: ReturnType<typeof pedestrian>
      readonly side: number
      readonly back: number
    }>
    readonly animals?: ReadonlyArray<{
      readonly draft: ReturnType<typeof animal>
      readonly side: number
      readonly back: number
    }>
  }>
}

/** Moves the player (on foot) to `at`. */
export const teleport = (at: PoseValue) =>
  Game.System(
    "Test/Teleport",
    {
      queries: {
        player: Game.Query({
          selection: { pose: Game.Query.write(Pose), prev: Game.Query.write(PrevPose) },
          with: [Player],
        }),
      },
    },
    ({ queries }) => {
      for (const { data } of queries.player.each()) {
        data.pose.set(at)
        data.prev.set(at)
      }
    },
  )

/** The rivers carrying `q` m³/s per km² of catchment, all of it groundwater (it drains over weeks: steady through a test). */
const riversAt = (q: number): RiversValue => ({
  snow: 0,
  soil: FLOW.capacity / 2,
  quick: 0,
  slow: (q * FLOW.slowTau) / 1000,
})

/** Sets the rivers to carry `q` m³/s per km² (`runtime.tick` it). */
export const flood = (q: number) =>
  Game.Schedule(
    Game.System(
      "Test/Flood",
      { resources: { rivers: Game.System.writeResource(Rivers) } },
      ({ resources }) => resources.rivers.set(riversAt(q)),
    ),
  )

/** Sets every vehicle's damage to `amount`, as if its crashes had used up that share of its durability (`runtime.tick` it). */
export const wear = (amount: number) =>
  Game.Schedule(
    Game.System(
      "Test/Wear",
      {
        queries: { vehicles: Game.Query({ selection: { damage: Game.Query.write(Damage) } }) },
      },
      ({ queries }) => {
        for (const { data } of queries.vehicles.each())
          data.damage.update((damage) => ({ ...damage, amount }))
      },
    ),
  )

/** Test setup: no other vehicles, trains or pedestrians, the player at `at`, plus the `cast`. The railway's service is left as setup made it: with `start`'s `trains`, setup's first trains are gone and no line has another due, so only the cast's trains run until a `SetTrains`. */
export const stage = (at: PoseValue, cast: Cast = {}) =>
  Game.Schedule(
    Game.System(
      "Test/Clear",
      {
        queries: {
          vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }),
          trains: Game.Query({ selection: { train: Game.Query.read(Train) } }),
          peds: Game.Query({ selection: { ped: Game.Query.read(Pedestrian) } }),
          animals: Game.Query({ selection: { animal: Game.Query.read(Animal) } }),
        },
        commands: Game.System.commands(Game.System.despawns(Vehicle, Train, Pedestrian, Animal)),
      },
      ({ queries, commands }) => {
        for (const { entity } of queries.vehicles.each()) commands.despawn(entity)
        for (const { entity } of queries.trains.each()) commands.despawn(entity)
        for (const { entity } of queries.peds.each()) commands.despawn(entity)
        for (const { entity } of queries.animals.each()) commands.despawn(entity)
      },
    ),
    teleport(at),
    Game.Schedule.applyDeferred(),
    Game.System(
      "Test/Spawn",
      {
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
            Animal,
            Roam,
            Follows,
            Down,
            Dead,
            Train,
            TrainMotion,
            TrainRun,
          ),
        ),
      },
      ({ commands }) => {
        for (const car of cast.cars ?? []) commands.spawn(car)
        for (const train of cast.trains ?? []) commands.spawn(train)
        for (const car of cast.traffic ?? []) commands.spawn(car)
        for (const ped of cast.peds ?? []) commands.spawn(ped)
        for (const beast of cast.animals ?? []) commands.spawn(beast)
        for (const body of cast.bodies ?? [])
          commands.spawn(Game.Command.extend(body, [Down, { until: 0 }], [Dead, { since: 0 }]))
        for (const body of cast.carcasses ?? [])
          commands.spawn(Game.Command.extend(body, [Down, { until: 0 }], [Dead, { since: 0 }]))
        for (const party of cast.parties ?? []) {
          const leader = Game.Entity.handle(
            commands.spawn(
              party.dead === true
                ? Game.Command.extend(party.leader, [Down, { until: 0 }], [Dead, { since: 0 }])
                : party.leader,
            ),
            Pedestrian,
          )
          for (const { draft, side, back } of party.people ?? [])
            commands.spawn(Game.Command.extend(draft, [Follows, { leader, side, back }]))
          for (const { draft, side, back } of party.animals ?? [])
            commands.spawn(Game.Command.extend(draft, [Follows, { leader, side, back }]))
        }
      },
    ),
    Game.Schedule.applyDeferred(),
  )

/** Despawns every vehicle, pedestrian and animal not in `keep`: what Populate brings in, the step it comes. */
const keepOnly = (keep: ReadonlySet<number>) =>
  Game.Schedule(
    Game.System(
      "Test/Alone",
      {
        queries: {
          vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }),
          peds: Game.Query({ selection: { ped: Game.Query.read(Pedestrian) } }),
          animals: Game.Query({ selection: { animal: Game.Query.read(Animal) } }),
        },
        commands: Game.System.commands(Game.System.despawns(Vehicle, Pedestrian, Animal)),
      },
      ({ queries, commands }) => {
        for (const { entity } of [
          ...queries.vehicles.each(),
          ...queries.peds.each(),
          ...queries.animals.each(),
        ])
          if (!keep.has(entity.id)) commands.despawn(entity)
      },
    ),
    Game.Schedule.applyDeferred(),
  )

/**
 * A runtime after setup (and `staging`, if given) driven by `timeline`: run frames, inspect the world (its trains, the railway
 * and the crossings included) and the player's view, and read every event emitted so far (`heard`, in emission order). `alone`:
 * no one else ever comes (what Populate spawns goes at once), so a staged scene plays out undisturbed by traffic and passers-by.
 * No train runs unless `trains` (`noTrains` ticks before setup): only the trains tests have the service, and the trains they stage
 * (with `staging`, only those: see `stage`).
 */
export const start = (
  timeline: Timeline = [],
  staging?: readonly [PoseValue, Cast?],
  options: {
    readonly alone?: boolean
    readonly trains?: boolean
    /** Keys a test plays as it goes, instead of `timeline` (`liveKeys` in rail/testing.ts). */
    readonly keys?: { readonly snapshot: () => Keyboard.Snapshot<typeof bindings> }
  } = {},
) => {
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, options.keys ?? Keyboard.scripted(bindings, timeline)),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value
  assert.ok((options.trains === true ? runtime.tick(setup) : runtime.tick(noTrains, setup)).ok)
  if (staging !== undefined) assert.ok(runtime.tick(stage(...staging)).ok)
  const heard = {
    impacts: new Array<Descriptor.Descriptor.Value<typeof Impact>>(),
    honks: new Array<Descriptor.Descriptor.Value<typeof Honk>>(),
    cries: new Array<Descriptor.Descriptor.Value<typeof Cry>>(),
    lightning: new Array<Descriptor.Descriptor.Value<typeof Lightning>>(),
    explosions: new Array<Descriptor.Descriptor.Value<typeof Explosion>>(),
    whistles: new Array<Descriptor.Descriptor.Value<typeof Whistle>>(),
  }
  const listen = Game.Schedule(
    Game.System(
      "Test/Listen",
      {
        events: {
          impacts: Game.System.readEvent(Impact),
          honks: Game.System.readEvent(Honk),
          cries: Game.System.readEvent(Cry),
          lightning: Game.System.readEvent(Lightning),
          explosions: Game.System.readEvent(Explosion),
          whistles: Game.System.readEvent(Whistle),
        },
      },
      ({ events }) => {
        heard.impacts.push(...events.impacts.all())
        heard.honks.push(...events.honks.all())
        heard.cries.push(...events.cries.all())
        heard.lightning.push(...events.lightning.all())
        heard.explosions.push(...events.explosions.all())
        heard.whistles.push(...events.whistles.all())
      },
    ),
  )
  const cast = runtime.inspect(World)
  const alone = keepOnly(
    new Set<number>([...cast.vehicles, ...cast.peds, ...cast.animals].map((body) => body.id)),
  )
  const run = (frames: number, each: (frame: number) => void = () => {}) => {
    for (let i = 0; i < frames; i++) {
      const ran =
        options.alone === true ? runtime.tick(update, alone, listen) : runtime.tick(update, listen)
      assert.ok(ran.ok, JSON.stringify(ran))
      each(i)
    }
  }
  return {
    runtime,
    run,
    heard,
    world: () => ({ ...runtime.inspect(World), ...runtime.inspect(TrainWorld) }),
    view: () => runtime.inspect(PlayerView),
  }
}

const battisti = graph.trafficEdges.filter((e) => roadOf(e).name === "Via Cesare Battisti")
const inFront = edgeIndex(battisti).nearest(-412, 438)
/**
 * Via Cesare Battisti eastbound in front of the Carabinieri: the traffic edge of that road nearest
 * (-412, 438), found by geometry so the fixtures survive map rebuilds. ~40 m of straight, clear road
 * with the next edge (`straightOn`), both verges walkable.
 */
export const BATTISTI: Step = { edge: inFront, forward: facesForward(inFront, 0) }
const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
/** The start of the BATTISTI lane, heading along it. */
export const ON_BATTISTI = {
  ...lanePoint(lane, 0, laneSide(BATTISTI, "panda")),
  angle: Ops.atan2(lane.dy, lane.dx),
}

/** The traffic edge leaving the end of `step` that carries on most nearly straight. */
export const straightOn = (step: Step): Step => {
  const node = endNode(step.edge, step.forward),
    here = laneOf(step.edge, step.forward)
  const along = (next: Step) => {
    const there = laneOf(next.edge, next.forward)
    return here.dx * there.dx + here.dy * there.dy
  }
  const options = graph.adjacency[node]!.filter(
    (e) => e !== step.edge && graph.trafficEdges.includes(e),
  ).map((e) => ({ edge: e, forward: graph.edges[e]!.a === node }))
  return options.reduce((best, next) => (along(next) > along(best) ? next : best))
}

/** A house wall on Via Cesare Battisti, (-435.2, 453.9) -> (-424.5, 451.9), the house to its north. */
const WALL_A = { x: -435.2, y: 453.9 },
  WALL_B = { x: -424.5, y: 451.9 }
const ALONG = {
  x: (WALL_B.x - WALL_A.x) / Vec2.distance(WALL_A, WALL_B),
  y: (WALL_B.y - WALL_A.y) / Vec2.distance(WALL_A, WALL_B),
}
/** The house wall's unit normal, pointing into the house. */
export const INTO = { x: -ALONG.y, y: ALONG.x }
/** The house wall's middle. */
export const MID = { x: (WALL_A.x + WALL_B.x) / 2, y: (WALL_A.y + WALL_B.y) / 2 }
/** Signed distance from the house wall's line, m (positive inside the house). */
export const depth = (p: { readonly x: number; readonly y: number }) =>
  (p.x - MID.x) * INTO.x + (p.y - MID.y) * INTO.y
/** The point `out` metres in front of the house wall's middle. */
export const facing = (out: number) => ({ x: MID.x - INTO.x * out, y: MID.y - INTO.y * out })
/** Heading square on into the house wall. */
export const TOWARD = Ops.atan2(INTO.y, INTO.x)
/** Heading along the house wall, its left side to the wall. */
export const BESIDE = Ops.atan2(ALONG.y, ALONG.x)
/** 30 m out from the house wall: where the player watches a scene there from. */
export const FAR = { ...facing(30), angle: 0 }

/** The point beside a panda's left (driver's) or right door. */
export const door = (car: PoseValue, side: 1 | -1 = 1): PoseValue => {
  const off = side * (VEHICLES.panda.width / 2 + 0.6)
  return {
    x: car.x - Ops.sin(car.angle) * off,
    y: car.y + Ops.cos(car.angle) * off,
    angle: car.angle,
  }
}

/** `keys` pressed on `frame` and released on the next. */
export const press = (frame: number, ...keys: Array<keyof typeof bindings>): Timeline => [
  { frame, press: keys },
  { frame: frame + 1, release: keys },
]

/** Whether a person at `p` is clear of walk walls (2 cm of slack). */
export const walkClear = (p: { readonly x: number; readonly y: number }) =>
  clearOf(wallsAlong("land", p.x, p.y, 0, 0, 1), p.x, p.y, PERSON_RADIUS, 0.02)

/** An unmanned vehicle at `pose` already rolling at `speed` along its heading, its controls held at `throttle` and `steer`. */
export const rolling = (
  model: VehicleModel,
  pose: PoseValue,
  speed: number,
  throttle: number,
  steer = 0,
) =>
  Game.Command.spawn(
    [Vehicle, { model, color: 0x8b8170 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: Ops.cos(pose.angle) * speed, vy: Ops.sin(pose.angle) * speed, spin: 0 }],
    [CarInput, { throttle, steer, handbrake: false }],
    [Chassis, rollingChassis(model, pose, speed)],
    [Damage, UNDAMAGED],
  )

/** A destroyed `model` parked at `pose`, burning, that blows up at step `fuse`. */
export const burning = (model: VehicleModel, pose: PoseValue, fuse: number) =>
  Game.Command.spawn(
    [Vehicle, { model, color: 0x8b8170 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: true }],
    [Chassis, rollingChassis(model, pose, 0)],
    [Damage, { ...UNDAMAGED, amount: 1, fuse }],
  )

/** A traffic car on Via Cesare Battisti, eastbound, at `at` (the lane's start by default), standing or rolling at `speed` m/s. */
export const battistiTraffic = (color: number, at: PoseValue = ON_BATTISTI, speed = 0) =>
  trafficCar(
    "panda",
    color,
    at,
    speed,
    { ...BATTISTI, side: laneSide(BATTISTI, "panda") },
    nextTrafficEdge(
      endNode(BATTISTI.edge, BATTISTI.forward),
      BATTISTI.edge,
      "panda",
      Random.make(1),
    ),
  )

/** Step length of the headless drives, s. */
export const DT = 1 / 60
/** Level test ground at 100 m. */
export const flat: Ground = () => 100

/** A vehicle's pose, motion and chassis as `drive` steps them. */
export interface DriveState {
  readonly pose: PoseValue
  readonly motion: { readonly vx: number; readonly vy: number; readonly spin: number }
  readonly chassis: ChassisValue
}
/** A driver's controls: throttle and steer in [-1, 1], the handbrake. */
export interface Pedals {
  readonly throttle: number
  readonly steer: number
  readonly handbrake: boolean
}

/**
 * A vehicle driven by `input` for `frames` steps on `ground` (no walls, `advance` alone), starting at the origin heading east at
 * `speed`, under `handling`, on `surface` as wet and snowy as `weather` (dry when omitted), its engine
 * worn by `wear`.
 */
export const drive = (
  model: VehicleModel,
  frames: number,
  input: (frame: number, state: DriveState) => Pedals,
  options: {
    readonly speed?: number
    readonly ground?: Ground
    readonly surface?: Surface
    readonly weather?: GroundWeather
    readonly chassis?: Partial<ChassisValue>
    readonly handling?: HandlingValue
    readonly wear?: Wear
    readonly each?: (frame: number, state: DriveState, result: StepResult) => void
  } = {},
): DriveState => {
  const ground = options.ground ?? flat,
    pose = { x: 0, y: 0, angle: 0 },
    speed = options.speed ?? 0
  let state: DriveState = {
    pose,
    motion: { vx: speed, vy: 0, spin: 0 },
    chassis: {
      ...settle(model, pose, ground),
      gear: gearFor(VEHICLES[model], speed),
      ...options.chassis,
    },
  }
  for (let frame = 0; frame < frames; frame++) {
    const { body, steer, gearbox, result } = advance(
      model,
      state,
      input(frame, state),
      frame,
      DT,
      ground,
      () => options.surface ?? "asphalt",
      options.handling,
      () => options.weather ?? DRY,
      options.wear,
    )
    state = {
      pose: { x: body.x, y: body.y, angle: body.angle },
      motion: { vx: body.vx, vy: body.vy, spin: body.spin },
      chassis: {
        z: body.z,
        vz: body.vz,
        pitch: body.pitch,
        pitchRate: body.pitchRate,
        roll: body.roll,
        rollRate: body.rollRate,
        steer,
        ...gearbox,
      },
    }
    options.each?.(frame, state, result)
  }
  return state
}
/** Speed along the heading, m/s. */
export const forward = (s: DriveState) =>
  s.motion.vx * Ops.cos(s.pose.angle) + s.motion.vy * Ops.sin(s.pose.angle)
