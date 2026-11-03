import assert from "node:assert/strict"
import { test } from "node:test"

import type { Kit, VoiceIo } from "../../types.ts"
import { segmentsUntil } from "../graph.ts"
import { wind } from "../nature.ts"
import { rain, roof } from "../rain.ts"
import { tyres } from "../tyres.ts"

/** A small deterministic random source, so the checks never flake. */
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32

/** A texture's segments over `seconds`, planned each 1/60 s frame as the speaker updates it. */
const planned = (seconds: number, random = seeded(7)) => {
  const all: Array<{ at: number; length: number; offset: number }> = []
  let next = 0
  for (let now = 0; now < seconds; now += 1 / 60) {
    const step = segmentsUntil(next, now, random)
    assert.ok(step.next >= now + 0.5, `planned to ${step.next} at ${now}`)
    all.push(...step.segments)
    next = step.next
  }
  return all
}

test("a texture's segments run on end to end, 0.3–0.9 s each, from places spread over the buffer, planned half a second ahead", () => {
  const all = planned(60)
  assert.ok(all.length > 60, `${all.length} segments`)
  assert.equal(all[0]!.at, 0)
  for (const [k, s] of all.entries()) {
    assert.ok(s.length >= 0.3 && s.length <= 0.9, `${s.length} s`)
    assert.ok(s.offset >= 0 && s.offset < 1)
    if (k > 0) assert.equal(s.at, all[k - 1]!.at + all[k - 1]!.length)
  }
  // Every tenth of the buffer starts some segment.
  assert.equal(new Set(all.map((s) => Math.floor(s.offset * 10))).size, 10)
})

test("a texture behind a stalled frame starts again from now, with no segments in the past", () => {
  const first = segmentsUntil(0, 0, seeded(3))
  const late = segmentsUntil(first.next, 4, seeded(4))
  assert.equal(late.segments[0]!.at, 4)
  assert.ok(late.segments.every((s) => s.at >= 4) && late.next >= 4.5)
})

test("the texture plays the 3 s grains at double speed with no 1.5 s period: the buffer's place 1.5 s on is almost never where it was", () => {
  const BUFFER = 3,
    RATE = 2,
    all = planned(120)
  /** Where in the buffer the segment playing at `t` is, s (the later of two cross-fading ones). */
  const place = (t: number) => {
    let k = all.findIndex((s) => s.at > t) - 1
    if (k < 0) k = all.length - 1
    const s = all[k]!
    return (s.offset * BUFFER + (t - s.at) * RATE) % BUFFER
  }
  let same = 0,
    checked = 0
  for (let t = 1; t < 110; t += 0.01, checked++)
    if (Math.abs(place(t + BUFFER / RATE) - place(t)) < 0.005) same++
  // A plain loop is at the same place every time.
  assert.ok(same / checked < 0.05, `${same} of ${checked}`)
})

/** A Web Audio stand-in that records each node, its options, its connections and its sources' starts and stops. */
const stubs = () => {
  const sources: Array<Source> = [],
    connects: Array<readonly [unknown, unknown]> = []
  class Param {
    value: number
    constructor(value = 0) {
      this.value = value
    }
    setTargetAtTime() {}
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
    setValueCurveAtTime() {}
    cancelScheduledValues() {}
  }
  class Node {
    readonly options: Record<string, unknown>
    gain: Param
    frequency = new Param()
    detune = new Param()
    Q = new Param()
    pan = new Param()
    playbackRate: Param
    offset: Param
    constructor(_ctx: unknown, options: Record<string, unknown> = {}) {
      this.options = options
      this.gain = new Param(Number(options.gain ?? 1))
      this.playbackRate = new Param(Number(options.playbackRate ?? 1))
      this.offset = new Param(Number(options.offset ?? 1))
    }
    connect<T>(to: T): T {
      connects.push([this, to])
      return to
    }
    disconnect() {}
    setPeriodicWave() {}
  }
  class Source extends Node {
    readonly starts: Array<readonly [number, number]> = []
    readonly stops: Array<number> = []
    onended: (() => void) | null = null
    constructor(ctx: unknown, options: Record<string, unknown> = {}) {
      super(ctx, options)
      sources.push(this)
    }
    start(when = 0, offset = 0) {
      this.starts.push([when, offset])
    }
    stop(when = 0) {
      this.stops.push(when)
    }
  }
  Object.assign(globalThis, {
    GainNode: Node,
    BiquadFilterNode: Node,
    WaveShaperNode: Node,
    StereoPannerNode: Node,
    PeriodicWave: Node,
    AudioBufferSourceNode: Source,
    ConstantSourceNode: Source,
    OscillatorNode: Source,
  })
  const buffer = (duration: number) => ({ duration, copyToChannel: () => {} })
  const ctx = {
    sampleRate: 8000,
    currentTime: 0,
    createBuffer: (_: number, length: number, rate: number) => buffer(length / rate),
  }
  const kit = {
    white: buffer(4),
    pink: buffer(4),
    brown: buffer(4),
    crackle: buffer(3),
    gust: buffer(64),
  }
  const cents = new Source(ctx)
  const io = { ctx, out: new Node(ctx), cents, kit } as unknown as VoiceIo
  return { io, kit: kit as unknown as Kit, cents, sources, connects }
}

// Regression: the wind's leaves looped the kit's 3 s grains at double speed (the same crackle every 1.5 s, on the same
// footstep at a walk); the rain's drops, the roof's patter and the tyres' crunch looped them every 3 s.
test("the wind's leaves, the rain's drops, the roof's patter and the tyres' crunch play the kit's grains in short segments from random places, never a plain loop", () => {
  const voices = [
    ["wind", wind, { kind: "wind", strength: 0.84, forest: 1, gusts: 0.5 }],
    ["rain", rain, { kind: "rain", rate: 10, forest: 1, built: 0, water: 0 }],
    ["roof", roof, { kind: "roof", rate: 10 }],
    [
      "tyres",
      tyres,
      { kind: "tyres", speed: 12, skid: 0.5, slip: 4, surface: "gravel", heavy: false },
    ],
  ] as const
  for (const [name, factory, sound] of voices) {
    const { io, kit, cents, sources, connects } = stubs()
    const voice = (factory as (io: VoiceIo) => { update: (sound: never, now: number) => void })(io)
    for (let now = 0; now < 10; now += 1 / 60) voice.update(sound as never, now)
    const grains = sources.filter((s) => s.options.buffer === kit.crackle)
    assert.ok(grains.length > 10, `${name}: ${grains.length} grain sources`)
    for (const g of grains) {
      const [at] = g.starts[0]!
      assert.ok(
        g.stops.length === 1 && g.stops[0]! - at <= 0.93 + 1e-9,
        `${name}: a segment of ${g.stops[0]! - at} s`,
      )
    }
    assert.ok(
      new Set(grains.map((g) => g.starts[0]![1])).size > 0.9 * grains.length,
      `${name}: offsets drawn`,
    )
    // The Doppler shift reaches the segments through one tap: the emitter cuts its cents' every connection when it is freed.
    assert.ok(
      connects.every(([from, to]) => from !== cents || !grains.some((g) => g.detune === to)),
      `${name}: cents into a segment`,
    )
  }
})
