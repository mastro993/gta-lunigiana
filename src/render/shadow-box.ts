/**
 * The key light's shadow box: how much ground it must cover for the view (`shadowFit`), its size held
 * in a few fixed steps per zoom (`holdBox`), and its place on the focus, snapped to its own texels
 * (`followSun`). A shadow edge holds still while the box keeps its size; each change of size rescales
 * the shadow map and moves its texel grid, which redraws every edge at once (a blink), so the size
 * changes only when the view needs another step: at once to grow, after a second to shrink.
 *
 * @module render/shadow-box
 */
import { type DirectionalLight, Matrix4, Object3D, type Vector2, Vector3 } from "three"

import { DISTANCE, ELEVATION, FAR, ZOOMS } from "./pipeline.ts"

const lightBasis = new Matrix4(),
  origin = new Vector3(),
  lr = new Vector3(),
  lu = new Vector3(),
  lb = new Vector3()

/** The sun's shadow box around the focus: half size across the light, and how far the shown ground reaches toward (`above`) and away from (`below`) the sun. */
export interface ShadowFit {
  readonly half: number
  readonly above: number
  readonly below: number
}

/** Widest shadow box half size, m: the 2048 map is then 0.3 m per texel. */
const SHADOW_CAP = 300
/** Casters may stand this far past the ground shown, across the light, m. */
const PAD = 10
/** Ray-march step down to the ground, m. */
const MARCH = 4
/** Rays marched per side of the view: a grid, because a deep valley can show only between the edges. */
const RAYS = 5
const ray = new Vector3(),
  hit = new Vector3()

/** The box's half size over flat ground for a view of `width` × `height` m: the circle round its ground rectangle, padded and capped. */
const flatHalf = (width: number, height: number): number =>
  Math.min(SHADOW_CAP, Math.hypot(width, height / Math.sin(ELEVATION)) / 2 + PAD)

/**
 * The shadow box that covers the ground a view of `width` × `height` m (screen plane, around
 * `focus`) shows. On flat ground that is the view's ground rectangle; a RAYS × RAYS grid of rays
 * across the view is also marched from the camera plane to the first ground each hits, because a
 * slope falling away from the camera shows ground far past that rectangle, and a valley far below
 * lies deep along the light.
 */
export const shadowFit = (
  focus: Vector3,
  axes: { readonly right: Vector3; readonly up: Vector3; readonly back: Vector3 },
  width: number,
  height: number,
  toSun: Vector3,
  groundAt: (x: number, z: number) => number,
): ShadowFit => {
  lightBasis.lookAt(toSun, origin, Object3D.DEFAULT_UP).extractBasis(lr, lu, lb)
  let reach = 0,
    above = 0,
    below = 0
  for (let k = 0; k < RAYS * RAYS; k++) {
    const u = ((2 * (k % RAYS)) / (RAYS - 1) - 1) * (width / 2),
      v = ((2 * Math.floor(k / RAYS)) / (RAYS - 1) - 1) * (height / 2)
    ray
      .copy(focus)
      .addScaledVector(axes.right, u)
      .addScaledVector(axes.up, v)
      .addScaledVector(axes.back, DISTANCE)
    // The first crossing from above the ground to below it (the camera plane may start inside a hill).
    let wasAbove = false
    for (let t = 0; t < FAR; t += MARCH, ray.addScaledVector(axes.back, -MARCH)) {
      const isAbove = ray.y > groundAt(ray.x, ray.z)
      if (wasAbove && !isAbove) {
        hit.subVectors(ray, focus)
        reach = Math.max(reach, Math.abs(hit.dot(lr)), Math.abs(hit.dot(lu)))
        above = Math.max(above, hit.dot(toSun))
        below = Math.min(below, hit.dot(toSun))
        break
      }
      wasAbove = isAbove
    }
  }
  return {
    half: Math.max(flatHalf(width, height), Math.min(SHADOW_CAP, reach + PAD)),
    above,
    below,
  }
}

/** Each step of the box's size is this many times the one below it, from the zoom's flat fit (`shadowBase`) up to SHADOW_CAP. */
const STEP = Math.SQRT2
/** Growing, the box takes the step that holds the fit with this share to spare, so a fit still growing through a turn does not take another step the next frame. */
const SPARE = 0.1
/** The box shrinks once the view has asked for a smaller step this long, s: a turn or a winding road does not pump its size. */
const HOLD = 1

