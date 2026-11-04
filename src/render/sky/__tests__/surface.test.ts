import assert from "node:assert/strict"
import { test } from "node:test"

import {
  Color,
  type IUniform,
  MeshLambertMaterial,
  ShaderChunk,
  ShaderLib,
  Vector2,
  Vector3,
} from "three"

import { DAY, daysFromCivil, utcFromRome } from "../../../sim/sky/calendar.ts"
import { airAt, type Air, celsiusAt, NO_SNOW, normalsAt } from "../../../sim/sky/climate.ts"
import {
  EDGE,
  groundAt,
  HIGHEST_SNOW,
  MELT_BAND,
  snowCoverAt,
  snowEdge,
} from "../../../sim/sky/local.ts"
import {
  actorMaterial,
  decalMaterial,
  solidMaterial,
  terrainMaterial,
  treeMaterial,
  waterMaterial,
} from "../../geometry.ts"
import { yOf } from "../../ground.ts"
import { viewAxes } from "../../pipeline.ts"
import { CUT_UNIFORMS } from "../../see-through.ts"
import {
  applySurface,
  driftClouds,
  patchShader,
  type Surface,
  VARIANTS,
  type Variant,
  weatherMaterial,
} from "../surface.ts"
import { SKY_UNIFORMS, TIME_WRAP } from "../uniforms.ts"

/** A fresh copy of three's Lambert program source, as `onBeforeCompile` receives it. */
const lambert = () => ({
  vertexShader: ShaderLib.lambert.vertexShader,
  fragmentShader: ShaderLib.lambert.fragmentShader,
  uniforms: {} as Record<string, IUniform>,
})
const count = (text: string, part: string): number => text.split(part).length - 1

test("patchShader rewrites three's Lambert program at each anchor exactly once, per variant", () => {
  for (const variant of VARIANTS) {
    const shader = lambert()
    patchShader(shader, variant)
    const { vertexShader: v, fragmentShader: f } = shader
    // The world position of the rest pose, and the surface block before the lights read the albedo.
    assert.equal(count(v, "vWeatherWorld = "), 1, `${variant}: world position written once`)
    assert.equal(count(v, "vec3 weatherRest = transformed;"), 1)
    assert.equal(count(f, "float weatherSun = "), 1, `${variant}: cloud shade computed once`)
    assert.ok(
      f.indexOf("float weatherSun = ") < f.indexOf("#include <lights_lambert_fragment>"),
      "before the albedo is lit",
    )
    // Cloud shadows patch the directional loop of an inlined copy of lights_fragment_begin, and only it.
    assert.equal(
      count(f, "#include <lights_fragment_begin>"),
      0,
      `${variant}: the chunk is inlined`,
    )
    assert.equal(count(f, "directLight.color *= weatherSun;"), 1)
    assert.equal(count(f, "getDirectionalLightInfo( directionalLight, directLight );"), 1)
    for (const anchor of [
      "#include <common>",
      "#include <begin_vertex>",
      "#include <worldpos_vertex>",
    ])
      assert.equal(count(v, anchor), 1, `${variant}: ${anchor} kept once`)
    for (const anchor of ["#include <common>", "#include <lights_lambert_fragment>"])
      assert.equal(count(f, anchor), 1, `${variant}: ${anchor} kept once`)
    assert.ok(
      !v.includes("$&") && !f.includes("$&"),
      "no String.replace pattern leaked into the GLSL",
    )
    // Snow and wet on the ground variants; the tree sways; water rings in the rain; actors only take cloud shadows.
    assert.equal(
      f.includes("#define WEATHER_GROUND"),
      variant === "solid" || variant === "terrain" || variant === "road" || variant === "tree",
      `${variant}: ground`,
    )
    // The see-through cut: buildings and trees above the player's feet, the ground above their row on screen, never an actor;
    // dropped before anything is shaded.
    assert.equal(f.includes("#define CUT_ABOVE"), variant === "solid" || variant === "tree")
    assert.equal(
      f.includes("#define CUT_GROUND"),
      variant === "terrain" || variant === "road" || variant === "water",
    )
    assert.equal(count(f, "if (cutAway(-vViewPosition, vWeatherWorld.y)) discard;"), 1)
    assert.ok(
      f.indexOf("cutAway(-vViewPosition") < f.indexOf("float weatherSun = "),
      `${variant}: cut before it is shaded`,
    )
    assert.equal(f.includes("#define WEATHER_ROAD"), variant === "road")
    assert.equal(v.includes("#define WEATHER_TREE"), variant === "tree")
    assert.equal(f.includes("#define WEATHER_WATER"), variant === "water")
  }
})

