import { Clock, type HostClock } from "@typeonce/ritmo"
import { InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { InputAxis, Random } from "@typeonce/ritmo-math"
import type { RuntimeServices } from "@typeonce/ritmo/Runtime"

import { clampKnob, DEFAULT_HANDLING } from "./handling.ts"
import { OPEN } from "./rail/barriers.ts"
import { CROSSINGS } from "./rail/crossings.ts"
import { ApplyTrains, Dispatch, FillTrains } from "./rail/dispatch.ts"
import { LINES } from "./rail/lines.ts"
import { TrainAI } from "./rail/service.ts"
import { TrainContacts } from "./rail/strikes.ts"
import { Crossings, TrainPhysics } from "./rail/systems.ts"
import {
  bindings,
  Driving,
  Game,
  GameClock,
  Handling,
  Input,
  KeyboardInput,
  Player,
  Pose,
  PrevPose,
  SetClock,
  SetHandling,
  SetWeather,
  STEP,
  Time,
  View,
  Weather,
} from "./schema.ts"
import { setClock } from "./sky/clock.ts"
import { initialWeather, setWeather } from "./sky/weather.ts"
import { Animals } from "./systems/animals.ts"
import { Contacts, Recover } from "./systems/contacts.ts"
import { CrashDamage } from "./systems/damage.ts"
import { PlayerDrive, RideAlong } from "./systems/drive.ts"
import { EnterExit } from "./systems/enter-exit.ts"
import { Explode, Respawn } from "./systems/explosions.ts"
import { PlayerFoot } from "./systems/foot.ts"
import { FindFooting } from "./systems/footing.ts"
import { Startle } from "./systems/fright.ts"
import { Pedestrians } from "./systems/pedestrians.ts"
import { Perceive } from "./systems/perceive.ts"
import { VehiclePhysics } from "./systems/physics.ts"
import { FillAnimals, PopulateAnimals } from "./systems/populate-animals.ts"
import { FillPeople, Populate } from "./systems/populate.ts"
import { ApplyPlayer, LeaveBehind } from "./systems/reach.ts"
import { AdvanceClock, AdvanceRivers, AdvanceWeather } from "./systems/sky.ts"
import { SpawnWorld } from "./systems/spawn.ts"
import { TrafficAI } from "./systems/traffic.ts"
import { Wade } from "./systems/water.ts"
import { followYaw, nearestSeat } from "./view.ts"
import { initialRivers } from "./water/flow.ts"

export * from "./schema.ts"
export { TrainView, type TrainViewModel } from "./rail/view.ts"
export {
  HandlingView,
  PlayerView,
  type PlayerViewModel,
  SkyView,
  type SkyViewModel,
} from "./views.ts"

const AdvanceTime = Clock.system(Game, { name: "Lunigiana/AdvanceTime", resource: Time })
const CaptureInput = InputCapture.system(Game, {
  name: "Lunigiana/CaptureInput",
  source: KeyboardInput,
  resource: Input,
})

/** Copies each pose into PrevPose at the start of the step, for render interpolation. */
const StorePrevious = Game.System(
  "Lunigiana/StorePrevious",
  {
    queries: {
      all: Game.Query({
        selection: { prev: Game.Query.write(PrevPose), pose: Game.Query.read(Pose) },
      }),
    },
  },
  ({ queries }) => {
    for (const { data } of queries.all.each()) data.prev.set(data.pose.get())
  },
)

/**
 * The turn keys swing the view a quarter left or right; on foot, the movement keys follow it.
 * Driving, the host's view follows the car, so the keys do nothing and the view keeps the quarter
 * seat nearest the car's heading: the player gets out to that seat, and the host settles the view on
 * it.
 */
const TurnView = Game.System(
  "Lunigiana/TurnView",
  {
    queries: {
      player: Game.Query({
        selection: { pose: Game.Query.read(Pose), driving: Game.Query.optional(Driving) },
        with: [Player],
      }),
    },
    resources: { input: Game.System.readResource(Input), view: Game.System.writeResource(View) },
  },
  ({ queries, resources }) => {
    const { turns } = resources.view.get()
    const found = queries.player.singleOptional()
    if (found.ok && found.value?.data.driving.present === true) {
      // The player's pose is the car's (RideAlong).
      const seat = nearestSeat(turns, followYaw(found.value.data.pose.get().angle))
      if (seat !== turns) resources.view.set({ turns: seat })
      return
    }
    const keys = resources.input.get()
    const turn = InputAxis.axis(keys.actions.turnRight.pressed, keys.actions.turnLeft.pressed)
    if (turn !== 0) resources.view.set({ turns: turns + turn })
  },
)

/** Each `SetHandling` request sets its knob, kept inside the knob's range (a switch to 0 or 1); one that is not a number is dropped. */
const ApplyHandling = Game.System(
  "Lunigiana/ApplyHandling",
  {
    resources: { handling: Game.System.writeResource(Handling) },
    events: { requests: Game.System.readEvent(SetHandling) },
  },
  ({ resources, events }) => {
    for (const { key, value } of events.requests.all()) {
      const valid = clampKnob(key, value)
      if (valid !== undefined)
        resources.handling.update((handling) => ({ ...handling, [key]: valid }))
    }
  },
)

/** Each `SetClock` request sets the game time and/or its rate, kept in range; one with no number in it is dropped. */
const ApplyClock = Game.System(
  "Lunigiana/ApplyClock",
  {
    resources: { clock: Game.System.writeResource(GameClock) },
    events: { requests: Game.System.readEvent(SetClock) },
  },
  ({ resources, events }) => {
    for (const request of events.requests.all()) {
      const next = setClock(resources.clock.get(), request)
      if (next !== undefined) resources.clock.set(next)
    }
  },
)

/** Each `SetWeather` request forces its regime (settled at once when asked) or hands the weather back to chance; one naming no regime is dropped. */
const ApplyWeather = Game.System(
  "Lunigiana/ApplyWeather",
  {
    resources: {
      clock: Game.System.readResource(GameClock),
      weather: Game.System.writeResource(Weather),
    },
    events: { requests: Game.System.readEvent(SetWeather) },
  },
  ({ resources, events }) => {
    for (const request of events.requests.all()) {
      const next = setWeather(resources.weather.get(), request, resources.clock.get().seconds)
      if (next !== undefined) resources.weather.set(next)
    }
  },
)

/**
 * Ticked once after the runtime is made. The first fill of trains, people and animals runs once the player stands at the start, so
 * the world is peopled from the first frame. The host's requests wait for the apply systems' first run in `update`, however many
 * render frames come first.
 */
export const setup = Game.Schedule(
  SpawnWorld,
  Game.Schedule.applyDeferred(),
  FillPeople,
  FillAnimals,
  // Last: the people and animals take the same entity ids as in a game with no trains (some of their ways hash it).
  FillTrains,
  Game.Schedule.applyDeferred(),
)
/** One fixed step of the game. */
export const update = Game.Schedule(
  AdvanceTime,
  CaptureInput,
  StorePrevious,
  TurnView,
  ApplyHandling,
  ApplyClock,
  ApplyWeather,
  ApplyTrains,
  ApplyPlayer,
  AdvanceClock,
  AdvanceWeather,
  AdvanceRivers,
  EnterExit,
  Game.Schedule.applyDeferred(),
  // Where each body on foot stands, before anything moves: the railway's rules read it.
  FindFooting,
  Explode,
  Wade,
  Game.Schedule.applyDeferred(),
  PlayerFoot,
  PlayerDrive,
  // Before traffic, which obeys the arms; the AI trains read them too.
  Crossings,
  TrafficAI,
  TrainAI,
  Pedestrians,
  Animals,
  VehiclePhysics,
  TrainPhysics,
  Contacts,
  // Last of the contacts: a train is shoved by nothing, so what it strikes ends where it leaves it.
  TrainContacts,
  CrashDamage,
  RideAlong,
  Recover,
  // After the contacts: this step's hits and crashes are events, which a save drops, so they are taken in the step they happen.
  Perceive,
  Startle,
  Respawn,
  // After the player's last move of the step: whoever a jump left behind goes before the next step reads the map there.
  LeaveBehind,
  Dispatch,
  Populate,
  PopulateAnimals,
  Game.Schedule.applyDeferred(),
)

/** A new game's start when the host gives none: 2026-10-22 08:00 CEST (Unix UTC seconds), so tests replay the same day. */
export const DEFAULT_START = 1792648800
/**
 * Mixed into the seed for the weather's stream. mulberry32 steps through every 32-bit state in one cycle, so `WeatherRng` and `Rng`
 * are the same sequence at an offset the seed sets. Measured over all 2³² seeds, the offset is as good as random: two streams of N
 * draws each overlap for about 2N/2³² of the seeds (1 in 2000 at a million draws); the closest is 7179 draws (seed 137 773 472), and
 * every seed from 0 to 200 000 is at least 1.2 million apart. Where they overlap the weather only repeats numbers the world drew: it
 * never changes traffic, people, animals or parking.
 */
const WEATHER_SEED = 0x9e3779b9
/** Mixed into the seed for the railway's stream (`RailRng`), as `WEATHER_SEED` is for the weather's: trains never change what `Rng` draws. */
const RAIL_SEED = 0x7f4a7c15

/**
 * A new game from `seed`, starting at `start` (Unix UTC seconds, a whole number: the host's today at 08:00 in Rome;
 * `DEFAULT_START` when omitted). The host passes every service: KeyboardInput plus its own (render registries, clocks).
 */
export const makeRuntime = <const Services extends RuntimeServices>(options: {
  readonly seed: number
  readonly start?: number
  readonly services: Services
  readonly debug?: { readonly hostClock: HostClock.HostClock }
}) => {
  const start = options.start ?? DEFAULT_START,
    weatherSeed = Random.seed(options.seed ^ WEATHER_SEED)
  return Game.Runtime.make({
    services: options.services,
    resources: {
      Time: Clock.start(STEP),
      Rng: Random.seed(options.seed),
      WeatherRng: weatherSeed,
      RailRng: Random.seed(options.seed ^ RAIL_SEED),
      Score: { stolen: 0, knocked: 0 },
      View: { turns: 0 },
      Handling: DEFAULT_HANDLING,
      GameClock: { seconds: start, rate: 1 },
      Weather: initialWeather(start, weatherSeed),
      Rivers: initialRivers(start, weatherSeed),
      Railway: LINES.map(() => ({ due: 0, from: 0 }) as const),
      LevelCrossings: CROSSINGS.map(() => OPEN),
      Input: Keyboard.idle(bindings),
    },
    debug: options.debug,
  })
}
