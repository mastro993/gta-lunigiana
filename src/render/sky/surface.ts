/**
 * Surface weather on the lit world: snow, wet ground, puddles, the rivers' level and current
 * and rain rings on them, cloud shadows and wind-swayed trees, patched into the flat Lambert materials with `onBeforeCompile`.
 * One program per variant (`VARIANTS`, each with its own `customProgramCacheKey`), every effect
 * driven by the shared `SKY_UNIFORMS` cells, never by a `#define` flipped at run time, so the
 * weather never recompiles a shader. Everything is in world space (no seam at a chunk's edge, no
 * swim when the camera scrolls), and the snow cover and wetness are the sim's own (`groundAt`, with
 * its lattice hash ported to 32-bit unsigned GLSL), so the white edge on screen is where the tyres
 * lose grip. The sky host calls `applySurface` once a frame.
 *
 * @module render/sky/surface
 */
import { Ops } from "@typeonce/ritmo-math"
import {
  Color,
  type Material,
  ShaderChunk,
  type Vector2,
  type WebGLProgramParametersWithUniforms,
} from "three"

import { type Air, celsiusAt } from "../../sim/sky/climate.ts"
import { EDGE, FEATHER, MELT_BAND, MELT_FULL, REACH } from "../../sim/sky/local.ts"
import { SPEED, STAGE } from "../../sim/water/channel.ts"
import { ROCK_NORMAL_Y, yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { CUT_GLSL, CUT_UNIFORMS } from "../see-through.ts"
import { phaseLocked, SKY_UNIFORMS } from "./uniforms.ts"

/** The surface-weather variants: buildings, terrain, road decals, instanced trees, rivers, and the things that move (people, vehicles, tyre marks, smoke). */
export const VARIANTS = ["solid", "terrain", "road", "tree", "water", "actor"] as const
/** A surface-weather variant (one shader program each). */
export type Variant = (typeof VARIANTS)[number]

/**
 * What each variant draws, as the GLSL macros it defines: snow and wet ground (`GROUND`), roads half
 * cleared of snow with puddles (`ROAD`), canopies that sway (`TREE`), rain rings (`WATER`), and how
 * the see-through cut takes it (`render/see-through`): buildings and trees above the player's feet
 * (`CUT_ABOVE`), the ground above their feet on screen (`CUT_GROUND`). Every variant takes cloud
 * shadows; actors (people, vehicles, tyre marks, smoke) take nothing else: a person crossing the snow
 * line stays dressed, the clouds shade everything the sun lights, and the cut never hides an actor.
 */
const DEFINES = {
  solid: ["WEATHER_GROUND", "CUT_ABOVE"],
  terrain: ["WEATHER_GROUND", "CUT_GROUND"],
  road: ["WEATHER_GROUND", "WEATHER_ROAD", "CUT_GROUND"],
  tree: ["WEATHER_GROUND", "WEATHER_TREE", "CUT_ABOVE"],
  water: ["WEATHER_WATER", "CUT_GROUND"],
  actor: [],
} as const satisfies Record<Variant, ReadonlyArray<string>>

/** Snow settles fully on faces whose world normal's y is above this; it thins out down to the terrain's bare rock faces (`ROCK_NORMAL_Y`), which hold none. */
const SNOW_SETTLES = 0.8
/** Share of the snow that stays on a road: traffic packs it into ruts and clears the rest. */
const ROAD_SNOW = 0.6
/** Fully wet level ground loses this share of its albedo (Lagarde: porous surfaces darken by up to half), walls about a third as much. */
const WET_DARK = 0.4
/** The heights around the snow line the meltwater band spans, m: the edge's reach above, and the reach plus the band (MELT_BAND) below. */
const MELT_SPAN = { above: REACH, below: REACH + MELT_BAND } as const
/** Snow's albedo, linear: off-white below 1, so a sunlit slope keeps its facets instead of clipping. */
const SNOW = new Color(PALETTE.snow)

/** Cloud shadows: a field of three octaves of value noise over CELL m, repeating every PERIOD cells; edges SOFT wide in field units (≈ 30 m). */
const CLOUD = { cell: 240, period: 128, soft: 0.03 } as const
/** The cloud field repeats every this many metres: `driftClouds` wraps the drift on it, so float32 never loses the offset. */
const CLOUD_PERIOD = CLOUD.cell * CLOUD.period
/** Clouds cross the ground this many times faster than the wind at the focus (the wind aloft is stronger). */
const CLOUD_SPEED = 2.5
/** The longest step `driftClouds` takes, s: a hitch or a jump in sim time does not fling the clouds. */
const MAX_DT = 0.25
/**
 * The cloud field's value below which a share k/10 of the ground lies (k = 0…10), measured over
 * 400 000 points of it (surface.test.ts checks the shaded share against the cover); the ends sit past
 * the field, so a clear sky casts nothing and an overcast one covers everything.
 */
const FIELD_QUANTILES = [
  -0.1, 0.3126, 0.3712, 0.4179, 0.4584, 0.4972, 0.5354, 0.5753, 0.6202, 0.6778, 1.1,
] as const
/** How much of the direct light a cloud takes: fair-weather cumulus `thin`, an overcast sky all of it. */
const CLOUD_SHADE = { thin: 0.65, thick: 1 } as const

/** Tree sway: none below `from` m/s at the focus, then `perMs` m per m/s, at most `most` m (two texels on foot at the gust's peak). */
const SWAY = { from: 2, perMs: 0.012, most: 0.12 } as const
/** How far the canopies lean downwind on screen, in sway amplitudes, at full crosswind. */
const LEAN = 0.5
/** The canopies' gust, rad/s: two sines locked to whole turns in TIME_WRAP. */
const GUSTS = [phaseLocked(1.7), phaseLocked(3.1)] as const

/** Rain rings on the water: the share of 0.2 m cells that ring each 1/8 s at `at` mm/h, growing as rate^`power`, capped at `most`. */
const RIPPLES = { share: 0.02, at: 3, power: 0.6, most: 0.06 } as const
/**
 * The current's streaks: `length` × `width` m cells carried downstream at the water's speed, two phases `period` s apart
 * dissolving into each other so none stretches; a share of them shows, from `calm` on still water to `most` at `fast` m/s and over (TUNED by eye: slack water
 * is all but clear, a spate's rapids white with them).
 */
const STREAKS = { length: 1.6, width: 0.3, period: 2, calm: 0.02, most: 0.3, fast: 3 } as const
/**
 * Clear water over the river's pebbles: the limestone bed seen through it, tinted with the water's green. The water's own
 * colour shows from `clear` m of mean depth and fully from `full` (TUNED by eye: an ankle-deep torrent reads as wet gravel, a
 * spate as a river).
 */
const SHALLOWS = {
  colour: new Color(PALETTE.limestone).lerp(new Color(PALETTE.waterShallow), 0.6),
  clear: 0.05,
  full: 0.7,
} as const

/** A number as a GLSL float literal. */
const num = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n))

