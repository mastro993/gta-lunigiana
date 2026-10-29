/**
 * Pixel-art isometric pipeline (three 0.186): an orthographic camera at 30° elevation sitting
 * opposite screen-up (north-west of the focus at the home seat, turned by `render/swing`), the
 * scene rendered into a low-res HalfFloat target (~270 texels tall), then one fullscreen pass that
 * draws depth-edge outlines, lays the sky's fog, haze, exposure and night grade over them
 * (`sky/post.ts`, per target texel), converts linear to sRGB and upscales by an integer factor with
 * a sub-texel scroll offset. The camera snaps to the texel grid, so the static world never shimmers
 * while the view still scrolls smoothly.
 *
 * @module render/pipeline
 */
import {
  DepthTexture,
  HalfFloatType,
  Matrix4,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type DirectionalLight,
  type Scene,
  type WebGLRenderer,
} from "three"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"

import { screenAxes } from "../sim/view.ts"
import { makePost, POST_GLSL } from "./sky/post.ts"

/** 30° elevation: world ground axes project to exact 2:1 pixel lines. */
const ELEVATION = Math.PI / 6
const MARGIN = 1 // extra low-res texels per side, consumed by the sub-texel offset
const DISTANCE = 500 // metres from focus to camera along the view axis
const NEAR = 1
/** How far back from the focus along the view's back axis (m) the near plane lies: nothing farther back is ever drawn. */
export const BEHIND = DISTANCE - NEAR
const FAR = 3000 // 2.5 km past the focus: from the Apuan summits the deepest ground in view is ≈ 2.45 km from the camera

const aim = new Matrix4(),
  origin = new Vector3()
/**
 * Writes the camera's right/up/back axes (three space, the columns of its rotation) for a view
 * turned `yaw` rad to the left of the home seat into the given vectors, and returns the rotation.
 * At the home seat the camera looks along screen-up on the ground (sim y = north maps to three −z),
 * from the opposite side, 30° up. A turn to the left (counter-clockwise from above in the sim)
 * is a rotation about three's +y.
 */
const aimAt = (yaw: number, right: Vector3, up: Vector3, back: Vector3): Matrix4 => {
  const home = screenAxes(0).up,
    c = Math.cos(ELEVATION)
  const eye = new Vector3(-home.x * c, Math.sin(ELEVATION), home.y * c).applyAxisAngle(
    Object3D.DEFAULT_UP,
    yaw,
  )
  return aim.lookAt(eye, origin, Object3D.DEFAULT_UP).extractBasis(right, up, back)
}

/** The camera's right/up/back axes (three space) for a view turned `yaw` rad to the left of the home seat. */
export const viewAxes = (
  yaw: number,
): { readonly right: Vector3; readonly up: Vector3; readonly back: Vector3 } => {
  const right = new Vector3(),
    up = new Vector3(),
    back = new Vector3()
  aimAt(yaw, right, up, back)
  return { right, up, back }
}

