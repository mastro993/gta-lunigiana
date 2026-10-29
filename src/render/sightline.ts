/**
 * Whether the world hides the player from the camera, and the see-through cut that opens while it
 * does (`render/see-through`). The line from a point toward the camera is marched through the
 * terrain, the buildings (walls up to their ridge) and the tree crowns as they are drawn, as
 * Baldur's Gate 3 traces from its characters toward the camera; where it first meets the terrain
 * is where the cut starts taking the ground.
 *
 * @module render/sightline
 */
import { Vector3 } from "three"

import { pointInRing } from "../sim/collide.ts"
import { buildingsIn, MAP, treesIn } from "../sim/map/index.ts"
import { topOf } from "./buildings.ts"
import { farTerrainY, yOf } from "./ground.ts"
import { viewAxes } from "./pipeline.ts"
import { CUT_UNIFORMS } from "./see-through.ts"
import { inCrown } from "./trees.ts"

/** The cut's radius on screen, in texels (6.75 m on foot, 9 m in a car, 10.8 m above 16 m/s). */
const RADIUS_TEXELS = 54
/** The cut opens over this many seconds, and shuts as fast. */
const EASE = 0.2
/** It stays open this many seconds after the player was last hidden, so it does not flicker at a wall's edge. */
const HOLD = 0.4
/** The lower of the two points the sight line is drawn from, m over the feet; the upper is a little under the top. */
const LOW = 0.4
const UNDER_TOP = 0.1
/** Buildings and trees are looked for every `step` m along the line, up to `reach` m (where it is 50 m up: over every roof and crown). */
const NEAR = { step: 0.75, reach: 100 } as const
/** The terrain is sampled every `step` m from `from` m on, up to `reach` m: the camera stands 500 m from the focus (past the tiles in memory, on the coarse grid: `farTerrainY`). */
const FAR = { from: 1, step: 2, reach: 500 } as const
/** A tree crown is looked for within this many metres of each step: the widest drawn crown's radius. */
const CROWN_REACH = 4.5
/**
 * The terrain is cut from this many metres short of where a sight line first meets it (the march's
 * step: it met it somewhere in the last one), and never nearer the player's middle than `least` m,
 * so the ground at their feet stays.
 */
const GROUND = { short: FAR.step, least: 1 } as const
/** `uCutGround` while no terrain hides the player: farther than any ground in view, so none is cut. */
const NO_GROUND = 1e6

/** Each building's top, render y (`topOf`), worked out the first time a line passes over it. */
const tops = new Float32Array(MAP.buildings.length).fill(Number.NaN)
const topAt = (i: number): number => {
  if (Number.isNaN(tops[i]!)) tops[i] = topOf(MAP.buildings[i]!)
  return tops[i]!
}

/** Whether (x, y) at render height `h` is inside building `i`'s walls and under its top. */
const inBuilding = (i: number, x: number, y: number, h: number): boolean => {
  const b = MAP.buildings[i]!
  return (
    h < topAt(i) &&
    h > yOf(b.z0) - 0.5 &&
    pointInRing(x, y, b.outer) &&
    !(b.holes ?? []).some((hole) => pointInRing(x, y, hole))
  )
}

/** Whether (x, y) at render height `h` is inside a building or a tree crown. */
const blockedAt = (x: number, y: number, h: number): boolean => {
  let found = false
  buildingsIn(x, y, x, y, (i) => {
    found ||= inBuilding(i, x, y, h)
  })
  if (!found)
    treesIn(x - CROWN_REACH, y - CROWN_REACH, x + CROWN_REACH, y + CROWN_REACH, (tx, ty, s, id) => {
      found ||= inCrown(tx, ty, s, id, x, y, h)
    })
  return found
}

/** What a sight line meets: whether anything hides its start, and how far along it the terrain first does (m, `Infinity`: none). */
export interface Sight {
  readonly hidden: boolean
  readonly ground: number
}

/**
 * What stands on the line from `from` (three space) along `back` (the camera's back axis: toward
 * the camera, 30° up) within 500 m: a building, a tree crown or the terrain.
 */
