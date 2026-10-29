/**
 * Test kit for the director's tests: the whole map in memory (as around the player in the game),
 * real map spots, a director on a recording speaker with a seeded random source, and `Heard` frames
 * built from a few vehicles, people, animals, trains (on the map's own line, as the audio schedule
 * projects them) and happenings, at a calm mid-morning (10:10 on 22 October, the sun 22° up, dry,
 * the usual wind) under which every law of the day and the weather is the identity, unless a test
 * sets its own sky or weather.
 *
 * @module audio/director/testing
 */
import { groundZ } from "../../sim/map/ground.ts"
import { LINES, pointAt } from "../../sim/rail/lines.ts"
import type { TrainMotionValue, WeatherValue } from "../../sim/schema.ts"
import { DAY, daysFromCivil, utcFromRome } from "../../sim/sky/calendar.ts"
import { NO_SNOW } from "../../sim/sky/climate.ts"
import { initialWeather } from "../../sim/sky/weather.ts"
import { VEHICLES, type VehicleModel } from "../../sim/vehicles.ts"
import { screenAxes } from "../../sim/view.ts"
import { skyAt } from "../index.ts"
import type { HeardTrain } from "../rail-types.ts"
import { heardTrain } from "../rail.ts"
import { seeded } from "../speech/testing.ts"
import { residentMap } from "../testing.ts"
import type {
  Continuous,
  Happening,
  Heard,
  HeardAnimal,
  HeardPerson,
  HeardVehicle,
  OneShot,
  Placement,
  Speaker,
  Zone,
} from "../types.ts"
import { makeDirector } from "./index.ts"
import { USUAL_WIND } from "./sky.ts"

// Every tile in memory: the director hears the exact map wherever a test listens, as the game does around the player.
residentMap()

// Real map spots, found by probing the map.
/** A treeless meadow on Monte dei Bianchi, clear for 300 m to the south and screen-right. */
export const MEADOW = { x: -329, y: 1078 }
/** A lane at Pian del Molino with a 10.7 m building 30 m east (`BEHIND`) and open ground 30 m north-west (`OPEN`). */
export const STREET = { x: -916.6, y: 1706.8 }
/** Behind the 10.7 m building east of `STREET`. */
export const BEHIND = { x: -886.6, y: 1706.8 }
/** The open ground north-west of `STREET`. */
export const OPEN = { x: -937.8, y: 1728 }
/** A wooded ridge above Aiola (900 m), with no water within 400 m. */
export const RIDGE = { x: 1600, y: -494.5 }
/** Monzone station, 68 m from the Torrente Lucido. */
export const STATION = { x: -494, y: 437 }
/** A street 50 m from Monzone Alto's tower. */
export const BELFRY = { x: -41.8, y: -306.6 }
/** The woods above Isolano, in earshot of eleven bell towers. */
export const HILLSIDE = { x: -950, y: 71 }
/** The street of Monzone where the game starts, 50 m from the Lucido behind the houses. */
export const SPAWN = { x: -412.6, y: 437.8 }
/** A bank 15 m from the Lucido, with nothing in the way. */
export const BANK = { x: -418.6, y: 395.8 }
/** Monte San Giorgio's west flank, in the open under a rock face, 400 m from `EAST_FLANK`. */
export const WEST_FLANK = { x: 785.7, y: -563.4 }
/** Monte San Giorgio's east flank, 400 m from `WEST_FLANK` across the mountain. */
export const EAST_FLANK = { x: 1185.7, y: -563.4 }
/** The rendered house wall on Via Cesare Battisti where src/sim/__tests__/index.test.ts drives a Panda, on its cobbles. */
export const HOUSE_WALL = { x: -429.85, y: 452.9 }
/** Gragnola's centre, walled in on every side. */
export const GRAGNOLA = { x: -1751.2, y: 3360.4 }
/** The riverbed's gravel 16 m under a bridge's asphalt deck. */
export const UNDER_BRIDGE = { x: -1190.3, y: 1273.1 }
/** One frame at 60 Hz, s. */
export const FRAME = 1 / 60
/** Screen-right on the ground, with the view in its home seat. */
export const SCREEN_RIGHT = screenAxes(0).right
/** Due south on the ground. */
export const SOUTH = { x: 0, y: -1 }
/** A Panda's mass, t. */
export const PANDA = VEHICLES.panda.mass / 1000

/** Game time `hour`:`minute` on 22 October 2026, Rome time, `days` later. */
export const at = (hour: number, minute = 0, days = 0): number =>
  utcFromRome((daysFromCivil(2026, 10, 22) + days) * DAY + hour * 3600 + minute * 60)
/** The tests' sky: 10:10 on 22 October, the sun 22° up, past the dawn chorus. */
export const MORNING = skyAt(at(10, 10))
/** The tests' weather: clear and dry, no snow on the map, the wind the law was tuned for with the valley's usual gusts. */
export const CALM: WeatherValue = {
  ...initialWeather(MORNING.seconds, 1),
  wind: USUAL_WIND,
  gust: 1.5,
  snowLine: NO_SNOW,
}

// The speech tests' mulberry32: a plain LCG's consecutive draws correlate, so a rare event's draw fixed the line drawn next.
export { seeded }

/** A one-shot played at speaker time `t`, `delay` s ahead. */
export interface Played {
  readonly sound: OneShot
  readonly at: Placement
  readonly delay: number
  readonly t: number
}

