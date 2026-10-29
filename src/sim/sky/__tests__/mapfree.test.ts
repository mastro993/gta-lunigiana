import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

// What the schema and the sky's pure modules load, recorded before anything imports them: none may decode the map, so a page
// that never loads monzone.bin (the audio lab) and the HUD's tests can use them.
const loaded = new Array<string>()
registerHooks({
  resolve: (specifier, context, next) => {
    const resolved = next(specifier, context)
    loaded.push(resolved.url)
    return resolved
  },
})

test("map-free: the schema, the train models and the sky's calendar, astronomy, place, climate, odds, plan, regimes, clock, local weather and readout load no map", async () => {
  const modules = [
    "../../schema.ts",
    "../regimes.ts",
    "../clock.ts",
    "../calendar.ts",
    "../astro.ts",
    "../place.ts",
    "../day.ts",
    "../climate.ts",
    "../odds.ts",
    "../plan.ts",
    "../local.ts",
    "../readout.ts",
    "../../rail/models.ts",
  ]
  for (const module of modules) await import(module)
  assert.ok(
    loaded.some((url) => url.endsWith("/sky/local.ts")),
    "the hook saw the imports",
  )
  assert.deepEqual(
    loaded.filter((url) => url.endsWith("/map/index.ts") || url.endsWith("/map/packed.ts")),
    [],
  )
  const { place, REFERENCE_PLACE } = await import("../place.ts")
  assert.deepEqual(place(), REFERENCE_PLACE, "with no map, the reference site")
})

test("map-free: once the map is decoded the sky's place is the map's: its origin, its 5th-percentile height and the way its ground falls", async () => {
  const { place, placeFrom, REFERENCE_PLACE } = await import("../place.ts")
  const { MAP } = await import("../../map/index.ts")
  const where = place()
  assert.deepEqual(where, placeFrom(MAP.origin, MAP.heightmap))
  assert.deepEqual({ lat: where.lat, lon: where.lon }, { ...MAP.origin })
  // The shipped map is the reference site: the same origin, its floor and slope to the rounding the default keeps.
  assert.ok(
    Math.abs(where.floor - REFERENCE_PLACE.floor) < 0.5 &&
      Math.abs(where.downslope - REFERENCE_PLACE.downslope) < 0.005,
    JSON.stringify(where),
  )
  const heights = Array.from(MAP.heightmap.data, (z) => z / 10).sort((a, b) => a - b)
  assert.equal(where.floor, heights[Math.floor(0.05 * (heights.length - 1))])
})
