/**
 * Trains as drawn: one node per `Train`, a group of car bodies, each placed on its own pose from the
 * sim's `carsOf` at the train's s blended between the last two steps (never the cars' poses, so at
 * every alpha each car stays on the rails and neighbours meet at their Jacobs bogie), on the rail
 * head at grade, in cuttings and on decks alike. Each model's cars come from its livery (the ATR 220
 * in DPR livery, render/atr220): a cab car at each end, the trailing one the leading one turned
 * about, and middle cars between, each facing local +X (the train's front, its active cab), standing
 * on y = 0 at the rail head and centred on its middle. Bodies and lamps are built once per model and
 * car and never freed. The leading cab's head lamps and the trailing cab's tail lamps are on the
 * signal lamp program, which shines by day as well; every car's windows light at night. The driven train shows an x-ray box per car,
 * trimmed and open at the joints, so neighbouring boxes never cut into each other or show through
 * the next car.
 *
 * @module render/train
 */
import { Descriptor } from "@typeonce/ritmo"
import { type NodeRegistry, RenderSync } from "@typeonce/ritmo-render"
import { BufferGeometry, Float32BufferAttribute, Group, type Material, Mesh } from "three"

import { Game, Train, TrainMotion, type TrainMotionValue } from "../sim/index.ts"
import { type CarPose, carsOf } from "../sim/rail/consist.ts"
import { type Line, LINES } from "../sim/rail/lines.ts"
import { TRAINS, type TrainModel } from "../sim/rail/models.ts"
import { ActorNode, xray } from "./actors.ts"
import { ATR220 } from "./atr220.ts"
import { RenderClock } from "./clock.ts"
import { actorMaterial, sharedGeometry } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { cabinLightMaterial, signalLampMaterials } from "./sky/glow.ts"

/**
 * How a model's cars are built: a cab car (its cab at +X) and a middle car, each from its length; a cab's head or tail lamps; and
 * the head lamps' height over the rail head, where its beam shines from.
 */
interface Livery {
  readonly cab: (length: number) => Array<BufferGeometry>
  readonly middle: (length: number) => Array<BufferGeometry>
  readonly windows: (length: number, cab: boolean) => Array<BufferGeometry>
  readonly lamps: (length: number, end: "head" | "tail") => Array<BufferGeometry>
  readonly headLamps: number
}
/** Every train model's cars as drawn. */
const LIVERIES = { atr220: ATR220 } as const satisfies Record<TrainModel, Livery>
/** An x-ray box stops this far short of a car's Jacobs joint, m: neighbouring cars' boxes never cut into each other, even on a curve. */
const JOINT_TRIM = 0.3

/** One car of a train: its body, its lit windows, and on a cab car its head and tail lamps (children of the body, which a trailing cab car turns about). */
class TrainCar extends ActorNode {
  readonly lamps: { readonly head: Mesh; readonly tail: Mesh } | undefined
  /** How far its x-ray box stops short of its front end (toward the train's front) and its rear one, m: a joint's is trimmed. */
  private readonly trim: readonly [front: number, rear: number]
  constructor(model: TrainModel, k: number, material: Material) {
    const { cars } = TRAINS[model],
      length = cars[k]!,
      livery = LIVERIES[model]
    const cab = k === 0 || k === cars.length - 1
    super(
      sharedGeometry(`${model}:${cab ? "cab" : "middle"}:${length}`, () =>
        cab ? livery.cab(length) : livery.middle(length),
      ),
      material,
    )
    if (cab && k > 0) this.body.rotation.y = Math.PI
    this.body.add(
      new Mesh(
        sharedGeometry(`${model}:windows:${cab ? "cab" : "middle"}:${length}`, () =>
          livery.windows(length, cab),
        ),
        cabinLightMaterial,
      ),
    )
    const lamp = (end: "head" | "tail") =>
      new Mesh(
        sharedGeometry(`${model}:${end}:${length}`, () => livery.lamps(length, end)),
        signalLampMaterials.off,
      )
    this.lamps = cab ? { head: lamp("head"), tail: lamp("tail") } : undefined
    if (this.lamps !== undefined) this.body.add(this.lamps.head, this.lamps.tail)
    this.trim = [k > 0 ? JOINT_TRIM : 0, k < cars.length - 1 ? JOINT_TRIM : 0]
  }

  /**
   * Builds its x-ray box: round its body as it is turned in the car, trimmed at its joints and open there. Seen along the train,
   * the next car's body stands in front of a joint's end face, which would show as a yellow block at every joint.
   */
  protected override proxy(_key: string): Mesh {
    const { geometry } = this.body
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!,
      turned = this.body.rotation.y !== 0
    const [x0, x1] = turned ? [-max.x, -min.x] : [min.x, max.x]
    const corners = new BufferGeometry().setAttribute(
      "position",
      new Float32BufferAttribute(
        [x0 + this.trim[1], min.y, min.z, x1 - this.trim[0], max.y, max.z],
        3,
      ),
    )
    const proxy = xray([corners])
    corners.dispose()
    // A box's faces in three's order: +X (front), −X (rear), then ±Y and ±Z, two triangles (six indices) each.
    const index = proxy.geometry.getIndex()!,
      kept = Array.from(index.array).filter(
        (_, i) => !(i < 6 && this.trim[0] > 0) && !(i >= 6 && i < 12 && this.trim[1] > 0),
      )
    proxy.geometry.setIndex(kept)
    proxy.geometry.clearGroups()
    return proxy
  }
}

