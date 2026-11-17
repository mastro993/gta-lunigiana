/**
 * The water variant's part of the surface weather (`render/sky/surface`, `WEATHER_WATER`): the
 * rivers lifted to the level they run at, never under the sea's; the colour of shallow running
 * water, of a lake by its depth and of the sea by its depth with foam at its shore; the current's
 * streaks; and rain rings. Its attributes are `WaterTriangles`' (`render/geometry`), its uniforms
 * the shared `SKY_UNIFORMS` cells, written once a frame by `applyWater`.
 *
 * @module render/sky/water-shader
 */
import { Ops } from "@typeonce/ritmo-math"
import { Color } from "three"

import { SPEED, STAGE } from "../../sim/water/channel.ts"
import { PALETTE } from "../palette.ts"
import { glslFloat, SKY_UNIFORMS } from "./uniforms.ts"

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
/** Still water darkens toward the deep water's colour from `from` m deep to `to` (TUNED by eye: a lake's middle, 3 m at most, reads deep). */
const STILL_DEEP = { colour: new Color(PALETTE.waterDeep), from: 0.7, to: 2.5 } as const
/**
 * The sea: its shallows' colour (`PALETTE.seaShallow`, the vertex colour; measured a few metres out, under half a metre of
 * water) darkens to the deep sea's (`seaDeep`, measured 7–8 m deep) over `deep` m of depth, and it foams where it breaks on the
 * shore, under `foam` m (fully under `surf`, TUNED by eye), where the waves' foam lies on the measured flight.
 */
const SEA = {
  deep: { colour: new Color(PALETTE.seaDeep), from: 0, to: 6 },
  foam: { colour: new Color(PALETTE.foam), surf: 0.15, foam: 0.3 },
} as const

/** A colour as a GLSL vec3 of its linear channels. */
const vec3 = (c: Color): string => `vec3(${glslFloat(c.r)}, ${glslFloat(c.g)}, ${glslFloat(c.b)})`

/** The vertex stage's declarations. */
export const WATER_VERTEX_PARS = /* glsl */ `
attribute float stage;
attribute vec3 flow;
attribute float still;
attribute float held;
attribute float sea;
uniform float uRiverStage;
varying vec3 vRiverFlow;
varying float vRiverDepth;
varying float vStill;
varying float vSea;
`

/**
 * After `begin_vertex`: a river's surface lifted off its bed to the depth the rivers run at (its
 * vertex's `stage` × q^STAGE, as `waterAt` has it), at least up to the sea's level (`held`), where
 * the same flow runs slower through the deeper water; a lake's or the sea's `still` depth shades it
 * but lifts nothing.
 */
export const WATER_VERTEX = /* glsl */ `
  float riverFlowing = stage * uRiverStage;
  vRiverDepth = max(riverFlowing, held);
  transformed.y += vRiverDepth;
  vRiverFlow = vec3(flow.xy, held > riverFlowing ? flow.z * riverFlowing / held : flow.z);
  vRiverDepth += still;
  vStill = still;
  vSea = sea;
`

/** The fragment stage's declarations. */
export const WATER_FRAGMENT_PARS = /* glsl */ `
varying vec3 vRiverFlow;
varying float vRiverDepth;
varying float vStill;
varying float vSea;
uniform float uRiverSpeed;
`

/**
 * Before the lights read the albedo, after the weather helpers (`weatherMap`, `weatherLattice`): the water's colour by its
 * depth, the current's streaks and rain rings.
 */
export const WATER_FRAGMENT = /* glsl */ `
if (vSea > 0.5) {
  // The sea: its shallows darkening to the deep sea, foam where it breaks on the shore.
  diffuseColor.rgb = mix(diffuseColor.rgb, ${vec3(SEA.deep.colour)}, smoothstep(${glslFloat(SEA.deep.from)}, ${glslFloat(SEA.deep.to)}, vStill));
  diffuseColor.rgb = mix(${vec3(SEA.foam.colour)}, diffuseColor.rgb, smoothstep(${glslFloat(SEA.foam.surf)}, ${glslFloat(SEA.foam.foam)}, vStill));
} else {
  // Shallow water shows the pebbles through it; the water's own colour, and the dark channel's, only where it is deep.
  diffuseColor.rgb = mix(${vec3(SHALLOWS.colour)}, diffuseColor.rgb, smoothstep(${glslFloat(SHALLOWS.clear)}, ${glslFloat(SHALLOWS.full)}, vRiverDepth));
  // A lake darkens with its depth.
  diffuseColor.rgb = mix(diffuseColor.rgb, ${vec3(STILL_DEEP.colour)}, smoothstep(${glslFloat(STILL_DEEP.from)}, ${glslFloat(STILL_DEEP.to)}, vStill));
}
{
  // The current: streaks carried downstream at the water's mean speed there, two phases crossfaded.
  vec2 down = normalize(vRiverFlow.xy + vec2(1e-6, 0.0));
  vec2 across = vec2(-down.y, down.x);
  float speed = vRiverFlow.z * uRiverSpeed;
  float share = mix(${glslFloat(STREAKS.calm)}, ${glslFloat(STREAKS.most)}, clamp(speed / ${glslFloat(STREAKS.fast)}, 0.0, 1.0));
  float streak = 0.0;
  for (int i = 0; i < 2; i++) {
    float phase = fract(uTime / ${glslFloat(STREAKS.period)} + 0.5 * float(i));
    vec2 q = weatherMap - down * (speed * ${glslFloat(STREAKS.period)} * phase);
    vec2 c = floor(vec2(dot(q, down) / ${glslFloat(STREAKS.length)}, dot(q, across) / ${glslFloat(STREAKS.width)}));
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
`

/**
 * Writes the water's uniforms for rain falling at `rain` mm/h and rivers carrying `flow` m³/s per km² (`SkyViewModel.flow`):
 * the rain rings' share, and the rivers' depth and speed factors, q^STAGE and q^SPEED (water/channel).
 */
export const applyWater = (rain: number, flow: number): void => {
  const u = SKY_UNIFORMS
  // `Ops.pow`, not `**`: the map build imports this module, and its imports keep to the maths that
  // rounds the same on arm64 and x64 (map-key.test.ts).
  u.uRipples.value =
    rain > 0 ? Math.min(RIPPLES.most, RIPPLES.share * Ops.pow(rain / RIPPLES.at, RIPPLES.power)) : 0
  u.uRiverStage.value = flow > 0 ? Ops.pow(flow, STAGE) : 0
  u.uRiverSpeed.value = flow > 0 ? Ops.pow(flow, SPEED) : 0
}
