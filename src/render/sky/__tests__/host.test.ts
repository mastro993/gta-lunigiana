import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, Group, Vector2, Vector3 } from "three"

import { heightAt } from "../../../sim/map/index.ts"
import { moonAt, skyDirection, sunAt } from "../../../sim/sky/astro.ts"
import { DAY, daysFromCivil, utcFromRome } from "../../../sim/sky/calendar.ts"
import { place, providePlace } from "../../../sim/sky/place.ts"
import type { Regime } from "../../../sim/sky/regimes.ts"
import { initialWeather, setWeather } from "../../../sim/sky/weather.ts"
import { yOf } from "../../ground.ts"
import { SkyHost } from "../host.ts"
import { SHADOW_FLOOR } from "../light.ts"
import { makePost } from "../post.ts"
import { SKY_UNIFORMS } from "../uniforms.ts"

/** Monzone, the spawn: the view's focus (three space, or at map point (x, y)) and a 1280 × 720 screen's texels. */
const X = -412.9,
  Y = 438.1
const view = (x = X, y = Y, yaw = 0) => {
  const focus = new Vector3(x, yOf(heightAt(x, y)), -y),
    size = new Vector2(427, 240)
  return { focus, yaw, texelsPerMetre: 8, view: size, post: makePost() }
}
const renderer = () => ({
  shadowMap: { autoUpdate: true, needsUpdate: false },
  clear: new Color(),
  setClearColor(c: Color) {
    this.clear.copy(c)
  },
})
/** UTC second of Rome's `hour` on 22 October 2026. */
const at = (hour: number) => utcFromRome(daysFromCivil(2026, 10, 22) * DAY + hour * 3600)
/** The weather settled on `regime` at `t`. */
const weather = (regime: Regime, t: number) =>
  setWeather(initialWeather(t, 1), { regime, settle: true }, t)!

/** One drawn frame of a fresh host: game time `t`, the weather settled on `regime`, the view at map point `at` (the spawn). */
const drawn = (t: number, regime: Regime, at: readonly [number, number] = [X, Y]) => {
  const host = new SkyHost(new Group(), { reduced: () => false }),
    r = renderer(),
    v = view(...at)
  host.sky(t, 1, weather(regime, t), 10, 0.04)
  host.draw(v, r)
  return { host, r, post: v.post }
}

// Regression: the moon was worked out over `MAP.origin` and the sun over the sky's place, so on another map the two would part.
test("the sun and the moon stand over the loaded map's place, wherever it lies", () => {
  // Cesena's origin (PR #37), 2.1° east of the shipped map's: the moon there differs by about a degree.
  const home = place(),
    cesena = { ...home, lat: 44.1391, lon: 12.2429 },
    t = at(21)
  const there = moonAt(t, cesena.lat, cesena.lon),
    sun = sunAt(t, cesena.lat, cesena.lon)
  assert.ok(
    Math.abs(moonAt(t, home.lat, home.lon).azimuth - there.azimuth) > 0.5,
    "the two places' moons differ",
  )
  providePlace(cesena)
  try {
    const look = drawn(t, "clear").host.look!
    assert.ok(
      Math.abs(look.moon.azimuth - there.azimuth) < 1e-9 &&
        Math.abs(look.moon.elevation - there.elevation) < 1e-9,
      `moon ${look.moon.azimuth}° vs ${there.azimuth}°`,
    )
    assert.ok(
      Math.abs(look.sun.azimuth - sun.azimuth) < 1e-9 &&
        Math.abs(look.sun.elevation - sun.elevation) < 1e-9,
      "the sun too",
    )
  } finally {
    providePlace(home)
  }
})

// Regression: the key light turned with the view's yaw, so a quarter turn or the driving view swung the shadows round with the camera.
test("the sun lights the map from where it really stands, whichever way the view looks", () => {
  // 22 October 2026, 12:00 in Rome: the sun about 34° up in the south.
  const t = at(12),
    { lat, lon } = place(),
    sun = sunAt(t, lat, lon),
    d = skyDirection(sun.azimuth, sun.elevation),
    real = new Vector3(d.x, d.z, -d.y)
  assert.ok(sun.elevation > SHADOW_FLOOR, "high enough that the shadow floor does not lift it")
  for (const yaw of [0, Math.PI / 2, -Math.PI, 1]) {
    const host = new SkyHost(new Group(), { reduced: () => false })
    host.sky(t, 1, weather("clear", t), 10, 0.04)
    host.draw(view(X, Y, yaw), renderer())
    assert.ok(host.toKey.distanceTo(real) < 1e-9, `yaw ${yaw}: ${host.toKey.toArray()}`)
  }
})