/** GLSL both stages share: the sim's lattice hash and value noise, the snow edge, the cloud field. */
const HELPERS = /* glsl */ `
varying vec3 vWeatherWorld;
// The sim's lattice hash (src/sim/sky/local.ts): 32-bit unsigned maths, the same value in [-1, 1).
float weatherLattice(vec2 c) {
  uvec2 u = uvec2(ivec2(c));
  uint h = (u.x * 0x27d4eb2du) ^ (u.y * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  return float(h) / 2147483648.0 - 1.0;
}
// The sim's smooth value noise in [-1, 1] over a lattice of \`cell\` m.
float weatherNoise(vec2 p, float cell) {
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 t = q - i;
  vec2 s = t * t * (3.0 - 2.0 * t);
  return mix(mix(weatherLattice(i), weatherLattice(i + vec2(1.0, 0.0)), s.x), mix(weatherLattice(i + vec2(0.0, 1.0)), weatherLattice(i + vec2(1.0, 1.0)), s.x), s.y);
}
// The sim's snow edge (snowEdge, its EDGE octaves): metres the snow line stands lower at map point p.
float weatherSnowEdge(vec2 p) { return ${EDGE.map(({ height, cell }) => `${num(height)} * weatherNoise(p, ${num(cell)})`).join(" + ")}; }
// Value noise on a lattice that repeats every \`period\` cells, q in cells.
float weatherCloudNoise(vec2 q, float period) {
  vec2 i = floor(q);
  vec2 t = q - i;
  vec2 s = t * t * (3.0 - 2.0 * t);
  vec2 a = mod(i, period);
  vec2 b = mod(i + 1.0, period);
  return mix(mix(weatherLattice(a), weatherLattice(vec2(b.x, a.y)), s.x), mix(weatherLattice(vec2(a.x, b.y)), weatherLattice(b), s.x), s.y);
}
#define WEATHER_CLOUD_CELL ${num(CLOUD.cell)}
#define WEATHER_CLOUD_PERIOD ${num(CLOUD.period)}
#define WEATHER_CLOUD_SOFT ${num(CLOUD.soft)}
// The cloud field at map point p, 0..1: it repeats every WEATHER_CLOUD_PERIOD cells.
float weatherClouds(vec2 p) {
  vec2 q = p / WEATHER_CLOUD_CELL;
  return 0.5 + 0.5 * (0.57 * weatherCloudNoise(q, WEATHER_CLOUD_PERIOD) + 0.29 * weatherCloudNoise(2.0 * q + vec2(37.0, 11.0), 2.0 * WEATHER_CLOUD_PERIOD)
    + 0.14 * weatherCloudNoise(4.0 * q + vec2(5.0, 23.0), 4.0 * WEATHER_CLOUD_PERIOD));
}
`

