/**
 * The director: the brain of proximity and physical behaviour between the `Heard` frames of the
 * audio schedule and a `Speaker`. Each frame it finds the listener's ears (and the cabin around
 * them), the weather there (the sim's own laws, at the ears' height), the masking floor, how
 * enclosed the street is and the rock faces that echo, lets its parts place every sound through
 * the acoustic chain (hearing.ts), keeps the loudest voices of each kind up to their caps, and
 * flushes the speaker. Its parts: vehicles, trains and level crossings, people (steps and cries),
 * talk (conversations), animals, the world around and thunder. Pure TypeScript: Node tests drive it with a recording
 * speaker and a seeded random source.
 *
 * Time is the speaker's: before its context exists (and while it is suspended) no time passes;
 * the director still tracks who sits where, but measures and plays nothing. The bells follow the
 * game's clock, which the `Heard` frame carries.
 *
 * @module audio/director
 */
import { conditionsAt } from "../../sim/sky/local.ts"
import { VEHICLES } from "../../sim/vehicles.ts"
import { axesAt } from "../../sim/view.ts"
import { EAR_HEIGHT } from "../acoustics.ts"
import { echoesAt, type Echo } from "../places.ts"
import type { CabinModel, Heard, Speaker } from "../types.ts"
import { makeAnimals } from "./animals.ts"
import { commit, groundAt, makeFrame, type Offer } from "./frame.ts"
import { makeOccluder } from "./occluder.ts"
import { makePeople } from "./people.ts"
import { makeRail } from "./rail.ts"
import { makeTalk } from "./talk.ts"
import { makeThunder } from "./thunder.ts"
import { makeVehicles } from "./vehicles.ts"
import { makeWorld } from "./world.ts"

/** A frame longer than this (s) is a stall, not time passing. */
const MAX_DT = 0.25
/** A train's cab floor over the rail head, m: over the bogie and the power pack (the ATR 220's 1.2–1.3 m). */
const CAB_FLOOR = 1.2
/** Echoing rock faces are looked up again after this long (s) or this far (m). */
const ECHOES_EVERY = 1,
  ECHOES_MOVED = 10

/**
 * Where the listener sits: the level the ears ride over, the cabin around them and whether it stands in a tunnel. In a car the
 * ears ride with it, in the air too, and in a train's cab over its rails (a rail deck, a tunnel); on foot the ground under the
 * listener stays on the level it was on, `near` (the last frame's): a bridge deck, not the river under it.
 */
export const seatOf = (
  heard: Heard,
  near?: number,
): {
  readonly ground: number
  readonly inside: CabinModel | undefined
  readonly underground: boolean
} => {
  const { listener } = heard
  const seat = heard.vehicles.find((v) => v.id === listener.car)
  if (seat !== undefined)
    return { ground: seat.z - VEHICLES[seat.model].cg, inside: seat.model, underground: false }
  const cab = heard.trains.find((t) => t.id === listener.car)
  if (cab !== undefined)
    return {
      ground: cab.cab + CAB_FLOOR,
      inside: cab.model,
      underground: cab.cars[0]?.tunnel === true,
    }
  return { ground: groundAt(listener.x, listener.y, near), inside: undefined, underground: false }
}

/** The director playing through `speaker`; `random` drives birds, owls, dogs, animal calls and what people say. */
export const makeDirector = (
  speaker: Speaker,
  options: { readonly random?: () => number } = {},
): { readonly hear: (heard: Heard) => void } => {
  const random = options.random ?? Math.random
  const occluder = makeOccluder(),
    vehicles = makeVehicles(),
    rail = makeRail(),
    people = makePeople(),
    talk = makeTalk(),
    animals = makeAnimals(),
    world = makeWorld(),
    thunder = makeThunder()
  let last: number | undefined, ground: number | undefined
  let held: ReadonlySet<string> = new Set()
  let faces:
    | {
        readonly x: number
        readonly y: number
        readonly at: number
        readonly echoes: ReadonlyArray<Echo>
      }
    | undefined

  return {
    hear: (heard) => {
      const now = speaker.now(),
        live = now > 0
      const dt = last === undefined ? 0 : Math.min(MAX_DT, Math.max(0, now - last))
      last = now
      const { listener } = heard
      const seat = seatOf(heard, ground)
      ground = seat.ground
      const ears = {
        x: listener.x,
        y: listener.y,
        z: ground + EAR_HEIGHT,
        vx: listener.vx,
        vy: listener.vy,
        right: axesAt(listener.yaw).right,
      }
      const { inside, underground } = seat
      const air = conditionsAt(heard.sky.seconds, heard.weather, ears.x, ears.y, ground)
      const { ambient, street } = world.listen(ears, now, dt, {
        sky: heard.sky,
        weather: heard.weather,
        air,
        inside,
        underground,
      })
      if (
        live &&
        (faces === undefined ||
          now - faces.at >= ECHOES_EVERY ||
          Math.hypot(ears.x - faces.x, ears.y - faces.y) >= ECHOES_MOVED)
      ) {
        faces = { x: ears.x, y: ears.y, at: now, echoes: echoesAt(ears.x, ears.y) }
      }
      const offers: Array<Offer> = []
      const frame = makeFrame({
        heard,
        now,
        dt,
        live,
        ears,
        air,
        inside,
        ambient,
        street,
        random,
        occluder,
        echoes: faces?.echoes ?? [],
        speaker,
        offers,
      })
      vehicles.hear(frame)
      rail.hear(frame)
      people.hear(frame)
      talk.hear(frame)
      animals.hear(frame)
      world.hear(frame)
      thunder.hear(frame)
      if (live) occluder.refresh(now)
      held = commit(offers, speaker, held)
      speaker.flush()
    },
  }
}
