import { Clock, Descriptor, Entity, Schema } from "@typeonce/ritmo"
import { type InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { Random } from "@typeonce/ritmo-math"
import * as v from "valibot"

import type { HandlingKey } from "./handling.ts"
import type { Surface } from "./map/surface.ts"
import { CROSSING_PHASES, RUN_STATES, TRAIN_MODELS } from "./rail/models.ts"
import { EVENTS, FOGS, INTENSITIES, type Regime, REGIMES, SKIES } from "./sky/regimes.ts"
import { VEHICLE_MODELS, type VehicleModel } from "./vehicles.ts"

/**
 * World conventions: x = east, y = north, metres from the map origin
 * (`MAP.origin`). Angles are radians counter-clockwise from east.
 */
export const Root = Schema.defineRoot("Lunigiana")

/** A finite number: a save is JSON, which cannot carry `NaN` or `Infinity`. */
const finite = v.pipe(v.number(), v.finite())
/** A safe integer: step counts, colours, indices. */
const integer = v.pipe(v.number(), v.safeInteger())
/** A stored entity handle, checked by Ritmo's guard (`Entity.isHandle`); it never proves the entity is alive. */
const handle = <H>(isHandle: (raw: unknown) => raw is H) => v.pipe(v.unknown(), v.guard(isHandle))

/** The one fixed step: Clock resource, FixedLoop and replays all use it. */
export const STEP = Clock.hz(60)

const PoseCodec = v.object({ x: finite, y: finite, angle: finite })

/** Where a body is and which way it faces. */
export const Pose = Descriptor.ConstructedComponent(PoseCodec)("Lunigiana/Pose")
/** Pose at the start of the current step, for render interpolation. */
export const PrevPose = Descriptor.ConstructedComponent(PoseCodec)("Lunigiana/PrevPose")
/** A Pose (or PrevPose) value. */
export type PoseValue = Descriptor.Descriptor.Value<typeof Pose>
/** World-frame velocity (m/s) and yaw rate (rad/s). */
export const Motion = Descriptor.ConstructedComponent(
  v.object({ vx: finite, vy: finite, spin: finite }),
)("Lunigiana/Motion")

/** The one human-controlled person. */
export const Player = Descriptor.Tag("Lunigiana/Player")
/** A person's age group: a child (always out with a grown-up), an adult or an elder. */
export const AGES = ["kid", "adult", "elder"] as const
/** An age group. */
export type Age = (typeof AGES)[number]
/** What a person wears below the shirt: trousers, shorts (bare shins), a skirt, or a dress (the skirt in the shirt's colour). */
export const OUTFITS = ["trousers", "shorts", "skirt", "dress"] as const
/** An outfit. */
export type Outfit = (typeof OUTFITS)[number]
/** A person's hair: short, long (to the shoulders), a bun, bald (skin on top) or under a flat cap. */
export const HAIRDOS = ["short", "long", "bun", "bald", "cap"] as const
/** A hairdo. */
export type Hairdo = (typeof HAIRDOS)[number]
/**
 * A person's look and build: skin, hair, shirt and `pants` (the trousers, shorts or skirt) as sRGB hex colours; age group, sex
 * (it sets the voice), outfit, hairdo, and standing height in metres.
 */
export const Person = Descriptor.ConstructedComponent(
  v.object({
    skin: integer,
    hair: integer,
    shirt: integer,
    pants: integer,
    age: v.picklist(AGES),
    female: v.boolean(),
    outfit: v.picklist(OUTFITS),
    hairdo: v.picklist(HAIRDOS),
    height: finite,
  }),
)("Lunigiana/Person", { immutable: true })
/** A Person value. */
export type Look = Descriptor.Descriptor.Value<typeof Person>
/** What a pedestrian is doing; see `Pedestrian`. */
export const MOODS = ["walk", "chat", "look", "shock", "gather", "flee"] as const
/** A pedestrian's mood. */
export type Mood = (typeof MOODS)[number]
/**
 * A non-player person and what it is doing until step `until`, about the point (fx, fy):
 * - `walk`: along its route; it stops to chat only from step `until` on;
 * - `chat`: standing, talking with the person at (fx, fy);
 * - `look`: standing, watching (fx, fy) in alarm: a speeding car, a crash, a horn, someone running away;
 * - `shock`: frozen, hands to the head, at a death at (fx, fy);
 * - `gather`: going to stand by a victim at (fx, fy);
 * - `flee`: running along its route away from (fx, fy).
 *
 * `blocked` counts the steps it has been getting nowhere.
 */
export const Pedestrian = Descriptor.ConstructedComponent(
  v.object({
    mood: v.picklist(MOODS),
    until: integer,
    blocked: integer,
    fx: finite,
    fy: finite,
  }),
)("Lunigiana/Pedestrian")
/** A Pedestrian value. */
export type PedestrianValue = Descriptor.Descriptor.Value<typeof Pedestrian>
/**
 * Walks with `leader`, a pedestrian, `side` m to its right and `back` m behind it: a child with a parent, a partner, a dog on a
 * lead. Its own route or roaming takes over when the leader is gone, down or dead.
 */
export const Follows = Descriptor.ConstructedComponent(
  v.object({
    leader: handle(Entity.isHandle(Root, Pedestrian)),
    side: finite,
    back: finite,
  }),
)("Lunigiana/Follows")
/**
 * A pedestrian who saw a person killed by a vehicle, or came on one lying dead: when its flight from the car ends it is shocked,
 * and when its shock ends it decides whether to stand by the body (`gather`, only in sight) or run (`flee`). Saved, so the
 * decision survives a save.
 */
export const Witness = Descriptor.Tag("Lunigiana/Witness")
/** Knocked to the ground until step `until` (the player, a pedestrian or an animal). */
export const Down = Descriptor.ConstructedComponent(v.object({ until: integer }))("Lunigiana/Down")
/**
 * Killed at step `since`: a pedestrian or an animal by a vehicle, anyone on foot by a train, anyone on foot near a blast, or the
 * player in the wreck, by an explosion. It lies where it fell, always `Down`, and never gets up; the player is brought back to
 * the start (`Respawn`).
 */
export const Dead = Descriptor.ConstructedComponent(v.object({ since: integer }))("Lunigiana/Dead")

/**
 * Standing or swimming in a river or stream (the player on foot, a pedestrian or an animal): `swimming` once the water lifts it
 * off its feet or the current takes them from under it, else wading. While it has this it is in the water under a bridge, not on
 * its deck. Saved; `Wade` sets it.
 */
export const InWater = Descriptor.ConstructedComponent(v.object({ swimming: v.boolean() }))(
  "Lunigiana/InWater",
)

/**
 * The ground a body on foot stands on, m a.s.l. (the player, a pedestrian or an animal): kept from step to step on the level it
 * was on (`groundZ` nearest the last), so someone on the track over a road tunnel or under a road bridge is on the track, and
 * someone in the tunnel or on the bridge is not. A body without one yet takes the ground its way or the place is on (`FindFooting`).
 */
export const Footing = Descriptor.ConstructedComponent(v.object({ z: finite }))("Lunigiana/Footing")
/** A Footing value. */
export type FootingValue = Descriptor.Descriptor.Value<typeof Footing>

/** Animal species: dogs and cats in the villages, cows and pigs on the farms. */
export const SPECIES = ["dog", "cat", "cow", "pig"] as const
/** A species. */
export type Species = (typeof SPECIES)[number]
/** An animal: its species, coat and patch colours (sRGB hex; the patch is the coat on a plain coat), and size (× its species' usual). */
export const Animal = Descriptor.ConstructedComponent(
  v.object({
    species: v.picklist(SPECIES),
    coat: integer,
    patch: integer,
    size: finite,
  }),
)("Lunigiana/Animal", { immutable: true })
/** An Animal value. */
export type AnimalValue = Descriptor.Descriptor.Value<typeof Animal>
/**
 * What an animal is doing until step `until`: standing (`idle`: grazing, sniffing, sitting), walking to (tx, ty), or fleeing
 * from (tx, ty); it keeps near its home (hx, hy).
 */
export const Roam = Descriptor.ConstructedComponent(
  v.object({
    mood: v.picklist(["idle", "walk", "flee"]),
    until: integer,
    hx: finite,
    hy: finite,
    tx: finite,
    ty: finite,
  }),
)("Lunigiana/Roam")
/** A Roam value. */
export type RoamValue = Descriptor.Descriptor.Value<typeof Roam>

/** A car, van or truck of one model and paint colour. */
export const Vehicle = Descriptor.ConstructedComponent(
  v.object({ model: v.picklist(VEHICLE_MODELS), color: integer }),
)("Lunigiana/Vehicle", { immutable: true })
/**
 * What the driver of a vehicle or a train is doing this step: throttle and steer in [-1, 1] and the handbrake. A train's lever is
 * the throttle (along its motion power, against it the brake; steer unused) and its handbrake the emergency brake.
 */
export const CarInput = Descriptor.ConstructedComponent(
  v.object({ throttle: finite, steer: finite, handbrake: v.boolean() }),
)("Lunigiana/CarInput")
/**
 * A vehicle's body beyond its planar Pose and Motion: the elevation of its centre of mass (m a.s.l.)
 * and vertical speed, pitch (nose up +) and roll (left side up +) with their rates (rad, rad/s; the
 * body turns yaw, then pitch, then roll), the road wheels' steering angle (rad, left +), the gear
 * (index into the gearbox's ratios; −1 reverse) and the step at which the current shift ends.
 */
export const Chassis = Descriptor.ConstructedComponent(
  v.object({
    z: finite,
    vz: finite,
    pitch: finite,
    pitchRate: finite,
    roll: finite,
    rollRate: finite,
    steer: finite,
    gear: integer,
    shiftUntil: integer,
  }),
)("Lunigiana/Chassis")
/** A Chassis value. */
export type ChassisValue = Descriptor.Descriptor.Value<typeof Chassis>
/**
 * How wrecked a vehicle is: the share of its durability its crashes have used up (`amount`, from 0 as new to 1 destroyed: the
 * engine is dead and it burns); its latest crash: the barrier-equivalent speed of its hardest hit (m/s; 0 before any), the step of
 * its first and what it struck (another vehicle's or an animal's entity id, −1 a wall or the ground), so the further contacts of one crash cost
 * only what a harder hit adds; and its fire: the step it blows up (`fuse`, 0 until it burns) and whether it has (`exploded`: a
 * charred shell). Stages, durability and what damage costs the engine are in damage.ts.
 */
export const Damage = Descriptor.ConstructedComponent(
  v.object({
    amount: finite,
    crash: finite,
    since: integer,
    struck: integer,
    fuse: integer,
    exploded: v.boolean(),
  }),
)("Lunigiana/Damage")
/** A Damage value. */
export type DamageValue = Descriptor.Descriptor.Value<typeof Damage>
/** An AI-driven vehicle (it follows its Route). */
export const Traffic = Descriptor.Tag("Lunigiana/Traffic")
/**
 * Progress along the map graph (`graph` in ./map/index.ts): the current edge,
 * the travel direction (a -> b when `forward`), and the lateral offset from the
 * centreline in metres (positive = right of travel).
 */
export const Route = Descriptor.ConstructedComponent(
  v.object({ edge: integer, forward: v.boolean(), side: finite }),
)("Lunigiana/Route")
/** A Route value. */
export type RouteValue = Descriptor.Descriptor.Value<typeof Route>
/**
 * An AI driver's plan beyond its Route: the edge it takes after the current
 * one (a -> b when `nextForward`), the steps it has been stuck, the step
 * until which it reverses to get unstuck, and how many times it has had to.
 */
export const Autopilot = Descriptor.ConstructedComponent(
  v.object({
    next: integer,
    nextForward: v.boolean(),
    stuck: integer,
    reverseUntil: integer,
    tries: integer,
  }),
)("Lunigiana/Autopilot")
/** A vehicle the player has already entered once (it scored a theft). */
export const Stolen = Descriptor.Tag("Lunigiana/Stolen")
/** The player is in this vehicle or train (each has the controls the player works, `CarInput`). */
export const Driving = Descriptor.ConstructedComponent(
  v.object({ vehicle: handle(Entity.isHandle(Root, CarInput)) }),
)("Lunigiana/Driving")

/** A train of one model (`TRAINS` in rail/models.ts), what it is (immutable). */
export const Train = Descriptor.ConstructedComponent(v.object({ model: v.picklist(TRAIN_MODELS) }))(
  "Lunigiana/Train",
  { immutable: true },
)
/**
 * Where a train is on its line (`LINES` in rail/lines.ts): the arc length `s` (m) of its active cab's
 * nose, `prev` its s at the start of this step (for render interpolation: every writer that moves it
 * at once sets `prev = s`), its speed `v` toward +s (m/s), which way the active cab faces (`facing`:
 * the train's body runs from s back to s − facing × its length), and its eased `power` (−1…1, + toward
 * the facing) and `brake` (0…1 of the emergency rate). Its controls are a `CarInput`.
 */
export const TrainMotion = Descriptor.ConstructedComponent(
  v.object({
    line: integer,
    s: finite,
    prev: finite,
    v: finite,
    facing: v.picklist([1, -1]),
    power: finite,
    brake: finite,
  }),
)("Lunigiana/TrainMotion")
/** A TrainMotion value. */
export type TrainMotionValue = Descriptor.Descriptor.Value<typeof TrainMotion>
/**
 * An AI train's driver: the way it runs along its line (`dir`, +1 toward +s), the station it calls at next (`stop`, an index
 * into `MAP.railway.stations`; −1 past its last), and what it is doing (`state`, rail/lookout.ts) and `until` which step:
 * dwelling at that station until it leaves, standing sounding the horn for something on the track ahead until it creeps on,
 * and otherwise (running, braking to a stand for it, creeping on) the step its next alarm is due from.
 */
export const TrainRun = Descriptor.ConstructedComponent(
  v.object({
    dir: v.picklist([1, -1]),
    stop: integer,
    state: v.picklist(RUN_STATES),
    until: integer,
  }),
)("Lunigiana/TrainRun")
/** A TrainRun value. */
export type TrainRunValue = Descriptor.Descriptor.Value<typeof TrainRun>

/** Simulation time. */
export const Time = Clock.resource("Lunigiana/Time", STEP)
/** The world's random stream (saved, so runs replay). */
export const Rng = Descriptor.ConstructedResource(Random.codec)("Lunigiana/Rng")
/** Counters shown on the HUD. */
export const Score = Descriptor.ConstructedResource(
  v.object({ stolen: integer, knocked: integer }),
)("Lunigiana/Score")
/**
 * Net quarter turns of the camera to the left of its home seat (any integer, mod 4 is the heading;
 * see `screenAxes`); driving, while the camera follows the car, the seat nearest the car's heading,
 * which the player gets out to. Saved: the on-foot keys depend on it.
 */
export const View = Descriptor.ConstructedResource(v.object({ turns: integer }))("Lunigiana/View")
/**
 * Every vehicle's handling knobs (`HANDLING` in handling.ts): multipliers, shares and switches over the
 * vehicles' real data, at `DEFAULT_HANDLING` in a new game. Saved, so a run replays with the handling
 * it was played with; set only through `SetHandling`.
 */
export const Handling = Descriptor.ConstructedResource(
  v.object({
    grip: finite,
    looseGround: finite,
    weatherGrip: finite,
    power: finite,
    brakes: finite,
    drag: finite,
    abs: finite,
    stability: finite,
    selfRighting: finite,
    traction: finite,
    steering: finite,
    steeringRate: finite,
    weightTransfer: finite,
    antiRoll: finite,
    stiffness: finite,
    damping: finite,
  } satisfies Record<HandlingKey, typeof finite>),
)("Lunigiana/Handling")
/** A request to set one handling knob, sent by the host's handling store (the settings, the dev debug menu); `ApplyHandling` keeps it in range. Not saved. */
export const SetHandling = Descriptor.Event<{
  readonly key: HandlingKey
  readonly value: number
}>()("Lunigiana/SetHandling")

/**
 * The game's date and time of day: whole Unix UTC `seconds`, and the game seconds each step adds
 * (`rate`: 1 in play, a game minute per real second; 0 stands the day still; the dev menu runs it up to
 * an hour a step). Saved; set only through `SetClock`.
 */
export const GameClock = Descriptor.ConstructedResource(
  v.object({ seconds: integer, rate: integer }),
)("Lunigiana/GameClock")
/** A GameClock value. */
export type GameClockValue = Descriptor.Descriptor.Value<typeof GameClock>
/** The weather's own random stream (saved), apart from `Rng` so the weather never changes traffic, pedestrians or parking. */
export const WeatherRng = Descriptor.ConstructedResource(Random.codec)("Lunigiana/WeatherRng")
/** The railway's own random stream (saved): where the first trains stand, the dwells and the layovers, apart from `Rng` so trains never change traffic, people or parking. */
export const RailRng = Descriptor.ConstructedResource(Random.codec)("Lunigiana/RailRng")
/**
 * Each line's service (`LINES` in rail/lines.ts, in its order): the step its next train may enter (`due`; null while one runs
 * on it, or with no service) and the end it enters from (`from`: 0 the line's start, 1 its end). Saved.
 */
export const Railway = Descriptor.ConstructedResource(
  v.array(v.object({ due: v.nullable(integer), from: v.picklist([0, 1]) })),
)("Lunigiana/Railway")
/** A Railway value. */
export type RailwayValue = Descriptor.Descriptor.Value<typeof Railway>
/**
 * Each level crossing's cycle (`CROSSINGS` in rail/crossings.ts, in its order): its `phase` since step `since`, its arms' share
 * down then (`from`, 0 up … 1 down, read only while they lower or rise), and the last step a train `demanded` it. Saved;
 * `crossingAt` says what it shows.
 */
export const LevelCrossings = Descriptor.ConstructedResource(
  v.array(
    v.object({
      phase: v.picklist(CROSSING_PHASES),
      since: integer,
      from: finite,
      demanded: integer,
    }),
  ),
)("Lunigiana/LevelCrossings")
/**
 * A day of weather as the weather plans it at Rome's midnight (sky/plan.ts), times as seconds since that
 * Rome day's midnight (a day the clocks change lasts 23 or 25 hours): the `day` (Rome's calendar day, days
 * since 1970-01-01), whether it has been `drawn` (not yet in a new game before its first step) and `from`
 * when it holds (before it, a new game's calm, clear start; 0 on any other day).
 * Whether the day is `wet` (at least 1 mm at sea level); a wet day's `event` regime between `start` and
 * `end` at `precip` mm/h at sea level, its `intensity` class; the day's `sky` (a dry day's regime, a wet
 * day's around its rain); a dry day's `fog` until `lift`, and its strong wind from `windyFrom` to
 * `windyTo`; and the day's `airMass`, its departure from the normal temperature (°C).
 */
const Plan = v.object({
  day: integer,
  drawn: v.boolean(),
  from: integer,
  wet: v.boolean(),
  event: v.picklist(EVENTS),
  intensity: v.picklist(INTENSITIES),
  start: integer,
  end: integer,
  precip: finite,
  sky: v.picklist(SKIES),
  fog: v.picklist(FOGS),
  lift: integer,
  windyFrom: integer,
  windyTo: integer,
  airMass: finite,
})
/**
 * The weather (sky/weather.ts): the weather `seed` the game drew it from (`WeatherRng`'s first state,
 * never changed; each day's plan draws from it and the day alone), the `regime` it is moving toward (the
 * day's plan's at this hour, or the one the dev menu `forced`). Then what eases toward the regime's
 * targets: the sky's `cloud` cover (0…1), `precip` (mm/h liquid-equivalent at sea level; `orographic`
 * scales it with height), `storm` (thunderstorm activity 0…1), the `wind` on the map's low ground at 10 m
 * (m/s) and its `windAngle` (rad counter-clockwise from east, where the air moves), the `gust` factor (≥ 1,
 * peak over mean), `fog` (the regime's mist and low cloud, 0…1) and the air's temperature `anomaly` (°C
 * over the normal). Then the ground: its wetness `wet` (0…1, where no snow lies) and the `snowLine` (m
 * a.s.l., the lowest ground with snow cover; `NO_SNOW` when none lies). The thunderstorm cell's centre
 * (`cellX`, `cellY`, m; far off the map when no storm is near). Last the day's `plan`. Saved; forced only
 * through `SetWeather`.
 */
export const Weather = Descriptor.ConstructedResource(
  v.object({
    seed: integer,
    regime: v.picklist(REGIMES),
    forced: v.boolean(),
    cloud: finite,
    precip: finite,
    storm: finite,
    wind: finite,
    windAngle: finite,
    gust: finite,
    fog: finite,
    anomaly: finite,
    wet: finite,
    snowLine: finite,
    cellX: finite,
    cellY: finite,
    plan: Plan,
  }),
)("Lunigiana/Weather")
/** A Weather value. */
export type WeatherValue = Descriptor.Descriptor.Value<typeof Weather>
/**
 * What the rivers carry (water/flow.ts): the catchments' water, mm over them, as snow lying, in the soil, running off quickly and in
 * the ground. Every river and stream runs at the discharge per km² it gives (`specificDischarge`) times its own catchment. Saved.
 */
export const Rivers = Descriptor.ConstructedResource(
  v.object({
    snow: finite,
    soil: finite,
    quick: finite,
    slow: finite,
  }),
)("Lunigiana/Rivers")
/** A Rivers value. */
export type RiversValue = Descriptor.Descriptor.Value<typeof Rivers>
/** A day's plan (`WeatherValue["plan"]`). */
export type PlanValue = WeatherValue["plan"]
/**
 * A request to set the game time (Unix UTC seconds) and/or its rate (game seconds per step), from two
 * senders: the host, which holds the clock at rate 0 behind the title card and sends rate 1 when the
 * player dismisses it (`holdClock`, hud/title.ts), and the dev debug menu. `ApplyClock` keeps both in
 * range. Not saved.
 */
export const SetClock = Descriptor.Event<{ readonly seconds?: number; readonly rate?: number }>()(
  "Lunigiana/SetClock",
)
/** A request from the dev debug menu to force a regime or hand the weather back to its day's plan (`regime` null), `settle` jumping straight to the targets; `ApplyWeather` checks it. Not saved. */
export const SetWeather = Descriptor.Event<{
  readonly regime: Regime | null
  readonly settle?: boolean
}>()("Lunigiana/SetWeather")

/**
 * A vehicle hit something this step: a wall, another vehicle, a person or an animal (`other`, their entity ids)
 * or the ground (landing hard, rolling over), where (the contact point on a wall, between two
 * vehicles or on the ground, the person's or animal's position), how hard (the closing speed at contact,
 * m/s) and with how much mass behind it (tonnes). A ground hit names the `face` of the body that
 * struck: the wheels bottoming out, the roof, a side, the nose or the tail. A person or animal hit is
 * `fatal` when it killed them. A train is a vehicle that strikes too: a train striking a person or an
 * animal is such a hit with the train as `car`, and a vehicle and a train meeting is a `train` hit, `car`
 * the vehicle and `other` the train, `fatal` when it wrecks the vehicle; two trains meeting are a `train`
 * hit, `car` the striking train and `other` the struck one, and a train against a buffer stop a `wall`
 * hit with the train as `car`. Not saved; the audio schedule plays it.
 */
export const Impact = Descriptor.Event<{
  readonly hit: "wall" | "car" | "person" | "animal" | "ground" | "train"
  readonly x: number
  readonly y: number
  readonly speed: number
  readonly mass: number
  readonly car: number
  readonly other?: number
  readonly face?: "under" | "roof" | "side" | "front" | "rear"
  readonly fatal?: boolean
}>()("Lunigiana/Impact")
/**
 * A tyre slid this step: wheel `wheel` (index into the model's `wheels`) of vehicle `car`, at its
 * contact point (x, y, z m a.s.l.), sliding at `slip` m/s past the ground (sideways beyond its grip,
 * spinning or locked), `amount` 0…1 how far past its grip, on `surface`, how snow-covered (`snow`, 0…1)
 * the ground is there, at simulation `step`. Not saved; the render lays tyre marks and smoke from it
 * (slush ruts and white spray on snow) and the audio plays the squeal.
 */
export const Skid = Descriptor.Event<{
  readonly car: number
  readonly wheel: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly slip: number
  readonly amount: number
  readonly surface: Surface
  readonly snow: number
  readonly step: number
}>()("Lunigiana/Skid")
/**
 * An AI train sounds its horn this step at its leading nose (x, y): a moderately long whistle entering a long tunnel, or, when
 * `urgent`, the alarm at something on the track. Not saved; the audio schedule plays it.
 */
export const Whistle = Descriptor.Event<{
  readonly train: number
  readonly x: number
  readonly y: number
  readonly urgent: boolean
}>()("Lunigiana/Whistle")
/** A request from the dev debug menu to call a train onto every line with no AI train on it, now (`ApplyTrains`). Not saved. */
export const SetTrains = Descriptor.Event<{ readonly call: true }>()("Lunigiana/SetTrains")
/**
 * A dev request to put the player at (x, y) facing `angle` (the dev `gta.teleport` hook, which the playtest's drives call), on
 * foot or in the vehicle they drive (`ApplyPlayer`). The step that applies it reads the map there, so the host sends it only once it holds every listed tile
 * over the target ± `STEP_REACH` (map/tiles.ts). Not saved.
 */
export const SetPlayer = Descriptor.Event<{
  readonly x: number
  readonly y: number
  readonly angle: number
}>()("Lunigiana/SetPlayer")
/** An AI driver held up for a while sounds the horn, once per stuck episode. Not saved; the audio schedule plays it. */
export const Honk = Descriptor.Event<{
  readonly car: number
  readonly model: VehicleModel
  readonly x: number
  readonly y: number
}>()("Lunigiana/Honk")
/** How someone who cries out feels; see `Cry`. */
export const FEELINGS = ["fright", "shock", "anger", "surprise"] as const
/** A feeling. */
export type Feeling = (typeof FEELINGS)[number]
/**
 * Someone cried out this step: the person or animal `who` (its entity id) at (x, y), in `feeling`: `fright` (in danger: a
 * scream, "Aiuto!"; a yelp, a squeal), `shock` (at a death: "Oddio!"), `anger` (at a reckless driver or a shove: "Vai piano!";
 * a dog's bark) or `surprise` (a crash, a horn: "Mamma mia!"). Not saved; the audio schedule voices it.
 */
export const Cry = Descriptor.Event<{
  readonly who: number
  readonly x: number
  readonly y: number
  readonly feeling: Feeling
}>()("Lunigiana/Cry")
/**
 * Lightning this step: a bolt to the ground at (x, y) (m) when `bolt`, else a flash inside the cloud above
 * it; `power` 0…1; `seed` a whole number for the bolt's shape and its thunder; at simulation `step`. Not
 * saved; the render draws it and the audio thunders it.
 */
export const Lightning = Descriptor.Event<{
  readonly x: number
  readonly y: number
  readonly bolt: boolean
  readonly power: number
  readonly seed: number
  readonly step: number
}>()("Lunigiana/Lightning")
/** A Lightning event. */
export type LightningValue = Descriptor.Descriptor.Value<typeof Lightning>
/**
 * A burning wreck (`car`, of `model`) blew up this step at its centre of mass (x, y, and z m a.s.l.). Not saved; the render draws the
 * fireball and the debris, the audio plays the blast.
 */
export const Explosion = Descriptor.Event<{
  readonly car: number
  readonly model: VehicleModel
  readonly x: number
  readonly y: number
  readonly z: number
}>()("Lunigiana/Explosion")

/** Player controls. Keys are host detail, but they live here so `Controls` has one home. */
export const bindings = {
  up: ["ArrowUp", Keyboard.code("KeyW")],
  down: ["ArrowDown", Keyboard.code("KeyS")],
  left: ["ArrowLeft", Keyboard.code("KeyA")],
  right: ["ArrowRight", Keyboard.code("KeyD")],
  sprint: ["Shift"],
  handbrake: [Keyboard.code("Space")],
  action: [Keyboard.code("KeyF"), "Enter"],
  turnLeft: [Keyboard.code("KeyQ")],
  turnRight: [Keyboard.code("KeyE")],
  // Only the audio host hears it: no gameplay effect.
  horn: [Keyboard.code("KeyH")],
} as const
type Controls = Keyboard.Snapshot<typeof bindings>

/** This step's controls, copied from the KeyboardInput service by InputCapture. Not saved. */
export const Input = Descriptor.TransientResource<Controls>()("Lunigiana/Input")
/** Any snapshot() source of Controls: live keyboard, scripted timeline, replay playback. */
export const KeyboardInput =
  Descriptor.Service<InputCapture.Source<Controls>>()("Lunigiana/Keyboard")

export const Game = Schema.bind(
  Schema.fragment({
    components: {
      Pose,
      PrevPose,
      Motion,
      Player,
      Person,
      Pedestrian,
      Follows,
      Witness,
      Down,
      Dead,
      Footing,
      Animal,
      Roam,
      Vehicle,
      CarInput,
      Chassis,
      Damage,
      Traffic,
      Route,
      Driving,
      Autopilot,
      Stolen,
      InWater,
      Train,
      TrainMotion,
      TrainRun,
    },
    resources: {
      Time,
      Rng,
      WeatherRng,
      RailRng,
      Score,
      View,
      Handling,
      GameClock,
      Weather,
      Rivers,
      Railway,
      LevelCrossings,
      Input,
    },
    events: {
      Impact,
      Honk,
      Cry,
      Skid,
      Lightning,
      Explosion,
      Whistle,
      SetHandling,
      SetClock,
      SetWeather,
      SetTrains,
      SetPlayer,
    },
    requires: [
      Schema.requires(Player, Pose, PrevPose, Motion, Person),
      Schema.requires(Pedestrian, Pose, PrevPose, Motion, Person, Route),
      Schema.requires(Animal, Pose, PrevPose, Motion, Roam),
      Schema.requires(Follows, Pose, PrevPose, Motion),
      Schema.requires(Witness, Pedestrian),
      Schema.requires(Vehicle, Pose, PrevPose, Motion, CarInput, Chassis, Damage),
      Schema.requires(Traffic, Vehicle, Route, Autopilot),
      Schema.requires(Dead, Down),
      Schema.requires(InWater, Pose, Motion),
      Schema.requires(Train, TrainMotion, CarInput),
      Schema.requires(TrainRun, Train),
    ],
  }),
  Root,
)
