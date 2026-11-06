/**
 * What the people and animal models share: a builder of low-poly boxes in any orientation (a limb
 * from joint to joint, a head tipped forward, a skirt's flare), and the node a figure lives in: its
 * frames, standing on the ground, lying down, and the blood pool under it once dead.
 *
 * @module render/figure
 */
import type { BufferGeometry, Material } from "three"

import { ON_DECK } from "../sim/map/ground.ts"
import { ActorNode } from "./actors.ts"
import { BloodPool, poolRadius } from "./blood.ts"
import { Triangles } from "./geometry.ts"
import { atGradeY, drawnY, footY } from "./ground.ts"

/** A point or direction in a figure's frame, m: +x forward, +y up, +z to its right. */
export type Vec = readonly [number, number, number]

/** Where a part's own box lies: an origin and three unit axes (right-handed). */
export interface Basis {
  readonly o: Vec
  readonly x: Vec
  readonly y: Vec
  readonly z: Vec
}

/** `a + k·b`. */
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Where the point `v` of `basis`'s own frame lies in the figure's frame. */
export const at = (basis: Basis, v: Vec): Vec =>
  add(add(add(basis.o, basis.x, v[0]), basis.y, v[1]), basis.z, v[2])

/** The basis at `o` with its up axis tipped `lean` rad forward (toward +x) about the figure's right axis. */
export const leaning = (o: Vec, lean = 0): Basis => ({
  o,
  x: [Math.cos(lean), -Math.sin(lean), 0],
  y: [Math.sin(lean), Math.cos(lean), 0],
  z: [0, 0, 1],
})

