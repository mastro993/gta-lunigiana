/**
 * The valley around the listener: the wind and rain beds (the rain drumming on the roof inside a
 * car), the crickets in warm, dry air, running water, songbirds in the trees by daylight and owls in
 * the woods at night, farm dogs, and the church bells striking the game clock's hours from the
 * village towers within earshot. Rivers, the wind and the rain raise the masking floor every other
 * sound is heard against, from the rural night's stillness to a downpour's roar; the streets around
 * the listener set the reverb send, and snow on the ground stills the leaves. In a tunnel (the
 * player's train in a bore) no wind blows, no rain falls and no crickets sing.
 *
 * @module audio/director/world
 */
import type { WeatherValue } from "../../sim/schema.ts"
import type { Conditions } from "../../sim/sky/local.ts"
import { place } from "../../sim/sky/place.ts"
import { hash01 } from "../../tools/geometry.ts"
import { audibility, CABIN, dbToGain, EAR_HEIGHT, mixGain, spreading, sumDb } from "../acoustics.ts"
import { smoothstep } from "../buffers.ts"
import {
  ambienceAt,
  type Bell,
  bells,
  birdSpot,
  type Dog,
  dogsNear,
  type Owl,
  owlsNear,
  streetAt,
  waterNear,
  type WaterHeard,
} from "../places.ts"
import { cricketsQuiet, echemeRate } from "../synth/nature.ts"
import { rainQuiet } from "../synth/rain.ts"
import type { CabinModel, HeardSky, OneShot } from "../types.ts"
import type { Frame } from "./frame.ts"
import type { Ears, Hearing } from "./hearing.ts"
import {
  BEDS,
  GALE_DB,
  HEIGHT,
  LEVELS,
  OWL,
  rainDb,
  TOWERS,
  WATER_R_MIN,
  windDb,
} from "./levels.ts"
import { RUN } from "./people.ts"
import {
  birdActivity,
  floorDb,
  gustsOf,
  owlActivity,
  RAINING,
  rainHeard,
  roofHearing,
  windFactor,
} from "./sky.ts"

/** Water, dogs and owls are looked up again after this long (s) or this far (m); water within `WATER_REACH` m, dogs `DOG_REACH`, owls `OWL_REACH`. */
const NEAR_EVERY = 0.25,
  NEAR_MOVED = 2,
  WATER_REACH = 400,
  DOG_REACH = 200,
  OWL_REACH = 600
/** The street around the listener eases over this long, s. */
const STREET_TAU = 0.5
/**
 * Wind strength from the ears' height over the map's floor (`place().floor`, its 5th-percentile height): a smoothstep over `ALTITUDE`
 * m from it, `CALM`…`GALE`, up to `OPEN` more in the open, `STREETS` less in streets, in the usual wind. It starts 80 m under the floor,
 * about the shipped map's lowest ground (147 m under a 230 m floor), so on that map it spans the 150–1000 m a.s.l. it was tuned on.
 */
const ALTITUDE = [-80, 770] as const,
  CALM = 0.15,
  GALE = 0.85,
  OPEN = 0.15,
  STREETS = 0.3
/** The strongest the wind gets: a gale's bed at `GALE_DB`, past its voice's full strength (1). */
const GUSTIEST = 10 ** ((GALE_DB - BEDS.wind) / 40)
/** A snow cover stills this share of the leaves in the wind: laden or bare trees, fallen leaves under the snow. */
const SNOW_LEAVES = 0.7
/** Birds call this often (per s) in full forest, plus `HOUSES` near houses (a built share over `GARDENS`), in the day's song. */
const BIRDS = { forest: 0.3, houses: 0.05 } as const,
  GARDENS = 0.05
const SPECIES = [
  ["robin", 0.35],
  ["tit", 0.3],
  ["blackbird", 0.2],
  ["chaffinch", 0.15],
] as const satisfies ReadonlyArray<
  readonly [Extract<OneShot, { readonly kind: "bird" }>["species"], number]
