/**
 * Every train and level-crossing sound. A train's power packs, one under each end car, at the revs
 * and load its power gives; its wheels on the rails as a line source along its cars in the open,
 * with the clacks of its axles over the joints and switches (places/track.ts), and its brakes
 * squealing to a stand from the same place; the player's horn from the cab (H) and the AI drivers'
 * (the sim's `Whistle`). Each car in a tunnel carries its own length's rolling out of the portal
 * losing least on the way to the ears, the tunnel's length lost on the way, and none past `DEEP`;
 * the cars in the open and those portals are one voice, their sound summed, so the level runs on as
 * the cars pass a portal. So is a power pack or a horn in a tunnel heard at its portal. The
 * player's own train is heard from its cab as a car's own engine is from its seat (`OWN_TRAIN_DB`):
 * from where each source is, through the cab's lowpass, with nothing in the way. A level crossing
 * whose bell rings is one voice at its centre. Occlusion is keyed per car (`train:id:k`), so a
 * train's voices share their measured paths.
 *
 * @module audio/director/rail
 */
import { TRAINS } from "../../sim/rail/models.ts"
import { hash01 } from "../../tools/geometry.ts"
import { CABIN, type LineSegment, lineLevel, mixGain, panOf, spreading } from "../acoustics.ts"
import { jointsBetween, portalsOf } from "../places/track.ts"
import type { HeardCar, HeardTrain } from "../rail-types.ts"
import { engineQuiet } from "../synth/engine.ts"
import { axleOffsets, brakesQuiet, brakesTargets, LOOKAHEAD, railsQuiet } from "../synth/rail.ts"
import { type Frame, groundAt } from "./frame.ts"
import type { Ears, Hearing, Source } from "./hearing.ts"
import { ENGINE, type Level, LEVELS, OWN_TRAIN_DB, ROLLING } from "./levels.ts"

/** Source heights over the rail head, m: the wheels, the power packs under the floor, the horn on the cab's roof. */
const OVER_RAIL = { wheels: 0.4, pack: 0.8, horn: 3.6 } as const
/** A crossing's bell on its post, m over the road. */
const BELL_HEIGHT = 2.5
/** Sound dies away this much per metre along a tunnel to its portal, dB (TUNED, estimated: a bore's walls take little of it). */
const TUNNEL_DB = 0.1
/** A source deeper in a tunnel than this, m, is not heard out of it. */
const DEEP = 400
/** A point source's level at 1 m under its sound power, dB: 10·log10(4π). */
const FREE_FIELD = 10 * Math.log10(4 * Math.PI)

/**
 * The player's own train from its cab, as a car's own engine is heard from its seat (`OWN_ENGINE` in ./vehicles.ts): `seat`
 * dB(A) at the ears from anywhere within half the cab's car of them, falling off with distance down the train past that, panned
 * from where the source is and dulled by the cab's lowpass; no Doppler, no ground, nothing in the way.
 */
const fromCab = (frame: Frame, train: HeardTrain, source: Source, seat: number): Hearing => {
  const { ears } = frame,
    reach = TRAINS[train.model].cars[0] / 2
  const dx = source.x - ears.x,
    dy = source.y - ears.y,
    r = Math.hypot(dx, dy, source.z - ears.z)
  const loss = spreading(r, reach) - spreading(reach, reach)
  return {
    placement: {
      gain: mixGain(seat, loss),
      pan: panOf(dx, dy, ears.right),
      cutoff: CABIN[train.model].cutoff,
      cents: 0,
      wet: 0,
    },
    level: seat - loss,
    audible: true,
    r,
    delay: 0,
  }
}

/** Car `car` of `train`'s velocity on the ground, m/s: the train's speed toward its front along the car. */
const velocityOf = (train: HeardTrain, car: HeardCar) => ({
  vx: train.v * train.facing * Math.cos(car.angle),
  vy: train.v * train.facing * Math.sin(car.angle),
})

/** The end of `car` toward the train's front (`sign` 1) or its rear (−1). */
const endOf = (car: HeardCar, sign: 1 | -1) => ({
  x: car.x + (sign * Math.cos(car.angle) * car.length) / 2,
  y: car.y + (sign * Math.sin(car.angle) * car.length) / 2,
})

/** Each of `train`'s axles' s along its line. */
const axlesOf = (train: HeardTrain): ReadonlyArray<number> =>
  axleOffsets(train.model).map((at) => train.s - train.facing * at)