test("patchShader shares the sky's uniform cells by reference, and fails loudly when three moves an anchor", () => {
  const a = lambert(),
    b = lambert()
  patchShader(a, "solid")
  patchShader(b, "tree")
  for (const key of Object.keys(SKY_UNIFORMS) as Array<keyof typeof SKY_UNIFORMS>) {
    assert.equal(a.uniforms[key], SKY_UNIFORMS[key], `${key}: the very cell`)
    assert.equal(b.uniforms[key], SKY_UNIFORMS[key])
  }
  for (const key of Object.keys(CUT_UNIFORMS) as Array<keyof typeof CUT_UNIFORMS>)
    assert.equal(a.uniforms[key], CUT_UNIFORMS[key], `${key}: the cut's very cell`)
  assert.equal(
    count(
      ShaderChunk.lights_fragment_begin,
      "getDirectionalLightInfo( directionalLight, directLight );",
    ),
    1,
    "the r186 anchor",
  )
  const moved = {
    ...lambert(),
    fragmentShader: ShaderLib.lambert.fragmentShader.replace(
      "#include <lights_lambert_fragment>",
      "",
    ),
  }
  assert.throws(() => patchShader(moved, "solid"), /lights_lambert_fragment/)
})

test("each world material is its own weather variant with its own program key, one program per variant", () => {
  const expected: ReadonlyArray<readonly [MeshLambertMaterial, Variant]> = [
    [solidMaterial, "solid"],
    [terrainMaterial, "terrain"],
    [decalMaterial, "road"],
    [treeMaterial, "tree"],
    [waterMaterial, "water"],
    [actorMaterial, "actor"],
  ]
  const keys = expected.map(([material]) => material.customProgramCacheKey())
  assert.equal(new Set(keys).size, expected.length, `distinct keys: ${keys.join(", ")}`)
  for (const [material, variant] of expected)
    assert.ok(
      material.customProgramCacheKey().includes(variant),
      `${variant}: ${material.customProgramCacheKey()}`,
    )
  assert.equal(
    weatherMaterial(new MeshLambertMaterial(), "road").customProgramCacheKey(),
    decalMaterial.customProgramCacheKey(),
  )
  assert.ok(
    waterMaterial.polygonOffset && decalMaterial.polygonOffset && !solidMaterial.polygonOffset,
    "water and roads lie over the ground they cover",
  )
})

/** The GLSL's lattice hash and value noise, verbatim: `lattice` and `mirror`'s noise copy them line for line. */
const NOISE_GLSL = [
  `float weatherLattice(vec2 c) {
  uvec2 u = uvec2(ivec2(c));
  uint h = (u.x * 0x27d4eb2du) ^ (u.y * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  return float(h) / 2147483648.0 - 1.0;
}`,
  `float weatherNoise(vec2 p, float cell) {
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 t = q - i;
  vec2 s = t * t * (3.0 - 2.0 * t);
  return mix(mix(weatherLattice(i), weatherLattice(i + vec2(1.0, 0.0)), s.x), mix(weatherLattice(i + vec2(0.0, 1.0)), weatherLattice(i + vec2(1.0, 1.0)), s.x), s.y);
}`,
] as const

/** `weatherLattice` (NOISE_GLSL) in JS: `ivec2` → `uvec2` is the two's complement Math.imul works in, `>>` on a `uint` is `>>>`. */
const lattice = (i: number, j: number): number => {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 2147483648 - 1
}

