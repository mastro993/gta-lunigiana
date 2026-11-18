/**
 * Tyre marks: one dynamic mesh for the whole map, a ring buffer of quads laid from the sim's Skid
 * events. Each wheel of each car draws a strip that joins its consecutive steps; a step without a
 * skid breaks it. The colour follows the surface (rubber on asphalt and stone, an earth rut on the
 * rest, the damp sand a rut turns up on a beach; a dark slush rut where snow lies), the opacity how far past its grip the tyre slid, and a mark
 * fades to nothing over `FADE` seconds of sim time. When the buffer is full, the oldest quad is
 * overwritten. The first transparent effect drawn (`DRAW_ORDER`: then smoke, fire, bolts, rain and snow).
 *
 * @module render/marks
 */
import type { Descriptor } from "@typeonce/ritmo"
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshLambertMaterial } from "three"

import { type Skid, STEP } from "../sim/index.ts"
import { drawnZ } from "../sim/map/ground.ts"
import type { Surface } from "../sim/map/surface.ts"
import type { VehicleModel } from "../sim/vehicles.ts"
import { linear } from "./geometry.ts"
import { yOf } from "./ground.ts"
import { DRAW_ORDER } from "./order.ts"
import { PALETTE } from "./palette.ts"
import { weatherMaterial } from "./sky/surface.ts"

/** A Skid event. */
export type SkidValue = Descriptor.Descriptor.Value<typeof Skid>

/** Seconds of sim time a mark takes to fade out. */
export const FADE = 60
/** Metres over the ground the skid names (road surfaces included): clears the centre dash, 0.02 m over its road. */
const LIFT = 0.04
/** Sim seconds between fade passes: each lowers an alpha by under 0.5 %, too little to see. */
const REFADE = 0.25

/** The tread each model's tyres leave, m (the truck's twin rear tyres). */
export const TREAD = {
  panda: 0.18,
  ape: 0.1,
  truck: 0.35,
  carabinieri: 0.22,
} as const satisfies Record<VehicleModel, number>

/** What a sliding tyre leaves on each surface (rubber on the hard ones, a rut on the soft ones) and its opacity at a full slide. */
const MARK = {
  asphalt: { hex: PALETTE.outline, alpha: 0.8 },
  stone: { hex: PALETTE.outline, alpha: 0.6 },
  gravel: { hex: PALETTE.woodBrown, alpha: 0.6 },
  dirt: { hex: PALETTE.woodBrown, alpha: 0.75 },
  grass: { hex: PALETTE.woodBrown, alpha: 0.55 },
  leaves: { hex: PALETTE.woodBrown, alpha: 0.5 },
  // A rut in dry sand turns up the damper, darker sand under it; its loose sides slump back, so it shows less than dirt's.
  sand: { hex: PALETTE.sandWet, alpha: 0.6 },
} as const satisfies Record<Surface, { readonly hex: number; readonly alpha: number }>
/** What a sliding tyre leaves in snow (Skid.snow 1): a dark rut of slush, plainer on the white. */
const RUT = { hex: PALETTE.snowRut, alpha: 0.9 } as const

/** The colour (linear) and full-slide opacity of `skid`'s mark: the surface's, turning to a slush rut with the snow on it. */
const markOf = (skid: SkidValue): readonly [number, number, number, number] => {
  const m = MARK[skid.surface],
    [r, g, b] = linear(m.hex),
    [sr, sg, sb] = linear(RUT.hex),
    k = skid.snow
  return [r + (sr - r) * k, g + (sg - g) * k, b + (sb - b) * k, m.alpha + (RUT.alpha - m.alpha) * k]
}

/** A strip's end: the wheel's last skid and, once the strip has a direction, the edges (left x, y, right x, y) the next quad starts from. */
interface Tip {
  readonly skid: SkidValue
  readonly edges?: readonly [number, number, number, number]
}

// Like decalMaterial, pulled towards the camera in depth; lit, so marks darken in shadow (and under the clouds' shadows) like the road.
const material = weatherMaterial(
  new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  }),
  "actor",
)

/** Every tyre mark on the map. Host state for the page's life: nothing loads a save in the browser. */
export class Marks {
  readonly mesh: Mesh
  private readonly capacity: number
  private readonly position: BufferAttribute
  private readonly color: BufferAttribute
  /** Each vertex's alpha before fading, and each quad's sim time of birth (s). */
  private readonly base: Float32Array
  private readonly born: Float64Array
  /** Quads ever written, and how many of them are on the GPU. */
  private written = 0
  private uploaded = 0
  /** Sim time of the last fade pass, and the latest step a skid came from. */
  private faded = -Infinity
  private latest = 0
  /** Each (car, wheel)'s strip end. */
  private readonly tips = new Map<number, Tip>()

