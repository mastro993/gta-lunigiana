import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts four of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, the roads at grade round each mouth over the terrain and their painted lines over them, its chunks as a whole-map build cuts them", () => {
  // Aulla's part brought 80 tunnels and 72 mouths; 5 open as crowded, 3 of them the Galleria
  // Barbarasco's, each of the A15's twin bores' faces standing on the other carriageway (accepted:
  // no rule for twin bores). The paths' and steps' tunnels fitted under what they cross then sank
  // Aulla station's three ramps to its underpass, under the ground (+215 wall triangles of 293), and
  // dipped Aulla's covered car park's two aisles under the footways over them: one opens on a
  // portal stood back 2 m at (-12965.8, 5378.3), the other's face would stand on the covered aisle
  // joining their ends (crowded). A way in a tunnel ending where another runs through it is a
  // junction in the bore, no mouth: 5 such ends left the mouths (both station ramps' at the
  // underpass, read low before they sank, buried after; three paths' under houses).
  // Sarzana's part brought 235 tunnels and 304 mouths, under the A12's and the A15's embankments,
  // Sarzana's streets and Vezzano Ligure's tracks. Via Termo's 29.3 m underpass under Vezzano
  // Ligure's four tracks rises to a head wall's height only 14.5 m in from its east mouth, past the
  // 14 m its box reaches: low. A mouth holding at its floor the corners behind it of the cells its
  // approach's carriageway runs in ahead of its face (`mouthClaim`, issue #20), the bank no longer
  // climbs the cell over the mouth: none of the 7 mouths it buried is buried now, 5 open mouths of
  // Sarzana's get a head wall, and 26 throats and boxes run 1–6 m farther in, to where the bank
  // stands over them again (heads 38 -> 43, buried 7 -> 0, low 211 -> 215, crowded 25 -> 23); the
  // bores' walls are cut where the ground over their first metres is lower (30196 -> 29716). The
  // same round's rail and water fixes moved the ground over 10 bores' ends and the Galleria
  // Calcinara's profile (31135800) by up to 3.1 m: 29764. With the paths at grade on the terrain
  // as drawn, the footway 1462688623 no longer sinks 0.92 m into the hold beside the west mouth of
  // Sarzana's service tunnel 376037643, out of the room its head wall takes: heads 43 -> 44,
  // crowded 23 -> 22. With a path or steps at grade fitted from its clearance under a deck or over a
  // bore (the path pass, issue #20), Vezzano Ligure station's stair stubs 1419380924 and 1419380925
  // sink under the stairs over them, their mouths buried (buried 0 -> 2), and the ground round three
  // mouths moves: one gets a portal, two are no longer crowded (portals 41 -> 42, crowded 22 -> 20,
  // low 215 -> 214, walls 29764 -> 29768).
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 374,
    passages: 140,
    metres: 10295,
    walls: 29768,
    mouths: 427,
    portals: 42,
    heads: 44,
    buried: 2,
    housed: 105,
    low: 214,
    crowded: 20,
  })
})
