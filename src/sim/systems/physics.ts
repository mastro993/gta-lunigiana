import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { forwardSpeed, moveCar, wallsAlong } from "../body.ts"
import { overturned, type Rig, rigFor, RIGS } from "../chassis.ts"
import { destroyed, NEW_ENGINE, type Wear } from "../damage.ts"
import { BRAKING, driveForce, shiftGear } from "../drivetrain.ts"
import { type BodyState, type Controls, type Ground, integrate } from "../dynamics.ts"
import { type HandlingValue, REAL_HANDLING } from "../handling.ts"
import { groundZ } from "../map/ground.ts"
import { type Surface, surfaceAt } from "../map/surface.ts"
import {
  CarInput,
  Chassis,
  type ChassisValue,
  Damage,
  Game,
  GameClock,
  Handling,
  Impact,
  Motion,
  Pose,
  type PoseValue,
  Rivers,
  Skid,
  Time,
  Vehicle,
  Weather,
} from "../schema.ts"
import { airAt } from "../sky/climate.ts"
import { DRY, groundAt, type GroundWeather } from "../sky/local.ts"
import { weathered } from "../tyres.ts"
import type { VehicleModel, VehicleSpec } from "../vehicles.ts"
import { FLOW, specificDischarge } from "../water/flow.ts"
import { waterAt } from "../water/rivers.ts"
import { inReach, playerPose } from "./reach.ts"

/** Wall hits: share of the impact speed bounced back, and speed lost per m/s of impact. */
const BOUNCE = 0.2
const IMPACT_LOSS = 0.04
/** Hits slower than this (m/s) are float noise; how loud a real one sounds is the audio host's call. */
const NOISE = 0.05
/** Road-wheel steering speed toward the keys, and back to straight, rad/s. */
const STEER_RATE = 2.5
const CENTRE_RATE = 4
/**
 * At speed the steering lock shrinks to what this lateral acceleration needs, plus some slip: a held
 * key turns at about the tyres' grip (× their grip factor), or just under the speed that tips the
 * vehicle over if that comes first (the Ape, the laden truck). Yanking the wheel can still tip them.
 */
const STEER_GRIP = 0.85 * 9.81
const TIP_MARGIN = 0.6
/** A wheel sliding less than this past its grip leaves no Skid. */
const SKID_FROM = 0.05
/** Resting: slower than this (m/s, rad/s) for two steps, a vehicle with its pedal up settles to exact zero and sleeps. */
const REST = 0.05

/**
 * Where a body of `spec` centred on (x, y) at heading `angle` meets what it moves `into` (a unit
 * vector): the point of its collision capsule (circles of radius W/2 along ±(L/2 − W/2)) furthest
 * along `into`, on the end circle that leads (the front corner of an oblique hit, the side's middle
 * of a square-on side hit).
 */
const contact = (
  spec: VehicleSpec,
  x: number,
  y: number,
  angle: number,
  into: Vec2.Vec2,
): Vec2.Vec2 => {
  const fx = Ops.cos(angle),
    fy = Ops.sin(angle),
    r = spec.width / 2,
    end = Math.sign(into.x * fx + into.y * fy) * (spec.length / 2 - r)
  return { x: x + fx * end + into.x * r, y: y + fy * end + into.y * r }
}

/**
 * The steering lock at `speed`: full lock while slow, then just enough to turn at the tyres' grip (× the handling's steering at speed),
 * `weather` the share of their dry grip the ground leaves them. Wet or snowy ground turns the lock at speed down with the grip: keys
 * steer all or nothing, and a held key on snow (0.3 µ) would otherwise ask the tyres for 0.85 g and slide the car straight on. A
 * design call beyond the weather design, kept on purpose: braking, the handbrake or more speed in a bend still slide the car.
 */
export const steerLimit = (rig: Rig, speed: number, weather = 1): number => {
  const grip = STEER_GRIP * rig.spec.tyres.grip * weather,
    lateral = Math.min(grip, TIP_MARGIN * rig.tipping * 9.81) * rig.steering
  return Math.min(
    rig.lock,
    Ops.atan((rig.wheelbase * lateral) / Math.max(1, speed * speed)) +
      0.6 * rig.spec.tyres.slip * (lateral / grip),
  )
}

