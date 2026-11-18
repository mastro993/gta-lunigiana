import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, type IUniform, ShaderLib } from "three"

import { PALETTE } from "../../palette.ts"
import { patchShader } from "../surface.ts"
import { glslFloat } from "../uniforms.ts"
import { seaShare } from "../water-shader.ts"

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

test("water shader: the sea ramps from its shallows to the deep sea's colour over 0–6 m and foams under 0.3 m, a crisp edge (the user's choice), river water it holds up never; lakes and rivers keep their colours", () => {
  const f = water.fragmentShader
  assert.ok(
    f.includes(
      `vec3 sea = mix(${vec3(PALETTE.seaShallow)}, ${vec3(PALETTE.seaDeep)}, smoothstep(0.0, 6.0, vRiverDepth));`,
    ),
    "toward the deep sea's colour from 0 to 6 m",
  )
  assert.ok(
    f.includes(`if (vLift <= 0.0) sea = mix(${vec3(PALETTE.foam)}, sea, step(0.3, vRiverDepth));`),
    "foam wholly under 0.3 m and none over it, on the sea's own water, which no river lifts",
  )
  assert.ok(
    water.vertexShader.indexOf("vLift = vRiverDepth;") <
      water.vertexShader.indexOf("vRiverDepth += still;"),
    "the lift is the river's alone, before still water's depth",
  )
  assert.ok(!f.includes("smoothstep(0.15"), "no soft edge to the foam")
  assert.ok(
    f.includes(`${vec3(PALETTE.waterDeep)}, smoothstep(0.7, 2.5, vStill)`),
    "a lake darkens as before",
  )
})

test("water shader: each vertex's share of the sea's look (`sea`) takes it from the river's and the lake's look, none at 0, to the sea's, whole at 1", () => {
  const v = water.vertexShader,
    f = water.fragmentShader
  assert.ok(v.includes("vSea = sea;"), "the share carried to the fragment")
  assert.ok(f.includes("if (vSea < 1.0) {"), "the river's and the lake's look under it")
  assert.ok(f.includes("if (vSea > 0.0) {"), "the sea's over it")
  assert.ok(f.includes("diffuseColor.rgb = mix(diffuseColor.rgb, sea, vSea);"), "blended by it")
  assert.ok(
    f.indexOf("if (vSea < 1.0) {") < f.indexOf(`${vec3(PALETTE.waterDeep)}, smoothstep(0.7`) &&
      f.indexOf(`${vec3(PALETTE.waterDeep)}, smoothstep(0.7`) < f.indexOf("if (vSea > 0.0) {"),
    "the river's look first, the sea's over it",
  )
})

test("seaShare: river water the sea holds up takes the sea's look by how far it holds it, none to 0.5 m (the plain's ditches), whole from 1.2 m (the Magra, its bed 1.0–3.2 m under the sea), with no step between", () => {
  for (const hold of [0, 0.07, 0.3, 0.5]) assert.equal(seaShare(hold), 0, `${hold} m`)
  for (const hold of [1.2, 1.3, 3.23]) assert.equal(seaShare(hold), 1, `${hold} m`)
  let last = 0,
    steepest = 0
  for (let mm = 0; mm <= 1500; mm++) {
    const share = seaShare(mm / 1000)
    assert.ok(share >= last, `growing at ${mm} mm`)
    steepest = Math.max(steepest, share - last)
    last = share
  }
  assert.ok(steepest < 0.0025, `at most ${steepest.toFixed(4)} a millimetre`)
})