/** The terrain's snow cover and wetness at three point (x, y, z), mirrored from its GLSL with the constants read out of it. */
const mirror = (() => {
  const f = lambert()
  patchShader(f, "terrain")
  const edge = [...f.fragmentShader.matchAll(/([\d.]+) \* weatherNoise\(p, ([\d.]+)\)/g)].map(
    (m) => ({ height: Number(m[1]), cell: Number(m[2]) }),
  )
  const feather = Number(/#define WEATHER_FEATHER ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const melt = Number(/#define WEATHER_MELT ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const meltFull = Number(/#define WEATHER_MELT_FULL ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const aspect = Number(/([\d.]+) \* north - uSnowLineY/.exec(f.fragmentShader)?.[1])
  const [, bare, full] = /rock = smoothstep\(([\d.]+), ([\d.]+), weatherNormal\.y\)/
    .exec(f.fragmentShader)!
    .map(Number)
  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t
  const noise = (px: number, py: number, cell: number) => {
    const fx = px / cell,
      fy = py / cell,
      ix = Math.floor(fx),
      iy = Math.floor(fy),
      tx = fx - ix,
      ty = fy - iy
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty)
    return mix(
      mix(lattice(ix, iy), lattice(ix + 1, iy), sx),
      mix(lattice(ix, iy + 1), lattice(ix + 1, iy + 1), sx),
      sy,
    )
  }
  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  return {
    edge,
    feather,
    melt,
    aspect,
    edgeAt: (mx: number, my: number) =>
      edge.reduce((sum, { height, cell }) => sum + height * noise(mx, my, cell), 0),
    /** The cover, the share of it that settles and the wetness at three point (x, y, z) on a face whose world normal is `n`, from the cells `applySurface` wrote. */
    ground: (x: number, y: number, z: number, n: Vector3 = new Vector3(0, 1, 0)) => {
      const { uSnowLineY, uWet, uMelt } = SKY_UNIFORMS
      const above =
        y +
        edge.reduce((sum, { height, cell }) => sum + height * noise(x, -z, cell), 0) +
        aspect * -n.z -
        uSnowLineY.value
      const cover = smoothstep(-feather, feather, above)
      const thaw = Math.max(
        0,
        Math.min(1, (uMelt.value.x + uMelt.value.y * (y - uSnowLineY.value)) / meltFull),
      )
      const settles = smoothstep(bare!, full!, n.y)
      return {
        cover,
        settles,
        wet:
          Math.max(uWet.value, thaw * Math.max(0, Math.min(1, 1 + above / melt))) *
          (1 - cover * settles),
      }
    },
  }
})()

test("the GLSL holds verbatim the hash, noise, snow and wet lines `mirror` copies: map north is three's −z, the edge raises the ground, a north face lowers the line but a road's does not, wet only off the snow", () => {
  const f = lambert()
  patchShader(f, "solid")
  // Only the terrain's snow line follows its faces' aspect: roads, decks, roofs and crowns take the level line, as the sim's
  // facingAt gives all but the terrain.
  for (const variant of VARIANTS) {
    const g = lambert()
    patchShader(g, variant)
    assert.equal(
      g.fragmentShader.includes("#define WEATHER_ASPECT"),
      variant === "terrain",
      variant,
    )
  }
  for (const line of [
    ...NOISE_GLSL,
    `float weatherSnowEdge(vec2 p) { return ${EDGE.map(({ height, cell }) => `${height.toFixed(1)} * weatherNoise(p, ${cell.toFixed(1)})`).join(" + ")}; }`,
    "vec2 weatherMap = vec2(vWeatherWorld.x, -vWeatherWorld.z);",
    "float north = 0.0;",
    "float north = -weatherNormal.z;",
    `float above = vWeatherWorld.y + weatherSnowEdge(weatherMap) + ${mirror.aspect.toFixed(1)} * north - uSnowLineY;`,
    "float cover = smoothstep(-WEATHER_FEATHER, WEATHER_FEATHER, above);",
    "float thaw = clamp((uMelt.x + uMelt.y * (vWeatherWorld.y - uSnowLineY)) / WEATHER_MELT_FULL, 0.0, 1.0);",
    "float wet = max(uWet, thaw * clamp(1.0 + above / WEATHER_MELT, 0.0, 1.0)) * (1.0 - cover * rock);",
  ])
    assert.equal(count(f.fragmentShader, line), 1, line)
})

/** The air at 10:00 on a mild January morning (the snow thawing at its line) and at dawn on a frosty one. */
const january = (hour: number, anomaly: number): Air =>
  airAt(utcFromRome(daysFromCivil(2027, 1, 16) * DAY + hour * 3600), {
    cloud: 0.2,
    wind: 2,
    anomaly,
  })