/**
 * Whether a vehicle with its pedal up looks settled this step: still for two steps and not gathering speed. `rests` then checks that it
 * stays put.
 */
export const settles = (
  before: { readonly vx: number; readonly vy: number },
  after: { readonly vx: number; readonly vy: number; readonly spin: number },
  chassis: Pick<ChassisValue, "vz" | "pitchRate" | "rollRate">,
): boolean => {
  const now = after.vx * after.vx + after.vy * after.vy,
    then = before.vx * before.vx + before.vy * before.vy
  return (
    now < REST * REST &&
    then < REST * REST &&
    now <= then + (REST * REST) / 4 &&
    Math.abs(after.spin) < REST &&
    Math.abs(chassis.vz) < REST &&
    Math.abs(chassis.pitchRate) < REST &&
    Math.abs(chassis.rollRate) < REST
  )
}

/**
 * A vehicle that has stopped is tried this many steps from exact rest; faster than HELD at the end (m/s; rates 10× it, rad/s), it is
 * not held where it stopped: a slide off a bank at the edge of the tyres' grip builds up over a few steps. A body down on the ground
 * creeps under its sliding friction's cap (by 2·g·sin θ a substep, at most about 0.042 m/s where its 0.6 holds it): no faster than
 * CREEP and no faster than half way through, it is held too.
 */
const TRIAL = 10
const HELD = 0.002
const CREEP = 0.045

/**
 * Whether a vehicle that looks settled (`settles`) really rests where it is: TRIAL steps from exact rest under the same controls leave
 * it still. What its brakes cannot hold (a steep grass bank, a car on its roof on a slope steeper than its sliding friction) starts
 * sliding, and does not sleep at the top of a coast up it.
 */
