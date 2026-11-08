/**
 * One step of a vehicle's rigid body, in substeps: each wheel's spring and damper against the
 * ground under it (so the body rides bumps, pitches when braking, rolls in a corner, leaves the
 * ground over a crest and lands), each tyre's force from its load and slip, gravity along the
 * slope, air drag, a river's buoyancy and drag on the underbody, and the body's corners against the
 * ground once it touches down on its side or roof. Forces and torques are summed in the heading frame (forward, left, up) about the centre of
 * mass; velocities update before positions (semi-implicit Euler). Walls are not here: the physics
 * system sweeps the body's planar move against them afterwards.
 *
 * @module dynamics
 */
import { Ops } from "@typeonce/ritmo-math"

import { righting, steadying } from "./assists.ts"
import {
  fitPlane,
  GRAVITY,
  type Offset,
  type Rig,
  tiltOf,
  turn,
  WHEELS_DOWN,
  wheelsAt,
} from "./chassis.ts"
import { groundZ } from "./map/ground.ts"
import type { Surface } from "./map/surface.ts"
import { DRY, type GroundWeather } from "./sky/local.ts"
import { loaded, tyreForce, weathered } from "./tyres.ts"

/** Substeps per simulation step: 240 Hz keeps the stiff tyre and contact forces stable. */
const SUBSTEPS = 4
/** Suspension travel past the static compression before the bump stop, m, the bump stop's stiffness × the spring's, and the most a wheel carries (× its static load). */
const TRAVEL = 0.1
const BUMP = 8
const MOST = 5
/** The damper sees at most this compression speed, m/s: the tyre's own give takes the edge off a kerb. */
const DAMPED = 2
/** The body's corners on the ground: natural frequency of the whole body on four of them (Hz), damping ratio, sliding friction. */
const HULL_HZ = 3
const HULL_DAMPING = 0.5
const HULL_FRICTION = 0.6
/** Air density, kg/m³. */
const AIR = 1.2
/** Water's density, kg/m³. */
const WATER = 1000
/**
 * The share of the body box under the water that buoys it: the air its cabin and doors hold. WRL Technical Report 2017/07 (UNSW
 * Water Research Laboratory) floated a 1.0 t Toyota Yaris in 0.6 m of still water and a 2.4 t Nissan Patrol in 0.95 m. Its wheels
 * come off the ground once the body has risen by its springs' sag (about 0.1 m), so half the box over the floor then floats both:
 * the Yaris's 0.3 m of a 3.9 × 1.7 m box (1.0 t), the Patrol's 0.55 m of 4.97 × 1.94 m (2.65 t).
 */
const SEALED = 0.5
/** Drag coefficient of a car's body in a current, side-on or end-on (a bluff box). */
const HULL_DRAG = 1.1
/** Drag coefficient of a tyre ploughing water, end-on and side-on (estimate: a bluff body's). */
const TYRE_DRAG = 1
/** In the air, the air slows the body's tumbling: pitch and roll rates lose this share per second (a game's mercy: most jumps land on the wheels). */
const AIR_SPIN = 1.5
/**
 * Half the span, m, over which a touching body corner measures the ground's slope; a sample this much off its ground (m) is past a
 * step, so slopes up to 300% read as slopes.
 */
const SLOPE_STEP = 0.1
const STEP_REACH = 0.3
/** Faster than this into the ground (m/s) a landing or a body corner is a hit. */
const HIT_FROM = 1.5

/** A vehicle's whole motion, written in place by `integrate`. */
export interface BodyState {
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  spin: number
  z: number
  vz: number
  pitch: number
  pitchRate: number
  roll: number
  rollRate: number
}

