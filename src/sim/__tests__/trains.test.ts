import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"

import {
  bindings,
  CarInput,
  Game,
  GameClock,
  KeyboardInput,
  makeRuntime,
  SetTrains,
  Train,
  TrainMotion,
} from "../index.ts"
import { MAP } from "../map/index.ts"
import { CROSSING_HOLD, LOWERING, MARGIN, RAISING, RELEASE, WARNING } from "../rail/barriers.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { entryClear, FillTrains } from "../rail/dispatch.ts"
import { LINES, linesNear, nextStop, speedAt } from "../rail/lines.ts"
import { DWELL, KEEP_BEHIND, trainDraft } from "../rail/service.ts"
import { trackUnder } from "../rail/systems.ts"
import {
  aiTrain,
  MONZONE,
  placeTrains,
  railStep,
  RIOLO,
  stopOf,
  TrainWorld,
} from "../rail/testing.ts"
import { jsonSave, start } from "../testing.ts"
import { atMonzone, LENGTH, line, railway, riolo, S, toRiolo } from "./railway.ts"

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