export const rests = (
  model: VehicleModel,
  at: VehicleState,
  input: Pedals,
  step: number,
  dt: number,
  ground: Ground = groundZ,
  surface: (x: number, y: number, level: number) => Surface = surfaceAt,
  handling: HandlingValue = REAL_HANDLING,
  weather: GroundUnder = () => DRY,
  wear: Wear = NEW_ENGINE,
): boolean => {
  let state: VehicleState = {
    pose: at.pose,
    motion: { vx: 0, vy: 0, spin: 0 },
    chassis: { ...at.chassis, vz: 0, pitchRate: 0, rollRate: 0 },
  }
  let half = 0
  for (let k = 0; k < TRIAL; k++) {
    if (k === TRIAL / 2)
      half = Math.sqrt(state.motion.vx * state.motion.vx + state.motion.vy * state.motion.vy)
    const { body, steer, gearbox } = advance(
      model,
      state,
      input,
      step + k,
      dt,
      ground,
      surface,
      handling,
      weather,
      wear,
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
  }
  const { motion, chassis } = state,
    speed = Math.sqrt(motion.vx * motion.vx + motion.vy * motion.vy)
  return (
    (speed < HELD || (speed < CREEP && speed <= half)) &&
    Math.abs(motion.spin) < 10 * HELD &&
    Math.abs(chassis.vz) < 10 * HELD &&
    Math.abs(chassis.pitchRate) < 10 * HELD &&
    Math.abs(chassis.rollRate) < 10 * HELD
  )
}

/** `from` toward `to` by at most `step`. */
const toward = (from: number, to: number, step: number): number =>
  from < to ? Math.min(to, from + step) : Math.max(to, from - step)

/** A vehicle's state as the physics reads and writes it. */
interface VehicleState {
  readonly pose: PoseValue
  readonly motion: { readonly vx: number; readonly vy: number; readonly spin: number }
  readonly chassis: ChassisValue
}
/** How wet and snow-covered the ground is at (x, y), `level` m a.s.l. */
type GroundUnder = (x: number, y: number, level: number) => GroundWeather
/** A driver's controls: throttle and steer in [-1, 1], the handbrake. */
interface Pedals {
  readonly throttle: number
  readonly steer: number
  readonly handbrake: boolean
}

/**
 * One step of a vehicle of `model` driven with `input`, before the walls: the steering turns toward
 * the keys within the lock for its speed and the grip the weather leaves, the gearbox picks a gear,
 * the engine worn by `wear` drives through it (unless the `water` it stands in is over its intake:
 * it stalls), the throttle against the motion is the brake pedal, and the body moves on its springs
 * and tyres over `ground` (`surface` under each wheel, as wet and snowy as `weather` says), buoyed
 * and dragged by the water; a destroyed one never rights itself. Returns the moved body, the new
 * steering angle and gearbox, what the tyres and body did, and the surfaces and their weather.
 */
export const advance = (
  model: VehicleModel,
  { pose, motion, chassis }: VehicleState,
  input: Pedals,
  step: number,
  dt: number,
  ground: Ground = groundZ,
  surface: (x: number, y: number, level: number) => Surface = surfaceAt,
  handling: HandlingValue = REAL_HANDLING,
  weather: GroundUnder = () => DRY,
  wear: Wear = NEW_ENGINE,
  water?: Controls["water"],
) => {
  // A wreck, burning or a charred shell, does not right itself: it stays where it lies.
  const rig = rigFor(
      model,
      destroyed(wear.damage) && handling.selfRighting === 1
        ? { ...handling, selfRighting: 0 }
        : handling,
    ),
    spec = rig.spec
  const speed = forwardSpeed(motion, pose.angle)
  const gearbox = shiftGear(spec, chassis, speed, input.throttle, step)
  // The throttle against the motion is the brake pedal; standing with no pedal, the driver keeps a foot on the brake.
  const braking =
    (input.throttle < 0 && speed > BRAKING) ||
    (input.throttle > 0 && speed < -BRAKING) ||
    (input.throttle === 0 && Math.abs(speed) < BRAKING)
  const c = Ops.cos(pose.angle),
    s = Ops.sin(pose.angle)
  const level = chassis.z - spec.cg
  const contacts = rig.wheels.map((w) => ({
    x: pose.x + w.at.f * c - w.at.l * s,
    y: pose.y + w.at.f * s + w.at.l * c,
  }))
  const surfaces = contacts.map((p) => surface(p.x, p.y, level)),
    grounds = contacts.map((p) => weather(p.x, p.y, level))
  // The share of their dry grip the wheels have left, on average: the steering's lock at speed follows it.
  const left =
    grounds.reduce((sum, g, i) => {
      const grip = rig.grips[surfaces[i]!]
      return sum + weathered(grip, g, rig.weatherGrip).mu / grip.dry.mu
    }, 0) / grounds.length
  const target = input.steer * steerLimit(rig, Math.abs(speed), left)
  const steer = toward(
    chassis.steer,
    target,
    (Math.abs(target) < Math.abs(chassis.steer) ? CENTRE_RATE : STEER_RATE) * rig.steeringRate * dt,
  )
  const body: BodyState = { ...pose, ...motion, ...chassis }
  const result = integrate(
    rig,
    body,
    {
      steer,
      drive: stalled(spec, chassis, water)
        ? 0
        : driveForce(spec, gearbox, speed, input.throttle, step, wear),
      brake: braking ? Math.abs(input.throttle) || 1 : 0,
      handbrake: input.handbrake,
      surfaces,
      weather: grounds,
      ...(water === undefined ? {} : { water }),
    },
    dt,
    ground,
  )
  return { body, steer, gearbox, result, surfaces, grounds }
}

/** Whether `water` stands over the engine's air intake of a vehicle of `spec` riding at `chassis`: the engine stalls. */
export const stalled = (
  spec: VehicleSpec,
  chassis: Pick<ChassisValue, "z">,
  water: Controls["water"],
): boolean => water !== undefined && water.level > chassis.z - spec.cg + spec.intake

/** The river a vehicle of `spec` at (x, y) riding at `chassis` stands in at `q` m³/s per km², if any: its level and current. */
const waterAround = (
  spec: VehicleSpec,
  x: number,
  y: number,
  chassis: Pick<ChassisValue, "z">,
  q: number,
): Controls["water"] => {
  const here = waterAt(x, y, chassis.z - spec.cg, q)
  return here === undefined ? undefined : { level: here.level, vx: here.vx, vy: here.vy }
}

/**
 * The drive physics of every vehicle, from its CarInput and its model's data: the steering turns
 * toward the keys at a rate and within a lock that shrinks with speed; the automatic gearbox picks
 * the gear and the engine's torque, worn by the vehicle's Damage, reaches the driven wheels through
 * it; the throttle against the motion is the brake pedal and the handbrake locks the rear wheels;
 * then the body moves on its springs and tyres (`integrate`), and its planar move is swept against
 * the drive walls: a hit keeps the sliding part, bounces a little and costs speed by how hard it
 * was. Wall and ground hits are Impact events, sliding tyres Skid events. A vehicle at rest with
 * its pedal up sleeps until something moves it, unless it stands in a river, which buoys it, drags
 * it with its current and stalls its engine once over the air intake. One beyond the player's reach stands frozen (`inReach`).
 */
export const VehiclePhysics = Game.System(
  "Lunigiana/VehiclePhysics",
  {
    queries: {
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          chassis: Game.Query.write(Chassis),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.read(CarInput),
          damage: Game.Query.read(Damage),
        },
      }),
      player: playerPose(),
    },
    resources: {
      time: Game.System.thisTick(Game.System.readResource(Time)),
      handling: Game.System.readResource(Handling),
      weather: Game.System.readResource(Weather),
      clock: Game.System.readResource(GameClock),
      rivers: Game.System.readResource(Rivers),
    },
    events: { impact: Game.System.writeEvent(Impact), skid: Game.System.writeEvent(Skid) },
  },
  ({ queries, resources, events }) => {
    const { dt, step } = resources.time.get(),
      handling = resources.handling.get(),
      weather = resources.weather.get()
    if (dt <= 0) return
    const air = airAt(resources.clock.get().seconds, weather),
      under = (x: number, y: number, level: number) => groundAt(weather, x, y, level, air),
      q = specificDischarge(resources.rivers.get(), FLOW),
      player = queries.player.each()[0]?.data.pose.get()
    for (const { entity, data } of queries.vehicles.each()) {
      const pose = data.pose.get()
      // Frozen beyond the player's reach, where the host keeps no map: it costs nothing and reads nothing.
      if (!inReach(pose, player)) continue
      const { model } = data.vehicle.get()
      const spec = RIGS[model].spec
      const input = data.input.get()
      const motion = data.motion.get()
      const chassis = data.chassis.get()
      // Asleep: a vehicle its brakes hold at rest, that nobody drives off or touched, costs nothing; one lying overturned wakes to
      // right itself when the handling's self-righting is on, unless it is a wreck.
      const wear = { damage: data.damage.get().amount, seed: entity.id }
      const still =
        motion.vx === 0 &&
        motion.vy === 0 &&
        motion.spin === 0 &&
        chassis.vz === 0 &&
        chassis.pitchRate === 0 &&
        chassis.rollRate === 0
      // In a river nothing sleeps: the current and the water's rise move it.
      const water = waterAround(spec, pose.x, pose.y, chassis, q)
      if (
        input.throttle === 0 &&
        still &&
        water === undefined &&
        !(handling.selfRighting === 1 && overturned(chassis) && !destroyed(wear.damage))
      )
        continue

      const { body, steer, gearbox, result, surfaces, grounds } = advance(
        model,
        { pose, motion, chassis },
        input,
        step,
        dt,
        groundZ,
        surfaceAt,
        handling,
        under,
        wear,
        water,
      )

      // The planar move against the walls. A turn that wedges the body into a wall is undone; if moving at all does, the car stays put.
      let vx = body.vx,
        vy = body.vy
      const delta = { x: body.x - pose.x, y: body.y - pose.y }
      const walls = wallsAlong("drive", pose.x, pose.y, delta.x, delta.y, spec.length / 2 + 0.5)
      const turned = moveCar(model, pose, body.angle, delta, walls)
      const moved = turned ?? moveCar(model, pose, pose.angle, delta, walls)
      // An undone turn keeps the heading, plus the half turn if the body's angles folded past vertical this step.
      const angle = turned === undefined ? pose.angle + (result.folded ? Math.PI : 0) : body.angle
      let spin = turned === undefined ? 0 : body.spin,
        at: Vec2.Vec2 = pose
      if (moved === undefined) {
        const hit = Math.sqrt(vx * vx + vy * vy)
        if (hit > NOISE) {
          const point = contact(spec, pose.x, pose.y, pose.angle, { x: vx / hit, y: vy / hit })
          events.impact.emit({
            hit: "wall",
            x: point.x,
            y: point.y,
            speed: hit,
            mass: spec.mass / 1000,
            car: entity.id,
          })
        }
        vx = 0
        vy = 0
        spin = 0
      } else {
        at = moved.position
        if (moved.blocked) {
          const real = Vec2.scale(Vec2.subtract(moved.position, pose), 1 / dt)
          const lost = Vec2.subtract({ x: vx, y: vy }, real)
          const impact = Vec2.length(lost)
          const into = Vec2.normalizeOr(lost, Vec2.zero)
          if (impact > NOISE) {
            const point = contact(spec, moved.position.x, moved.position.y, angle, into)
            // How hard it hit: the velocity into the wall at contact. The speed lost this step is less by what the step
            // travelled before contact, and the rest is lost next step: one hit would read as two softer ones.
            // Never faster than the car was going: a push-out of the body counts in what was lost, not in how hard it hit.
            const hard = Math.min(
              Math.sqrt(vx * vx + vy * vy),
              Math.max(impact, vx * into.x + vy * into.y),
            )
            events.impact.emit({
              hit: "wall",
              x: point.x,
              y: point.y,
              speed: hard,
              mass: spec.mass / 1000,
              car: entity.id,
            })
          }
          const keep = Math.max(0.2, 1 - IMPACT_LOSS * impact)
          // Never faster than before the hit (push-outs from a rotation can add speed).
          const slide = Vec2.clampLength(
            Vec2.scale(real, keep),
            Math.sqrt(vx * vx + vy * vy) * keep,
          )
          vx = slide.x - into.x * impact * BOUNCE
          vy = slide.y - into.y * impact * BOUNCE
          spin *= keep
        }
      }

      if (result.hit !== undefined) {
        events.impact.emit({
          hit: "ground",
          x: result.hit.x,
          y: result.hit.y,
          speed: result.hit.speed,
          mass: spec.mass / 1000,
          car: entity.id,
          face: result.hit.face,
        })
      }
      result.skids.forEach((skid, wheel) => {
        if (skid.amount >= SKID_FROM) {
          events.skid.emit({
            car: entity.id,
            wheel,
            x: skid.x,
            y: skid.y,
            z: skid.z,
            slip: skid.slip,
            amount: skid.amount,
            surface: surfaces[wheel]!,
            snow: grounds[wheel]!.snow,
            step,
          })
        }
      })

      data.pose.set({ x: at.x, y: at.y, angle })
      const next = { ...body, steer, ...gearbox }
      if (
        input.throttle === 0 &&
        water === undefined &&
        settles(motion, { vx, vy, spin }, next) &&
        rests(
          model,
          { pose: { x: at.x, y: at.y, angle }, motion, chassis: next },
          input,
          step,
          dt,
          groundZ,
          surfaceAt,
          handling,
          under,
          wear,
        )
      ) {
        data.motion.set({ vx: 0, vy: 0, spin: 0 })
        data.chassis.set({
          z: next.z,
          vz: 0,
          pitch: next.pitch,
          pitchRate: 0,
          roll: next.roll,
          rollRate: 0,
          steer: next.steer,
          gear: next.gear,
          shiftUntil: next.shiftUntil,
        })
      } else {
        data.motion.set({ vx, vy, spin })
        data.chassis.set({
          z: next.z,
          vz: next.vz,
          pitch: next.pitch,
          pitchRate: next.pitchRate,
          roll: next.roll,
          rollRate: next.rollRate,
          steer: next.steer,
          gear: next.gear,
          shiftUntil: next.shiftUntil,
        })
      }
    }
  },
)