/** What the driver and the engine do this step. */
export interface Controls {
  /** Road wheels' steering angle, rad (left +). */
  readonly steer: number
  /** Engine force at the road over all driven wheels, N (+ forward). */
  readonly drive: number
  /** Brake pedal, 0…1. */
  readonly brake: number
  /** The handbrake locks the wheels that do not steer. */
  readonly handbrake: boolean
  /** The surface under each wheel, and how wet and snow-covered it is there. */
  readonly surfaces: ReadonlyArray<Surface>
  readonly weather: ReadonlyArray<GroundWeather>
  /** The river the vehicle stands in, if any: its surface (m a.s.l.) and current (m/s, world frame). */
  readonly water?: { readonly level: number; readonly vx: number; readonly vy: number }
}

/** The hardest a wheel slid this step, where. */
interface WheelSkid {
  amount: number
  slip: number
  x: number
  y: number
  z: number
}

/** The hardest the body struck the ground this step: speed into it (m/s), where, with which face. */
interface GroundHit {
  readonly speed: number
  readonly x: number
  readonly y: number
  readonly face: "under" | "roof" | "side" | "front" | "rear"
}

/** What the body did this step besides moving: each wheel's skid, the hardest hit on the ground, how many wheels touched, and whether its angles folded past vertical (the heading turned by π). */
export interface StepResult {
  readonly skids: ReadonlyArray<WheelSkid>
  readonly hit: GroundHit | undefined
  readonly grounded: number
  readonly folded: boolean
}

const clampTo = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/** Which face struck the ground: corner `index` (0–3 underbody, 4–7 roof) of a body tilted to `up`, pitched `pitch`. */
const faceOf = (index: number, corner: Offset, up: number, pitch: number): GroundHit["face"] =>
  up < -WHEELS_DOWN
    ? "roof"
    : up < WHEELS_DOWN || index >= 4
      ? "side"
      : Math.abs(pitch) > 0.5
        ? corner.f > 0
          ? "front"
          : "rear"
        : "under"

/** Elevation of the ground at (x, y) nearest `near` (m a.s.l.): the map's (`groundZ`), or a test's. */
export type Ground = (x: number, y: number, near?: number) => number