test("the white edge on screen is where the tyres lose grip: the shader's snow cover and wetness are the sim's, point by point", () => {
  assert.equal(mirror.edge.length, 2, "two octaves read out of the GLSL")
  // The edge noise itself, across lattice cells of both octaves, negative coordinates included.
  for (const [x, y] of [
    [0, 0],
    [2364, -5129],
    [-412.9, 438.1],
    [17.5, -80.25],
    [-1751, 3360],
    [4210, -2454],
    [79.99, 20.01],
  ] as const) {
    assert.ok(Math.abs(mirror.edgeAt(x, y) - snowEdge(x, y)) < 1e-9, `edge at (${x}, ${y})`)
  }
  // Points around a snow line on Monte Sagro's flanks, in three space (x, render y, −north), in a thaw and in a frost, and around a
  // low line in a thaw.
  const wet = 0.3
  let edges = 0,
    melting = 0,
    worst = 0
  for (const [snowLine, air] of [
    [1500, january(14, 6)],
    [1500, january(7, -4)],
    [600, january(14, 0)],
  ] as const) {
    applySurface({ ...calm, snowLine, wet, air })
    for (let k = 0; k < 2000; k++) {
      const x = 2000 + ((k * 7919) % 900),
        north = -5400 + ((k * 104729) % 700),
        z = snowLine - 420 + ((k * 31) % 720)
      // A face of every slope up to 55° (bare rock from 50°) and every aspect: its normal in three space, and as the sim's facing.
      const slope = (((k * 17) % 56) * Math.PI) / 180,
        aspect = k * 2.399963,
        n = new Vector3(
          Math.sin(slope) * Math.sin(aspect),
          Math.cos(slope),
          -Math.sin(slope) * Math.cos(aspect),
        ),
        facing = () => ({ north: -n.z, up: n.y })
      const shader = mirror.ground(x, yOf(z), -north, n)
      const sim = groundAt({ wet, snowLine }, x, north, z, air, facing)
      assert.ok(
        Math.abs(shader.cover * shader.settles - snowCoverAt(snowLine, x, north, z, facing)) < 1e-9,
        `cover at (${x}, ${north}, ${z} m)`,
      )
      assert.ok(Math.abs(shader.cover * shader.settles - sim.snow) < 1e-9)
      worst = Math.max(worst, Math.abs(shader.wet - sim.wet))
      if (shader.cover > 0.05 && shader.cover < 0.95) edges++
      if (sim.wet > wet + 0.05) melting++
    }
  }
  assert.ok(
    worst < 1e-9,
    `wetness ${worst} off the sim's: the air is a straight line across the band`,
  )
  assert.ok(
    edges > 100 && melting > 100,
    `${edges} points in the edge's feather, ${melting} wetted by meltwater`,
  )
  assert.ok(
    celsiusAt(january(7, -4), 1500) < 0 && celsiusAt(january(14, 6), 1500) > 1,
    "one frost, one thaw",
  )
  // No snow anywhere, and the plain wetness, under the sim's no-snow line.
  applySurface({ ...calm, snowLine: NO_SNOW, wet: 0.4, air: january(14, 6) })
  assert.deepEqual(mirror.ground(2364, yOf(1748), 5129), { cover: 0, settles: 1, wet: 0.4 })
})

test("the meltwater band's air is the sim's: a straight line in height wherever snow can lie in Italy, in every month, hour and weather", () => {
  // `celsiusAt` bends only where the daily range reaches its floor: above 5.2 km in every month from 35.5 to 47.1 N (7.6 km north
  // of 44 N), over Italy's highest ground (4808 m); a snow line above a map's top is the sim's `NO_SNOW`, over no ground at all.
  let worst = 0
  for (const lat of [35.5, 38, 42, 44.16, 45.5, 47.1]) {
    for (let day = 0; day < 365; day += 5) {
      const t = utcFromRome((daysFromCivil(2027, 1, 1) + day) * DAY + ((day * 7) % 24) * 3600)
      // The day's swing of the range, from the coldest hour under a clear calm sky to the warmest (`rangeShare` up to 1.15).
      for (const swing of [-0.575, 0, 0.575]) {
        const air: Air = { normals: normalsAt(t, lat), swing, anomaly: -3 }
        for (let snowLine = 0; snowLine <= 4810; snowLine += 370) {
          applySurface({ ...calm, snowLine, air })
          const { x: atLine, y: perMetre } = SKY_UNIFORMS.uMelt.value
          for (let z = snowLine - HIGHEST_SNOW - MELT_BAND; z <= snowLine + HIGHEST_SNOW; z += 10)
            worst = Math.max(
              worst,
              Math.abs(atLine + perMetre * (z - snowLine) - celsiusAt(air, z)),
            )
        }
      }
    }
  }
  assert.ok(worst < 1e-9, `the band's line is ${worst} °C off the sim's air`)
})

