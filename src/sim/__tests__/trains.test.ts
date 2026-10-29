import assert from "node:assert/strict"
import { test } from "node:test"

import { type Descriptor, HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops } from "@typeonce/ritmo-math"

import {
  bindings,
  CarInput,
  Game,
  GameClock,
  KeyboardInput,
  makeRuntime,
  SetTrains,
  setup,
  Train,
  TrainMotion,
  update,
  Whistle,
} from "../index.ts"
import { MAP } from "../map/index.ts"
import { CROSSING_HOLD, LOWERING, MARGIN, RAISING, RELEASE, WARNING } from "../rail/barriers.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { entryClear, FillTrains, LAYOVER } from "../rail/dispatch.ts"
import { DRAWN_RUN, LINES, linesNear, nextStop, pointAt, speedAt } from "../rail/lines.ts"
import { trainLength } from "../rail/models.ts"
import { DWELL, KEEP_BEHIND, LONG_TUNNEL, trainDraft, WHISTLE_LEAD } from "../rail/service.ts"
import { trackUnder } from "../rail/systems.ts"
import {
  aiTrain,
  crossedBy,
  groundTo,
  MONZONE,
  placeTrains,
  railStep,
  RIOLO,
  stopOf,
  TrainWorld,
} from "../rail/testing.ts"
import { jsonSave, stage, start } from "../testing.ts"

const S = 60,
  LENGTH = trainLength("atr220"),
  line = LINES[MONZONE.line]!,
  riolo = crossedBy(RIOLO, line.index)
type Whistled = Descriptor.Descriptor.Value<typeof Whistle>

/** A game with the train service, its world stepped by the railway alone (`railStep`), the whistles it hears collected. */
const railway = () => {
  const game = start([], undefined, { trains: true })
  const whistles: Array<Whistled> = []
  const listen = Game.Schedule(
    Game.System(
      "Test/Whistles",
      { events: { whistles: Game.System.readEvent(Whistle) } },
      ({ events }) => {
        whistles.push(...events.whistles.all())
      },
    ),
  )
  const step = (
    frames: number,
    each: (world: ReturnType<typeof inspect>, frame: number) => boolean | void = () => {},
  ) => {
    for (let frame = 0; frame < frames; frame++) {
      assert.ok(game.runtime.tick(railStep, listen).ok)
      if (each(inspect(), frame) === true) return frame
    }
    return frames
  }
  const inspect = () => game.runtime.inspect(TrainWorld)
  return { ...game, step, inspect, whistles }
}

/** An AI train entering the line from its start (s 0 end), its tail at the run-out's end, at line speed. */
const entering = () => aiTrain(line.start + LENGTH, 1, speedAt(line, line.start + LENGTH))

/** The way from Monzone toward Via Riolo, and where a train running it stands at Monzone. */
const toRiolo = Math.sign(riolo.s - stopOf(MONZONE.station, -1)) as 1 | -1,
  atMonzone = stopOf(MONZONE.station, toRiolo)
/** Where a train's leading end along `dir` is. */
const leading = (train: { s: number; facing: 1 | -1 }, dir: 1 | -1) =>
  dir > 0
    ? Math.max(train.s, train.s - train.facing * LENGTH)
    : Math.min(train.s, train.s - train.facing * LENGTH)

/** The calls, removals and entries of the trains on the line over `frames`, or until `trips` trains have run and the next enters. */
const service = (
  game: ReturnType<typeof railway>,
  frames: number,
  trips = Number.MAX_SAFE_INTEGER,
) => {
  const calls: Array<{ station: number; dir: number; off: number; dwell: number }> = [],
    removed: Array<{ step: number; due: number; from: number; tail: number; v: number }> = [],
    entered: Array<{ step: number; s: number; v: number; dir: number }> = [],
    onOpenBox: Array<string> = []
  let seen: { id: number; state: string; tail: number; v: number } | undefined
  game.step(frames, (world, frame) => {
    const train = world.trains[0]
    if (train === undefined) {
      if (seen !== undefined) {
        const { due, from } = world.railway[line.index]!
        removed.push({ step: frame, due: due!, from, tail: seen.tail, v: seen.v })
      }
      seen = undefined
      return
    }
    if (seen?.id !== train.id)
      entered.push({ step: frame, s: train.s, v: train.v, dir: train.run!.dir })
    if (entered.length > trips) return true
    const run = train.run!
    if (run.state === "dwell" && seen?.state !== "dwell")
      calls.push({
        station: run.stop,
        dir: run.dir,
        off: (train.s - stopOf(run.stop, run.dir)) * run.dir,
        dwell: run.until - frame,
      })
    // Its leading end never on a road box whose arms are not down.
    const head = leading(train, run.dir)
    for (const [i, box] of CROSSINGS.entries()) {
      const at = box.on.find((o) => o.line === line.index)
      if (box.walk || at === undefined || world.crossings[i]!.phase === "closed") continue
      if (Math.abs(head - at.s) <= at.half + MARGIN) onOpenBox.push(`box ${i} at ${frame}`)
    }
    seen = { id: train.id, state: run.state, tail: train.s - train.facing * LENGTH, v: train.v }
    return false
  })
  return { calls, removed, entered, onOpenBox }
}

