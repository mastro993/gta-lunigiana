import "../../sim/map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (tunnels.map-test.ts checks Lunigiana). Its tunnels are the Secante's cut and cover under the
// city, underpasses under the railway and the arcades of the centre.

test("Cesena: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 64,
    passages: 22,
    metres: 5264,
    // The profiles' bounds across a crossing's carriageway and at a deck's ends (road-levels.ts)
    // and the motorways' grade fitted unrelaxed (ROAD_PASSES) moved the bores' bend samples, and the
    // paths at grade out of the paths' underpasses are their approaches (path-approaches.ts), which
    // cut their mouths: 18267 -> 18365 wall triangles.
    walls: 18365,
    // 70184534's end where 70184520 runs on through the bore is a junction, no mouth.
    mouths: 76,
    portals: 6,
    // The Sottopasso Cervese's east mouth (757.4, 622.3), 3.1 m under the ground there and 5.05 m
    // or more over its end: buried before its approach cut it.
    heads: 3,
    // The Sottopasso del Mare's (23605012, at 1932.9, 46.5) and the Sottopasso Ravennate's south (at
    // -15.8, 878.2):
    // their ends under the rail keep its clearance, 5.2 and 5.9 m under the roads meeting them.
    buried: 2,
    housed: 46,
    // The Sottopasso Cervese's west mouth (720.7, 570.3) and the Sottopasso Ravennate's north (-17.2,
    // 1018), their
    // ends risen to the ground their approaches lead on over (0.3 m and none under it), were buried.
    low: 15,
    // The path 43076054's two under the station (497.6, 704.3 and 519, 751.2), cut by their
    // approaches to 0.4 and 1.0 m under the ground, were buried: a portal's face would stand on
    // another path.
    crowded: 4,
  })
})