/** The cloud field of the shader, mirrored: three octaves of periodic value noise over 240 m cells. */
const clouds = (() => {
  const f = lambert()
  patchShader(f, "solid")
  const cell = Number(/#define WEATHER_CLOUD_CELL ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const period = Number(/#define WEATHER_CLOUD_PERIOD ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const soft = Number(/#define WEATHER_CLOUD_SOFT ([\d.]+)/.exec(f.fragmentShader)?.[1])
  const mod = (a: number, b: number) => a - b * Math.floor(a / b)
  const noise = (qx: number, qy: number, p: number) => {
    const ix = Math.floor(qx),
      iy = Math.floor(qy),
      tx = qx - ix,
      ty = qy - iy,
      sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty)
    const ax = mod(ix, p),
      ay = mod(iy, p),
      bx = mod(ix + 1, p),
      by = mod(iy + 1, p)
    const s = lattice(ax, ay) + (lattice(bx, ay) - lattice(ax, ay)) * sx,
      n = lattice(ax, by) + (lattice(bx, by) - lattice(ax, by)) * sx
    return s + (n - s) * sy
  }
  const field = (x: number, y: number) => {
    const qx = x / cell,
      qy = y / cell
    return (
      0.5 +
      0.5 *
        (0.57 * noise(qx, qy, period) +
          0.29 * noise(2 * qx + 37, 2 * qy + 11, 2 * period) +
          0.14 * noise(4 * qx + 5, 4 * qy + 23, 4 * period))
    )
  }
  const shade = (cut: number, x: number, y: number) => {
    const t = Math.max(0, Math.min(1, (field(x, y) - cut + soft) / (2 * soft)))
    return t * t * (3 - 2 * t)
  }
  return { cell, period, field, shade }
})()

const calm: Surface = {
  snowLine: NO_SNOW,
  wet: 0,
  flow: 0.04,
  air: january(12, 0),
  cloudCover: 0,
  cloudOffset: { x: 0, y: 0 },
  wind: { x: 0, y: 0 },
  rain: 0,
  texelsPerMetre: 8,
  viewRight: viewAxes(0).right,
  skyColour: new Color(0.4, 0.5, 0.6),
}

test("cloud shadows cover the share of the ground the sky's cover says, darker under a thick sky, none under a clear one", () => {
  for (const cover of [0.1, 0.3, 0.5, 0.65, 0.9]) {
    applySurface({ ...calm, cloudCover: cover })
    let shaded = 0
    const n = 6000
    for (let k = 0; k < n; k++)
      shaded += clouds.shade(
        SKY_UNIFORMS.uCloudCut.value,
        ((k * 7919) % 30011) * 1.37,
        ((k * 104729) % 29989) * 1.13,
      )
    assert.ok(
      Math.abs(shaded / n - cover) < 0.05,
      `cover ${cover}: ${(shaded / n).toFixed(3)} of the ground in cloud shadow`,
    )
  }
  applySurface({ ...calm, cloudCover: 0 })
  assert.equal(SKY_UNIFORMS.uCloudShade.value, 0, "a clear sky casts none")
  applySurface({ ...calm, cloudCover: 0.3 })
  const fair = SKY_UNIFORMS.uCloudShade.value
  applySurface({ ...calm, cloudCover: 1 })
  assert.ok(
    fair > 0.5 && SKY_UNIFORMS.uCloudShade.value > fair && SKY_UNIFORMS.uCloudShade.value <= 1,
    "an overcast sky takes the direct sun",
  )
})