/** The basis at `o` whose up axis points along `dir`, its right axis kept as near the figure's as it can be. */
const along = (o: Vec, dir: Vec): Basis => {
  const y = unit(dir),
    side: Vec = Math.abs(y[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
  const z = unit(add(side, y, -(side[0] * y[0] + side[1] * y[1] + side[2] * y[2])))
  return { o, x: cross(y, z), y, z }
}

/** A box's six faces as corner cycles; corner i has its x, y and z at the box's max when bits 4, 2 and 1 are set. */
const FACES = [
  [0, 1, 3, 2],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 3, 7, 5],
] as const

/** One frame of a figure as low-poly boxes, flat-shaded and vertex-coloured like every actor. */
export class Figure {
  private readonly triangles = new Triangles()

  /** A box spanning `min`…`max` in `basis`'s frame. */
  box(basis: Basis, min: Vec, max: Vec, hex: number): void {
    this.solid(
      basis,
      (i) => [i & 4 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 1 ? max[2] : min[2]],
      hex,
    )
  }

  /** A box flaring from half extents (x, z) `top` at height `y1` to `bottom` at `y0`, centred on `basis`'s up axis: a skirt. */
  frustum(
    basis: Basis,
    y0: number,
    y1: number,
    bottom: readonly [number, number],
    top: readonly [number, number],
    hex: number,
  ): void {
    this.solid(
      basis,
      (i) => {
        const [hx, hz] = i & 2 ? top : bottom
        return [i & 4 ? hx : -hx, i & 2 ? y1 : y0, i & 1 ? hz : -hz]
      },
      hex,
    )
  }

  /** A limb from joint `from` to joint `to`, `wide` across the figure's right axis and `deep` across the other. */
  limb(from: Vec, to: Vec, wide: number, deep: number, hex: number): void {
    const d: Vec = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    this.box(
      along(from, d),
      [-deep / 2, 0, -wide / 2],
      [deep / 2, Math.hypot(d[0], d[1], d[2]), wide / 2],
      hex,
    )
  }

  /** The frame's geometry, lowered `drop` m and then scaled `scale` times about the ground point under the origin. */
  geometry(drop = 0, scale = 1): BufferGeometry {
    return this.triangles.geometry().translate(0, -drop, 0).scale(scale, scale, scale)
  }

  private solid(basis: Basis, corner: (i: number) => Vec, hex: number): void {
    const p = Array.from({ length: 8 }, (_, i) => at(basis, corner(i)))
    const centre = p.reduce<Vec>((sum, q) => add(sum, q, 1 / 8), [0, 0, 0])
    for (const [a, b, c, d] of FACES) {
      const mid = add(add(add(p[a]!, p[b]!), add(p[c]!, p[d]!)), centre, -4)
      this.triangles.face(p[a]!, p[b]!, p[c]!, p[d]!, mid, hex)
    }
  }
}

/** A small seeded random stream in [0, 1) (mulberry32): the same entity gets the same pool outline and coat markings. */
export const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How a figure lies when down or dead: its body's Euler turn and offset in the node's frame. */
export interface Lying {
  readonly turn: Vec
  readonly shift: Vec
}

/** Where a figure's blood pool spreads: its centre in the node's frame (x forward, z right), how far, and its outline's seed. */
export interface Bleeding {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly seed: number
}

/**
 * A figure's node: frames to swap between, standing on the ground under its pose, lying flat when down or dead (the body turns,
 * the node stays upright so the pool under it lies flat), and its blood pool. It owns and frees its frames, proxies and pool.
 */
export class FigureNode<Frame extends string> extends ActorNode {
  readonly frames: Readonly<Record<Frame, BufferGeometry>>
  readonly pool: BloodPool
  /** Metres covered (they drive the gait's frame). */
  walked = 0
  /** Down or dead. */
  lying = false
  /** Render y of the water's surface when it floats in a river (swimming, or lying in it), else undefined: it stands on the bed. */
  afloat: number | undefined = undefined
  /** How far under the surface its origin (its feet standing) floats, m: its own for swimming and for lying (`floating`). */
  protected sink = 0
  protected readonly lies: Lying
  private readonly bleeding: Bleeding
  private last: { readonly x: number; readonly y: number } | undefined = undefined
  /** The pool as last spread: radius, then the node's x, y, heading and height. */
  private spread: readonly [number, number, number, number, number] | undefined = undefined

  constructor(
    frames: Readonly<Record<Frame, BufferGeometry>>,
    rest: Frame,
    material: Material,
    lies: Lying,
    bleeding: Bleeding,
  ) {
    super(frames[rest], material)
    this.frames = frames
    this.lies = lies
    this.bleeding = bleeding
    this.pool = new BloodPool(seeded(bleeding.seed))
    this.add(this.pool)
  }

  /**
   * Stands the node on the ground under map point (x, y) on the level of `footing` (m a.s.l., the sim's `Footing`: `footY`), or
   * floats it `sink` under the water's surface (never under the bed), facing `angle`, and adds the metres covered to `walked`.
   */
  place(x: number, y: number, angle: number, footing: number): void {
    const h = footY(x, y, footing)
    this.position.set(x, this.afloat === undefined ? h : Math.max(h, this.afloat - this.sink), -y)
    this.rotation.y = angle
    if (this.last !== undefined) this.walked += Math.hypot(x - this.last.x, y - this.last.y)
    this.last = { x, y }
  }

  /** Lies flat (`down`, or `dead`) or stands; only the dead bleed. */
  lie(down: boolean, dead: boolean): void {
    this.lying = down || dead
    const turn = this.lying ? this.lies.turn : ZERO,
      shift = this.lying ? this.lies.shift : ZERO
    this.body.rotation.set(turn[0], turn[1], turn[2])
    this.body.position.set(shift[0], shift[1], shift[2])
    this.pool.visible = dead
  }

  /**
   * Spreads the pool to its size `seconds` after death, draped on the ground (and road ribbons) under the node; flat on a bridge
   * deck or a tunnel's floor, whose corners past the edge would otherwise drop to the ground metres below.
   */
  bleed(seconds: number): void {
    const radius = poolRadius(seconds, this.bleeding.radius)
    const x = this.position.x,
      y = -this.position.z,
      angle = this.rotation.y,
      h = this.position.y
    const s = this.spread
    if (s?.[0] === radius && s[1] === x && s[2] === y && s[3] === angle && s[4] === h) return
    this.spread = [radius, x, y, angle, h]
    // Three's turn about +y by `angle` takes the node's (lx, lz) to map (lx cos + lz sin, lx sin − lz cos) from (x, y).
    if (Math.abs(h - atGradeY(x, y)) > ON_DECK) {
      // A deck's profile is straight between its ends, so it is as good as flat across a pool.
      this.pool.spread(radius, this.bleeding.x, this.bleeding.z, () => 0)
      return
    }
    const c = Math.cos(angle),
      sn = Math.sin(angle)
    this.pool.spread(
      radius,
      this.bleeding.x,
      this.bleeding.z,
      (lx, lz) => drawnY(x + lx * c + lz * sn, y + lx * sn - lz * c, h) - h,
    )
  }

  /** Frees the node's own geometry: x-ray proxies, frames and pool. */
  override dispose(): void {
    super.dispose()
    for (const frame of Object.values<BufferGeometry>(this.frames)) frame.dispose()
    this.pool.geometry.dispose()
  }
}

const ZERO: Vec = [0, 0, 0]