  constructor(capacity = 4096) {
    this.capacity = capacity
    this.base = new Float32Array(capacity * 4)
    this.born = new Float64Array(capacity)
    const geometry = new BufferGeometry()
    this.position = new BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(
      DynamicDrawUsage,
    )
    this.color = new BufferAttribute(new Float32Array(capacity * 16), 4).setUsage(DynamicDrawUsage)
    const normal = new Float32Array(capacity * 12)
    for (let v = 0; v < capacity * 4; v++) normal[v * 3 + 1] = 1
    const index = new Uint16Array(capacity * 6)
    for (let q = 0; q < capacity; q++)
      index.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3], q * 6)
    geometry
      .setAttribute("position", this.position)
      .setAttribute("normal", new BufferAttribute(normal, 3))
      .setAttribute("color", this.color)
    geometry.setIndex(new BufferAttribute(index, 1))
    geometry.setDrawRange(0, 0)
    this.mesh = new Mesh(geometry, material)
    this.mesh.frustumCulled = false // spread over the whole map, and the bounds would change every frame
    this.mesh.receiveShadow = true
    this.mesh.matrixAutoUpdate = false
    this.mesh.renderOrder = DRAW_ORDER.marks
  }

  /** Quads drawn. */
  get count(): number {
    return Math.min(this.written, this.capacity)
  }

  /** One step of a sliding tyre `width` m wide: extends its wheel's strip when the wheel slid the step before too. */
  add(skid: SkidValue, width: number): void {
    const key = skid.car * 16 + skid.wheel,
      tip = this.tips.get(key)
    this.latest = Math.max(this.latest, skid.step)
    if (tip === undefined || skid.step !== tip.skid.step + 1) {
      this.tips.set(key, { skid })
      return
    }
    const dx = skid.x - tip.skid.x,
      dy = skid.y - tip.skid.y,
      d = Math.hypot(dx, dy)
    // Spinning on the spot: no direction to draw along, the strip just carries on.
    if (d < 1e-3) {
      this.tips.set(key, { ...tip, skid: { ...tip.skid, step: skid.step } })
      return
    }
    const nx = (-dy / d) * (width / 2),
      ny = (dx / d) * (width / 2)
    const start = tip.edges ?? [tip.skid.x + nx, tip.skid.y + ny, tip.skid.x - nx, tip.skid.y - ny]
    const end = [skid.x + nx, skid.y + ny, skid.x - nx, skid.y - ny] as const
    this.quad(start, tip.skid, end, skid)
    this.tips.set(key, { skid, edges: end })
  }

  /** Fades the marks to sim time `now` (s) and hands the GPU what changed. */
  update(now: number): void {
    for (const [key, tip] of this.tips) if (tip.skid.step < this.latest - 1) this.tips.delete(key)
    const runs = this.fresh()
    for (const [first, count] of runs) this.position.addUpdateRange(first * 12, count * 12)
    if (runs.length > 0) this.position.needsUpdate = true
    if (now - this.faded >= REFADE || now < this.faded) {
      this.faded = now
      const c = this.color.array
      for (let q = 0; q < this.count; q++) {
        const fade = Math.max(0, 1 - (now - this.born[q]!) / FADE)
        for (let v = 0; v < 4; v++) c[q * 16 + v * 4 + 3] = this.base[q * 4 + v]! * fade
      }
      this.color.clearUpdateRanges() // the whole buffer
      this.color.needsUpdate = true
    } else if (runs.length > 0) {
      for (const [first, count] of runs) this.color.addUpdateRange(first * 16, count * 16)
      this.color.needsUpdate = true
    }
    this.uploaded = this.written
    this.mesh.geometry.setDrawRange(0, this.count * 6)
  }

  /** The slots written since the last upload, as up to two runs (first slot, count): the ring may have wrapped. */
  private fresh(): Array<readonly [number, number]> {
    const count = Math.min(this.written - this.uploaded, this.capacity),
      first = (this.written - count) % this.capacity
    if (count === 0) return []
    return first + count <= this.capacity
      ? [[first, count]]
      : [
          [first, this.capacity - first],
          [0, first + count - this.capacity],
        ]
  }

  /** Writes the quad from skid `a`'s edges to skid `b`'s into the next slot: start left, start right, end right, end left. */
  private quad(
    start: readonly [number, number, number, number],
    a: SkidValue,
    end: readonly [number, number, number, number],
    b: SkidValue,
  ): void {
    const q = this.written++ % this.capacity
    // On the ribbon as drawn: the wheel's ground blends a junction's (or a hairpin's) overlapping ribbons, the highest is the one seen.
    const ya = yOf(drawnZ(a.x, a.y, a.z)) + LIFT,
      yb = yOf(drawnZ(b.x, b.y, b.z)) + LIFT
    // Three space is (east, up, −north).
    this.position.array.set(
      [start[0], ya, -start[1], start[2], ya, -start[3], end[2], yb, -end[3], end[0], yb, -end[1]],
      q * 12,
    )
    const [ar, ag, ab, am] = markOf(a),
      [br, bg, bb, bm] = markOf(b)
    const aa = am * a.amount,
      ba = bm * b.amount
    this.color.array.set([ar, ag, ab, aa, ar, ag, ab, aa, br, bg, bb, ba, br, bg, bb, ba], q * 16)
    this.base.set([aa, aa, ba, ba], q * 4)
    this.born[q] = b.step * STEP.dt
  }
}