export const sight = (from: Vector3, back: Vector3): Sight => {
  // Map frame: x east, y north (three z is −north), h render y.
  const dx = back.x,
    dy = -back.z,
    dh = back.y,
    x0 = from.x,
    y0 = -from.z,
    h0 = from.y
  let ground = Number.POSITIVE_INFINITY
  for (let t = FAR.from; t <= FAR.reach && ground === Number.POSITIVE_INFINITY; t += FAR.step)
    if (farTerrainY(x0 + dx * t, y0 + dy * t) > h0 + dh * t) ground = t
  if (ground < Number.POSITIVE_INFINITY) return { hidden: true, ground }
  for (let t = NEAR.step; t <= NEAR.reach; t += NEAR.step)
    if (blockedAt(x0 + dx * t, y0 + dy * t, h0 + dh * t)) return { hidden: true, ground }
  return { hidden: false, ground }
}

/** What the cut needs of the view: its yaw (for the camera's back axis) and its zoom (for the radius in metres). */
export interface CutView {
  readonly yaw: number
  readonly texelsPerMetre: number
}

const point = new Vector3()

/**
 * The cut's host state: how far it is open, and when the player was last hidden. The render
 * schedule hands it the player as drawn every frame (`follow`), or `shut` when there is none.
 */
export class SeeThrough {
  /** How far the cut is open, 0 shut … 1 open. */
  open = 0
  private hiddenAt = Number.NEGATIVE_INFINITY
  private last: number | undefined = undefined
  private yaw = Number.NaN
  private back = new Vector3()
  /** How far nearer the camera than the player's middle the terrain is cut, m (`uCutGround`): kept while the cut shuts. */
  private ground = NO_GROUND
  private readonly view: CutView
  private readonly reduced: () => boolean

  constructor(view: CutView, reduced: () => boolean) {
    this.view = view
    this.reduced = reduced
  }

  /**
   * Follows the player drawn at (x, `feet`, z), three space, `height` m tall, at sim time `now`
   * (s): opens the cut while the world hides a point low on their body or near its top, and shuts
   * it HOLD s after neither is. Under `prefers-reduced-motion` it opens and shuts at once. While
   * the terrain hides them, the ground is cut from GROUND.short m short of where it first meets
   * either line, measured along the view from the middle of their body.
   */
  follow(x: number, feet: number, z: number, height: number, now: number): void {
    if (this.view.yaw !== this.yaw) {
      this.yaw = this.view.yaw
      this.back.copy(viewAxes(this.yaw).back)
    }
    const middle = feet + height / 2
    let hidden = false,
      ground = Number.POSITIVE_INFINITY
    for (const over of [LOW, Math.max(LOW, height - UNDER_TOP)]) {
      const seen = sight(point.set(x, feet + over, z), this.back)
      hidden ||= seen.hidden
      // The line starts `over − height / 2` m above the middle: along the view, that much times the back axis's rise nearer.
      ground = Math.min(ground, seen.ground + (over - height / 2) * this.back.y)
    }
    // Sim time went back (a state restored, as the devtools' replay does): the old timings lie ahead of `now`.
    if (this.last !== undefined && now < this.last) {
      this.hiddenAt = Number.NEGATIVE_INFINITY
      this.last = undefined
    }
    if (hidden) {
      this.hiddenAt = now
      this.ground =
        ground < Number.POSITIVE_INFINITY
          ? Math.max(GROUND.least, ground - GROUND.short)
          : NO_GROUND
    }
    const target = now - this.hiddenAt < HOLD ? 1 : 0,
      dt = this.last === undefined ? 0 : Math.max(0, now - this.last)
    this.last = now
    this.open = this.reduced()
      ? target
      : this.open +
        Math.sign(target - this.open) * Math.min(Math.abs(target - this.open), dt / EASE)
    CUT_UNIFORMS.uCutCentre.value.set(x, middle, z)
    CUT_UNIFORMS.uCutFeet.value = feet
    CUT_UNIFORMS.uCutGround.value = this.ground
    CUT_UNIFORMS.uCutRadius.value = (this.open * RADIUS_TEXELS) / this.view.texelsPerMetre
  }

  /** Shuts the cut at once: there is no player to show. */
  shut(): void {
    this.open = 0
    this.hiddenAt = Number.NEGATIVE_INFINITY
    this.last = undefined
    this.ground = NO_GROUND
    CUT_UNIFORMS.uCutRadius.value = 0
  }
}
