/**
 * Tyre smoke and dust: one InstancedMesh of low-poly puffs for the whole map, spawned from the
 * sim's Skid events in proportion to how far past its grip and how fast each tyre slides. Burnt
 * rubber is white-grey on asphalt and stone, dust tan on gravel and dirt, dark brown on leaves, a pale
 * spray of sand on a beach, and grass hardly smokes; on snow it is white spray. A puff grows, rises, drifts and shrinks away over 1–2 s of sim time, so the
 * smoke hangs still while the game is paused. When every puff is in the air, the puffs owed meanwhile are dropped.
 * Drawn after the tyre marks (render order 1).
 *
 * @module render/smoke
 */
import {
  Color,
  IcosahedronGeometry,
  type InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three"

import { STEP } from "../sim/index.ts"
import type { Surface } from "../sim/map/surface.ts"
import { paint } from "./geometry.ts"
import { yOf } from "./ground.ts"
import type { SkidValue } from "./marks.ts"
import { DRAW_ORDER } from "./order.ts"
import { PALETTE } from "./palette.ts"
import { Pool } from "./pool.ts"
import { weatherMaterial } from "./sky/surface.ts"

/** What a sliding tyre throws up on each surface: its colour, and puffs per second per m/s of slip at a full slide. */
export const PUFF = {
  asphalt: { hex: PALETTE.limestone, rate: 1.5 },
  stone: { hex: PALETTE.plasterGrey, rate: 1.2 },
  gravel: { hex: PALETTE.stoneLight, rate: 2 },
  dirt: { hex: PALETTE.dirtTrack, rate: 2.5 },
  grass: { hex: PALETTE.grassDry, rate: 0.2 },
  leaves: { hex: PALETTE.woodBrown, rate: 1 },
  // Loose and dry, every slide ploughs it up: a spray of its own colour, the thickest of any ground.
  sand: { hex: PALETTE.sand, rate: 3 },
} as const satisfies Record<Surface, { readonly hex: number; readonly rate: number }>

/** What a tyre throws up from snow (Skid.snow 1): white spray. */
const SPRAY = new Color(PALETTE.snowFlake)
/** How a kind of puff moves and lasts, each a [min, max] range drawn per puff: drift and rise (m/s), life (sim s) and peak radius (m). */
export interface PuffLook {
  readonly drift: readonly [number, number]
  readonly rise: readonly [number, number]
  readonly life: readonly [number, number]
  readonly size: readonly [number, number]
}
/** A tyre's smoke or dust. */
const TYRE: PuffLook = { drift: [0.2, 0.6], rise: [0.5, 0.9], life: [1, 2], size: [0.4, 0.8] }

/** Floats per puff: spawn point (three space), drift and rise (m/s), birth and life (sim s), peak radius (m), yaw. */
const STRIDE = 10

const shape = paint(new IcosahedronGeometry(1, 0), 0xffffff) // tinted per puff by its instance colour
// Lit like the people and cars: shaded by the clouds, not snowed on.
const material = weatherMaterial(
  new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  }),
  "actor",
)
const matrix = new Matrix4(),
  at = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  up = new Vector3(0, 1, 0),
  tint = new Color(),
  sprayed = new Color()

/** Every puff in the air. Host state for the page's life: nothing loads a save in the browser. */
export class Smoke {
  private readonly random: () => number
  /** Live puffs, packed at the front. */
  private readonly puffs: Pool
  /** Puffs owed but not yet spawned (a slide under one puff a step still smokes, every few steps). */
  private debt = 0

  constructor(random: () => number = Math.random, max = 256) {
    this.random = random
    this.puffs = new Pool(shape, material, max, STRIDE, DRAW_ORDER.smoke)
  }

  /** The puffs' mesh, for the scene. */
  get mesh(): InstancedMesh {
    return this.puffs.mesh
  }

  /** One step of a sliding tyre. */
  add(skid: SkidValue): void {
    this.debt += PUFF[skid.surface].rate * skid.amount * skid.slip * STEP.dt
    if (this.debt < 1) return
    const hex = sprayed.setHex(PUFF[skid.surface].hex).lerp(SPRAY, skid.snow).getHex()
    for (; this.debt >= 1; this.debt--)
      this.puff(skid.x, yOf(skid.z) + 0.2, -skid.y, skid.step * STEP.dt, hex, TYRE)
  }

  /** Moves every puff to sim time `now` (s) and lets the burnt-out ones go. */
  update(now: number): void {
    const { mesh, data: p } = this.puffs
    // Nothing in the air now or last frame: nothing to upload.
    if (this.puffs.idle) return
    for (let i = 0; i < mesh.count;) {
      const o = i * STRIDE,
        age = Math.max(0, now - p[o + 6]!),
        u = age / p[o + 7]!
      if (u >= 1) {
        this.puffs.drop(i)
        continue
      }
      const s = p[o + 8]! * Math.sin(Math.PI * Math.sqrt(u)) // swells quickly, then thins away
      at.set(p[o]! + p[o + 3]! * age, p[o + 1]! + p[o + 5]! * age, p[o + 2]! + p[o + 4]! * age)
      mesh.setMatrixAt(
        i,
        matrix.compose(at, turn.setFromAxisAngle(up, p[o + 9]!), size.set(s, s, s)),
      )
      i++
    }
    this.puffs.upload()
  }

  /**
   * One puff within 0.2 m of (x, y, z) in three space, born at sim time `born` (s), tinted `hex`, moving and lasting as `look` says;
   * none when every puff is in the air.
   */
  puff(x: number, y: number, z: number, born: number, hex: number, look: PuffLook): void {
    const i = this.puffs.take()
    if (i < 0) return
    const r = this.random,
      heading = r() * 2 * Math.PI,
      drift = between(r, look.drift)
    this.puffs.data.set(
      [
        x + (r() - 0.5) * 0.4,
        y,
        z + (r() - 0.5) * 0.4,
        Math.cos(heading) * drift,
        -Math.sin(heading) * drift,
        between(r, look.rise),
        born,
        between(r, look.life),
        between(r, look.size),
        r() * 2 * Math.PI,
      ],
      i * STRIDE,
    )
    this.puffs.mesh.setColorAt(i, tint.setHex(hex))
  }
}

/** A draw from `random` in [min, max). */
export const between = (random: () => number, [min, max]: readonly [number, number]): number =>
  min + (max - min) * random()
