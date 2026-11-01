import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops } from "@typeonce/ritmo-math"

import { bindings, Game, KeyboardInput, makeRuntime, setup, update } from "../index.ts"
import { MAP } from "../map/index.ts"
import { LAYOVER } from "../rail/dispatch.ts"
import { DRAWN_RUN, pointAt, speedAt } from "../rail/lines.ts"
import { DWELL, LONG_TUNNEL, WHISTLE_LEAD } from "../rail/service.ts"
import { aiTrain, groundTo, placeTrains, RIOLO, stopOf } from "../rail/testing.ts"
import { jsonSave, stage, start } from "../testing.ts"
import { atMonzone, entering, LENGTH, line, railway, S, service, toRiolo } from "./railway.ts"

test("trains: the railway draws from its own stream: other dwells, the same traffic, people and Rng", () => {
  // A train coming slowly into the line's last station, whose dwell is drawn as it stops: 3 km from the
  // start, where nothing the world brings out round the player meets it (by Monzone a traffic car
  // slowing for a train draws its next turn later, and the world's stream parts though the railway
  // draws nothing from it).
  const play = (edit?: (saved: { resources: Record<string, unknown> }) => void) => {
    const a = start([], undefined, { trains: true })
    assert.ok(
      a.runtime.tick(placeTrains([aiTrain(stopOf(line.stations.at(-1)!, 1) - 25, 1, 3)])).ok,
    )
    if (edit === undefined) return a
    const saved = jsonSave(a.runtime) as {
      resources: Record<string, unknown>
    }
    edit(saved)
    const b = start()
    assert.ok(b.runtime.restore(saved).ok)
    return b
  }
  const a = play(),
    b = play((saved) => {
      saved.resources["Lunigiana/RailRng"] =
        ((saved.resources["Lunigiana/RailRng"] as number) + 12345) >>> 0
    })
  a.run(20 * S)
  b.run(20 * S)
  const dwell = (game: typeof a) => game.world().trains[0]!.run!
  assert.equal(dwell(a).state, "dwell")
  assert.notEqual(dwell(b).until, dwell(a).until, "another dwell")
  assert.ok(a.world().vehicles.some((v) => v.traffic) && a.world().peds.length > 0)
  assert.deepEqual(b.world().vehicles, a.world().vehicles)
  assert.deepEqual(b.world().peds, a.world().peds)
  assert.equal(b.world().rng, a.world().rng)
  // And with no trains at all the world's stream draws the same.
  const none = start()
  none.run(20 * S)
  assert.equal(none.world().rng, a.world().rng)
})

test("trains: determinism: a train leaving Monzone over Via Riolo, one arriving at a station and one whistling into a tunnel replay bit for bit", () => {
  const last = line.stations.at(-1)!,
    tunnel = line.tunnels.find((t) => t.to - t.from >= LONG_TUNNEL && t.from > atMonzone)!
  const cast = [
    // Away from Monzone over Via Riolo: the bell at once, the arms down at 19 s, it goes, and they rise behind it.
    aiTrain(atMonzone, toRiolo, 0, 8 * S),
    // Into the line's last station at 3 m/s, its dwell drawn from RailRng as it stops.
    aiTrain(stopOf(last, 1) - 25, 1, 3),
    // 100 m short of a long tunnel's whistle point at line speed.
    aiTrain(tunnel.from - WHISTLE_LEAD - 100, 1, speedAt(line, tunnel.from)),
  ]
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 7,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(setup, stage(MAP.spawns.player, { trains: cast }))
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames: 60 * S, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames: 60 * S })
  // What those frames hold (the railway alone moves the trains as the whole step does): the box's whole cycle, the arrival's
  // draw and the whistle.
  const game = railway()
  assert.ok(game.runtime.tick(placeTrains(cast)).ok)
  const phases = new Set<string>()
  let called = false
  game.step(60 * S, (world) => {
    phases.add(world.crossings[RIOLO]!.phase)
    called ||= world.trains.some((t) => t.run!.state === "dwell" && t.run!.stop === last)
  })
  assert.deepEqual([...phases].sort(), ["closed", "lowering", "open", "raising", "warning"])
  assert.ok(called, "a call at the last station")
  assert.equal(game.whistles.length, 1)
})