>
/** An owl calls `1 / OWL_MEAN` times a second while active, never within `OWL_REST` s of its last call: one call every 30–60 s or so (its hoots last 6 s). */
const OWL_MEAN = 20,
  OWL_REST = 30
/** A dog barks every `BARK_MEAN` s on average, `EXCITED`× as often while the listener runs (or drives) within `EXCITED_NEAR` m. */
const BARK_MEAN = 45,
  EXCITED = 4,
  EXCITED_NEAR = 30
/** Hour strokes are this far apart (s); each tower starts up to `TOWER_LAG` s late (its own, stable); a stroke is scheduled `STROKE_AHEAD` s early. */
const STROKE_GAP = 2.5,
  TOWER_LAG = 6,
  STROKE_AHEAD = 0.1
/** The game hours the bells ring, local time: the night's silence from 22:00 to 07:00, as Tuscany's parishes keep it. */
const BELL_HOURS = [7, 21] as const
/** Rain falls on water this near (m): a river's or a fountain's, as much as on the puddles of a wet village. */
const WATER_RAIN = [5, 40] as const

/** A body of water heard from where it was looked up: its level and its distance there. */
interface Water extends WaterHeard {
  readonly r: number
}

/** What the listener's surroundings are this frame, before the rest of it: the sky, the weather there, the cabin around them and whether it stands in a tunnel. */
export interface Around {
  readonly sky: HeardSky
  readonly weather: WeatherValue
  readonly air: Conditions
  readonly inside: CabinModel | undefined
  readonly underground: boolean
}

/** Whether a Poisson process of `rate` per second fires in `dt`. */
const fires = (random: () => number, rate: number, dt: number): boolean =>
  random() < 1 - Math.exp(-rate * dt)