/** Advances `body` by `dt` seconds under `controls` on `ground`. */
export const integrate = (
  rig: Rig,
  body: BodyState,
  controls: Controls,
  dt: number,
  ground: Ground = groundZ,
): StepResult => {
  const h = dt / SUBSTEPS,
    spec = rig.spec,
    m = spec.mass
  const driven = rig.wheels.filter((w) => w.driven).length
  const skids = rig.wheels.map((): WheelSkid => ({ amount: 0, slip: 0, x: 0, y: 0, z: 0 }))
  const before = rig.wheels.map(() => 0)
  const hullK = (m * (2 * Math.PI * HULL_HZ) ** 2) / 4,
    hullD = 2 * HULL_DAMPING * Math.sqrt((hullK * m) / 4)
  const steer = { c: Ops.cos(controls.steer), s: Ops.sin(controls.steer) }
  const grips = rig.wheels.map((_, i) =>
    weathered(
      rig.grips[controls.surfaces[i] ?? "asphalt"],
      controls.weather[i] ?? DRY,
      rig.weatherGrip,
    ),
  )
  let hit: GroundHit | undefined,
    grounded = 0
  for (let k = 0; k < SUBSTEPS; k++) {
    const c = Ops.cos(body.angle),
      s = Ops.sin(body.angle)
    const tilt = tiltOf(body.pitch, body.roll),
      up = tilt.cp * tilt.cr
    const vf = body.vx * c + body.vy * s,
      vl = -body.vx * s + body.vy * c
    const p = body.rollRate,
      q = body.pitchRate,
      r = body.spin
    let ff = 0,
      fl = 0,
      fu = -m * GRAVITY,
      tf = 0,
      tl = 0,
      tu = 0
    const apply = (o: Offset, Ff: number, Fl: number, Fu: number) => {
      ff += Ff
      fl += Fl
      fu += Fu
      tf += o.l * Fu - o.u * Fl
      tl += o.u * Ff - o.f * Fu
      tu += o.f * Fl - o.l * Ff
    }
    /** Horizontal velocity of the body point at offset `o`, heading frame. */
    const along = (o: Offset) => ({ f: vf - q * o.u - r * o.l, l: vl + r * o.f - p * o.u })
    const toWorld = (o: Offset) => ({
      x: body.x + o.f * c - o.l * s,
      y: body.y + o.f * s + o.l * c,
    })

    // Suspension: each wheel's spring and damper against the ground under it.
    const offsets = rig.wheels.map((w) => turn(w.at, tilt))
    const grounds = offsets.map((o, i) => {
      const at = toWorld(o),
        height = body.z + o.u
      if (k === 0) {
        // Where the wheel was a substep ago, for the ground's rate under it.
        const v = along(o)
        before[i] = ground(at.x - (v.f * c - v.l * s) * h, at.y - (v.f * s + v.l * c) * h, height)
      }
      return ground(at.x, at.y, height)
    })
    // The ground's slope under the wheels: the springs push along its normal, so gravity pulls the car downhill.
    const plane = fitPlane(offsets, grounds)
    const loads: Array<number> = rig.wheels.map((w, i) => {
      const o = offsets[i]!,
        g = grounds[i]!,
        rate = (g - before[i]!) / h
      before[i] = g
      const compression = rig.sag + g - (body.z + o.u)
      if (up <= WHEELS_DOWN || compression <= 0) return 0
      const falling = -(body.vz + p * o.l + q * o.f)
      let load = w.spring * compression + w.damper * clampTo(rate + falling, DAMPED)
      const over = compression - rig.sag - TRAVEL
      if (over > 0) {
        load += BUMP * w.spring * over
        // A landing: the body coming down onto the bump stop faster than the slope under it falls away (a kerb under a rolling wheel is not one).
        const v = along(o),
          closing = falling + v.f * plane.gf + v.l * plane.gl
        if (closing > HIT_FROM && (hit === undefined || closing > hit.speed))
          hit = { speed: closing, ...toWorld(o), face: faceOf(0, w.at, up, body.pitch) }
      }
      return Math.min(MOST * w.load, Math.max(0, load))
    })
    // Anti-roll bars: a wheel compressed more than the other on its axle takes load from it.
    const twist = rig.wheels.map((w, i) => {
      const j = rig.partner[i]!
      if (j < 0 || loads[i]! <= 0 || loads[j]! <= 0) return 0
      const o = offsets[i]!,
        other = offsets[j]!
      return w.antiRoll * (grounds[i]! - (body.z + o.u) - (grounds[j]! - (body.z + other.u)))
    })
    twist.forEach((t, i) => (loads[i] = Math.max(0, loads[i]! + t)))
    const norm = Math.sqrt(1 + plane.gf * plane.gf + plane.gl * plane.gl),
      nf = -plane.gf / norm,
      nl = -plane.gl / norm,
      nu = 1 / norm
    let touching = 0
    rig.wheels.forEach((w, i) => {
      const load = loads[i]!,
        o = offsets[i]!
      if (load <= 0) return
      touching++
      const ds = w.steered ? steer.s : 0,
        dc = w.steered ? steer.c : 1
      const v = along(o),
        vx = v.f * dc + v.l * ds,
        vy = -v.f * ds + v.l * dc
      const sx = load * (nf * dc + nl * ds),
        sy = load * (-nf * ds + nl * dc)
      // The tyre's force tilts the body over a lever cut by the handling's weight transfer.
      const lever = { ...o, u: o.u * rig.transfer }
      // The patch's own share of the mass, less what a push there spends tilting the body over it (or static friction overshoots).
      const share = w.load / GRAVITY,
        alongMass = share / (1 + (m * lever.u * lever.u) / rig.iy),
        sideMass = share / (1 + (m * lever.u * lever.u) / rig.ix)
      const grip = grips[i]!
      const out = tyreForce({
        load,
        mu: loaded(grip.mu * spec.tyres.grip, load, w.load),
        slide: grip.slide,
        roll: grip.roll,
        peak: spec.tyres.slip,
        vx,
        vy,
        drive: w.driven ? controls.drive / driven : 0,
        brake: controls.brake * spec.brakes.decel * m * w.brake,
        locked: controls.handbrake && !w.steered,
        abs: spec.brakes.abs,
        traction: spec.traction,
        holdX: (-alongMass * vx) / h - sx,
        holdY: (-sideMass * vy) / h - sy,
      })
      apply(
        lever,
        out.fx * dc - out.fy * ds + load * nf,
        out.fx * ds + out.fy * dc + load * nl,
        load * nu,
      )
      const skid = skids[i]!
      if (out.amount > skid.amount)
        Object.assign(skid, { amount: out.amount, slip: out.slip, ...toWorld(o), z: grounds[i]! })
    })
    grounded = Math.max(grounded, touching)

    // The body's corners, once it is down on its belly, side or roof: pushed out along the ground's normal, sliding in its plane. Each looks
    // its ground up at the level the car stands on, so a tunnel's floor or a deck under the car wins over the hillside or deck above it.
    let resting = false
    const level = wheelsAt(spec, body)
    rig.corners.forEach((corner, index) => {
      const o = turn(corner, tilt),
        at = toWorld(o),
        height = body.z + o.u
      const here = ground(at.x, at.y, level),
        depth = here - height
      if (depth <= 0) return
      resting = true
      // The slope of the surface the corner is on: a sample past a step (a deck's edge, a kerb) is another surface, not a slope. Both
      // samples that far off are a face steeper than the reach, not an edge.
      const slope = (dx: number, dy: number) => {
        const ahead = ground(at.x + dx * SLOPE_STEP, at.y + dy * SLOPE_STEP, level),
          behind = ground(at.x - dx * SLOPE_STEP, at.y - dy * SLOPE_STEP, level)
        const a = Math.abs(ahead - here) <= STEP_REACH,
          b = Math.abs(behind - here) <= STEP_REACH
        return a === b
          ? (ahead - behind) / (2 * SLOPE_STEP)
          : a
            ? (ahead - here) / SLOPE_STEP
            : (here - behind) / SLOPE_STEP
      }
      const gf = slope(c, s),
        gl = slope(-s, c)
      const norm = Math.sqrt(1 + gf * gf + gl * gl),
        n = { f: -gf / norm, l: -gl / norm, u: 1 / norm }
      const v = along(o),
        vu = body.vz + p * o.l + q * o.f,
        into = v.f * n.f + v.l * n.l + vu * n.u
      const normal = Math.max(0, hullK * depth * n.u - hullD * into)
      // The sliding velocity, in the ground's plane.
      const tf = v.f - into * n.f,
        tl = v.l - into * n.l,
        tu = vu - into * n.u,
        speed = Math.sqrt(tf * tf + tl * tl + tu * tu)
      const friction =
        speed > 1e-6 ? Math.min(HULL_FRICTION * normal, (m / 8) * (speed / h)) / speed : 0
      apply(
        o,
        normal * n.f - friction * tf,
        normal * n.l - friction * tl,
        normal * n.u - friction * tu,
      )
      if (-into > HIT_FROM && (hit === undefined || -into > hit.speed))
        hit = { speed: -into, ...at, face: faceOf(index, corner, up, body.pitch) }
    })

    // In a river: each quarter of the underbody buoyed by the water over it, dragged toward the current through the side and end it
    // shows the water, and slowed as it rises or sinks through it; each wheel ploughing the water over its ground.
    const water = controls.water
    if (water !== undefined) {
      const wf = water.vx * c + water.vy * s,
        wl = -water.vx * s + water.vy * c,
        deepest = spec.height - spec.clearance
      for (let index = 0; index < 4; index++) {
        const o = turn(rig.corners[index]!, tilt),
          under = Math.min(deepest, Math.max(0, water.level - (body.z + o.u)))
        if (under <= 0) continue
        const v = along(o),
          vu = body.vz + p * o.l + q * o.f,
          rf = wf - v.f,
          rl = wl - v.l,
          drag = 0.5 * WATER * HULL_DRAG * under
        apply(
          { ...o, u: o.u + under / 2 },
          // Each quarter shows a quarter of the body's end and side.
          drag * (spec.width / 4) * Math.abs(rf) * rf,
          drag * (spec.length / 4) * Math.abs(rl) * rl,
          WATER * GRAVITY * ((spec.length * spec.width) / 4) * under * SEALED -
            0.5 * WATER * HULL_DRAG * ((spec.length * spec.width) / 4) * Math.abs(vu) * vu,
        )
      }
      // Each wheel ploughs the water over the ground under it: its tread end-on, the wetted segment of its side sideways.
      rig.wheels.forEach((_, i) => {
        const depth = Math.min(2 * spec.wheelRadius, Math.max(0, water.level - grounds[i]!))
        if (depth <= 0) return
        const o = offsets[i]!,
          v = along(o),
          rf = wf - v.f,
          rl = wl - v.l,
          r = spec.wheelRadius,
          side = (4 / 3) * Math.sqrt(depth * (2 * r - depth)) * depth,
          drag = 0.5 * WATER * TYRE_DRAG
        apply(
          { ...o, u: o.u + depth / 2 },
          drag * spec.tyreWidth * depth * Math.abs(rf) * rf,
          drag * side * Math.abs(rl) * rl,
          0,
        )
      })
    }

    // The stability assist (arcade): yaw toward the steered line, the slide damped.
    const steady = steadying(rig, vf, vl, r, controls.steer, touching, controls.handbrake)
    fl += steady.side
    tu += steady.yaw

    // Air drag at the centre of mass.
    const drag = 0.5 * AIR * spec.drag * Math.sqrt(vf * vf + vl * vl)
    ff -= drag * vf
    fl -= drag * vl

    const af = ff / m,
      al = fl / m
    body.vx += (af * c - al * s) * h
    body.vy += (af * s + al * c) * h
    body.vz += (fu / m) * h
    body.spin += (tu / rig.iz) * h
    body.rollRate += (tf / rig.ix) * h
    body.pitchRate -= (tl / rig.iy) * h
    if (touching === 0 && !resting) {
      body.rollRate *= 1 - AIR_SPIN * h
      body.pitchRate *= 1 - AIR_SPIN * h
    }
    // Self-righting (arcade): a vehicle down on its side or roof, nearly stopped, rolls back onto its wheels.
    const partly = touching > 0 && touching < rig.wheels.length
    const righted = righting(
      rig,
      up,
      resting || partly,
      Math.sqrt(body.vx * body.vx + body.vy * body.vy),
      body.roll,
      body.pitch,
      body,
      h,
    )
    body.rollRate = righted.rollRate
    body.pitchRate = righted.pitchRate
    body.vz = righted.vz
    body.x += body.vx * h
    body.y += body.vy * h
    body.angle += body.spin * h
    body.z += body.vz * h
    body.roll += body.rollRate * h
    body.pitch += body.pitchRate * h
  }
  return { skids, hit, grounded, folded: upright(body) }
}

/** `a` wrapped into [−π, π). */
const wrap = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))

/**
 * Keeps the body's angles canonical after it tumbles: roll and pitch in [−π, π), and the heading the way
 * the nose points. Past a vertical pitch the same turn reads heading + π, pitch π − pitch, roll + π
 * (pitch rate reversed): a car that flipped end over end then drives nose first again, and one that
 * rolled all the way round reads roll 0. Returns whether it folded.
 */
const upright = (body: BodyState): boolean => {
  body.roll = wrap(body.roll)
  body.pitch = wrap(body.pitch)
  if (Math.abs(body.pitch) <= Math.PI / 2) return false
  body.pitch = wrap(Math.PI - body.pitch)
  body.roll = wrap(body.roll + Math.PI)
  body.angle += Math.PI
  body.pitchRate = -body.pitchRate
  return true
}
