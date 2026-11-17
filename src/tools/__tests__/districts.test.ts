import assert from "node:assert/strict"
import { test } from "node:test"

import { fitDistricts } from "../districts.ts"

test("a region's district discs hold the landmarks its inputs reach: Lunigiana's the mountains', none of the coast's", () => {
  const names = new Set(
    fitDistricts({ nodes: new Map(), ways: new Map(), relations: new Map() }, []).map(
      (d) => d.name,
    ),
  )
  for (const name of ["Monzone Alto", "Monte Sagro", "Cima Belfiore", "Monte Grugola"])
    assert.ok(names.has(name), name)
  for (const name of ["Foce del Magra", "Punta Bianca"]) assert.ok(!names.has(name), name)
})
