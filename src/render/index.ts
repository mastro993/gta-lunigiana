/**
 * The render schedule: mirrors people, animals, vehicles and trains into three nodes with
 * RenderSync (render/registries; a vehicle that blew up as its charred shell), places them between
 * fixed steps (PrevPose → Pose at the loop's alpha, a train's s blended along its line), people and
 * animals on the ground or road under them in the frame for what they do, vehicles at their centre
 * of mass from their Chassis and every train's cars on the rails (render/train), spreads the blood
 * pools under the dead, marks the player's car or train for the x-ray silhouette, sets the level
 * crossings' arms and lights (render/crossings), lays tyre marks and smoke from the Skid events,
 * draws the damaged engines' smoke and fire and the Explosion events' blasts (render/effects), and
 * hands the sky host the clock, the weather, the lightning and the cars and trains with their lamps
 * on, and the see-through cut the player as drawn. Read-only towards the world
 * (__tests__/index.test.ts checks every system's declared access); the host ticks it once per
 * animation frame after writing `RenderClock.alpha`.
 *
 * @module render
 */
import { Descriptor } from "@typeonce/ritmo"
import { RenderSync } from "@typeonce/ritmo-render"
import type { Object3D } from "three"

import { wrapAngle } from "../sim/body.ts"
import {
  Animal,
  Chassis,
  type ChassisValue,
  Damage,
  Dead,
  Down,
  Driving,
  Game,
  GameClock,
  InWater,
  Lightning,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  type PoseValue,
  PrevPose,
  Rivers,
  type RiversValue,
  STEP,
  Time,
  Traffic,
  Train,
  TrainRun,
  Vehicle,
  Weather,
} from "../sim/index.ts"
import { TRAINS } from "../sim/rail/models.ts"
import { VEHICLES } from "../sim/vehicles.ts"
import { FLOW, specificDischarge } from "../sim/water/flow.ts"
import { waterUnder } from "../sim/water/rivers.ts"
import { vehicleBody, vehicleNode } from "./actors.ts"
import { AnimalNode } from "./animals.ts"
import { RenderClock } from "./clock.ts"
import { DrawCrossings } from "./crossings.ts"
import { DrawEffects } from "./effects.ts"
import { actorMaterial } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { PersonNode } from "./people.ts"
import { Animals, People, Vehicles } from "./registries.ts"
import type { SeeThrough } from "./sightline.ts"
import type { SkyHost } from "./sky/host.ts"
import { beamOf, PlaceTrains, SyncTrains, Trains } from "./train.ts"

export { RenderClock } from "./clock.ts"
export { Crossings } from "./crossings.ts"
export { Effects, makeEffects } from "./effects.ts"
export { Animals, makeRegistries, People, Vehicles } from "./registries.ts"
export { Trains } from "./train.ts"

/** The host's sky (`SkyHost`), fed by the render schedule: it draws the light, the weather and the night lights. */
export const Sky = Descriptor.Service<SkyHost>()("Lunigiana/Sky")
/** The host's see-through cut (`SeeThrough`), fed the player as drawn by the render schedule. */
export const Cut = Descriptor.Service<SeeThrough>()("Lunigiana/SeeThrough")

const SyncPeople = RenderSync.system(Game, {
  name: "Lunigiana/SyncPeople",
  renderable: Person,
  registry: People,
  select: {
    driving: Game.Query.optional(Driving),
    down: Game.Query.optional(Down),
    dead: Game.Query.optional(Dead),
    player: Game.Query.optional(Player),
    pedestrian: Game.Query.optional(Pedestrian),
    motion: Game.Query.read(Motion),
    pose: Game.Query.read(Pose),
    wet: Game.Query.optional(InWater),
  },
  resources: { time: Time, rivers: Rivers },
  // PrevPose is written every step, so apply also sees Driving and Down going away, and keeps the speed and clock current.
  redrawOn: [Driving, Down, Dead, Pedestrian, InWater, PrevPose],
  create: ({ renderable, entity }) => new PersonNode(renderable, actorMaterial, entity),
  apply: (node, { data, resources }) => {
    node.visible = !data.driving.present
    node.lie(data.down.present, data.dead.present)
    node.mood = data.pedestrian.value()?.mood ?? "walk"
    const { vx, vy } = data.motion.get()
    node.speed = Math.hypot(vx, vy)
    node.clock = resources.time.get().step * STEP.dt
    node.floating(
      ...afloat(data.pose.get(), data.wet.value(), data.down.present, resources.rivers.get()),
    )
    node.showXray(data.player.present)
  },
})

