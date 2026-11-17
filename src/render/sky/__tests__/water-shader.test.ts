import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, type IUniform, ShaderLib } from "three"

import { PALETTE } from "../../palette.ts"
import { patchShader } from "../surface.ts"
import { glslFloat } from "../uniforms.ts"

/** The water variant's program, as `onBeforeCompile` leaves it. */
const water = (() => {
  const shader = {
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
    uniforms: {} as Record<string, IUniform>,
  }
  patchShader(shader, "water")
  return shader
})()

/** A palette colour as the GLSL vec3 of its linear channels. */
const vec3 = (hex: number) => {
  const c = new Color(hex)
  return `vec3(${glslFloat(c.r)}, ${glslFloat(c.g)}, ${glslFloat(c.b)})`
}

test("water shader: a river rises with its flow but never under the sea's level, the same flow slower in the water the sea holds up; lakes and the sea lift nothing", () => {
  const v = water.vertexShader
  for (const line of [
    "attribute float held;",
    "attribute float sea;",
    "float riverFlowing = stage * uRiverStage;",
    "vRiverDepth = max(riverFlowing, held);",
    "transformed.y += vRiverDepth;",
    "vRiverFlow = vec3(flow.xy, held > riverFlowing ? flow.z * riverFlowing / held : flow.z);",
    "vRiverDepth += still;",
  ])
    assert.ok(v.includes(line), line)
  assert.ok(
    v.indexOf("transformed.y += vRiverDepth;") < v.indexOf("vec3 weatherRest = transformed;"),
    "lifted before the rest pose the clouds lock to",
  )
})

test("water shader: the sea ramps from its shallows to the deep sea's colour over 0–6 m and foams under 0.3 m; lakes and rivers keep their colours", () => {
  const f = water.fragmentShader
  assert.ok(f.includes("if (vSea > 0.5) {"), "the sea's own colour")
  assert.ok(
    f.includes(`mix(diffuseColor.rgb, ${vec3(PALETTE.seaDeep)}, smoothstep(0.0, 6.0, vStill))`),
    "toward the deep sea's colour from 0 to 6 m",
  )
  assert.ok(
    f.includes(`mix(${vec3(PALETTE.foam)}, diffuseColor.rgb, smoothstep(0.15, 0.3, vStill))`),
    "foam under 0.3 m, whole under 0.15",
  )
  assert.ok(
    f.includes(`${vec3(PALETTE.waterDeep)}, smoothstep(0.7, 2.5, vStill)`),
    "a lake darkens as before",
  )
})