const VERTEX_PARS = /* glsl */ `
#ifdef WEATHER_WATER
attribute float stage;
attribute vec3 flow;
uniform float uRiverStage;
varying vec3 vRiverFlow;
varying float vRiverDepth;
#endif
#ifdef WEATHER_TREE
attribute float canopy;
uniform float uTime;
uniform float uSway;
uniform float uSwayLean;
uniform float uTexelsPerMetre;
uniform vec3 uSwayAxis;
#endif
`

/**
 * After `begin_vertex`: a river's surface lifted off its bed to the depth the rivers run at (its
 * vertex's `stage` × q^STAGE, as `waterAt` has it), the rest pose (what the snow and the clouds are locked to), then the tree's
 * sway. A canopy moves rigidly by whole texels along the camera's right (a sprite's wobble: the
 * static world never shimmers), converted back into the unit shape's frame (Rᵀ·w / s); the trunk
 * stays. The shadow pass draws the rest pose.
 */
const VERTEX_SWAY = /* glsl */ `
#ifdef WEATHER_WATER
  vRiverDepth = stage * uRiverStage;
  transformed.y += vRiverDepth;
  vRiverFlow = flow;
#endif
vec3 weatherRest = transformed;
#if defined( WEATHER_TREE ) && defined( USE_INSTANCING )
{
  vec3 root = instanceMatrix[3].xyz;
  float phase = dot(root.xz, vec2(0.11, 0.07)) + 3.0 * weatherLattice(floor(root.xz));
  float gust = uSwayLean + sin(uTime * ${GUSTS[0]} + phase) + 0.5 * sin(uTime * ${GUSTS[1]} + 1.7 * phase);
  float texels = floor(uSway * uTexelsPerMetre * gust + 0.5);
  mat3 m = mat3(instanceMatrix);
  transformed += canopy * (transpose(m) * (uSwayAxis * (texels / uTexelsPerMetre))) / dot(m[0], m[0]);
}
#endif
`