test("trains: a new game starts with each line's train dwelling at its station nearest the player's start, centred on the platforms, for 30–60 s", () => {
  const { trains, railway: lines } = start([], undefined, { trains: true }).world()
  assert.equal(trains.length, LINES.filter((l) => l.stations.length > 0).length)
  for (const train of trains) {
    const run = train.run!
    assert.equal(run.state, "dwell")
    assert.ok(LINES[train.line]!.stations.includes(run.stop))
    assert.equal(train.s, stopOf(run.stop, run.dir))
    assert.deepEqual([train.v, train.facing], [0, run.dir])
    assert.ok(run.until >= DWELL[0] * S && run.until <= DWELL[1] * S, `dwells ${run.until / S} s`)
    assert.equal(lines[train.line]!.due, null, "no other train due while it runs")
  }
  // The tests' games have none, unless they ask.
  assert.deepEqual(start().world().trains, [])
  // Whatever the seed, Monzone's line's train stands at Monzone, facing the way past the line's point nearest the start, and its
  // body passes that point within 2 minutes. (Not in the view on foot at 1280×720: see "The first train passes out of view".)
  const { player } = MAP.spawns
  const nearest = linesNear(player.x, player.y, 200).find((n) => n.line === line.index)!.s
  for (let seed = 1; seed <= 8; seed++) {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    assert.ok(made.ok)
    const runtime = made.value
    assert.ok(runtime.tick(Game.Schedule(FillTrains, Game.Schedule.applyDeferred())).ok)
    const first = runtime.inspect(TrainWorld).trains.find((t) => t.line === line.index)!
    assert.equal(first.run!.stop, MONZONE.station, `seed ${seed}`)
    const past = (train: { s: number; facing: 1 | -1 }) =>
      (nearest - train.s) * (nearest - (train.s - train.facing * LENGTH)) <= 0
    let passed = -1
    for (let frame = 0; frame < 120 * S && passed < 0; frame++) {
      if (runtime.inspect(TrainWorld).trains.some(past)) passed = frame
      else assert.ok(runtime.tick(railStep).ok)
    }
    assert.ok(passed >= 0, `seed ${seed}: the train past the start within 2 minutes`)
  }
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

test("trains: an AI train stops KEEP_BEHIND m behind a train standing on its line, and goes once it is gone", () => {
  const game = railway()
  const parked = 5800
  assert.ok(
    game.runtime.tick(
      placeTrains([
        aiTrain(5000, 1, 20),
        trainDraft("atr220", { line: line.index, s: parked, facing: 1, v: 0 }),
      ]),
    ).ok,
  )
  game.step(90 * S)
  const ai = game.inspect().trains.find((t) => t.run !== undefined)!
  assert.equal(ai.v, 0)
  const gap = parked - LENGTH - ai.s
  assert.ok(Math.abs(gap - KEEP_BEHIND) < 3, `${gap.toFixed(2)} m behind it`)
  const stopped = { line: ai.line, s: ai.s, facing: ai.facing, v: 0 }
  assert.ok(game.runtime.tick(placeTrains([trainDraft("atr220", stopped, ai.run)])).ok)
  game.step(20 * S)
  assert.ok(game.inspect().trains[0]!.s > ai.s + 20, "on its way")
})

test("trains: an AI train closer than KEEP_BEHIND m behind a moving train falls back to that, not only matching its speed", () => {
  const game = railway()
  // A driverless train coasting at 8 m/s (down the grade there, gathering speed), an AI train 15 m behind it as fast.
  const ahead = 5800
  assert.ok(
    game.runtime.tick(
      placeTrains([
        aiTrain(ahead - LENGTH - 15, 1, 8),
        trainDraft("atr220", { line: line.index, s: ahead, facing: 1, v: 8 }),
      ]),
    ).ok,
  )
  const gap = () => {
    const trains = game.inspect().trains,
      ai = trains.find((t) => t.run !== undefined)!,
      lead = trains.find((t) => t.run === undefined)!
    return { gap: lead.s - LENGTH - ai.s, slower: lead.v - ai.v }
  }
  // It drops back at once (only matching the speed ahead, it would stay 15 m behind), then keeps its distance.
  game.step(4 * S)
  assert.ok(gap().slower > 2 && gap().gap > 18, JSON.stringify(gap()))
  game.step(36 * S)
  assert.ok(gap().gap > KEEP_BEHIND - 3, `${gap().gap.toFixed(2)} m behind it`)
})

test("trains: the dispatcher sends a train only once its braking distance ahead of its entry is free; SetTrains calls one now", () => {
  const nose = line.start + LENGTH,
    clear = entryClear(speedAt(line, nose))
  // A train standing with its near end just inside, then just outside, the entering train's clearance; no AI train on the line.
  for (const [off, enters] of [
    [-1, false],
    [1, true],
  ] as const) {
    const game = railway()
    const blocking = trainDraft("atr220", {
      line: line.index,
      s: nose + clear + off + LENGTH,
      facing: 1,
      v: 0,
    })
    assert.ok(game.runtime.tick(placeTrains([blocking])).ok)
    game.runtime.send(SetTrains, { call: true })
    game.step(10 * S)
    const ai = game.inspect().trains.filter((t) => t.run !== undefined)
    assert.equal(ai.length, enters ? 1 : 0, `${off} m out`)
    assert.equal(game.inspect().railway[line.index]!.due === null, enters)
    if (!enters) continue
    // In, it stops KEEP_BEHIND m short of the standing train on its plan's 0.6 m/s², braking no harder.
    let last = ai[0]!.v,
      hardest = 0
    game.step(80 * S, (world) => {
      const train = world.trains.find((t) => t.run !== undefined)!
      hardest = Math.max(hardest, (last - train.v) * S)
      last = train.v
    })
    const stopped = game.inspect().trains.find((t) => t.run !== undefined)!
    assert.equal(stopped.v, 0)
    assert.ok(Math.abs(nose + clear + off - stopped.s - KEEP_BEHIND) < 1, `${stopped.s}`)
    assert.ok(hardest < 0.62, `braking at ${hardest.toFixed(3)} m/s²`)
  }
  const game = railway()
  assert.ok(game.runtime.tick(placeTrains([])).ok)
  game.runtime.send(SetTrains, { call: true })
  game.step(1)
  const [train] = game.inspect().trains
  assert.ok(train?.run !== undefined, "in at once on a clear line")
  assert.deepEqual(
    [train.s, train.facing, train.run.state, train.run.stop],
    [line.start + LENGTH, 1, "run", line.stations[0]],
  )
  assert.equal(game.inspect().railway[line.index]!.due, null)
})

// As SetHandling's: the dev menu may call trains before the first update, with a render tick in between.
test("SetTrains: a request sent before the first update still applies after another schedule ticks first", () => {
  const { runtime, run } = start([], undefined, { trains: true })
  assert.ok(runtime.tick(placeTrains([])).ok)
  runtime.send(SetTrains, { call: true })
  assert.ok(runtime.tick(Game.Schedule(Game.System("Test/Draw", {}, () => {}))).ok)
  run(1)
  const world = runtime.inspect(TrainWorld)
  assert.equal(world.trains.filter((t) => t.run !== undefined).length, LINES.length)
  assert.ok(world.railway.every((entry) => entry.due === null))
})

test("trains: Via Riolo closes for a train leaving Monzone toward it 20 s before it goes, and opens 2 s after it has cleared, 12 s on", () => {
  const game = railway()
  assert.ok(game.runtime.tick(placeTrains([aiTrain(atMonzone, toRiolo, 0, 20 * S)])).ok)
  const phases: Array<{ step: number; phase: string }> = []
  let cleared = -1,
    left = -1
  game.step(80 * S, (world, frame) => {
    const { phase } = world.crossings[RIOLO]!,
      train = world.trains[0]!
    if (phases.at(-1)?.phase !== phase) phases.push({ step: frame, phase })
    if (left < 0 && train.v !== 0) left = frame
    const ends = [train.s, train.s - train.facing * LENGTH],
      trailing = toRiolo > 0 ? Math.min(...ends) : Math.max(...ends)
    if (cleared < 0 && (trailing - (riolo.s + toRiolo * (riolo.half + MARGIN))) * toRiolo > 0)
      cleared = frame
    return phase === "open" && cleared > 0
  })
  const at = (phase: string) => phases.find((p) => p.phase === phase)!.step
  assert.equal(at("warning"), 0, "the bell as soon as it is 20 s from leaving")
  assert.equal(at("lowering"), WARNING * S)
  assert.equal(at("closed"), (WARNING + LOWERING) * S)
  // Its brakes take a moment to let go.
  assert.ok(left >= 20 * S && left <= 21 * S, `it leaves on time, the arms down (${left})`)
  assert.ok(Math.abs(at("raising") - (cleared + RELEASE * S)) <= 1, "up 2 s after its tail clears")
  assert.equal(phases.at(-1)!.phase, "open")
  assert.equal(phases.at(-1)!.step - at("raising"), RAISING * S)
})

/** An AI train going `toRiolo` `before` m short of Via Riolo's near edge, at `v` m/s (dwelling until step `until`): when the arms are down, when it moves off and first slows, when its nose is on the road with the arms not down, and where it ends. */
const atRiolo = (before: number, v = 0, until?: number) => {
  const game = railway()
  const s = riolo.s - toRiolo * (riolo.half + MARGIN + before)
  assert.ok(game.runtime.tick(placeTrains([aiTrain(s, toRiolo, v, until)])).ok)
  let closed = -1,
    moved = -1,
    slowed = -1,
    onOpen = -1,
    last = 0
  game.step(60 * S, (world, frame) => {
    const train = world.trains[0]!,
      phase = world.crossings[RIOLO]!.phase,
      fwd = train.v * toRiolo
    if (closed < 0 && phase === "closed") closed = frame
    if (moved < 0 && fwd > 0.01) moved = frame
    if (moved >= 0 && slowed < 0 && fwd < last - 1e-6) slowed = frame
    last = fwd
    if (onOpen < 0 && phase !== "closed" && (train.s - (s + toRiolo * before)) * toRiolo > 0)
      onOpen = frame
    return (train.s - toRiolo * LENGTH - riolo.s) * toRiolo > riolo.half + MARGIN
  })
  return { closed, moved, slowed, onOpen, passed: game.inspect().trains[0]!.s }
}

test("trains: an AI train short of a crossing whose arms are not down demands it, and stands until they are, then goes on without slowing", () => {
  // In state run, CROSSING_HOLD m short of an open Via Riolo: it closes the box itself, else the two would wait for each other.
  const hold = atRiolo(CROSSING_HOLD - riolo.half - MARGIN)
  assert.equal(hold.closed, (WARNING + LOWERING) * S, "it closes the box from where it stands")
  assert.ok(hold.moved > hold.closed, "and moves off once the arms are down")
  // 100 m short, its hold point within its braking distance: it waits there rather than moving off only to brake.
  const near = atRiolo(100)
  assert.ok(near.moved > near.closed && near.slowed < 0, `no stop-start: ${JSON.stringify(near)}`)
  // 10 m short, past the hold point, its dwell ending in 1 s; or creeping at 3 m/s 15 m short: it never noses onto the road
  // while the arms come down.
  const close = atRiolo(10, 0, S),
    creeping = atRiolo(15, 3)
  assert.ok(close.moved > close.closed)
  for (const run of [close, creeping]) assert.equal(run.onOpen, -1)
  for (const run of [hold, near, close, creeping])
    assert.ok((run.passed - riolo.s) * toRiolo > 0, "and passes the box")
})

test("trains: an AI train standing ready far short of a crossing demands it from the strike-in, and never brakes for it", () => {
  // A road box 1000 m or more past Monzone going +s, short of the next station: Viale 20 Settembre, 900 m ahead of a train
  // standing between them.
  const from = stopOf(MONZONE.station, 1),
    next = stopOf(nextStop(line, from, 1, LENGTH), 1)
  const [index, box] = CROSSINGS.flatMap((c, i) => {
    const at = c.on.find((o) => o.line === line.index)
    return at !== undefined && !c.walk && at.s > from + 1000 && at.s < next
      ? [[i, at] as const]
      : []
  })[0]!
  assert.ok(box.reach > 900)
  const game = railway()
  assert.ok(game.runtime.tick(placeTrains([aiTrain(box.s - 900, 1)])).ok)
  let braked = -1
  game.step(80 * S, (world, frame) => {
    const train = world.trains[0]!,
      { phase } = world.crossings[index]!
    if (frame === 0) assert.equal(phase, "warning", "demanded at once")
    if (braked < 0 && phase !== "closed" && train.input.throttle < 0) braked = frame
    return train.s - LENGTH > box.s + box.half + MARGIN
  })
  assert.equal(braked, -1, "it never braked for the box while its arms came down")
  assert.ok(game.inspect().trains[0]!.s - LENGTH > box.s, "and passed it")
})

test("trains: a dwell runs only while the game clock does: behind the title card a train waits on at its station", () => {
  const hold = (rate: number) =>
    Game.Schedule(
      Game.System(
        "Test/HoldClock",
        { resources: { clock: Game.System.writeResource(GameClock) } },
        ({ resources }) => resources.clock.update((clock) => ({ ...clock, rate })),
      ),
    )
  const game = railway()
  assert.ok(game.runtime.tick(hold(0), placeTrains([aiTrain(atMonzone, toRiolo, 0, 30 * S)])).ok)
  game.step(90 * S)
  assert.equal(game.inspect().trains[0]!.run!.state, "dwell", "still there 90 s on")
  assert.equal(game.inspect().crossings[RIOLO]!.phase, "open", "its departure not called")
  assert.ok(game.runtime.tick(hold(1)).ok)
  let left = -1
  game.step(60 * S, (world, frame) => {
    if (world.trains[0]!.run!.state === "run") left = frame
    return left >= 0
  })
  assert.ok(left >= 29 * S && left <= 30 * S, `its 30 s dwell, once the clock runs (${left / S} s)`)
})

test("trains: no train runs past the end of its line's run-out, and in a tunnel the rail is dry", () => {
  // A train with no driver, its lever at full power, 300 m from the end at 20 m/s.
  const game = railway()
  const driven = Game.Command.spawn(
    [Train, { model: "atr220" }],
    [
      TrainMotion,
      {
        line: line.index,
        s: line.end - 300,
        prev: line.end - 300,
        v: 20,
        facing: 1,
        power: 1,
        brake: 0,
      },
    ],
    [CarInput, { throttle: 1, steer: 0, handbrake: false }],
  )
  assert.ok(game.runtime.tick(placeTrains([driven])).ok)
  game.step(40 * S)
  const [train] = game.inspect().trains
  assert.ok(Math.abs(train!.s - line.end) < 1e-9 && train!.v === 0, `at ${train!.s}`)
  // Soaked rail outside the line's longest tunnel; inside it, dry.
  const { weather, clock } = game.world()
  const wet = { ...weather, wet: 1 },
    tunnel = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  const motion = (s: number) =>
    ({ line: line.index, s, prev: s, v: 0, facing: 1, power: 0, brake: 0 }) as const
  const inside = trackUnder(
      line,
      motion((tunnel.from + tunnel.to) / 2),
      "atr220",
      wet,
      clock.seconds,
    ),
    outside = trackUnder(line, motion(tunnel.to + 400), "atr220", wet, clock.seconds)
  assert.equal(inside.grip, 1)
  assert.ok(outside.grip < 1, `wet outside: ${outside.grip}`)
})

test("trains: the railway draws from its own stream: other dwells, the same traffic, people and Rng", () => {
  // A train coming slowly into Monzone, whose dwell is drawn as it stops.
  const play = (edit?: (saved: { resources: Record<string, unknown> }) => void) => {
    const a = start([], undefined, { trains: true })
    assert.ok(a.runtime.tick(placeTrains([aiTrain(stopOf(MONZONE.station, 1) - 25, 1, 3)])).ok)
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

test("trains: a save taken while Via Riolo's arms come down restores through JSON and plays on alike, the train, the crossings and the whistles", () => {
  const a = railway()
  assert.ok(a.runtime.tick(placeTrains([aiTrain(atMonzone, toRiolo, 0, 20 * S)])).ok)
  a.step(13 * S)
  assert.equal(a.inspect().crossings[RIOLO]!.phase, "lowering")
  const b = railway()
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.inspect(), a.inspect())
  const from = a.whistles.length
  a.step(90 * S)
  b.step(90 * S)
  assert.deepEqual(b.inspect(), a.inspect())
  assert.equal(a.inspect().crossings[RIOLO]!.phase, "open", "the arms went down and up again")
  assert.ok(b.whistles.length > 0, "and whistled for the tunnel beyond")
  assert.deepEqual(b.whistles, a.whistles.slice(from))
})