test("trains: a train runs the whole line both ways, calling at every station for 30–60 s within 3 m of its stop, never on an open box, lays over 60–180 s, and is removed past the drawn run", () => {
  const game = railway()
  assert.ok(game.runtime.tick(placeTrains([entering()])).ok)
  const { calls, removed, entered, onOpenBox } = service(game, 2400 * S, 2)
  const stations = line.stations
  assert.deepEqual(
    calls.map((c) => [c.station, c.dir]),
    [...stations.map((s) => [s, 1]), ...[...stations].reverse().map((s) => [s, -1])],
  )
  for (const call of calls) {
    assert.ok(
      Math.abs(call.off) < 3,
      `${MAP.railway.stations[call.station]!.name}: ${call.off.toFixed(2)} m off`,
    )
    assert.ok(
      call.dwell >= DWELL[0] * S && call.dwell <= DWELL[1] * S,
      `dwells ${call.dwell / S} s`,
    )
  }
  assert.deepEqual(onOpenBox, [], "the arms down whenever it reaches a road box")
  // Removed once its whole body is past the drawn run, out of view, not before; the next one due after the layover, from that
  // end, entering at the run-out's end at line speed.
  assert.ok(removed.length >= 2 && entered.length >= 3)
  for (const [i, gone] of removed.entries()) {
    // Its tail the step before it went: within that step's run short of the drawn run's end.
    const short = gone.from === 1 ? line.length + DRAWN_RUN - gone.tail : gone.tail + DRAWN_RUN
    assert.ok(
      short >= 0 && short < Math.abs(gone.v) / S,
      `removed ${short} m short of the drawn run's end`,
    )
    const layover = gone.due - gone.step
    assert.ok(
      layover >= LAYOVER[0] * S - 1 && layover <= LAYOVER[1] * S,
      `layover ${layover / S} s`,
    )
    assert.equal(gone.from, i % 2 === 0 ? 1 : 0)
    const next = entered[i + 1]!
    assert.ok(next.step >= gone.due - 1 && next.step <= gone.due + 1, "in as soon as due")
    assert.equal(next.dir, gone.from === 1 ? -1 : 1)
    assert.equal(next.s, gone.from === 1 ? line.end - LENGTH : line.start + LENGTH)
    assert.equal(Math.abs(next.v), speedAt(line, next.s))
  }
  // A moderately long whistle entering each tunnel of 200 m or more, WHISTLE_LEAD m before its mouth, each way.
  const long = line.tunnels.filter((t) => t.to - t.from >= LONG_TUNNEL)
  assert.ok(long.length > 0)
  const portals = [
    ...long.map((t) => t.from - WHISTLE_LEAD),
    ...[...long].reverse().map((t) => t.to + WHISTLE_LEAD),
  ]
  assert.equal(game.whistles.length, portals.length)
  for (const [i, whistle] of game.whistles.entries()) {
    const at = pointAt(line, portals[i]!)
    assert.ok(Ops.hypot(whistle.x - at.x, whistle.y - at.y) < 1, "at the whistle point")
    assert.equal(whistle.urgent, false)
  }
})

test("trains: on wet rail and under snow a train still stops within 3 m at every station, and never reaches a road box before its arms are down", () => {
  for (const ground of [{ wet: 1 }, { snow: true }]) {
    const game = railway()
    assert.ok(game.runtime.tick(groundTo(ground), placeTrains([entering()])).ok)
    const { calls, onOpenBox } = service(game, 840 * S)
    assert.equal(calls.length, line.stations.length)
    for (const call of calls)
      assert.ok(Math.abs(call.off) < 3, `${JSON.stringify(ground)}: ${call.off} m off`)
    assert.deepEqual(onOpenBox, [])
  }
})
