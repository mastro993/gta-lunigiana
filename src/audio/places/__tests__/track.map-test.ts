import { test } from "node:test"

import { LINES } from "../../../sim/rail/lines.ts"
import { checkJoints } from "./track-checks.ts"

// Map check (pnpm test:map): every line of the map, end to end; track.test.ts checks the line by
// Monzone station.
test("the rails clack at a joint every 36 m along every line, end to end, and at its switches: where a loop or siding the line does not run on meets it", () => {
  for (const line of LINES) checkJoints(line.index, -100, line.length + 100)
})
