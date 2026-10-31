// The live vehicles round Monzone on lucido and on the 3x test region (`lunigiana-3x`, region.ts),
// whose play area is lucido's on three times its built terrain: the same seed and the same stand at
// the start (`stand.ts`, one child process a map, as a process loads one map). The 3x is built by
// hand (node src/tools/build-map.ts --region lunigiana-3x, 28 s, 1.6 GB; CI never builds it), and
// without it this is skipped.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { PARKED } from "../../sim/population/parked.ts"
import { TRAFFIC } from "../../sim/systems/populate.ts"
import { builtMapUrl } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"

const X3 = regionFromArgs(["--region", "lunigiana-3x"])
const skip = existsSync(builtMapUrl(X3))
  ? false
  : `no ${X3.key} build in test-maps: run node src/tools/build-map.ts --region ${X3.key}`
const STAND = fileURLToPath(new URL("stand.ts", import.meta.url))

/** How many vehicles are live after the stand on the map of region `key`, by kind. */
const stand = (key: string) => {
  const { parked, traffic, other } = JSON.parse(
    execFileSync(process.execPath, [STAND, key], { encoding: "utf8" }),
  ) as { readonly parked: number; readonly traffic: number; readonly other: number }
  return { parked, traffic, other }
}

test(
  "round Monzone the live vehicles are as many on three times lucido's built terrain as on lucido, within 200 parked and 10 traffic",
  { skip },
  () => {
    const lucido = stand("lunigiana")
    assert.deepEqual(stand(X3.key), lucido)
    const { parked, traffic, other } = lucido
    assert.ok(parked + other <= PARKED && traffic <= TRAFFIC.max)
    assert.ok(parked > 0 && traffic > 0 && other === 2) // the Carabinieri's two
  },
)