/**
 * How a person or animal at `pose` is in the water (`wet`): whether it is, the render y of the surface over it while it swims or
 * lies there (undefined while it wades, standing on the bed, or is out of it), and whether it swims.
 */
const afloat = (
  pose: PoseValue,
  wet: { readonly swimming: boolean } | undefined,
  lying: boolean,
  rivers: RiversValue,
): [boolean, number | undefined, boolean] => {
  if (wet === undefined || !(wet.swimming || lying)) return [wet !== undefined, undefined, false]
  const water = waterUnder(pose.x, pose.y, true, specificDischarge(rivers, FLOW))
  return [true, water === undefined ? undefined : yOf(water.level), wet.swimming]
}

const SyncAnimals = RenderSync.system(Game, {
  name: "Lunigiana/SyncAnimals",
  renderable: Animal,
  registry: Animals,
  select: {
    down: Game.Query.optional(Down),
    dead: Game.Query.optional(Dead),
    motion: Game.Query.read(Motion),
    pose: Game.Query.read(Pose),
    wet: Game.Query.optional(InWater),
  },
  resources: { time: Time, rivers: Rivers },
  redrawOn: [Down, Dead, InWater, PrevPose],
  create: ({ renderable, entity }) => new AnimalNode(renderable, actorMaterial, entity),
  apply: (node, { data, resources }) => {
    node.lie(data.down.present, data.dead.present)
    const { vx, vy } = data.motion.get()
    node.speed = Math.hypot(vx, vy)
    node.clock = resources.time.get().step * STEP.dt
    node.floating(
      ...afloat(data.pose.get(), data.wet.value(), data.down.present, resources.rivers.get()),
    )
  },
})

const SyncVehicles = RenderSync.system(Game, {
  name: "Lunigiana/SyncVehicles",
  renderable: Vehicle,
  registry: Vehicles,
  select: { damage: Game.Query.read(Damage) },
  redrawOn: [Damage],
  create: ({ renderable }) => vehicleNode(renderable.model, renderable.color, actorMaterial),
  // A wreck that blew up is left a charred shell, its lamps burnt off with it.
  apply: (node, { renderable, data }) => {
    const exploded = data.damage.get().exploded
    node.body.geometry = vehicleBody(renderable.model, renderable.color, exploded)
    node.lamps.visible = !exploded
  },
})

/** Shows the x-ray silhouette of the vehicle or train the player drives, and only that one. */
const MarkDriven = Game.System(
  "Lunigiana/MarkDriven",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
    },
    services: { nodes: Game.System.service(Vehicles), trains: Game.System.service(Trains) },
  },
  ({ queries, services }) => {
    const found = queries.player.singleOptional()
    const driving = found.ok ? found.value?.data.driving.value() : undefined
    const driven = driving === undefined ? undefined : Game.Entity.id(driving.vehicle)
    for (const [entity, node] of services.nodes.entries()) node.showXray(entity === driven)
    for (const [entity, node] of services.trains.entries()) node.showXray(entity === driven)
  },
)

/** `from` → `to` at `alpha`, turning the short way round. */
export const blend = (from: PoseValue, to: PoseValue, alpha: number): PoseValue => ({
  x: from.x + (to.x - from.x) * alpha,
  y: from.y + (to.y - from.y) * alpha,
  angle: from.angle + wrapAngle(to.angle - from.angle) * alpha,
})

const PlacePeople = RenderSync.interpolate(Game, {
  name: "Lunigiana/PlacePeople",
  registry: People,
  previous: PrevPose,
  current: Pose,
  clock: RenderClock,
  blend,
  place: (node, { x, y, angle }) => {
    node.place(x, y, angle)
    node.pose()
  },
})

