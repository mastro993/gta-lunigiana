import assert from "node:assert/strict"
import { test } from "node:test"

import { speedAt } from "../rail/lines.ts"
import { aiTrain, placeTrains } from "../rail/testing.ts"
import { start } from "../testing.ts"
import { anonymous, line, S } from "./railway.ts"

test("trains: with a train far off, traffic, people, animals and the world's draws are the same as with none", () => {
  // The train in the Ugliancaldo tunnel, kilometres from the player at Monzone.
  const tunnel = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a)),
    s = (tunnel.from + tunnel.to) / 2
  const withTrain = start([], undefined, { trains: true })
  assert.ok(withTrain.runtime.tick(placeTrains([aiTrain(s, 1, speedAt(line, s))])).ok)
  const without = start()
  withTrain.run(20 * S)
  without.run(20 * S)
  const a = withTrain.world(),
    b = without.world()
  assert.ok(a.vehicles.some((v) => v.traffic) && a.peds.length > 0 && a.trains.length === 1)
  // Each train spawned shifts the ids of everything spawned after it; nothing else differs.
  assert.deepEqual(anonymous(a.vehicles), anonymous(b.vehicles))
  assert.deepEqual(anonymous(a.peds), anonymous(b.peds))
  assert.deepEqual(anonymous(a.animals), anonymous(b.animals))
  assert.equal(a.rng, b.rng)
})