// Regression: puddles and rain rings mirrored the hemisphere's sky colour itself, π times the sky's radiance, so wet roads showed white blots.
test("puddles and rain rings mirror the sky's radiance: the hemisphere's sky light over π", () => {
  const { host } = drawn(at(12), "rain")
  const sky = host.hemisphere.color,
    mirror = SKY_UNIFORMS.uSkyColour.value
  for (const c of ["r", "g", "b"] as const)
    assert.ok(
      Math.abs(mirror[c] - sky[c] / Math.PI) < 1e-9,
      `${c}: ${mirror[c]} vs ${sky[c] / Math.PI}`,
    )
})

test("the shadow pass runs under a clear or cloudy sun and is skipped on a moonless night and under a full overcast", () => {
  assert.equal(drawn(at(12), "clear").r.shadowMap.autoUpdate, true)
  assert.equal(drawn(at(12), "cloudy").r.shadowMap.autoUpdate, true, "a cloudy sky has sunny gaps")
  // 22 October 2026, 05:30: the moon is down too.
  const night = drawn(at(5.5), "clear")
  assert.equal(
    night.host.look?.moon.elevation !== undefined && night.host.look.moon.elevation < 0,
    true,
  )
  assert.equal(night.r.shadowMap.autoUpdate, false)
  const overcast = weather("rain", at(12))
  assert.equal(overcast.cloud, 1, "the rain regime settles on a full cover")
  assert.equal(drawn(at(12), "rain").r.shadowMap.autoUpdate, false)
})

test("the lamps and the exposure land at once on the first frame and after a clock jump, and ease otherwise", () => {
  const host = new SkyHost(new Group(), { reduced: () => false }),
    v = view(),
    r = renderer()
  host.sky(at(12), 1, weather("clear", at(12)), 10, 0.04)
  host.draw(v, r)
  assert.equal(host.frame?.lamps, 0)
  // A frame later, the clock running at its rate, a storm settles: the lamps' target is on, and they only start to fade in.
  host.sky(at(12) + 1, 1, weather("storm", at(12)), 10 + 1 / 60, 0.04)
  host.draw(v, r)
  assert.ok(
    host.look!.light.lamps > 0.9 && host.frame.lamps > 0 && host.frame.lamps < 0.05,
    `eased: ${host.frame.lamps}`,
  )
  assert.ok(host.look!.exposure < host.look!.light.exposure, "the eye opens slowly")
  // Ten hours on in one frame: a dev-menu jump to the night.
  host.sky(at(22), 1, weather("clear", at(22)), 10 + 2 / 60, 0.04)
  host.draw(v, r)
  assert.ok(
    host.frame.lamps > 0.99 && host.look!.exposure === host.look!.light.exposure,
    "landed at once",
  )
})

// Regression: the fog took 0.8 of the key light at any sun height, so the low sun of an 08:00 valley fog dyed it beige (blue/red 0.64).
test("the fog is lit mostly by the sky: the sun falls on it as on level ground, so a low sun warms it only faintly", () => {
  // From the Viano slope (above the valley fog, in the full sun) on a clear 27 October.
  const viano = [-2120, 20] as const,
    morning = drawn(utcFromRome(daysFromCivil(2026, 10, 27) * DAY + 8 * 3600), "clear", viano)
  const noon = drawn(at(12), "clear", viano),
    sun = morning.host.look!.sun.elevation,
    warmth = (c: Color) => c.b / c.r
  assert.ok(
    sun > 5 && sun < 15 && morning.host.look!.here.fog === 0,
    `a low sun: ${sun}°, unveiled`,
  )
  for (const [when, { host, post }, least] of [
    ["08:00", morning, 0.85],
    ["12:00", noon, 0.9],
  ] as const) {
    const fog = post.uFogColor.value,
      shown = fog.clone().multiplyScalar(host.look!.exposure)
    assert.ok(
      warmth(fog) > least && warmth(fog) < 1.1,
      `${when}: white-grey, faintly warm at most (blue/red ${warmth(fog).toFixed(2)})`,
    )
    assert.ok(
      0.2126 * shown.r + 0.7152 * shown.g + 0.0722 * shown.b > 0.4,
      `${when}: a light grey on screen`,
    )
  }
})