const PlaceAnimals = RenderSync.interpolate(Game, {
  name: "Lunigiana/PlaceAnimals",
  registry: Animals,
  previous: PrevPose,
  current: Pose,
  clock: RenderClock,
  blend,
  place: (node, { x, y, angle }) => {
    node.place(x, y, angle)
    node.pose()
  },
})

/**
 * Puts a vehicle's node at its centre of mass `alpha` of the way through the last step: the pose
 * blended PrevPose → Pose, the height, pitch and roll stepped back from the current Chassis along
 * their rates (close to the previous step's values: the physics moves them in substeps). Three's rotation order YZX turns
 * the body as the sim does: heading, then pitch (nose up +) about its right axis, then roll (left
 * side up +, the roof toward local +Z, the right) about its forward axis.
 */
export const placeVehicle = (
  node: Object3D,
  prev: PoseValue,
  pose: PoseValue,
  chassis: ChassisValue,
  alpha: number,
): void => {
  // No car turns 90° in a step: a heading half a turn on is the physics folding a tumble's angles (heading + π, pitch π − pitch,
  // roll + π, the same body), unfolded here so the blend runs on from the previous step's angles.
  const folded = Math.abs(wrapAngle(pose.angle - prev.angle)) > Math.PI / 2
  const to = folded ? { ...pose, angle: pose.angle - Math.PI } : pose
  const pitch = folded ? Math.PI - chassis.pitch : chassis.pitch,
    pitchRate = folded ? -chassis.pitchRate : chassis.pitchRate
  const roll = folded ? chassis.roll - Math.PI : chassis.roll
  const { x, y, angle } = blend(prev, to, alpha),
    back = (1 - alpha) * STEP.dt
  node.position.set(x, yOf(chassis.z - chassis.vz * back), -y)
  node.rotation.set(roll - chassis.rollRate * back, angle, pitch - pitchRate * back)
}

const PlaceVehicles = Game.System(
  "Lunigiana/PlaceVehicles",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          prev: Game.Query.read(PrevPose),
          pose: Game.Query.read(Pose),
          chassis: Game.Query.read(Chassis),
        },
      }),
    },
    services: { nodes: Game.System.service(Vehicles), clock: Game.System.service(RenderClock) },
  },
  ({ queries, services }) => {
    for (const { entity, data } of queries.vehicles.each()) {
      const node = services.nodes.get(entity.id)
      if (node !== undefined)
        placeVehicle(
          node,
          data.prev.get(),
          data.pose.get(),
          data.chassis.get(),
          services.clock.alpha,
        )
    }
  },
)

/** Spreads each dead body's blood pool to its size at the drawn moment's sim time, under the node as placed this frame. */
const SpreadPools = Game.System(
  "Lunigiana/SpreadPools",
  {
    queries: { dead: Game.Query({ selection: { dead: Game.Query.read(Dead) } }) },
    resources: { time: Game.System.readResource(Time) },
    services: {
      people: Game.System.service(People),
      animals: Game.System.service(Animals),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, services }) => {
    const now = resources.time.get().step + services.clock.alpha
    for (const { entity, data } of queries.dead.each()) {
      const node = services.people.get(entity.id) ?? services.animals.get(entity.id)
      node?.bleed((now - data.dead.get().since) * STEP.dt)
    }
  },
)

/**
 * Hands the sky host this frame's game time (blended at alpha), the weather, sim time and what the
 * rivers carry, the steps' lightning, and the cars and trains with their lamps on, switching every
 * car's and train's lamps: on in traffic, in an AI train and in the player's car or train, off when
 * parked or left. After `sky.sky()`, which empties the sky's list of lit cars, and after the placing
 * systems, so the cars and trains stand where they are drawn; a train's beam leaves its leading nose.
 */
