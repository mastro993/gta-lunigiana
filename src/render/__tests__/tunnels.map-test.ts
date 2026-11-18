import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts four of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  // Aulla's part brought 80 tunnels and 72 mouths; 5 open as crowded, 3 of them the Galleria
  // Barbarasco's, each of the A15's twin bores' faces standing on the other carriageway (accepted:
  // no rule for twin bores). The paths' and steps' tunnels fitted under what they cross then sank
  // Aulla station's three ramps to its underpass, under the ground (+215 wall triangles of 293), and
  // dipped Aulla's covered car park's two aisles under the footways over them: one opens on a
  // portal stood back 2 m at (-12965.8, 5378.3), the other's face would stand on the covered aisle
  // joining their ends (crowded). A way in a tunnel ending where another runs through it is a
  // junction in the bore, no mouth: 5 such ends left the mouths (both station ramps' at the
  // underpass, read low before they sank, buried after; three paths' under houses).
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 139,
    passages: 67,
    metres: 2875,
    // The paths at grade out of the paths' tunnels, their approaches (path-approaches.ts), meet them
    // at their level and cut the ground round their mouths, and their ends rise to them: Aulla
    // station's ramps' mouths 1.5-2.7 m lower, Equi Terme's underpass's 1.3 m higher, 8305 -> 8283.
    walls: 8283,
    mouths: 123,
    portals: 24,
    heads: 3,
    buried: 0,
    housed: 27,
    low: 63,
    crowded: 6,
  })
})