/** A train as drawn: its cars from the active cab back, each placed on its own pose (`place`). */
export class TrainNode extends Group {
  readonly model: TrainModel
  readonly cars: ReadonlyArray<TrainCar>
  constructor(model: TrainModel, material: Material) {
    super()
    this.model = model
    this.cars = TRAINS[model].cars.map((_, k) => new TrainCar(model, k, material))
    this.add(...this.cars)
  }

  /** Puts each car on its pose (`carsOf`: from the active cab back): its middle on the rail head, heading, then pitch. */
  place(poses: ReadonlyArray<CarPose>): void {
    for (const [k, car] of this.cars.entries()) {
      const pose = poses[k]
      if (pose === undefined) continue
      car.position.set(pose.x, yOf(pose.z), -pose.y)
      car.rotation.set(0, pose.angle, pose.pitch)
    }
  }

  /** Lamps on (an AI train, the player's): the leading cab's head lamps and the trailing cab's tail lamps shine; off, every lamp is dark. */
  setLamps(on: boolean): void {
    const last = this.cars.length - 1,
      { on: lit, off } = signalLampMaterials
    for (const [k, car] of this.cars.entries()) {
      if (car.lamps === undefined) continue
      car.lamps.head.material = on && k === 0 ? lit : off
      car.lamps.tail.material = on && k === last ? lit : off
    }
  }

  /** Shows every car's x-ray box (`on`) or hides them. */
  showXray(on: boolean): void {
    for (const car of this.cars) car.showXray(on)
  }

  /** The point `back` m behind the leading nose on the lead car's axis as placed (its heading, then its pitch): map x and y, the rail head's render y there, and the heading. */
  behindNose(back: number): {
    readonly x: number
    readonly y: number
    readonly z: number
    readonly angle: number
  } {
    const lead = this.cars[0]!,
      { y: angle, z: pitch } = lead.rotation,
      ahead = TRAINS[this.model].cars[0] / 2 - back,
      flat = Math.cos(pitch) * ahead
    return {
      x: lead.position.x + Math.cos(angle) * flat,
      y: -lead.position.z + Math.sin(angle) * flat,
      z: lead.position.y + Math.sin(pitch) * ahead,
      angle,
    }
  }

  /** Frees the train's own geometry: its cars' x-ray boxes (the bodies and lamps are shared per model). */
  dispose(): void {
    for (const car of this.cars) car.dispose()
  }
}

/**
 * Where the sky host's headlight beam starts for a train with its lamps on, `LitCar` style: `HEAD.ahead` (2 m) behind the
 * leading nose, so the spot stands at the nose, and `HEAD.rise` (0.25 m) under the head lamps (sky/night-lights.ts).
 */
export const beamOf = (node: TrainNode) => {
  const at = node.behindNose(2)
  return { x: at.x, y: at.y, z: at.z + LIVERIES[node.model].headLamps - 0.25, angle: at.angle }
}

/** A train's cars `alpha` of the way through the last step: its s blended `prev` → `s`, then the cars placed on the track from it. */
export const trainCars = (
  line: Line,
  motion: TrainMotionValue,
  model: TrainModel,
  alpha: number,
): ReadonlyArray<CarPose> =>
  carsOf(line, motion.prev + (motion.s - motion.prev) * alpha, motion.facing, model)

/** Train nodes, one per entity with a Train. */
export const Trains =
  Descriptor.Service<NodeRegistry.NodeRegistry<TrainNode>>()("Lunigiana/TrainNodes")

/** Keeps one node per train. Nothing about a train changes its look: `PlaceTrains` moves it, `DrawSky` lights it, `MarkDriven` shows its x-ray. */
export const SyncTrains = RenderSync.system(Game, {
  name: "Lunigiana/SyncTrains",
  renderable: Train,
  registry: Trains,
  create: ({ renderable }) => new TrainNode(renderable.model, actorMaterial),
  apply: () => undefined,
})

/** Puts every train's cars where they are `alpha` of the way through the last step (`trainCars`). */
export const PlaceTrains = Game.System(
  "Lunigiana/PlaceTrains",
  {
    queries: {
      trains: Game.Query({
        selection: { train: Game.Query.read(Train), motion: Game.Query.read(TrainMotion) },
      }),
    },
    services: { nodes: Game.System.service(Trains), clock: Game.System.service(RenderClock) },
  },
  ({ queries, services }) => {
    for (const { entity, data } of queries.trains.each()) {
      const node = services.nodes.get(entity.id),
        motion = data.motion.get(),
        line = LINES[motion.line]
      if (node !== undefined && line !== undefined)
        node.place(trainCars(line, motion, node.model, services.clock.alpha))
    }
  },
)