/** Where `source`, at s on its train's line in a car standing in a tunnel, is heard from: the portal losing least on its way to the ears, with the tunnel's loss; none past `DEEP`. */
const throughPortal = (
  ears: Ears,
  train: HeardTrain,
  s: number,
  over: number,
): { readonly source: Source; readonly loss: number } | undefined => {
  const portals = portalsOf(train.line, s)
  if (portals.length === 0) return undefined
  const cost = (p: (typeof portals)[number]) =>
    p.depth * TUNNEL_DB + spreading(Math.hypot(p.x - ears.x, p.y - ears.y), 1)
  const best = portals.reduce((a, b) => (cost(b) < cost(a) ? b : a))
  return best.depth > DEEP
    ? undefined
    : { source: { x: best.x, y: best.y, z: best.z + over }, loss: best.depth * TUNNEL_DB }
}

/** Where a source in `car` of `train` at s is heard from, and what more it loses on the way: in the open where it is, in a tunnel at a portal (the player's own train from where it is); none when buried too deep. */
const placeOf = (
  ears: Ears,
  train: HeardTrain,
  car: HeardCar,
  at: Source,
  s: number,
  over: number,
): { readonly source: Source; readonly loss: number } | undefined =>
  !car.tunnel || train.mine ? { source: at, loss: 0 } : throughPortal(ears, train, s, over)

/** A part of a train's rolling as heard: the car it lies on, its place, its level at the ears and how much of that its tunnel took. */
interface Part {
  readonly car: number
  readonly source: Source
  readonly at: number
  readonly lost: number
}

/**
 * The rolling's source, the car it lies on, and its level there re 1 m with what more it loses on the way: the cars in the open
 * as a line source, heard from its nearest point (the player's own train, all of it), and each car in a tunnel from its best
 * portal with its own length's sound power, the tunnel's length lost; their sound summed at the ears and heard from the louder
 * part's place, so it runs on as the cars pass a portal. None when nothing is heard out of the hill.
 */
export const rollingOf = (
  ears: Ears,
  train: HeardTrain,
):
  | { readonly source: Source; readonly car: number; readonly level: Level; readonly loss: number }
  | undefined => {
  const open = train.cars.flatMap((car, k) => (car.tunnel && !train.mine ? [] : [{ car, k }]))
  // The cars in the tunnels, each at its portal: the loudest at the ears, and their energy there.
  let deep: Part | undefined,
    buried = 0
  for (const [k, car] of train.cars.entries()) {
    if (!car.tunnel || train.mine) continue
    const place = throughPortal(ears, train, car.s, OVER_RAIL.wheels)
    if (place === undefined) continue
    const { source } = place
    const at =
      ROLLING.lw +
      10 * Math.log10(car.length) -
      FREE_FIELD -
      place.loss -
      spreading(Math.hypot(source.x - ears.x, source.y - ears.y, source.z - ears.z), ROLLING.rMin)
    buried += 10 ** (at / 10)
    if (deep === undefined || at > deep.at) deep = { car: k, source, at, lost: place.loss }
  }
  let line: Part | undefined
  if (open.length > 0) {
    const segments: Array<LineSegment> = open.map(({ car }) => {
      const front = endOf(car, 1),
        rear = endOf(car, -1)
      return { ax: rear.x, ay: rear.y, bx: front.x, by: front.y, lw: ROLLING.lw }
    })
    // Over or under the train (a deck, a hill over a cutting), the ears are as far from it as their height.
    const near = open.reduce((a, b) =>
      Math.hypot(b.car.x - ears.x, b.car.y - ears.y) <
      Math.hypot(a.car.x - ears.x, a.car.y - ears.y)
        ? b
        : a,
    )
    const heard = lineLevel(segments, ears.x, ears.y, ears.z - near.car.z - OVER_RAIL.wheels)
    const { car, k } = open.reduce((a, b) =>
      Math.hypot(b.car.x - heard.x, b.car.y - heard.y) <
      Math.hypot(a.car.x - heard.x, a.car.y - heard.y)
        ? b
        : a,
    )
    line = {
      car: k,
      source: { x: heard.x, y: heard.y, z: car.z + OVER_RAIL.wheels, ...velocityOf(train, car) },
      at: heard.level,
      lost: 0,
    }
  }
  const from = line === undefined || (deep !== undefined && deep.at > line.at) ? deep : line
  if (from === undefined) return undefined
  // From the louder part's place at its own level re 1 m, its tunnel's loss still a loss; what the rest adds is taken off it.
  const { source } = from,
    r = Math.hypot(source.x - ears.x, source.y - ears.y, source.z - ears.z),
    sum = 10 * Math.log10(buried + (line === undefined ? 0 : 10 ** (line.at / 10)))
  return {
    source,
    car: from.car,
    level: { db: from.at + from.lost + spreading(r, ROLLING.rMin), rMin: ROLLING.rMin },
    loss: from.lost - (sum - from.at),
  }
}