/** The world part of the director, with the nearby water, dogs and owls, the eased street, the last ring it rang and its strokes to come. */
export const makeWorld = () => {
  let near:
    | {
        readonly x: number
        readonly y: number
        readonly at: number
        readonly water: ReadonlyArray<Water>
        readonly dogs: ReadonlyArray<Dog>
        readonly owls: ReadonlyArray<Owl>
      }
    | undefined
  let street: number | undefined
  let strength = 0,
    forest = 0,
    open = 0,
    built = 0,
    underground = false
  /** The loudest water as heard last frame (occlusion and cabin included), dB(A): an occluded river masks only as loud as it sounds. */
  let loudest = -Infinity
  let rung = ""
  /** Bell strokes still to ring, speaker time; each owl's last call. */
  const strokes: Array<{ readonly bell: Bell; readonly at: number }> = []
  const calls = new Map<string, number>()

  /**
   * The bed of `db` dB(A) at the ears, whose voice plays `under` dB under its nominal by itself: everywhere at once,
   * through the cabin when inside, and diffuse already (no reverb send). Its level is compressed like any source's, so
   * the gain gives back what the voice took.
   */
  const bed = (frame: Frame, db: number, under: number): Hearing => {
    const cabin = frame.inside === undefined ? undefined : CABIN[frame.inside]
    return {
      placement: {
        gain: mixGain(db, cabin?.loss ?? 0) * dbToGain(under),
        pan: 0,
        cutoff: cabin?.cutoff ?? 20000,
        cents: 0,
        wet: 0,
      },
      level: db - (cabin?.loss ?? 0),
      audible: true,
      r: 0,
      delay: 0,
    }
  }

  /** The beds round the listener: the wind, the rain (and its drumming on the roof inside), and the crickets in the meadows. */
  const beds = (frame: Frame) => {
    const { ears, air } = frame,
      { weather } = frame.heard
    // A gale's voice blows at full strength, its bed louder: the voice plays as far under its nominal as its own strength takes.
    const voice = Math.min(1, strength)
    frame.hold(
      "wind",
      {
        kind: "wind",
        strength: voice,
        forest: forest * (1 - SNOW_LEAVES * air.snowCover),
        gusts: gustsOf(weather),
      },
      bed(frame, windDb(strength), BEDS.wind - windDb(voice)),
    )
    // Rain on whatever lies around: leaves, roofs and paving, a river near or the puddles of a wet village; and on the car's roof.
    if (air.rain >= RAINING) {
      const nearest = Math.min(...(near?.water ?? []).map((w) => w.r)),
        water = Math.max(1 - smoothstep(WATER_RAIN[0], WATER_RAIN[1], nearest), air.wet * built)
      frame.hold(
        "rain",
        { kind: "rain", rate: air.rain, forest, built, water },
        bed(frame, rainDb(air.rain), rainQuiet(air.rain)),
      )
      if (frame.inside !== undefined)
        frame.hold("roof", { kind: "roof", rate: air.rain }, roofHearing(air.rain))
    }
    // Tree crickets sing in the meadows, not in the villages, in air warm enough and dry: a bed, with no reverb send.
    const density = Math.max(0, open - built)
    if (density > 0 && echemeRate(air.celsius) > 0 && air.rain < RAINING) {
      const crickets = frame.path(
        undefined,
        ears,
        { db: BEDS.crickets, rMin: 1 },
        { quiet: cricketsQuiet(density) },
      )
      frame.hold(
        "crickets",
        { kind: "crickets", density, celsius: air.celsius },
        { ...crickets, placement: { ...crickets.placement, wet: 0 } },
      )
    }
  }

  return {
    /**
     * Before the rest of the frame: what is near, the street, and the masking floor: the wind bed as heard (blowing as the weather
     * does, never stiller than the rural day, or night, at its stillest, and through the cabin inside), the rain as heard, and the
     * loudest water last heard.
     */
    listen: (
      ears: Ears,
      now: number,
      dt: number,
      around: Around,
    ): { readonly ambient: number; readonly street: number } => {
      if (
        near === undefined ||
        now - near.at >= NEAR_EVERY ||
        Math.hypot(ears.x - near.x, ears.y - near.y) >= NEAR_MOVED
      ) {
        const water = waterNear(ears.x, ears.y, WATER_REACH).map((w) => ({
          ...w,
          r: Math.hypot(w.x - ears.x, w.y - ears.y, w.z + HEIGHT.water - ears.z),
        }))
        near = {
          x: ears.x,
          y: ears.y,
          at: now,
          water,
          dogs: dogsNear(ears.x, ears.y, DOG_REACH),
          owls: owlsNear(ears.x, ears.y, OWL_REACH),
        }
      }
      const enclosed = streetAt(ears.x, ears.y)
      street =
        street === undefined
          ? enclosed
          : street + (enclosed - street) * (1 - Math.exp(-dt / STREET_TAU))
      ;({ forest, open, built } = ambienceAt(ears.x, ears.y))
      const low = place().floor,
        height =
          CALM +
          (GALE - CALM) * smoothstep(low + ALTITUDE[0], low + ALTITUDE[1], ears.z - EAR_HEIGHT)
      // The stillest the wind gets (`windDb` at the floor): the rural background itself, leaves and the far valley, even in a sheltered street.
      const still = 10 ** ((floorDb(around.sky.sun) - BEDS.wind) / 40)
      strength = Math.min(
        GUSTIEST,
        Math.max(still, (height + OPEN * open - STREETS * street) * windFactor(around.weather)),
      )
      // What masks is what plays: inside, the wind bed comes through the cabin (`bed`), as every source it masks does. In a
      // tunnel no wind blows nor rain falls: the floor is the stillest air's.
      ;({ underground } = around)
      const wind =
        windDb(underground ? still : strength) -
        (around.inside === undefined ? 0 : CABIN[around.inside].loss)
      const rain = underground ? -Infinity : rainHeard(around.air.rain, around.inside)
      return { ambient: sumDb([wind, rain, loudest]), street }
    },

    hear: (frame: Frame): void => {
      const { ears, now, dt, random, air } = frame,
        { sky } = frame.heard
      // In a tunnel (the player's train in a bore) no wind, rain nor crickets: only water, the animals and the bells, through the hill.
      if (!underground) beds(frame)
      // The level looked up holds the distance cue: it passes as the source level back to 1 m, the spreading as the loss
      // (obstacles, lowpass, masking). Like a bed's, that level here is what the mix compresses: far water is no louder a source.
      loudest = -Infinity
      for (const w of near?.water ?? []) {
        const at = frame.path(
          w.key,
          { x: w.x, y: w.y, z: w.z + HEIGHT.water },
          { db: w.level + spreading(w.r, WATER_R_MIN), rMin: WATER_R_MIN },
        )
        const gain = mixGain(w.level, w.level - at.level) * audibility(at.level, frame.ambient)
        frame.hold(
          w.key,
          { kind: "water", body: w.body, flow: w.flow },
          { ...at, placement: { ...at.placement, gain } },
        )
        if (at.audible) loudest = Math.max(loudest, at.level)
      }

      // The draws keep their order (birds, dogs, then owls only at night), so a day's random stream is the one it always was.
      const songs = birdActivity(sky.sun, sky.hour < 12, air.rain)
      if (
        fires(random, (BIRDS.forest * forest + (built > GARDENS ? BIRDS.houses : 0)) * songs, dt)
      ) {
        const spot = birdSpot(ears.x, ears.y, random)
        if (spot !== undefined) {
          let pick = random()
          const species = SPECIES.find(([, share]) => (pick -= share) < 0)?.[0] ?? "robin"
          frame.play(
            { kind: "bird", species },
            frame.path(`bird:${spot.x},${spot.y}`, spot, LEVELS.bird),
          )
        }
      }

      const listener = frame.heard.listener,
        busy = listener.car !== undefined || Math.hypot(listener.vx, listener.vy) > RUN
      for (const dog of near?.dogs ?? []) {
        const excited = busy && Math.hypot(dog.x - ears.x, dog.y - ears.y) < EXCITED_NEAR
        if (fires(random, (excited ? EXCITED : 1) / BARK_MEAN, dt))
          frame.play({ kind: "bark", big: dog.big }, frame.path(dog.key, dog, LEVELS.bark))
      }

      const hooting = owlActivity(sky.sun, air.rain)
      for (const owl of hooting > 0 ? (near?.owls ?? []) : []) {
        if (
          now - (calls.get(owl.key) ?? -Infinity) < OWL_REST ||
          !fires(random, hooting / OWL_MEAN, dt)
        )
          continue
        calls.set(owl.key, now)
        frame.play({ kind: "bird", species: "owl" }, frame.path(owl.key, owl, OWL))
      }

      // On the game clock's hour the hours (1–12), by day: each ring once (the day in its key, so a clock set back rings again), from
      // the towers loudest here. A new ring takes over what is left of the last (a clock the dev menu runs fast). Before the audio
      // context runs no tower is heard, so the ring waits for it: a new game's 08:00, held behind the title card, rings once it runs.
      const ring = `${sky.day}:${sky.hour}`
      if (
        frame.live &&
        sky.minute === 0 &&
        sky.hour >= BELL_HOURS[0] &&
        sky.hour <= BELL_HOURS[1] &&
        ring !== rung
      ) {
        rung = ring
        strokes.length = 0
        const count = sky.hour % 12 || 12
        const towers = bells.flatMap((bell, i) => {
          const at = frame.path(bell.key, bell, LEVELS.bell)
          return at.audible ? [{ bell, lag: TOWER_LAG * hash01(i, 7), level: at.level }] : []
        })
        for (const { bell, lag } of towers.sort((a, b) => b.level - a.level).slice(0, TOWERS)) {
          for (let k = 0; k < count; k++) strokes.push({ bell, at: now + lag + k * STROKE_GAP })
        }
      }
      // A stroke is placed when it rings: in the half minute of the hours the listener moves on.
      for (let k = strokes.length - 1; k >= 0; k--) {
        const { bell, at } = strokes[k]!
        if (at > now + STROKE_AHEAD) continue
        strokes.splice(k, 1)
        frame.play(
          { kind: "bell", pitch: bell.pitch },
          frame.path(bell.key, bell, LEVELS.bell),
          Math.max(0, at - now),
        )
      }
    },
  }
}