/** After `worldpos_vertex`: the rest pose in three space, for the fragment's world-locked patterns. */
const VERTEX_WORLD = /* glsl */ `
{
  vec4 weatherAt = vec4(weatherRest, 1.0);
  #ifdef USE_INSTANCING
    weatherAt = instanceMatrix * weatherAt;
  #endif
  vWeatherWorld = (modelMatrix * weatherAt).xyz;
}
`

const FRAGMENT_PARS = /* glsl */ `
uniform float uSnowLineY;
uniform float uWet;
uniform vec2 uMelt;
uniform float uCloudCut;
uniform float uCloudShade;
uniform vec2 uCloudOffset;
uniform vec3 uSkyColour;
uniform float uTime;
uniform float uRipples;
#ifdef WEATHER_WATER
varying vec3 vRiverFlow;
varying float vRiverDepth;
uniform float uRiverSpeed;
#endif
#define WEATHER_FEATHER ${num(FEATHER)}
#define WEATHER_MELT ${num(MELT_BAND)}
#define WEATHER_MELT_FULL ${num(MELT_FULL)}
#define WEATHER_TICKS 8.0
#if defined( CUT_ABOVE ) || defined( CUT_GROUND )
${CUT_GLSL}
#endif
`

/**
 * Before `lights_lambert_fragment` reads the albedo: snow and wetness as the sim's `groundAt` has
 * them at this point (cover over ±FEATHER m of the ragged edge; meltwater wetting a MELT m band
 * below it where the air thaws, fully from MELT_FULL °C), snow only on faces flatter than the
 * cliffs, drawn as a world-locked stipple of 0.25 m grains clumped by 1.5 m patches (a crisp
 * pixel-art edge); puddles on flat road that mirror the sky (≈ 11 % of it, fully wet); the current's
 * streaks and rain rings on the water; and the cloud over this point, which `weatherSun` takes off the directional light below.
 */