/** The train and crossing part of the director. */
export const makeRail = () => ({
  hear: (frame: Frame): void => {
    const { heard } = frame
    const keyOf = (train: HeardTrain, k: number) =>
      train.mine ? undefined : `train:${train.id}:${k}`
    for (const train of heard.trains) {
      const { cars } = train,
        spec = TRAINS[train.model]
      // One power pack under each end car.
      for (let i = 0; i < Math.min(spec.engines, cars.length); i++) {
        const k = i === 0 ? 0 : cars.length - 1,
          car = cars[k]!
        const place = placeOf(
          frame.ears,
          train,
          car,
          { x: car.x, y: car.y, z: car.z + OVER_RAIL.pack, ...velocityOf(train, car) },
          car.s,
          OVER_RAIL.pack,
        )
        if (place === undefined) continue
        frame.hold(
          `engine:${train.id}:${i}`,
          {
            kind: "engine",
            model: train.model,
            rpm: train.rpm,
            load: train.load,
            inside: false,
            variant: hash01(train.id, i),
            damage: 0,
            misfire: false,
          },
          train.mine
            ? fromCab(frame, train, place.source, OWN_TRAIN_DB.pack)
            : frame.path(keyOf(train, k), place.source, ENGINE[train.model], {
                doppler: true,
                quiet: engineQuiet(train.model, train.rpm, train.load),
                loss: place.loss,
              }),
        )
      }
      const rolling = rollingOf(frame.ears, train)
      if (rolling !== undefined) {
        const axles = axlesOf(train),
          reach = Math.abs(train.v) * LOOKAHEAD + 1
        frame.hold(
          `rails:${train.id}`,
          {
            kind: "rails",
            v: train.v,
            axles,
            joints: jointsBetween(
              train.line,
              Math.min(...axles) - reach,
              Math.max(...axles) + reach,
            ),
          },
          train.mine
            ? fromCab(frame, train, rolling.source, OWN_TRAIN_DB.rails)
            : frame.path(keyOf(train, rolling.car), rolling.source, rolling.level, {
                doppler: true,
                quiet: railsQuiet(train.v),
                loss: rolling.loss,
              }),
        )
        const brakes = { kind: "brakes", speed: Math.abs(train.v), brake: train.brake } as const
        if (brakesTargets(brakes) > 0)
          frame.hold(
            `brakes:${train.id}`,
            brakes,
            train.mine
              ? fromCab(frame, train, rolling.source, OWN_TRAIN_DB.brakes)
              : frame.path(keyOf(train, rolling.car), rolling.source, LEVELS.brakes, {
                  doppler: true,
                  quiet: brakesQuiet(brakes),
                  loss: rolling.loss,
                }),
          )
      }
      // The player's horn, on the active cab's roof: through the cab, as a car's horn is heard from its seat.
      const cab = cars[0]
      if (train.mine && heard.horn && cab !== undefined)
        frame.hold(
          `trainHorn:${train.id}`,
          { kind: "trainHorn" },
          frame.path(
            undefined,
            { ...endOf(cab, 1), z: cab.z + OVER_RAIL.horn, ...velocityOf(train, cab) },
            LEVELS.trainHorn,
            { doppler: true },
          ),
        )
    }
    const trains = new Map(heard.trains.map((t) => [t.id, t]))
    for (const h of heard.happenings) {
      if (h.kind !== "whistle") continue
      const train = trains.get(h.train),
        cab = train?.cars[0]
      const at = { x: h.x, y: h.y, z: h.z + OVER_RAIL.horn }
      const place =
        train === undefined || cab === undefined
          ? { source: at, loss: 0 }
          : placeOf(
              frame.ears,
              train,
              cab,
              { ...at, ...velocityOf(train, cab) },
              train.s,
              OVER_RAIL.horn,
            )
      if (place !== undefined)
        frame.play(
          { kind: "trainHonk", urgent: h.urgent },
          frame.path(`train:${h.train}:0`, place.source, LEVELS.trainHonk, { loss: place.loss }),
        )
    }
    // One bell per box, at its centre: two posts' bells started apart would flam. It gets no louder inside its posts, where
    // its bells stand: at the centre it would play 15 dB over its level there and duck the whole mix on every stroke.
    for (const crossing of heard.crossings) {
      if (!crossing.ringing) continue
      const key = `plBell:${crossing.id}`
      frame.hold(
        key,
        { kind: "plBell", variant: hash01(crossing.id, 7) },
        frame.path(
          key,
          { x: crossing.x, y: crossing.y, z: groundAt(crossing.x, crossing.y) + BELL_HEIGHT },
          { ...LEVELS.plBell, rMin: Math.max(LEVELS.plBell.rMin, crossing.posts) },
          { doppler: true },
        ),
      )
    }
  },
})