/** The shadow box's size from frame to frame (`holdBox`): its half size, m, how long the view has asked for a smaller step, s, and the most it asked for meanwhile, m. */
export interface HeldBox {
  readonly half: number
  readonly lower: number
  readonly peak: number
}

/**
 * The first step of the box's size for a view of `view` texels at `texelsPerMetre`: the flat fit of
 * the narrowest zoom `zoomFor` picks that shows at least as much ground. At rest on a zoom that is
 * its own (50.2 m on foot at 1280 × 720); while the zoom eases between two, the wider one's, so the
 * steps hold still through the change.
 */
export const shadowBase = (view: Vector2, texelsPerMetre: number): number => {
  const zoom = ZOOMS.findLast((z) => z <= texelsPerMetre) ?? texelsPerMetre
  return flatHalf(view.x / zoom, view.y / zoom)
}

/** The smallest step from `base` (base × STEPᵏ, the last SHADOW_CAP) that holds `need` m. */
const stepFor = (base: number, need: number): number => {
  let half = base
  while (half < need && half < SHADOW_CAP) half = Math.min(SHADOW_CAP, half * STEP)
  return half
}

/**
 * The shadow box's size this frame, `dt` s after the last (`box`; undefined on the first frame), for
 * a view that asks for `need` m (`shadowFit`), on the steps from `base` (`shadowBase`). It starts on
 * the step that holds `need`; grows at once when `need` outgrows it, with SPARE to spare, so no ground
 * shown goes without shadows; drops to that step at once when it is more than one step above it; and
 * otherwise shrinks only once the view has asked for a smaller step for HOLD s, to the step that holds
 * the most it asked for meanwhile. So it never holds less than `need`, nor more than a step above it.
 */
export const holdBox = (
  box: HeldBox | undefined,
  need: number,
  base: number,
  dt: number,
): HeldBox => {
  const fits = stepFor(base, need)
  if (box === undefined) return { half: fits, lower: 0, peak: 0 }
  if (need > box.half) return { half: stepFor(base, need * (1 + SPARE)), lower: 0, peak: 0 }
  if (box.half > Math.min(SHADOW_CAP, fits * STEP)) return { half: fits, lower: 0, peak: 0 }
  if (box.half <= fits) return box.lower === 0 ? box : { half: box.half, lower: 0, peak: 0 }
  const lower = box.lower + dt,
    peak = Math.max(box.peak, need)
  return lower >= HOLD
    ? { half: stepFor(base, peak), lower: 0, peak: 0 }
    : { half: box.half, lower, peak }
}

/** Shadow casters may stand this far toward the sun from the ground shown, m (a ridge over a valley). */
const CASTERS = 1500
/** Depth bias, m (three's `shadow.bias` is a share of the box's depth). */
const BIAS = 0.45

/**
 * Places the sun's shadow box (`fit`, its half size held by `holdBox`) on `focus`, snapped to
 * shadow-map texels in light space so shadow edges do not crawl while the camera moves.
 * `sun.target` must be in the scene.
 */
export const followSun = (
  sun: DirectionalLight,
  focus: Vector3,
  toSun: Vector3,
  fit: ShadowFit,
): void => {
  const shadow = sun.shadow.camera,
    half = fit.half
  shadow.left = -half
  shadow.right = half
  shadow.top = half
  shadow.bottom = -half
  const distance = Math.max(0, fit.above) + CASTERS
  shadow.far = distance - Math.min(0, fit.below) + 50
  sun.shadow.bias = -BIAS / (shadow.far - shadow.near)
  shadow.updateProjectionMatrix()
  const texel = (2 * half) / sun.shadow.mapSize.x
  lightBasis.lookAt(toSun, origin, Object3D.DEFAULT_UP).extractBasis(lr, lu, lb)
  const x = Math.round(focus.dot(lr) / texel) * texel,
    y = Math.round(focus.dot(lu) / texel) * texel
  sun.target.position
    .copy(lr)
    .multiplyScalar(x)
    .addScaledVector(lu, y)
    .addScaledVector(lb, focus.dot(lb))
  sun.position.copy(sun.target.position).addScaledVector(toSun, distance)
}
