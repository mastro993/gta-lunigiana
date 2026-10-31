import { test } from "node:test"

import { MAP } from "../../map/index.ts"
import { checkBedDry } from "./rail-bed.ts"

// Map check (pnpm test:map): every track of the map; channel.test.ts checks those by Monzone
// station.
test("channel: wherever a stream crosses the map's track, the whole rail bed stays dry at the mean, in a spate and in the 30 years' highest flood", () => {
  checkBedDry(MAP.rail, 3)
})
