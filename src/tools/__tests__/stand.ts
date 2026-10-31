// Run by x3-region.map-test.ts, once per map: node src/tools/__tests__/stand.ts <region key>. Loads
// that region's map as built, starts a game on seed 1 with the player standing at the start for
// `FRAMES` frames, and prints the live vehicles then as JSON: parked (on a spot), traffic, the rest
// (the Carabinieri's), and the parked cars' spots.
import { loadBuiltMap } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"

/** How long the player stands, frames: 60 s, past the time traffic and the parked cars take to come round them. */
const FRAMES = 3600

const key = process.argv[2]
if (key === undefined) throw new Error("usage: node src/tools/__tests__/stand.ts <region key>")
await loadBuiltMap(regionFromArgs(["--region", key]))
const { start } = await import("../../sim/testing.ts")
const game = start()
game.run(FRAMES)
const vehicles = game.world().vehicles
const parked = vehicles.filter((v) => v.parked !== undefined)
console.log(
  JSON.stringify({
    parked: parked.length,
    traffic: vehicles.filter((v) => v.traffic).length,
    other: vehicles.filter((v) => v.parked === undefined && !v.traffic).length,
    spots: parked.map((v) => v.parked!).sort((a, b) => a - b),
  }),
)