const FRAGMENT = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRtSize;
  uniform float uScale;
  uniform vec2 uOffset;
  uniform float uDepthRange;
  uniform float uOutlineMetres;
  uniform float uOutlineDarken;
  ${POST_GLSL}

  // Orthographic camera: the depth buffer is linear in [near, far].
  float depthAt(vec2 t) { return texture2D(tDepth, (t + 0.5) / uRtSize).r * uDepthRange; }

  void main() {
    vec2 t = floor(gl_FragCoord.xy / uScale + uOffset);
    vec4 c = texture2D(tColor, (t + 0.5) / uRtSize);
    float d = depthAt(t);
    float deeper = max(
      max(depthAt(t + vec2(1.0, 0.0)), depthAt(t - vec2(1.0, 0.0))),
      max(depthAt(t + vec2(0.0, 1.0)), depthAt(t - vec2(0.0, 1.0)))) - d;
    if (deeper > uOutlineMetres) c.rgb *= uOutlineDarken;
    // After the outlines, so they fade into the fog with what they edge.
    c.rgb = atmosphere(c.rgb, t, d);
    gl_FragColor = linearToOutputTexel(c);
  }`

/** The widest zoom `zoomFor` picks, texels per metre: the most ground the view ever shows. */
export const WIDEST_ZOOM = 5

/**
 * Texels per metre: 8 on foot, 6 in a car, 5 above 16 m/s; back to 6 only below 13 m/s, so town
 * speeds around the threshold never flip the zoom. `last` is the previous result.
 */
export const zoomFor = (speed: number | undefined, last: number): number => {
  if (speed === undefined) return 8
  const s = Math.abs(speed)
  return s > 16 || (s >= 13 && last === WIDEST_ZOOM) ? WIDEST_ZOOM : 6
}

/** The low-res render target, the camera that fills it and the blit to the canvas. */
export class PixelView {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, NEAR, FAR)
  /** World point the view is centred on; host code moves it. */
  readonly focus = new Vector3()
  /** Radians the view is turned to the left of its home seat; host code turns it. */
  yaw = 0
  /** Low-res texels per world metre (zoom). */
  texelsPerMetre = 8
  /** Device pixels per low-res texel (integer, from `resize`). */
  scale = 1
  /** Low-res texels on screen, margin excluded. */
  readonly view = new Vector2(1, 1)
  /** The post pass's uniforms: the camera's are written here each frame, the atmosphere's by the sky host (`writePost`). */
  readonly post = makePost()

  private readonly renderer: WebGLRenderer
  private readonly targetHeight: number
  private readonly target: WebGLRenderTarget
  private readonly blit: FullScreenQuad
  private readonly material: ShaderMaterial
  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private readonly back = new Vector3()
  /** The yaw the camera and its axes were last aimed at. */
  private aimed = Number.NaN
  private readonly size = new Vector2()

  constructor(renderer: WebGLRenderer, targetHeight = 270) {
    this.renderer = renderer
    this.targetHeight = targetHeight
    this.target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthTexture: new DepthTexture(1, 1),
    })
    this.material = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uRtSize: { value: new Vector2(1, 1) },
        uScale: { value: 1 },
        uOffset: { value: new Vector2(MARGIN, MARGIN) },
        uDepthRange: { value: FAR - NEAR },
        uOutlineMetres: { value: 1 },
        uOutlineDarken: { value: 0.45 },
        ...this.post,
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: FRAGMENT,
    })
    this.blit = new FullScreenQuad(this.material)
  }

  /** Fits the canvas to the CSS size and picks the integer upscale for ~`targetHeight` texels. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(cssWidth, cssHeight)
    const device = this.renderer.getDrawingBufferSize(this.size)
    this.scale = Math.max(1, Math.round(device.y / this.targetHeight))
    this.view.set(Math.ceil(device.x / this.scale), Math.ceil(device.y / this.scale))
    this.target.setSize(this.view.x + 2 * MARGIN, this.view.y + 2 * MARGIN)
    const rtSize = this.material.uniforms["uRtSize"]!.value as Vector2
    rtSize.set(this.target.width, this.target.height)
    this.material.uniforms["uScale"]!.value = this.scale
  }

  /** Turns the camera and its axes to `yaw` if they are not there yet. */
  private aim(): void {
    if (this.yaw === this.aimed) return
    this.camera.quaternion.setFromRotationMatrix(aimAt(this.yaw, this.right, this.up, this.back))
    this.aimed = this.yaw
  }

  /** The shadow box over the ground this view shows (`shadowFit`), at its current yaw; `groundAt(x, z)` is the terrain's render y, read up to 2.5 km off (the sky host's falls back to the coarse grid: `farTerrainY`). */
  shadowFit(toSun: Vector3, groundAt: (x: number, z: number) => number): ShadowFit {
    this.aim()
    return shadowFit(
      this.focus,
      { right: this.right, up: this.up, back: this.back },
      this.view.x / this.texelsPerMetre,
      this.view.y / this.texelsPerMetre,
      toSun,
      groundAt,
    )
  }

  /**
   * Compiles every program `scene` and `extra` (stand-ins never drawn, `render/stand-ins`) need, lit by
   * `scene`'s lights, as `render` draws them: into the linear HalfFloat target. Compiled for the canvas
   * instead, each would be an sRGB-output twin no frame uses, and the real one would compile later.
   */
  compile(scene: Scene, extra: Object3D): void {
    this.renderer.setRenderTarget(this.target)
    this.renderer.compile(scene, this.camera)
    this.renderer.compile(extra, this.camera, scene)
    this.renderer.setRenderTarget(null)
  }

  /** Renders one frame: camera turned to `yaw` and snapped to the texel grid, remainder handed to the blit. */
  render(scene: Scene): void {
    const texel = 1 / this.texelsPerMetre
    const cam = this.camera
    this.aim()
    cam.left = (-this.target.width * texel) / 2
    cam.right = (this.target.width * texel) / 2
    cam.top = (this.target.height * texel) / 2
    cam.bottom = (-this.target.height * texel) / 2
    cam.updateProjectionMatrix()
    const fx = this.focus.dot(this.right) / texel,
      fy = this.focus.dot(this.up) / texel
    const sx = Math.round(fx),
      sy = Math.round(fy)
    cam.position
      .copy(this.right)
      .multiplyScalar(sx * texel)
      .addScaledVector(this.up, sy * texel)
      .addScaledVector(this.back, this.focus.dot(this.back) + DISTANCE)
    cam.updateMatrixWorld()
    const offset = this.material.uniforms["uOffset"]!.value as Vector2
    offset.set(MARGIN + fx - sx, MARGIN + fy - sy)
    const post = this.post
    post.uCamPos.value.copy(cam.position)
    post.uRight.value.copy(this.right)
    post.uUp.value.copy(this.up)
    post.uBack.value.copy(this.back)
    post.uTexel.value = texel
    this.renderer.setRenderTarget(this.target)
    this.renderer.render(scene, cam)
    this.renderer.setRenderTarget(null)
    this.blit.render(this.renderer)
  }
}

const lightBasis = new Matrix4(),
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
/** Ray-march step down to the ground, m. */
const MARCH = 4
/** Rays marched per side of the view: a grid, because a deep valley can show only between the edges. */
const RAYS = 5
const ray = new Vector3(),
  hit = new Vector3()

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
  let half = Math.hypot(width, height / Math.sin(ELEVATION)) / 2,
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
        half = Math.max(half, Math.abs(hit.dot(lr)), Math.abs(hit.dot(lu)))
        above = Math.max(above, hit.dot(toSun))
        below = Math.min(below, hit.dot(toSun))
        break
      }
      wasAbove = isAbove
    }
  }
  return { half: Math.min(SHADOW_CAP, half + 10), above, below }
}

/** Shadow casters may stand this far toward the sun from the ground shown, m (a ridge over a valley). */
const CASTERS = 1500
/** Depth bias, m (three's `shadow.bias` is a share of the box's depth). */
const BIAS = 0.45

/**
 * Fits the sun's shadow box (`shadowFit`) on `focus`, snapped to shadow-map texels in light space
 * so shadow edges do not crawl while the camera moves. `sun.target` must be in the scene.
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
