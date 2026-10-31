// Run by x3-region.map-test.ts, once per map and seed: node src/tools/__tests__/stand.ts <region key>
// [seed]. Loads that region's map as built, starts a game on the seed (1 by default) with the player
// standing at the start for `FRAMES` frames, and prints the live vehicles then as JSON: parked (on a
// spot), traffic, the rest (the Carabinieri's), the parked cars' spots, and the spots the game's
// dice park a car on within `PARKING.fill[1]` of the start (`carOn`), with where each stands.
import { loadBuiltMap } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"

/** How long the player stands, frames: 60 s, past the time traffic and the parked cars take to come round them. */
const FRAMES = 3600

const key = process.argv[2]
if (key === undefined)
  throw new Error("usage: node src/tools/__tests__/stand.ts <region key> [seed]")
const seed = Number(process.argv[3] ?? 1)
await loadBuiltMap(regionFromArgs(["--region", key]))
const { start } = await import("../../sim/testing.ts")
const { MAP } = await import("../../sim/map/index.ts")
const { carOn, PARKING, spotsWithin } = await import("../../sim/population/parked.ts")
const game = start([], undefined, { seed })
game.run(FRAMES)
const vehicles = game.world().vehicles
const parked = vehicles.filter((v) => v.parked !== undefined)
const dice = spotsWithin(MAP.spawns.player, PARKING.fill[1])
  .filter((i) => carOn(seed, i) !== undefined)
  .sort((a, b) => a - b)
console.log(
  JSON.stringify({
    parked: parked.length,
    traffic: vehicles.filter((v) => v.traffic).length,
    other: vehicles.filter((v) => v.parked === undefined && !v.traffic).length,
    spots: parked.map((v) => v.parked!).sort((a, b) => a - b),
    dice,
    near: spotsWithin(MAP.spawns.player, PARKING.fill[1])
      .map((i) => `${MAP.spawns.parked[i]!.x},${MAP.spawns.parked[i]!.y}`)
      .sort(),
  }),
)