const fragmentSurface = (): string => /* glsl */ `
vec3 weatherNormal = transformNormalByInverseViewMatrix(normal, viewMatrix);
vec2 weatherMap = vec2(vWeatherWorld.x, -vWeatherWorld.z);
#ifdef WEATHER_GROUND
{
  float above = vWeatherWorld.y + weatherSnowEdge(weatherMap) - uSnowLineY;
  float cover = smoothstep(-WEATHER_FEATHER, WEATHER_FEATHER, above);
  float thaw = clamp((uMelt.x + uMelt.y * (vWeatherWorld.y - uSnowLineY)) / WEATHER_MELT_FULL, 0.0, 1.0);
  float wet = max(uWet, thaw * clamp(1.0 + above / WEATHER_MELT, 0.0, 1.0)) * (1.0 - cover);
  float settles = smoothstep(${num(ROCK_NORMAL_Y)}, ${num(SNOW_SETTLES)}, weatherNormal.y);
  #ifdef WEATHER_ROAD
    settles *= ${num(ROAD_SNOW)};
  #endif
  float grain = 0.5 + 0.5 * weatherLattice(floor(weatherMap * 4.0) + vec2(7919.0, 7907.0));
  float clump = 0.5 + 0.5 * weatherNoise(weatherMap + vec2(613.0, 307.0), 1.5);
  float snow = float(clamp(mix(grain, clump, 0.6), 0.002, 0.998) < cover * settles);
  diffuseColor.rgb *= 1.0 - ${num(WET_DARK)} * wet * mix(0.35, 1.0, clamp(weatherNormal.y, 0.0, 1.0));
  #ifdef WEATHER_ROAD
    float pool = 0.5 + 0.5 * weatherNoise(weatherMap + vec2(211.0, 401.0), 1.6);
    float puddle = (1.0 - snow) * step(0.97, weatherNormal.y) * float(pool > 1.0 - 0.23 * smoothstep(0.3, 1.0, wet));
    diffuseColor.rgb *= 1.0 - 0.6 * puddle;
    totalEmissiveRadiance += uSkyColour * (0.35 * puddle);
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${num(SNOW.r)}, ${num(SNOW.g)}, ${num(SNOW.b)}), snow);
}
#endif
#ifdef WEATHER_WATER
{
  // Shallow water shows the pebbles through it; the water's own colour, and the dark channel's, only where it is deep.
  diffuseColor.rgb = mix(vec3(${num(SHALLOWS.colour.r)}, ${num(SHALLOWS.colour.g)}, ${num(SHALLOWS.colour.b)}), diffuseColor.rgb, smoothstep(${num(SHALLOWS.clear)}, ${num(SHALLOWS.full)}, vRiverDepth));
}
{
  // The current: streaks carried downstream at the water's mean speed there, two phases crossfaded.
  vec2 down = normalize(vRiverFlow.xy + vec2(1e-6, 0.0));
  vec2 across = vec2(-down.y, down.x);
  float speed = vRiverFlow.z * uRiverSpeed;
  float share = mix(${num(STREAKS.calm)}, ${num(STREAKS.most)}, clamp(speed / ${num(STREAKS.fast)}, 0.0, 1.0));
  float streak = 0.0;
  for (int i = 0; i < 2; i++) {
    float phase = fract(uTime / ${num(STREAKS.period)} + 0.5 * float(i));
    vec2 q = weatherMap - down * (speed * ${num(STREAKS.period)} * phase);
    vec2 c = floor(vec2(dot(q, down) / ${num(STREAKS.length)}, dot(q, across) / ${num(STREAKS.width)}));
    float on = float(0.5 + 0.5 * weatherLattice(c + vec2(4001.0 * float(i), 3001.0)) > 1.0 - share);
    // Each streak shows for its own share of its phase's life, so the two phases dissolve into each other cell by cell.
    float life = 0.5 + 0.5 * weatherLattice(c + vec2(17.0, 4001.0 * float(i)));
    streak = max(streak, on * float(life < 1.0 - abs(2.0 * phase - 1.0)));
  }
  totalEmissiveRadiance += uSkyColour * (0.5 * streak);
}
{
  vec2 cell = floor(weatherMap * 5.0);
  float tick = floor(WEATHER_TICKS * uTime + WEATHER_TICKS * (0.5 + 0.5 * weatherLattice(cell)));
  float ring = float(0.5 + 0.5 * weatherLattice(cell + vec2(7.0, 13.0) * tick) < uRipples);
  totalEmissiveRadiance += uSkyColour * (0.6 * ring);
}
#endif
float weatherSun = 1.0 - uCloudShade * smoothstep(uCloudCut - WEATHER_CLOUD_SOFT, uCloudCut + WEATHER_CLOUD_SOFT, weatherClouds(weatherMap - uCloudOffset));
`

/** Drops a fragment the see-through cut takes (`render/see-through`): view-space position from three's Lambert varying. */
const CUT_FRAGMENT = /* glsl */ `
#if defined( CUT_ABOVE ) || defined( CUT_GROUND )
  if (cutAway(-vViewPosition, vWeatherWorld.y)) discard;
#endif
`

/** The r186 directional-light anchor in `lights_fragment_begin` (the pre-r151 form with `geometry` no longer matches). */
const DIR_LIGHT = "getDirectionalLightInfo( directionalLight, directLight );"

/** `source` with its only `anchor` replaced by `by`: throws when a three upgrade moves, renames or repeats it (no String.replace: `$&` in GLSL would be special). */
const replaceOnce = (source: string, anchor: string, by: string): string => {
  const at = source.indexOf(anchor)
  if (at < 0 || source.includes(anchor, at + 1))
    throw new Error(`shader anchor not found exactly once: ${anchor}`)
  return source.slice(0, at) + by + source.slice(at + anchor.length)
}