test("clouds drift with the wind in sim time, wrapped on the field's period in float64; a hitch does not fling them", () => {
  const CLOUD_PERIOD = clouds.cell * clouds.period,
    offset = new Vector2()
  for (let f = 0; f < 60 * 600; f++) driftClouds(offset, { x: 4, y: -3 }, 1 / 60)
  const drift = offset.clone()
  assert.ok(drift.x >= 0 && drift.x < CLOUD_PERIOD && drift.y >= 0 && drift.y < CLOUD_PERIOD)
  // Ten minutes at (4, −3) m/s, times the clouds' speed over the ground's wind: the same as one long step would give, wrapped.
  const once = new Vector2()
  for (let s = 0; s < 2400; s++) driftClouds(once, { x: 4, y: -3 }, 0.25)
  assert.ok(once.distanceTo(drift) < 1e-6, `${once.toArray()} vs ${drift.toArray()}`)
  assert.ok(
    Math.abs(clouds.field(100, 200) - clouds.field(100 + CLOUD_PERIOD, 200 - CLOUD_PERIOD)) < 1e-12,
    "the field repeats on the period",
  )
  const hitch = new Vector2()
  driftClouds(hitch, { x: 10, y: 0 }, 5)
  driftClouds(hitch, { x: 10, y: 0 }, -1)
  assert.ok(
    hitch.x > 0 && hitch.x <= 10 * 0.25 * 3,
    `a 5 s hitch drifts as one capped step: ${hitch.x}`,
  )
})

test("trees sway only in wind, by whole texels along the camera's right, on frequencies that keep their phase across the time wrap", () => {
  applySurface(calm)
  assert.equal(SKY_UNIFORMS.uSway.value, 0, "still air: not a texel of shimmer")
  applySurface({ ...calm, wind: { x: 1.5, y: -1 } })
  assert.equal(SKY_UNIFORMS.uSway.value, 0, "a breeze: still")
  applySurface({ ...calm, wind: { x: 6, y: 0 } })
  const breezy = SKY_UNIFORMS.uSway.value
  applySurface({ ...calm, wind: { x: 30, y: 0 } })
  assert.ok(breezy > 0 && SKY_UNIFORMS.uSway.value > breezy, "more wind, more sway")
  assert.ok(SKY_UNIFORMS.uSway.value * 8 * 2.5 < 2.5, "at most two texels on foot in a gale")
  // Home view: screen right points south-west on the ground, so a wind toward the south-west leans the canopies right.
  const right = viewAxes(0).right
  applySurface({ ...calm, wind: { x: -6, y: -6 }, viewRight: right })
  assert.ok(SKY_UNIFORMS.uSwayLean.value > 0.3)
  assert.deepEqual(SKY_UNIFORMS.uSwayAxis.value.toArray(), right.toArray())
  const shader = lambert()
  patchShader(shader, "tree")
  const rates = [shader.vertexShader, shader.fragmentShader].flatMap((source) =>
    [...source.matchAll(/uTime\s*\*\s*([0-9.]+)/g)].map((m) => Number(m[1])),
  )
  assert.equal(rates.length, 2, "the two gusts")
  for (const w of rates) {
    const cycles = (w * TIME_WRAP) / (2 * Math.PI)
    assert.ok(
      Math.abs(cycles - Math.round(cycles)) < 1e-4,
      `${w} rad/s runs ${cycles} cycles per wrap`,
    )
  }
})

test("applySurface writes the snow line in render y, the wetness, the sky a puddle shows and the rain rings, into the same cells", () => {
  const cells = { ...SKY_UNIFORMS }
  applySurface({
    ...calm,
    snowLine: 1200,
    wet: 0.7,
    rain: 4,
    texelsPerMetre: 6,
    skyColour: new Color(0.2, 0.3, 0.4),
  })
  assert.equal(SKY_UNIFORMS.uSnowLineY.value, yOf(1200))
  assert.equal(SKY_UNIFORMS.uWet.value, 0.7)
  assert.equal(SKY_UNIFORMS.uTexelsPerMetre.value, 6)
  assert.deepEqual(SKY_UNIFORMS.uSkyColour.value.toArray(), [0.2, 0.3, 0.4])
  const rings = SKY_UNIFORMS.uRipples.value
  applySurface({ ...calm, rain: 12 })
  assert.ok(
    rings > 0 && SKY_UNIFORMS.uRipples.value > rings && SKY_UNIFORMS.uRipples.value < 0.1,
    "more rain, more rings, never a boil",
  )
  applySurface(calm)
  assert.equal(SKY_UNIFORMS.uRipples.value, 0)
  for (const key of Object.keys(cells) as Array<keyof typeof cells>)
    assert.equal(SKY_UNIFORMS[key], cells[key], `${key}: the same cell`)
  assert.ok(SKY_UNIFORMS.uSwayAxis.value instanceof Vector3)
})