const DrawSky = Game.System(
  "Lunigiana/DrawSky",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
      vehicles: Game.Query({
        selection: { vehicle: Game.Query.read(Vehicle), traffic: Game.Query.optional(Traffic) },
      }),
      trains: Game.Query({
        selection: { train: Game.Query.read(Train), run: Game.Query.optional(TrainRun) },
      }),
    },
    resources: {
      time: Game.System.readResource(Time),
      clock: Game.System.readResource(GameClock),
      weather: Game.System.readResource(Weather),
      rivers: Game.System.readResource(Rivers),
    },
    events: { lightning: Game.System.readEvent(Lightning) },
    services: {
      sky: Game.System.service(Sky),
      nodes: Game.System.service(Vehicles),
      trains: Game.System.service(Trains),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, events, services }) => {
    const { sky, nodes } = services,
      alpha = services.clock.alpha,
      { seconds, rate } = resources.clock.get()
    sky.sky(
      seconds + alpha * rate,
      rate,
      resources.weather.get(),
      (resources.time.get().step + alpha) * STEP.dt,
      specificDischarge(resources.rivers.get(), FLOW),
    )
    for (const lightning of events.lightning.all()) sky.strike(lightning)
    const found = queries.player.singleOptional()
    const driving = found.ok ? found.value?.data.driving.value() : undefined
    const driven = driving === undefined ? undefined : Game.Entity.id(driving.vehicle)
    for (const { entity, data } of queries.vehicles.each()) {
      const node = nodes.get(entity.id)
      if (node === undefined) continue
      const on = data.traffic.present || entity.id === driven
      node.setLamps(on)
      if (on)
        sky.car({
          id: entity.id,
          x: node.position.x,
          y: -node.position.z,
          z: node.position.y,
          angle: node.rotation.y,
          driven: entity.id === driven,
        })
    }
    for (const { entity, data } of queries.trains.each()) {
      const node = services.trains.get(entity.id)
      if (node === undefined) continue
      const on = data.run.present || entity.id === driven
      node.setLamps(on)
      if (on) sky.car({ id: entity.id, ...beamOf(node), driven: entity.id === driven })
    }
  },
)

/** How tall a lying person is drawn for the see-through cut's sight lines, m. */
const LYING = 0.5

/**
 * Hands the see-through cut the player as drawn this frame: on foot their figure (standing on its
 * feet, or lying), driving their car (its ground `cg` under the node, its spec's height) or their
 * train (its leading cab at the driver's place, on the rail head, its spec's height), or shuts it
 * when there is no player. After the placing systems, so it follows the nodes where they stand.
 */
const FollowPlayer = Game.System(
  "Lunigiana/FollowPlayer",
  {
    queries: {
      player: Game.Query({ selection: { driving: Game.Query.optional(Driving) }, with: [Player] }),
    },
    resources: { time: Game.System.readResource(Time) },
    services: {
      cut: Game.System.service(Cut),
      people: Game.System.service(People),
      vehicles: Game.System.service(Vehicles),
      trains: Game.System.service(Trains),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, services }) => {
    const now = (resources.time.get().step + services.clock.alpha) * STEP.dt
    const found = queries.player.singleOptional()
    const me = found.ok ? found.value : undefined
    const driving = me?.data.driving.value()
    const train =
      driving === undefined ? undefined : services.trains.get(Game.Entity.id(driving.vehicle))
    if (train !== undefined) {
      const { model } = train,
        cab = train.behindNose(TRAINS[model].door)
      return services.cut.follow(cab.x, cab.z, -cab.y, TRAINS[model].height, now)
    }
    const node =
      driving === undefined
        ? me === undefined
          ? undefined
          : services.people.get(me.entity.id)
        : services.vehicles.get(Game.Entity.id(driving.vehicle))
    if (node === undefined) return services.cut.shut()
    const at = node.position
    if (node instanceof PersonNode)
      services.cut.follow(at.x, at.y, at.z, node.lying ? LYING : node.height, now)
    else {
      const spec = VEHICLES[node.model]
      services.cut.follow(at.x, at.y - spec.cg, at.z, spec.height, now)
    }
  },
)

/** The render schedule, ticked once per animation frame after the fixed updates. */
export const render = Game.Schedule(
  SyncPeople,
  SyncAnimals,
  SyncVehicles,
  SyncTrains,
  MarkDriven,
  PlacePeople,
  PlaceAnimals,
  PlaceVehicles,
  PlaceTrains,
  SpreadPools,
  DrawCrossings,
  DrawEffects,
  DrawSky,
  FollowPlayer,
)