/** Rewrites a Lambert program's shaders as `variant` and hands it the shared `SKY_UNIFORMS` cells: pure, so a Node test runs it on `ShaderLib.lambert`. */
export const patchShader = (
  shader: Pick<WebGLProgramParametersWithUniforms, "vertexShader" | "fragmentShader" | "uniforms">,
  variant: Variant,
): void => {
  Object.assign(shader.uniforms, SKY_UNIFORMS, CUT_UNIFORMS) // the cells themselves, so every program of every material updates together
  const defines = DEFINES[variant].map((name) => `#define ${name}\n`).join("")
  let vertex = replaceOnce(
    shader.vertexShader,
    "#include <common>",
    `${defines}#include <common>\n${HELPERS}${VERTEX_PARS}`,
  )
  vertex = replaceOnce(vertex, "#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_SWAY}`)
  vertex = replaceOnce(
    vertex,
    "#include <worldpos_vertex>",
    `#include <worldpos_vertex>\n${VERTEX_WORLD}`,
  )
  let fragment = replaceOnce(
    shader.fragmentShader,
    "#include <common>",
    `${defines}#include <common>\n${HELPERS}${FRAGMENT_PARS}`,
  )
  // The see-through cut, first: a fragment it takes is not shaded at all.
  fragment = replaceOnce(
    fragment,
    "#include <clipping_planes_fragment>",
    `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`,
  )
  fragment = replaceOnce(
    fragment,
    "#include <lights_lambert_fragment>",
    `${fragmentSurface()}\n#include <lights_lambert_fragment>`,
  )
  // The cloud takes only the sun's (or moon's) light: the sky, headlights and street lamps still reach the ground under it.
  const lights = replaceOnce(
    ShaderChunk.lights_fragment_begin,
    DIR_LIGHT,
    `${DIR_LIGHT}\n\t\tdirectLight.color *= weatherSun;`,
  )
  fragment = replaceOnce(fragment, "#include <lights_fragment_begin>", lights)
  shader.vertexShader = vertex
  shader.fragmentShader = fragment
}

/** Makes `material` a weather-patched Lambert of `variant`, with its own program per variant. */
export const weatherMaterial = <M extends Material>(material: M, variant: Variant): M => {
  material.onBeforeCompile = (shader) => patchShader(shader, variant)
  // The default key is onBeforeCompile's source, the same for every variant: three would share the wrong program.
  material.customProgramCacheKey = () => `weather-${variant}`
  return material
}

/** What the surface needs from the sky each frame (see `applySurface`). */
export interface Surface {
  /** The snow line, m a.s.l. (`Weather.snowLine`; the sim's `NO_SNOW` lays none). */
  readonly snowLine: number
  /** Ground wetness where no snow lies, 0..1 (`Weather.wet`). */
  readonly wet: number
  /** The air now (`airAt(seconds, weather)`): where it is above freezing, meltwater wets the ground below the snow. */
  readonly air: Air
  /** Sky cover, 0..1 (`Weather.cloud`). */
  readonly cloudCover: number
  /** How far the clouds have drifted, map metres (x east, y north), from `driftClouds`. */
  readonly cloudOffset: { readonly x: number; readonly y: number }
  /** Wind at the focus, m/s, sim frame (`SkyFrame.wind`): the trees' sway. */
  readonly wind: { readonly x: number; readonly y: number }
  /** Rain falling at the focus, mm/h (`SkyFrame.rain`): rings on the water. */
  readonly rain: number
  /** What the rivers carry, m³/s per km² of catchment (`SkyViewModel.flow`): how high and fast they run. */
  readonly flow: number
  /** The view's zoom, texels per metre (`PixelView.texelsPerMetre`): the sway's whole texels. */
  readonly texelsPerMetre: number
  /** The camera's right axis, three space (`viewAxes(view.yaw).right`): the sway's direction. */
  readonly viewRight: { readonly x: number; readonly y: number; readonly z: number }
  /** What a puddle mirrors: the sky's linear radiance (the hemisphere's sky colour × its intensity). */
  readonly skyColour: Color
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** The cloud field's threshold for `cover` of the sky: the field's (1 − cover) quantile, so that share of the ground lies in shadow. */
const cloudCut = (cover: number): number => {
  const k = (1 - clamp01(cover)) * 10,
    i = Math.min(9, Math.floor(k))
  return FIELD_QUANTILES[i]! + (FIELD_QUANTILES[i + 1]! - FIELD_QUANTILES[i]!) * (k - i)
}

/** How much of the direct light a cloud takes under `cover` of the sky: none in a clear sky, `thin` up to 0.7, all of it overcast. */
const cloudShade = (cover: number): number =>
  cover < 0.01
    ? 0
    : CLOUD_SHADE.thin + (CLOUD_SHADE.thick - CLOUD_SHADE.thin) * clamp01((cover - 0.7) / 0.3)

/** The share of the direct light that reaches the ground under `cover`, on average: `cover` of it lies in cloud shadow (the sky's mean light, `light.ts`). */
export const throughClouds = (cover: number): number =>
  1 - clamp01(cover) * cloudShade(clamp01(cover))

/** Writes this frame's surface weather into `SKY_UNIFORMS`: the sky host calls it once per frame, before the scene renders. */
export const applySurface = (s: Surface): void => {
  const u = SKY_UNIFORMS
  u.uSnowLineY.value = yOf(s.snowLine)
  u.uWet.value = clamp01(s.wet)
  // The air's temperature across the meltwater band (70 m above the line down to 170 m below it) as a straight line: the sim's own, as
  // `celsiusAt` falls straight with height up to where the daily range reaches its floor, above 5.2 km in every month at Italy's
  // latitudes (surface.test.ts).
  const below = celsiusAt(s.air, s.snowLine - MELT_SPAN.below),
    over = celsiusAt(s.air, s.snowLine + MELT_SPAN.above)
  u.uMelt.value.set(
    celsiusAt(s.air, s.snowLine),
    (over - below) / (MELT_SPAN.above + MELT_SPAN.below),
  )
  const cover = clamp01(s.cloudCover)
  u.uCloudCut.value = cloudCut(cover)
  u.uCloudShade.value = cloudShade(cover)
  u.uCloudOffset.value.set(s.cloudOffset.x, s.cloudOffset.y)
  u.uSkyColour.value.copy(s.skyColour)
  // `Ops.pow`, not `**`: the map build imports this module, and its imports keep to the maths that
  // rounds the same on arm64 and x64 (map-key.test.ts).
  u.uRipples.value =
    s.rain > 0
      ? Math.min(RIPPLES.most, RIPPLES.share * Ops.pow(s.rain / RIPPLES.at, RIPPLES.power))
      : 0
  u.uRiverStage.value = s.flow > 0 ? Ops.pow(s.flow, STAGE) : 0
  u.uRiverSpeed.value = s.flow > 0 ? Ops.pow(s.flow, SPEED) : 0
  const speed = Math.hypot(s.wind.x, s.wind.y)
  u.uSway.value = Math.min(SWAY.most, SWAY.perMs * Math.max(0, speed - SWAY.from))
  // The wind's share along the camera's right: three x is east, three z is south.
  u.uSwayLean.value =
    speed > 0 ? (LEAN * (s.wind.x * s.viewRight.x - s.wind.y * s.viewRight.z)) / speed : 0
  u.uSwayAxis.value.set(s.viewRight.x, s.viewRight.y, s.viewRight.z)
  u.uTexelsPerMetre.value = s.texelsPerMetre
}

/** Moves the clouds `dt` sim seconds on with the wind at the focus (m/s, sim frame), in float64, wrapped into [0, CLOUD_PERIOD). */
export const driftClouds = (
  offset: Vector2,
  wind: { readonly x: number; readonly y: number },
  dt: number,
): Vector2 => {
  const step = Math.max(0, Math.min(MAX_DT, dt)) * CLOUD_SPEED
  const wrap = (v: number) => ((v % CLOUD_PERIOD) + CLOUD_PERIOD) % CLOUD_PERIOD
  return offset.set(wrap(offset.x + wind.x * step), wrap(offset.y + wind.y * step))
}
