/**
 * People and animals in the water. A body wades while the water leaves it its footing: slower the
 * deeper it is, and pushed along a little more as the current nears what it can stand against. It
 * swims once the water reaches its chest or the current takes its feet from under it (the depth ×
 * speed beyond its hold, Cox, Shand and Blacka 2010), and then moves with the current plus its
 * own stroke. It never drowns: in the water it is swept until it swims or wades out.
 *
 * @module water/swim
 */
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import type { WaterHere } from "./rivers.ts"

/**
 * The depth × speed (m²/s) at which an adult of 1.75 m (75 kg, H·M 131 m·kg) loses its footing:
 * the upper limit of stability in most of the trials Cox, Shand and Blacka (2010, Australian
 * Rainfall and Runoff Revision Project 10, as reported in WRL Technical Report 2014/07) collect.
 * Smaller and lighter bodies stand less: the limit scales with height × mass, so a 1.2 m child
 * (35 kg at the same BMI, H·M 42 m·kg, among Cox et al.'s children of 25–50) keeps its feet to
 * 0.39 m²/s, their 0.4 for children. No body stands more than an adult.
 */
const HOLD = { dv: 1.2, hm: 1.75 * 75 } as const
/** A body floats off its feet once the water is this share of its height deep: at the chest (Cox et al.'s 1.2 m for adults). */
const AFLOAT = 0.7
/** Back on its feet only below these shares of the depth and hold that took them (no flicker at the line). */
const REGAIN = 0.85
/**
 * Wading: speed lost for each metre of water per 1.75 m of height, and the least share kept. Walking pace in knee-deep water
 * (0.35 m) falls 39 % for men and 45 % for women ("Impacts of water depth on pedestrian speed, gait, and stability", trials of
 * 188 people at 0, 0.35, 0.60 and 0.90 m, Acta Polytechnica CTU Proceedings).
 */
const WADE = { perMetre: 1.15, least: 0.25 } as const
/** A swimmer's velocity closes on the current plus its stroke with this time constant, s (the water's drag). */
const WATER_TAU = 0.5
/** A person of 1.75 m weighs this much at a body-mass index of 24.5, kg (mass grows with height squared). */
const BMI = 24.5

/** Swimming speed by age group, m/s (estimates: an unhurried breaststroke near 0.9 m/s, about 2 minutes per 100 m). */
export const STROKE = { kid: 0.6, adult: 0.9, elder: 0.7 } as const
/** How many times an unhurried stroke's speed a hard crawl makes (the player sprinting, an estimate). */
export const HARD_STROKE = 1.6

/** The mass of a person of `height` m at BMI 24.5, kg. */
export const personMass = (height: number): number => BMI * height * height

/** The depth × speed (m²/s) a body of `height` m and `mass` kg stands against before the current takes its feet. */
export const holdOf = (height: number, mass: number): number =>
  HOLD.dv * Math.min(1, (height * mass) / HOLD.hm)

/** A body's build in the water: its height (a person standing, an animal at the shoulder), m, and its hold (`holdOf`), m²/s. */
export interface Build {
  readonly height: number
  readonly hold: number
}

/** Whether a body of `build` in `water` is off its feet, given whether it was a step ago. */
export const swept = (water: WaterHere, build: Build, was: boolean): boolean => {
  const share = was ? REGAIN : 1,
    dv = water.depth * Ops.hypot(water.vx, water.vy)
  return water.depth > AFLOAT * build.height * share || dv > build.hold * share
}

/** Past this share of its height deep, or of its hold in depth × speed, a person or animal wading heads for the bank (TUNED). */
const WARY = { depth: 0.3, hold: 0.25 } as const

/** Whether a body of `build` wading in `water` makes for the bank rather than carry on: the water is past its knees or pulls at it. */
export const outOfDepth = (water: WaterHere, build: Build): boolean =>
  water.depth > WARY.depth * build.height ||
  water.depth * Ops.hypot(water.vx, water.vy) > WARY.hold * build.hold

/**
 * Running in water: the legs' drag grows with the square of their speed, so whatever a body wants
 * past a walk (`pace`, m/s) fades out by the time the water reaches its knees (`knee`, of its
 * height): a sprint splashes through the shallows and is a wade by knee depth (estimates).
 */
const RUNNING = { pace: 1.4, knee: 0.28 } as const

/** How fast a body of `height` m in `depth` m of water goes when it wants `speed` m/s: what it wants past a walk fades by knee depth, then the wading share. */
export const wadingSpeed = (speed: number, depth: number, height: number): number => {
  const walk = Math.min(speed, RUNNING.pace),
    run = (speed - walk) * Math.max(0, 1 - depth / (RUNNING.knee * height))
  return (walk + run) * wadeShare(depth, height)
}

/** The share of its walking speed a body of `height` m keeps wading in `depth` m of water. */
export const wadeShare = (depth: number, height: number): number =>
  Math.max(WADE.least, 1 - (WADE.perMetre * depth * 1.75) / height)

/**
 * A body's velocity after `dt` s in `water`, from `velocity`: wading toward `wish` (its velocity on
 * land) slowed by the depth (`wadingSpeed`), plus the current as far as (depth × speed / hold)², changing by at
 * most `accel` m/s²; swimming, or down, toward the current plus a `stroke` m/s along `wish`.
 */
export const waterVelocity = (
  velocity: Vec2.Vec2,
  wish: Vec2.Vec2,
  water: WaterHere,
  build: Build,
  swimming: boolean,
  stroke: number,
  accel: number,
  dt: number,
): Vec2.Vec2 => {
  const current = { x: water.vx, y: water.vy }
  if (swimming) {
    const target = Vec2.add(current, Vec2.scale(Vec2.normalizeOr(wish, Vec2.zero), stroke))
    return Vec2.add(
      velocity,
      Vec2.scale(Vec2.subtract(target, velocity), 1 - Ops.exp(-dt / WATER_TAU)),
    )
  }
  const pull = Math.min(1, (water.depth * Vec2.length(current)) / build.hold) ** 2
  const speed = Vec2.length(wish),
    wading = speed > 0 ? wadingSpeed(speed, water.depth, build.height) / speed : 0
  const target = Vec2.add(Vec2.scale(wish, wading), Vec2.scale(current, pull))
  return Vec2.moveToward(velocity, target, accel * dt)
}