/** A director on a recording speaker whose clock (from `t`; 0 is no context yet) the test advances by `dt` per `hear`. */
export const rig = (t = 1) => {
  let holding = new Map<string, { readonly sound: Continuous; readonly at: Placement }>()
  let held = holding
  const plays: Array<Played> = [],
    stops: Array<{ readonly sound: OneShot; readonly t: number }> = []
  const speaker: Speaker = {
    now: () => t,
    hold: (key, sound, at) => void holding.set(key, { sound, at }),
    play: (sound, at, delay) => void plays.push({ sound, at, delay, t }),
    stop: (sound) => void stops.push({ sound, t }),
    flush: () => {
      held = holding
      holding = new Map()
    },
  }
  const director = makeDirector(speaker, { random: seeded(7) })
  return {
    plays,
    /** The one-shots stopped, and when. */
    stops,
    /** The speaker's time now. */
    now: () => t,
    /** What the last frame held. */
    held: () => held,
    hear: (heard: Heard, frames = 1, dt = FRAME) => {
      for (let i = 0; i < frames; i++) {
        t += dt
        director.hear(heard)
      }
    },
    /** Plays of `kind` since it was last taken. */
    take: (kind: OneShot["kind"]): Array<Played> => {
      const taken = plays.filter((p) => p.sound.kind === kind)
      plays.splice(0, plays.length, ...plays.filter((p) => p.sound.kind !== kind))
      return taken
    },
  }
}

/** Vehicle `id`, idling on its wheels at `at`. */
export const car = (
  id: number,
  model: VehicleModel,
  at: { readonly x: number; readonly y: number },
  more: Partial<HeardVehicle> = {},
): HeardVehicle => ({
  id,
  model,
  x: at.x,
  y: at.y,
  z: groundZ(at.x, at.y) + VEHICLES[model].cg,
  angle: 0,
  vx: 0,
  vy: 0,
  rpm: VEHICLES[model].engine.idle,
  load: 0,
  wheelsDown: true,
  hullDown: false,
  running: true,
  mine: false,
  damage: 0,
  misfire: false,
  burning: false,
  ...more,
})
/** A Panda revving at the redline under full load. */
export const FULL = { rpm: VEHICLES.panda.engine.redline, load: 1 } as const
/** Person `id` standing at `at`: a man, walking. */
export const person = (
  id: number,
  at: { readonly x: number; readonly y: number },
  more: Partial<HeardPerson> = {},
): HeardPerson => ({
  id,
  x: at.x,
  y: at.y,
  vx: 0,
  vy: 0,
  player: false,
  age: "adult",
  female: false,
  mood: "walk",
  fx: at.x,
  fy: at.y,
  down: false,
  dead: false,
  ...more,
})
/** Animal `id` of `species`, idle at `at`, of its species' usual size. */
export const animal = (
  id: number,
  species: HeardAnimal["species"],
  at: { readonly x: number; readonly y: number },
  more: Partial<HeardAnimal> = {},
): HeardAnimal => ({
  id,
  species,
  x: at.x,
  y: at.y,
  vx: 0,
  vy: 0,
  size: 1,
  mood: "idle",
  down: false,
  dead: false,
  ...more,
})
/** An ATR 220, train `id`, on the map's line with its active cab's nose at s, facing `facing` (+s unless −1), moving as `motion` says (standing, power off, by default), the player's when `mine`. */
export const train = (
  id: number,
  s: number,
  motion: Partial<TrainMotionValue> = {},
  mine = false,
): HeardTrain =>
  heardTrain(
    id,
    "atr220",
    { line: 0, s, prev: s, v: 0, facing: 1, power: 0, brake: 0, ...motion },
    mine,
  )!
/** `metres` off the map's line at s, to its right (left when negative), on the ground there. */
export const beside = (s: number, metres: number) => {
  const at = pointAt(LINES[0]!, s)
  return { x: at.x + Math.sin(at.angle) * metres, y: at.y - Math.cos(at.angle) * metres }
}

/** The listener at `at` (in `car` when given), with `more` of the world, at the tests' sky and weather unless it sets them. */
export const world = (
  at: { readonly x: number; readonly y: number },
  more: Partial<Heard> = {},
  car?: number,
): Heard => ({
  listener: { x: at.x, y: at.y, vx: 0, vy: 0, car, yaw: 0 },
  vehicles: [],
  people: [],
  animals: [],
  trains: [],
  crossings: [],
  happenings: [],
  horn: false,
  sky: MORNING,
  weather: CALM,
  ...more,
})
/** `metres` from `from` toward `dir` (screen-right by default). */
export const away = (
  from: { readonly x: number; readonly y: number },
  metres: number,
  dir: { readonly x: number; readonly y: number } = SCREEN_RIGHT,
) => ({ x: from.x + metres * dir.x, y: from.y + metres * dir.y })
/** Car `car`, a Panda, hitting a wall at `at` on its `zone` (nose first). */
export const wallHit = (
  at: { readonly x: number; readonly y: number },
  speed: number,
  car = 1,
  zone: Zone = "front",
): Happening => ({
  kind: "impact",
  hit: "wall",
  x: at.x,
  y: at.y,
  speed,
  mass: PANDA,
  car,
  body: { model: "panda", zone },
})
