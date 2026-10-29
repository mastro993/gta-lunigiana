# Architecture

The game is a Ritmo ECS simulation plus a browser host. The simulation (`src/sim`) owns every rule
that changes the world. It is headless and deterministic: no DOM, no Three.js, no wall clock, no
`Math.random`. The host (`src/main.ts`, `src/render`, `src/audio`, `src/hud`) captures input,
draws, plays the sound, and shows the HUD. It reads the world and never writes saved state: its
requests go in as events that a system applies. `SetHandling` carries the handling the player picks
in the settings or the dev debug menu, `SetClock` the game clock held behind the title card and
the time and rate set in the dev debug menu, and `SetWeather` a regime forced in the dev debug menu.

```
keys, touch ──► KeyboardInput service ──► CaptureInput ──► Input resource ──► systems
                                                                                │
             HUD ◄── PlayerView, SkyView ◄───────────── world (components, resources, events)
             three.js nodes, sky host ◄── render schedule ◄─────┤
             speakers ◄── director ◄── audio schedule (Hear) ◄──┘
```

## Simulation

`src/sim/index.ts` is the entry. It re-exports the schema, defines the schedules, and exports
`makeRuntime({ seed, start?, services, debug? })`, which makes a runtime with the starting
resources: `Time` (60 Hz clock), `Rng` (seeded from `seed`), `WeatherRng` (seeded from
`seed ^ 0x9e3779b9`), `RailRng` (seeded from `seed ^ 0x7f4a7c15`), `Score` (zeroed), `View`
(home view), `Handling` (a new game's knobs, `DEFAULT_HANDLING`: the Balanced preset), `GameClock`
(`start` at rate 1), `Weather` (`initialWeather(start, weatherSeed)`, `weatherSeed` being
`WeatherRng`'s first state: clear and calm, dry ground, the season's snow line, and a calm plan the
first step draws that holds clear for 90 game minutes, so the tests' first 600 steps stay
storm-free), `Rivers` (`initialRivers(start, weatherSeed)`: the year before the start run an hour
at a time under the weather seed's plans, [water.md](water.md#a-new-games-rivers)), `Railway`
(every line's next train due at step 0, from its start), `LevelCrossings` (every crossing open)
and `Input` (idle keys).

- `start` is the game time a new game begins at, in whole Unix UTC seconds: a fraction fails to
  decode and no runtime is made. Without it the game starts at `DEFAULT_START`, 1792648800
  (2026-10-22 08:00 CEST), so tests replay the same day.
- The weather draws from its own stream so that it never changes traffic, people, animals or
  parking. mulberry32 runs through every 32-bit state in one cycle, so the two streams are one
  sequence at an offset the seed sets: at least 7,179 draws apart over all 2³² seeds, and at least
  1.2 million for seeds 0–200,000. Only the storm cell and its lightning draw from `WeatherRng`;
  each day's plan comes from the weather seed (kept in `Weather.seed`) and the day alone, so a
  storm never changes the days after it.
- The railway draws from its own stream too, `RailRng`: which way each line's first train runs, its
  dwells and the layovers ([gameplay.md](gameplay.md#trains)), so trains never change what traffic,
  people, animals or parking draw. Its seed is `seed ^ 0x7f4a7c15`, another offset on the same
  mulberry32 cycle.
- The clock, the sun and moon, the climate and the weather are pure functions in `src/sim/sky/`
  ([weather.md](weather.md)). The host calls the same functions to draw, play and show them, so the
  snow it draws is the snow the tyres feel.

### Schedules and system order

`setup` runs once after the runtime is made:

1. `SpawnWorld` (`systems/spawn.ts`): the player and the parked cars on 200 of the map's parked
   spots (`PARKED`), the two Carabinieri cars included.
2. `applyDeferred`
3. `FillPeople` (`systems/populate.ts`): the first fill, as many people out around the player's
   start as `Populate` keeps, from 4 m to 120 m ([gameplay.md](gameplay.md#the-first-fill)).
4. `FillAnimals` (`systems/populate-animals.ts`): the animals `PopulateAnimals` keeps there. It
   asks for the farms first, so the farm list is built here, behind the title card, not in a step
   of play.
5. `FillTrains` (`rail/dispatch.ts`): each line's first train, dwelling at its station nearest the
   player's start that no train placed already stands on, facing the way past the line's point
   nearest the start, never toward a train placed ahead on shared track that faces it
   ([gameplay.md](gameplay.md#the-service)). It comes after the people and animals
   so they take the same entity ids as in a game without trains: a gatherer's distance from a body
   hashes its id.
6. `applyDeferred`

The apply systems run in `update` only. A request the host sends before the first `update` (the
player's stored handling at load, or the clock held behind the title card) waits for their first
run, however many render frames tick first: Ritmo keeps a sent event for a reader that has not run
yet (since 0.14).

In Node, setup takes about 12 ms once the land cover is built, as `main.ts` builds it first (the
farm list about 9 ms of it); a test that has not built the cover pays for it here too, about
109 ms. Setup draws from the world's `Rng`, and `FillTrains` from `RailRng`, so the fill replays
with the seed.

`update` is one fixed step (`STEP = Clock.hz(60)`):

| # | System | File | Does |
|---|---|---|---|
| 1 | `AdvanceTime` | `index.ts` | advances `Time` (Ritmo `Clock.system`) |
| 2 | `CaptureInput` | `index.ts` | copies the `KeyboardInput` snapshot into `Input` |
| 3 | `StorePrevious` | `index.ts` | copies every `Pose` into `PrevPose` (for interpolation) |
| 4 | `TurnView` | `index.ts` | turn keys: the view's quarter turns (`View`); driving, the seat nearest the car's heading |
| 5 | `ApplyHandling` | `index.ts` | each `SetHandling` request sets its knob in `Handling`, kept in the knob's range |
| 6 | `ApplyClock` | `index.ts` | each `SetClock` request sets the game time and/or its rate in `GameClock`, kept in range (2000-01-01 to 2100-01-01, rate a whole 0–3600) |
| 7 | `ApplyWeather` | `index.ts` | each `SetWeather` request forces a regime or hands the weather back to the day's plan, settled at once when asked, under the plan of the day the clock is on |
| 8 | `ApplyTrains` | `rail/dispatch.ts` | each `SetTrains` request makes a train due now on every line no AI train runs on (`Railway`) |
| 9 | `AdvanceClock` | `systems/sky.ts` | moves `GameClock` on by its rate (a game second a step at rate 1); at rate 0 it stands still, unwritten |
| 10 | `AdvanceWeather` | `systems/sky.ts` | over the step's game seconds, draws the day's plan from the weather seed when a new Rome day begins (at rate 0 only that), moves toward the regime it sets for the hour and eases `Weather` toward it, wetting, drying, snowing and thawing the ground; over its real time, drifts a thunderstorm's cell and emits `Lightning`, drawing from `WeatherRng` |
| 11 | `AdvanceRivers` | `systems/sky.ts` | over the step's game seconds, the weather's precipitation fills the catchments' snow, soil and stores and they drain into the rivers (`Rivers`, [water.md](water.md)) |
| 12 | `EnterExit` | `systems/enter-exit.ts` | action key: enter, steal, carjack, get out; a train at its cab doors (`rail/boarding.ts`): its AI driver flees (out of the far cab where the active one has no door at grade), the far cab becomes the active one; getting out needs a stand at grade, the platforms' side first, and with none the player goes through to the far cab; out, the player stands on the ground on the vehicle's level (`Footing`) |
| 13 | `applyDeferred` | | applies the enter/exit commands, so the blast knows who sits in which vehicle |
| 14 | `FindFooting` | `systems/footing.ts` | every body on foot keeps to the level it was on (`Footing`: the ground nearest its last, decks and tunnels out to their verges); one with none takes its way's road or the terrain's level |
| 15 | `Explode` | `systems/explosions.ts` | lights a burning wreck's fuse; a wreck whose fuse has burnt down blows up (`Explosion`): hits and shoves the vehicles near it, kills, knocks down and scares the people |
| 16 | `Wade` | `systems/water.ts` | who is in the water: every person on foot and every animal in a river or stream gets `InWater`, swimming once off its feet, and loses it on dry ground |
| 17 | `applyDeferred` | | applies the blast's deaths and knockdowns, the first footings and who is in the water, before anything moves |
| 18 | `PlayerFoot` | `systems/foot.ts` | player walking, sprinting, sliding when down; in the water wading or swimming with the current |
| 19 | `PlayerDrive` | `systems/drive.ts` | player keys into the driven car's or train's `CarInput` |
| 20 | `Crossings` | `rail/systems.ts` | each level crossing moves on through its cycle (`LevelCrossings`: open, warning, lowering, closed, raising) from whether a train demands it now: moving at it, standing ready (an AI train about to go, the player's with its lever forward) or on it |
| 21 | `TrafficAI` | `systems/traffic.ts` | AI drivers write their `CarInput`, braking for vehicles, people, animals and the cars of trains on their level, slower and keeping further back where the road is wet or snowy; at a level crossing (`rail/roads.ts`, reading `LevelCrossings` this step) they stop for a box not open (from the lowering on always, and short of the trains' envelope) and keep it and the junction before it clear, patient while it is closed for a train; a driver held up honks (`Honk`), and backs up rather than turn round beside a line's track |
| 22 | `TrainAI` | `rail/service.ts` | AI train drivers write their lever (`CarInput`): line speed, braking curves to the next station's stop point, behind a train ahead on their track (any line's, on shared track; short of where one coming at them will stand) and short of a crossing whose arms are not down, standing where they are while one within their braking distance comes down; they dwell at stations while the game clock runs (`TrainRun`), drawing from `RailRng`, and whistle entering long tunnels (`Whistle`); a person, an animal or a vehicle on the track ahead on their level, a vehicle touching their body alongside, or another train against either end, holds them (`rail/lookout.ts`): the emergency brake and the urgent whistle, the horn, then a creep on; shoved while dwelling, they pull the emergency brake |
| 23 | `Pedestrians` | `systems/pedestrians.ts` | people move as their mood says: walk their routes, keep by their leader, stop, gather, run; the down and the dead slide; out of their depth in the water they make for the bank, and the current takes the down and the dead |
| 24 | `Animals` | `systems/animals.ts` | animals rest, wander (never onto the track), keep by their walker and run from what scares them, a train on their level and this step's whistles too; free dogs bark; the down and the dead slide; out of their depth in the water they paddle for the bank; cries are `Cry` events |
| 25 | `VehiclePhysics` | `systems/physics.ts` | every vehicle moves on its springs and tyres from its `CarInput` under the `Handling`, each tyre's grip lowered by the wet and the snow under it, buoyed and dragged by a river and its engine stalled under one; wall and ground hits are `Impact` events, sliding tyres `Skid` events |
| 26 | `TrainPhysics` | `rail/systems.ts` | every train moves along its line from its lever: traction, brakes, running resistance, grade and curves, on rail the weather leaves wet or under snow (`TrainMotion`); the player's under SCMT to its buffer stops at the drawn run (`rail/collisions.ts`), any other to its run-outs' ends; trains on one track that meet go on at their common speed; a buffer struck is a `wall` `Impact`, a train struck a `train` one |
| 27 | `Contacts` | `systems/contacts.ts` | car–car, car–person, car–animal, person and animal contacts, knockdowns and deaths (`Down`, `Dead`); car–car hits, knockdowns, kills, a cow struck and a car stopped against a wall by a pinned person or animal (faster than `KNOCK_SPEED`) are `Impact` events |
| 28 | `TrainContacts` | `rail/strikes.ts` | trains strike what touches their cars on their level, shoved by nothing: vehicles shoved clear or dragged along their wall, wrecked faster than 14 m/s or dragged against a wall faster than 3 m/s (a `train` `Impact` as a contact begins, against `PrevPose` and `TrainMotion.prev`, and the wrecking blow); people and animals on their `Footing` pushed aside, or knocked down by the train's own speed into them and maybe killed by the train's death curve, the player too (`Impact` with the train as its `car`) |
| 29 | `CrashDamage` | `systems/damage.ts` | this step's `Impact` events wear the vehicles they struck (`Damage`), a train's as a wall's; a traffic car destroyed is abandoned, its driver fleeing |
| 30 | `RideAlong` | `systems/drive.ts` | the driving player takes the car's pose and motion, or the pose of a train's active cab and the train's motion |
| 31 | `Recover` | `systems/contacts.ts` | knocked-down people and animals get up, never the dead; pedestrians then flee, animals bolt |
| 32 | `Perceive` | `systems/perceive.ts` | pedestrians take in this step's hits, crashes, horns and whistles, the vehicles (the cars of trains on their level among them), bodies and people around them and the level crossings closing (`rail/senses.ts`; held there as patiently as a driver), and set their moods; cries are `Cry` events; marks `Witness`es, lets go of a leader gone or dead |
| 33 | `Startle` | `systems/fright.ts` | cats and pigs run from this step's crashes and struck bodies (`Cry`) |
| 34 | `Respawn` | `systems/explosions.ts` | the dead player comes back on foot at the start after 4 s, on the ground there (`Footing`) |
| 35 | `Dispatch` | `rail/dispatch.ts` | removes AI trains run past their line's drawn run and makes that line's next train due after a layover, drawn from `RailRng`; removes a stolen train the player has left once all of it is out of view (`VIEW_REACH`), its line's next train then due after a layover; sends a due train in at the run-out's end once its braking distance ahead (`entryClear`) and its run-out are free of any train and no AI train of another line runs the other way on track they share |
| 36 | `Populate` | `systems/populate.ts` | every 0.5 s spawns (never within 15 m of a level crossing) and despawns traffic and parties of people (the dead beyond 140 m, like the living), and removes destroyed vehicles once out of view (`VIEW_REACH`) |
| 37 | `PopulateAnimals` | `systems/populate-animals.ts` | every 0.5 s spawns and despawns the free animals |
| 38 | `applyDeferred` | | applies spawns, despawns, inserts and removals |

Controls, the handling, the clock, the weather, the rivers and a call for trains are settled before
movement, where each body on foot stands (`FindFooting`), a blast and who is in the water are
settled once getting in and out are applied and before anything moves (the movement systems read
`InWater` and the water under them this step; what moves this step keeps to its footing from the
next), all movement happens before contacts, crash damage is counted after both, from the same
step's hits, and contacts happen before the player's pose follows the car. The crossings move on
before traffic and the AI train drivers, which read them that step (`thisTick`), as `Perceive`
does; the drivers write their levers and sound their whistles before `Pedestrians` and `Animals`,
which hear them in the step they sound, as `Perceive` does, and `TrainPhysics` moves the trains
after the vehicles and before the contacts; `CrashDamage` (which damages no train) and `Perceive`
read its `Impact`s in the same step. `TrainContacts` comes last of the contacts: a train is shoved
by nothing, so what it strikes ends where it leaves it, and `CrashDamage` counts its hits in the
same step. `Dispatch` takes trains off and sends them in beside `Populate`, at the step's last
`applyDeferred`. The physics drives on the crash damage counted the step before, and on a blast's
in the same step. `Perceive` and `Startle` run after the contacts and `Recover` because they read
this step's `Impact` and `Honk` events, which a save does not keep: read a step later, a restored
game would miss them. The moods they set move people and animals from the next step. `TrafficAI`
and `VehiclePhysics` read `GameClock` and `Weather` and work out the air once a step (`airAt`), so
every wheel meets the wet and the snow this step's weather left, meltwater included. Gameplay is in
[gameplay.md](gameplay.md), the weather in [weather.md](weather.md), the rivers and who meets them
in [water.md](water.md).

### Where state lives

Saved world state (in snapshots), declared in `src/sim/schema.ts`:

| Component | On | Holds |
|---|---|---|
| `Pose`, `PrevPose` | every body | x, y (m, east/north from the map origin), angle (rad CCW from east) |
| `Motion` | every body | velocity vx, vy (m/s) and spin (rad/s) |
| `Player` | the player | tag |
| `Person` | player, pedestrians | look and build (immutable): skin, hair, shirt and `pants` colours, age group (`kid`, `adult`, `elder`), sex, outfit (`trousers`, `shorts`, `skirt`, `dress`), hairdo (`short`, `long`, `bun`, `bald`, `cap`), height (m) |
| `Pedestrian` | pedestrians | mood (`walk`, `chat`, `look`, `shock`, `gather`, `flee`), the step it ends (for a walk, the end of its cooldown), the point (fx, fy) it is about, steps blocked |
| `Follows` | a party's kids, partner, dog on a lead | handle of the leader (a pedestrian), and the place beside it: `side` m to its right, `back` m behind |
| `Witness` | pedestrians | tag: saw a person killed or came on a body; its shock ends in the choice to gather or run |
| `Down` | knocked-down and dead people and animals | step at which they get up; for the `Dead`, the step they died, and `Recover` never lifts them |
| `Dead` | the killed: pedestrians and animals a vehicle struck, people and animals on foot a train struck, people on foot by a blast, the player in a wreck that blew up | step they died (`since`); always with `Down` |
| `Footing` | the player, pedestrians and animals, once `FindFooting` has seen them | the ground it stands on, m a.s.l., kept on the level it was on: the railway's rules read it (`footingAt`, which takes `firstFooting` for one with none yet) |
| `Animal` | animals | species (`dog`, `cat`, `cow`, `pig`), coat and patch colours, size × the species' usual (immutable) |
| `InWater` | the player on foot, pedestrians, animals in a river or stream | `swimming`: off its feet; while it has it, it is in the water under a bridge, not on its deck |
| `Roam` | animals | mood (`idle`, `walk`, `flee`), the step it ends, home (hx, hy), and the point (tx, ty) it walks to or runs from |
| `Vehicle` | vehicles | model and paint colour (immutable) |
| `CarInput` | vehicles, trains | throttle, steer, handbrake for this step; a train's lever is the throttle (along its motion power, against it the brake, from rest backwards) and its handbrake the emergency brake |
| `Chassis` | vehicles | centre-of-mass elevation and vertical speed, pitch and roll with their rates, road-wheel steering angle, gear, step the current shift ends |
| `Damage` | vehicles | share of its durability its crashes used up (0 as new, 1 destroyed); its latest crash's hardest hit (barrier-equivalent m/s), first step and what it struck (another vehicle's or an animal's entity id, −1 a wall or the ground); the step its fire blows it up (`fuse`) and whether it has (`exploded`) |
| `Traffic` | AI vehicles | tag |
| `Route` | traffic, pedestrians | current graph edge, direction, lateral offset (a follower's is its leader's) |
| `Autopilot` | traffic | next edge, stuck counter, reverse end step, unstick tries |
| `Stolen` | vehicles, trains | tag: already entered once by the player |
| `Driving` | the player | handle of the vehicle or train being driven, with the intent `CarInput` (both carry it): a system resolves it through a query that selects `CarInput` (`PlayerDrive` one for both; `EnterExit`, `RideAlong` and `PlayerView` one for vehicles, one for trains), and the hosts compare `Game.Entity.id` |
| `Train` | trains | model (`atr220`, immutable) |
| `TrainMotion` | trains | its line (an index into `LINES`), the arc length `s` of its active cab's nose and `prev`, its s at the step's start (every writer that moves it at once sets both), speed `v` toward +s (m/s), which way the active cab faces (`facing`, ±1: the body runs back from s to s − facing × its length), its eased `power` (−1…1, + toward the facing) and `brake` (0…1 of the emergency rate) |
| `TrainRun` | AI trains | the way it runs along its line (`dir`, ±1), the station it calls at next (`stop`, an index into `MAP.railway.stations`, −1 past its last), and its `state` and `until` which step: `run`, `dwell` there until it leaves, or held by something on the track ahead: `braking` to a stand, `horn` until it creeps on, then `creep`; running, braking and creeping, `until` is the step its next alarm is due from |

`Schema.requires` enforces the bundles: a `Player` has a pose, previous pose, motion and look; a
`Pedestrian` the same and a `Route`; an `Animal` a pose, previous pose, motion and `Roam`; a
follower a pose, previous pose and motion; a `Witness` is a `Pedestrian`; a `Vehicle` has a pose,
previous pose, motion, `CarInput`, `Chassis` and `Damage`; `Traffic` also needs `Route` and
`Autopilot`; the `Dead` are always `Down`; `InWater` needs a pose and motion; a `Train` has a
`TrainMotion` and a `CarInput`, and a `TrainRun` is on a `Train`. Trains have no `Pose` or
`Motion`: a 55 m articulated body along a line is no point body, so no system that moves, touches
or hears point bodies takes them in. The systems that meet trains (`TrafficAI`, `TrainAI`'s
look-out, `Pedestrians` through `Perceive`, `Animals`, `TrainContacts`) take each car as a capsule
moving with its train (`trainCars`, `rail/bodies.ts`), and only where the other body's ground
stands within 2 m of the rail head (`LEVEL`). Spawns put a vehicle on its springs at rest on the
ground (`settle` in `src/sim/chassis.ts`), in the gear for its speed, undamaged. No save is ever
persisted, so the new and reshaped state (`Chassis`, `Damage`, `Dead`, the wider `Person` and
`Pedestrian`, `Handling` with its `weatherGrip` knob, `GameClock`, `WeatherRng`, `Weather`,
`Rivers` and `InWater`, the trains, `RailRng`, `Railway`, `LevelCrossings` and `Footing`) needs no
snapshot migration; a body restored without a `Footing` takes its first.

Saved resources:

| Resource | Holds |
|---|---|
| `Time` | the fixed step's count and length (Ritmo's clock) |
| `Rng` | the world's random stream: traffic, people and animals, parking |
| `WeatherRng` | the weather's own random stream: the storm cell and lightning (its first state is the weather seed) |
| `RailRng` | the railway's own random stream: which way each line's first train runs where either way passes the start, the dwells and the layovers |
| `Score` | `stolen` (vehicles and trains), and `knocked`: people the player's car or train knocked down or killed |
| `View` | `turns`, the net quarter turns of the camera; driving, the seat nearest the car's heading |
| `Handling` | the 16 handling knobs ([gameplay.md](gameplay.md#handling)) |
| `GameClock` | `seconds`, the game time in whole Unix UTC seconds, and `rate`, the game seconds each step adds: 1 in play (a game minute per real second, a 24-minute day), 0 standing still, up to 3600 from the dev debug menu |
| `Rivers` | the catchments' water, mm over them: `snow` lying, `soil` moisture, `quick` runoff and `slow` groundwater in store; every river and stream runs at the discharge per km² they give (`specificDischarge`) times its own catchment ([water.md](water.md)). A new game's comes from the year before its start under the weather seed's plans (`initialRivers`) |
| `Railway` | per line (`LINES`), the step its next train may enter (`due`; null while one runs on it, or with no service) and the end it enters from (`from`: 0 the line's start, 1 its end) |
| `LevelCrossings` | per crossing (`CROSSINGS`), its `phase` since step `since`, its arms' share down then (`from`, 0 up … 1 down, read only while they lower or rise), and the last step a train `demanded` it |
| `Weather` | the weather `seed` (never changed); the `regime` it moves toward and whether it is `forced`; the eased `cloud`, `precip` (mm/h at sea level), `storm`, `wind` (on the map's low ground) and `windAngle`, `gust`, `fog` and temperature `anomaly`; the ground's `wet` and `snowLine` (m a.s.l.); the storm cell's centre (`cellX`, `cellY`); and the day's `plan` (its Rome `day`, whether `drawn`, `from` when it holds, `wet`, a wet day's `event`, `intensity`, `start`, `end` and `precip`, the `sky`, a dry day's `fog` until `lift` and strong wind from `windyFrom` to `windyTo`, and the `airMass`; times in seconds since the Rome day's midnight) |

`Input` is transient: it is rebuilt every step and never saved.

Events are transient too. `Impact` (a vehicle hit a wall, another vehicle, a person, an animal or
the ground: where, which is the contact point for a wall, a vehicle or the ground, how hard, with
how much mass in tonnes, for the ground which face of the body struck, and for a person or an animal
whether it killed them, `fatal`; a train striking a person or an animal is such a hit with the train
as its `car`, a vehicle and a train meeting a `train` hit, `fatal` when it wrecks the vehicle, two
trains meeting a `train` hit with the striking train as `car` and the struck one as `other`, and the
player's train striking its buffer stop a `wall` hit with the train as `car`), `Skid` (a tyre slid
this step: where, how fast, how far past its grip, on what surface, how snow-covered), `Honk` (an AI
driver held up sounds the horn), `Cry` (a person or an animal cried out: who, where, and in
`fright`, `shock`, `anger` or `surprise`), `Lightning` (a thunderstorm's flash this step: a ground
strike or a flash in the cloud at x, y, its power 0…1, the seed of its bolt and its thunder, its
step), `Explosion` (a burning wreck blew up: which, of what model, where) and `Whistle` (an AI train
sounded its horn at its nose: entering a long tunnel, or `urgent`) carry moments. `VehiclePhysics`,
`TrainPhysics`, `Contacts`, `TrainContacts`, `TrafficAI`, `AdvanceWeather`, `Explode` and `TrainAI`
emit the hits, skids, horns, flashes, blasts and whistles; `Perceive`, `Animals` and `Startle` emit
`Cry`. The audio schedule reads all seven ([audio.md](audio.md#data-flow): a whistle plays the AI
train's horn, and a hit with a train in it crashes as steel), and the render schedule reads `Skid`
(tyre marks and smoke), `Lightning` (the bolt and the flash) and `Explosion` (the blast). In
`update`, `CrashDamage` reads `Impact` later in the same step, `Perceive` this step's `Impact`,
`Honk` and `Whistle` events, `Startle` this step's `Impact` events and `Animals` this step's
`Whistle` events and the `Honk` events since its last run: these are the only traces an event leaves
in the components (`Damage`, and the moods and `Witness`es it sets). An in-cloud flash may lie off
the map; a bolt never does. Four events are host intents, which no system emits and the host sends
with `runtime.send`:

- `SetHandling` (set one handling knob to a value): the host's handling store
  (`src/hud/handling.ts`) sends it for the settings and the dev debug menu; `ApplyHandling` reads
  it.
- `SetClock` (set the game time and/or its rate): the host sends it to hold the clock behind the
  title card (`holdClock`, see [Host loop](#host-loop)), and the dev sky store for the debug menu;
  `ApplyClock` reads it.
- `SetWeather` (force a regime, or `null` to hand the weather back to the day's plan, `settle` to
  jump to its steady state): the dev sky store sends it; `ApplyWeather` reads it.
- `SetTrains` (`call`: a train due now on every line no AI train runs on, `takesCall`): the tests
  send it, and the dev trains store for the debug menu's Trains area and `gta.trains.call()`;
  `ApplyTrains` reads it.

Snapshots hold no events: `CrashDamage`, `Perceive` and `Startle` read each `Impact`, `Perceive`
each `Honk`, and `Perceive` and `Animals` each `Whistle`, in the step it is emitted (`thisTick`), so
a snapshot between steps loses none and a restored save plays on alike.

Static data is module content, not state. `MAP` and `graph` (`src/sim/map/index.ts`), the wall,
tree, building and edge lookups, the per-model lane tables in `src/sim/route.ts` and the per-model
rigs in `src/sim/chassis.ts` (`RIGS`: static wheel loads, springs, inertias, steering lock, tipping
threshold) are built once at load and never change, so they are safe to share between runtimes.
A rig under a handling off its real values (`rigFor`) is a pure function of the model and the
`Handling`, derived on first use and cached (the whole cache empties once it holds 64 rigs, 16
for each of the four models), so it is safe to share too.
The railway's tables are too, built at load from `MAP.railway`: `LINES` (`src/sim/rail/lines.ts`:
each line as one polyline in arc length, extended straight past both terminals by its run-outs,
its speed limits, stations, tunnels and the track it runs on piece by piece, with a 32 m
`staticGrid` of its segments behind `linesNear`), `SHARED` (the same file: where each line runs on
another's pieces or run-out, mapping one line's s onto the other's, one stretch for as many pieces
in a row as they share), and `CROSSINGS`, `CROSSINGS_ON` and `APPROACHES`
(`src/sim/rail/crossings.ts`: each level crossing's box, built once, the lines crossing it at grade
with their s and strike-in, its stop lines and arms; per line the boxes it crosses, by s, which the
AI drivers, the crossings' demand and the traffic's busy boxes walk instead of every box; and the
traffic steps leading in, keyed by `stepKey`, each into the box it reaches first). The traffic edges
within 12 m of a line's track at grade, where no car turns round (`nearTrack` in
`src/sim/rail/roads.ts`), are a set built at load too (40 of the map's 5877, in 3 ms). The
crossings' cycle and demand are pure functions in `src/sim/rail/barriers.ts`; boarding a train and
getting out (`src/sim/rail/boarding.ts`), the player's train's SCMT, buffer stops and trains
meeting (`src/sim/rail/collisions.ts`), what traffic does at them
(`src/sim/rail/roads.ts`), the trains as bodies and the level the world meets them on
(`src/sim/rail/bodies.ts`), the AI driver's look-out (`src/sim/rail/lookout.ts`) and what people
make of the railway (`src/sim/rail/senses.ts`) are pure functions of the trains, the crossings'
states and the map. The train models (`TRAINS` in
`src/sim/rail/models.ts`) decode no map, so the schema can import them.
The sky's tables (the national temperature normals, the odds' rows, the regimes' `REGIME_SPECS`)
are module content as well. The map's place (`place()`, `src/sim/sky/place.ts`: its origin, its
5th-percentile height and the way its ground falls) is per-load map content: `src/sim/map/index.ts`
works it out once it decodes the map (13–20 ms) and hands it over with `providePlace`, as the host
hands the map file to `provideMap`; with no map loaded it is the reference site, the shipped map's
place. So the sky modules the schema and the HUD import (`regimes`, `clock`, `calendar`, `astro`,
`place`, `day`, `climate`, `odds`, `plan`, `local`, `readout`) decode no map, and every Italian map
gets its own sun and climate (`sky/__tests__/mapfree.test.ts` asserts both); `sky/weather.ts`
decodes it, for the heights and the bounds. `ORIGIN` in `src/sim/map/kinds.ts` now serves only the build.
The land-cover raster (`mapCover` in `src/sim/map/cover.ts`, ≈ 105 ms and 4.9 MB) and the road
index of `surfaceAt` (`src/sim/map/surface.ts`) are built on first use: pure functions of `MAP`,
never written after; `main.ts` builds the raster in its "Painting land cover" loading step, so
the first physics step finds it ready. The lookups are compact static grids (`staticGrid` in
`src/sim/collide.ts`, item indices packed into one `Int32Array`):

- `wallsNear` indexes the walls straight from the decoded flat arrays and the trees as points,
  making each trunk's square (`pushTrunk` in `src/sim/map/kinds.ts`) only when a query reaches it.
  It reuses its answer array and the segment objects in it until the next call of the same kind:
  copy the coordinates to keep them.
- `buildingsIn` (over `buildingBoxes`, 64 m cells) and `treesIn` (the trees as points) in
  `src/sim/map/index.ts` are broad phases that call back with candidate indices; callers run the
  exact test. The sim (the residents, the farms, the spawns' indoor checks) and the audio host
  (occlusion, streets, birds) share them.
- `edgeIndex` (`src/sim/edges.ts`, re-exported by `src/sim/route.ts`), with its instances
  `trafficIndex` and `walkIndex` (`src/sim/route.ts`) and `peopledIndex`, answers nearest-edge and
  spawn-band lookups without scanning the whole graph.
- `waterAt` (`src/sim/water/rivers.ts`) finds the nearest reach of a river or stream within its
  bed in a 32 m grid of the map's reaches, each with its two vertices' bed, depth and speed per
  unit discharge (`channelOf` in `src/sim/water/channel.ts`, built at load). `initialRivers` keeps the rivers it has worked out for a start
  and seed (a pure function of them), and `petAt` the evapotranspiration's heat index per latitude.
- `groundZ` (`src/sim/map/ground.ts`) is where every wheel, foot, sound source and drawn actor
  stands, in m a.s.l.: the terrain as its mesh is drawn (each 4 m cell split along its SW–NE
  diagonal), or a station platform's top where that is higher (`platformTop`, from
  `MAP.railway.platforms`), at-grade roads `ROAD_LIFT` above their profile (blended where several
  overlap, so a junction's ground stays continuous where their profiles disagree), and bridge decks
  and tunnels kept to the level nearest the caller's previous height (with `verges`, a deck or a
  tunnel reaching out to its walkers' verges). `footZ` is where someone on
  foot stands: given their previous height, the ground nearest it with the decks out to their verges
  (what `FindFooting` keeps in `Footing`, and where getting out of a train steps down, nearest the
  rail head); with none to go by, on a road bridge's deck or in a road tunnel within its reach to
  its verges, else the highest ground. Road segments and platforms are bucketed in 16 m cells at
  load. The renderer converts it to render y (`src/render/ground.ts`).

The population's tables are static data too, pure functions of `MAP` shared by every runtime: the
residents of each home and within 60 m of each walk edge, and the walk edges people live along
(`residentsNear`, `residentsAlong`, `peopledIndex` in `src/sim/population/density.ts`), built at
load; the 2,405 farms in a 64 m grid (`farmsNear` and the ground checks in
`src/sim/population/farms.ts`), built on first use, which `setup` makes (about 9 ms in Node with
the land cover built); and the residents ahead of each way out of a junction (`nextWalkEdge` in
`src/sim/route.ts`), cached as walkers first reach it.

Host state stays in the host: the camera, the render clock, the three.js scene and nodes, the
streamed world's chunks, the tyre marks and smoke, the wrecks' smoke and flames, the level
crossings' arms and lights (set every frame from the saved `LevelCrossings`), the sky host (its
lights, the eased exposure and lamps, the clouds' drift and the shared sky uniforms, worked out
again from the saved clock and weather every frame, so a loaded save needs nothing), the HUD's DOM,
the player's handling (a preset's name or the knobs set by hand, kept in `localStorage` by
`src/hud/handling.ts`), the dev sky store (nothing stored), and the audio context, live voices and
the director's memory of each sound source, thunders on their way included (pruned as sources go;
see [audio.md](audio.md#where-state-lives)).

## Input

1. `src/main.ts` makes `Keyboard.actions(window, bindings)` and passes it as the `KeyboardInput`
   service. In mobile mode ([HUD](#hud)) it passes `withTouch` (`src/hud/touch.ts`) instead: the
   keyboard's snapshot with the touch controls' added. The stick holds the direction keys it leans
   more than 22.5° toward, so it has the keys' eight directions, and each button holds its key;
   every key has a button. A key is held while any of them holds it, so the sim cannot tell a tap
   from a key. A control the player's mode or vehicle hides is `null` in `Touch`'s layout, so one
   hidden under a thumb that stays down (the stick on getting in, ◀ on getting out, ◀ ▶ on
   boarding a train) lets go of its keys.
2. `CaptureInput` (Ritmo's `InputCapture.system`) copies its snapshot into the `Input` resource
   at the start of each step.
3. Systems read `Input`: `held` for movement, steering and handbrake, `pressed` (once per press)
   for the action and turn keys. No sim system reads `horn` (H): only the audio schedule does.

`bindings` in `src/sim/schema.ts` is the only list of keys. Tests and replays use the same path:
`Keyboard.scripted(bindings, timeline)` replaces the live keyboard.

## Start-up

The title card doubles as the loading screen: it says the game is in early development, downloads
the map, builds in named steps, and asks for a key only once the first frame is drawn.

1. `index.html` is static, so the card shows before any script runs. Its entry, `src/boot.ts`,
   is a few kB and imports only the card (`src/hud/title.ts`) and the map file's handover
   (`src/sim/map/packed.ts`), so the bar moves within milliseconds.
2. `boot.ts` fetches `monzone.bin` (6.7 MB of gzip, a hashed asset) and counts the bytes against
   `Content-Length` (the first 60% of the bar, with MB so far). It gunzips with
   `DecompressionStream` while the file arrives, then hands the bytes to `provideMap`. The file is
   named `.bin`, not `.gz`: Vite's server would label a `.gz` as `Content-Encoding: gzip`, and the
   browser would then gunzip it first.
3. It imports the game in three parts, with a paint between them, because each import evaluates
   only the modules the earlier ones left: `src/sim/map/index.ts` (decoding, collision grids),
   `src/sim/route.ts` (each vehicle model's lanes), then `main.ts`.
4. `main.ts` first makes the sky host, every light and weather mesh in it, so they exist before
   any shader compiles. It then builds the rest in steps with top-level `await`, each named on the
   card: the land cover (`mapCover`), the world (`new World`, which places the street and
   platform lamps and builds the platforms and the level crossings' fixed parts), then the HUD, the
   runtime, `setup` (about 12 ms in Node: the farm list and the first fill), the
   clock's hold and the first audio tick, then every chunk of the first view.
5. `main.ts` compiles every program the game draws (`view.compile` with the stand-ins, see
   [Rendering](#rendering)) and draws the first frame itself: a throw there reaches the card,
   where inside the loop's animation frame it would stop the loop behind "Press any key".
   It then drops the presses of keys hit while loading (held keys stay held, as `pausable` does),
   starts the loop, arms M and calls `titleReady`. The card swaps the bar for "Press any key"
   ("Tap to play" in mobile mode) and hides on the next key, click or tap, which runs the game
   clock ([Host loop](#host-loop)).
6. If any step throws (the download, a missing WebGL), the card keeps the step's name, shows the
   error (`role="alert"`) and a Retry button that reloads; a failed module import stays failed
   until a reload. Retry stops Enter and Space from reaching the game's keyboard, which cancels
   them at the window. When the scripts themselves fail to load (a network error, or an
   `index.html` cached from before a deploy asking for removed assets), a small inline script in
   `index.html` shows the same error and Retry.

The step name is a polite live region, so screen readers hear each step; the byte count beside it
is not, so chunks stay quiet. A background tab has no animation frames and slows timers to about
one a second, so there each step yields on a `MessageChannel` message instead (eight steps would
otherwise add ≈ 8 s).

Measured with the production build in headless Chrome on an M4 Pro, 1280×720, before the day
cycle (its dev-server numbers are under [Measured](#measured)):

| Case | Before | After |
|---|---|---|
| local server | first frame at 1.9 s; JS heap after GC 117 MB | "Press any key" at 0.63 s; 88 MB |
| 4× CPU, 1.5 MB/s | the 15 MB script in at 9.8 s (a dead "Press any key" until then), one 3.5 s task, first frame at 13.5 s | map in at 4.6 s, ready at 7.1 s, longest task 0.64 s |

## Host loop

`src/main.ts` drives everything from one `FixedLoop`: 60 Hz steps, at most 5 steps per frame, and
frames clamped to 0.25 s. Before the loop starts it ticks `setup`, holds the game clock, ticks the
`audio` schedule once, and draws the first frame (the `render` schedule's first run): a system
reads the events published since its own last run, so a reader that has never run would miss the
first steps' `Impact`, `Honk`, `Cry`, `Skid`, `Lightning`, `Explosion` and `Whistle` events. Each
animation frame it:

1. writes the loop's `alpha` (fraction of a step since the last one) into `RenderClock`;
2. ticks the `render` and `audio` schedules (`runtime.tick(render, audio)`); the render's `DrawSky`
   hands the sky host the clock, the weather, the steps' lightning and the cars and trains with
   lamps on, and its `FollowPlayer` hands the see-through cut the player as drawn;
3. reads `PlayerView` and moves and turns the camera;
4. draws the sky for the moved camera (`skyHost.draw`: light, shadows, fog, rain, bolts, night
   lights; see [The sky](#the-sky));
5. streams the static world around the camera focus (see below);
6. renders the pixel view, then updates the HUD with `PlayerView` and `SkyView` and, in mobile
   mode, the touch controls.

The seed comes from `?seed=N`, or a random 32-bit number.

A new game starts today, on the browser's local date, at 08:00 in Rome:
`start = utcFromRome(daysFromCivil(year, month, day) · DAY + 8 h)`, from the sim's calendar
(`src/sim/sky/calendar.ts`), which keeps Rome's summer time. The clock stands still behind the title
card, so the player starts at 08:00 however long the card stays up: right after `setup`,
`holdClock` (`src/hud/title.ts`) sends `SetClock { rate: 0 }`, and `titleReady` calls the release
it returns when the card hides, which sends `{ rate: 1 }`. Only the clock waits: traffic, people and
animals move on behind the card. `title.test.ts` wires it as `main.ts` does: after 300 steps on the
card the clock reads `DEFAULT_START` and the HUD 08:00, and 60 steps after the card goes it reads
`DEFAULT_START + 60` at rate 1.

## Rendering

The render schedule (`src/render/index.ts`) uses `@typeonce/ritmo-render`. Its fourteen systems
run in this order: `SyncPeople`, `SyncAnimals`, `SyncVehicles`, `SyncTrains`, `MarkDriven`,
`PlacePeople`, `PlaceAnimals`, `PlaceVehicles`, `PlaceTrains`, `SpreadPools`, `DrawCrossings`,
`DrawEffects`, `DrawSky`, `FollowPlayer`. The train, crossing and effects systems live in their own
modules (`src/render/train.ts`, `src/render/crossings.ts`, `src/render/effects.ts`), the people,
animal and vehicle registries in `src/render/registries.ts`, and `RenderClock` in
`src/render/clock.ts`, so those modules read them without importing the schedule
(`src/render/index.ts` re-exports what `main.ts` wires).

- `SyncPeople`, `SyncAnimals`, `SyncVehicles` and `SyncTrains` (`RenderSync.system`) keep one
  three.js node per entity with a `Person`, an `Animal`, a `Vehicle` or a `Train`, in the `People`,
  `Animals`, `Vehicles` and `Trains` node registries (the services `Lunigiana/PeopleNodes`,
  `Lunigiana/AnimalNodes`, `Lunigiana/VehicleNodes` and `Lunigiana/TrainNodes`, which
  `makeRegistries` makes in `main.ts`). A detached node frees what it owns: its frames, its blood
  pool and its x-ray proxies; a vehicle node frees only its proxy, since its body is shared per
  model and paint, and a train node only its cars' proxies, since its bodies and lamps are shared
  per model and car. A person in a car is hidden. `SyncPeople` hands
  each node the person's mood, speed (from `Motion`, so a follower catching up is drawn running)
  and the sim time, and lays it down while `Down` or `Dead`; `SyncAnimals` hands on the speed and
  lays the animal down. A vehicle that has blown up (`Damage.exploded`) shows a charred shell
  (`vehicleBody` in `src/render/actors.ts`): its body's geometry with every vertex colour turned to
  its luminance and blended 90% toward `PALETTE.outline`, cached per model and paint like the
  intact one and never disposed.
- `MarkDriven` shows the x-ray silhouette (drawn only where the world hides the actor) on the
  player's car or train and no other (the driven one found by `Game.Entity.id(driving.vehicle)`,
  since `Driving` holds a `CarInput` handle for both). `SyncPeople` shows it on the player's
  figure. Its yellow is divided by the post pass's exposure, as the lamps are, so it stays the same
  yellow at night as at noon (at a night's exposure of 4 it would clip to lemon).
- `PlacePeople` and `PlaceAnimals` (`RenderSync.interpolate`) blend `PrevPose` → `Pose` at the
  render alpha, stand each figure on the ground or road under it (`groundY` in
  `src/render/ground.ts`, kept to the level it was on), add the metres it covered, and show the
  frame for what it does (below).
- `PlaceVehicles` puts each vehicle's node at its centre of mass from the sim, with no ground
  lookup of its own: x and y blended `PrevPose` → `Pose`, and the `Chassis` height, pitch and
  roll stepped back from the current step along their rates (`vz`, `pitchRate`, `rollRate`) by
  (1 − alpha) of a step: close to the previous step's values (within a few cm and about 1° as a
  car lands from a jump, since the physics moves them in four substeps), with no previous copy
  saved. A heading more than a quarter turn on from `PrevPose` is a tumble's angles folding
  (heading + π, pitch π − pitch, roll + π: the same body), so the blend unfolds them first.
  Rotation order YZX turns the node as the sim turns the body: heading, pitch about its right
  axis, roll about its forward axis (a positive roll tips the roof to the right). Each mesh
  stands on y = 0 at rest, centred on the centre of mass, with its wheels where `VEHICLES` puts
  them (the truck's one sim rear axle drawn as a tandem 1.3 m apart); body and x-ray proxy hang
  `cg` below the node (`VehicleNode` in `src/render/actors.ts`).
- `PlaceTrains` puts each train's cars on the rails: the train's s blended `TrainMotion.prev` → `s`
  at the render alpha, then every car from the sim's `carsOf` at that s (`src/sim/rail/consist.ts`,
  shared with the sim and the audio): its middle on the rail head (`pointAt`'s z, the profile plus
  `RAIL_LIFT`, at grade and on decks), heading, then pitch. Blending each car's pose instead would
  cut the chord inside a curve, 0.25 m off the rails for a 20 m step on the line's sharpest curve
  (162 m in radius, on the deck by the east edge). Below, [Trains](#trains-and-crossings).
- `SpreadPools` spreads each dead body's blood pool under its node as placed this frame (below).
- `DrawEffects` reads the `Skid` and `Explosion` events since the last frame and every vehicle's
  `Damage`, and feeds the effects host (`makeEffects` in `src/render/effects.ts`, made in `main.ts`
  beside the registries, passed as the `Effects` service, and `gta.effects` in dev builds). The
  marks, the smoke and the flames age by sim time (`Time.step` plus the render alpha), so they stand
  still while the game is paused. They are host state for the page's life: nothing loads a save in
  the browser.
  - Tyre marks (`src/render/marks.ts`): one dynamic mesh for the whole map, a ring buffer of 4,096
    quads, the oldest overwritten first. Each (car, wheel) draws a strip joining its consecutive
    steps; a step without a skid breaks it. Width by model's tread (Panda 0.18 m, Ape 0.1 m,
    Giulia 0.22 m, the truck's twin tyres 0.35 m), rubber on asphalt and stone, an earth rut on the
    rest, turning to a dark slush rut with the snow under the wheel (`Skid.snow`), opacity by
    `amount`, fading out over 60 s. A quad lies 4 cm over the ground the event
    names or the highest road ribbon drawn within 3 m over it (`drawnZ`; on a hairpin or at a
    junction the wheels' blended ground can sit under it, while a tunnel's hill stands higher),
    which clears the centre dash (2 cm over its road), and the material is pulled towards the
    camera in depth like the decals. Only the slots written since the last
    frame are uploaded (`addUpdateRange`), plus the whole colour buffer on a fade pass every
    0.25 s of sim time (≈ 0.5 ms for a full buffer). It is the first transparent effect drawn
    (render order 0).
  - Smoke and dust (`src/render/smoke.ts`): one `InstancedMesh` of up to 256 low-poly puffs
    (an icosahedron tinted per puff, 60 % opaque), spawned at `rate` × `amount` × `slip` puffs a
    second: white-grey burnt rubber on asphalt and stone, tan dust on gravel and dirt, dark brown
    on leaves, hardly any on grass, turning to white spray with the snow (`Skid.snow`). A puff
    swells, rises, drifts and thins away over 1–2 s; when all 256 are in the air, the puffs owed
    meanwhile are dropped. Being transparent it draws after every opaque mesh, the x-ray
    silhouettes included, and after the marks (render order 1), and it writes no depth.
  - Marks and smoke are lit like the people and cars (the `actor` weather variant: cloud shadows,
    no snow, no wet darkening), so they are not left sunlit under an overcast sky.
  - Damaged engines (`src/render/wrecks.ts`), by the stage of damage
    ([gameplay.md](gameplay.md#damage)): white smoke from the medium stage (10 puffs a second,
    0.5–0.9 m in radius at their peak, a little bigger than a tyre's 0.4–0.8), black from the severe
    (12), and once destroyed black smoke billowing from 0.5 m over the engine (12) above flames (40
    a second). Each leaves its model's engine (`ENGINE` in `src/render/actors.ts`, just outside the
    body: over the Panda's and the Giulia's bonnet, in front of the truck's grille, behind the Ape's
    cab), so a car on its side or roof smokes from over its body. Only 8 damaged engines within
    150 m of the player smoke (`PLUME_REACH`: the view reaches 90): burning wrecks first, as they
    are about to blow, then the smoking ones, white or black alike so a near one is not dropped for
    a far one, each the nearest first, and the charred shells last. The pools are sized for 8 plumes
    and fires with every puff and flame living its longest, so they always hold them in full. Each
    node keeps what it owes, so emission does not depend on the frame rate; each puff is born when
    it was due, where the engine was then, so a moving car trails its smoke, while the flames burn
    on the engine as it is placed each frame, so they stay with it as it moves, stops dead or
    tumbles. The smoke is a pool of `Smoke` puffs of its own (336), so wrecks and tyre smoke never
    starve each other. The flames are 224 small octahedra in one `InstancedMesh` with an unlit
    material, so they glow in shadow: they lick up within 0.5 m of the engine, rise 1.2–2 m/s,
    shrink and turn from yellow through orange to red over 0.35–0.7 s, their colours over 1 so they
    burn hot through the pipeline, and they draw after the smoke and write no depth, so the outline
    pass leaves their edges alone. An empty pool uploads nothing. A charred shell gives off only a
    thin dark grey smoke (`PLUMES.burnt`: 4 puffs a second, 0.3–0.5 m, rising 0.6–1 m/s for 2–3 s)
    and no flames.
  - Blasts (`src/render/blasts.ts`), from the `Explosion` events within 150 m of the player, each
    started at the drawn moment's sim time: a flash (an unlit icosahedron swelling from 1.2 to 4 m
    in radius, 2.4 to 8 m across, in 0.12 s, white-hot to yellow, gone by 0.3 s), a fireball of 40
    unlit octahedra flung out and up at 4–12 m/s (air drag 3/s, rising 4 m/s², 0.7–1.7 m in radius,
    0.6–1.2 s, white through yellow and orange to red), 30 embers (0.12–0.24 m in radius, 6–14 m/s
    under gravity, about 1 s), 24 pieces of debris (boxes 0.25–0.6 m long, lit like the cars by
    the `actor` variant, a third in the body's paint, the rest charred, thrown at 4–11 m/s and
    spinning, gone when they fall back to the ground or after 2.5 s) and 24 black puffs of its own `Smoke` pool (1.2–2.2 m in radius, rising
    1.5–2.5 m/s for 3–5 s). A falling piece's ground is where it comes down, found as it is thrown:
    where it would land on level ground at the wreck's foot, then twice more where it would land on
    the ground found the pass before, on the level nearest the wreck's (a bridge's deck, then the
    valley past its edge). Each pass only lowers it, so it is never over the wreck's foot and a bank
    across a valley does not lift it back up. On a hillside falling away at 50 % every shard lands
    within 0.35 m of the ground (with the wreck's ground alone some vanished 6 m up in the air); off
    5 bridges 6.5–24 m over their valleys, 10 blasts each, 2 of the 975 shards that came down
    vanished over 0.5 m up (514 of 1,205 with the wreck's ground alone). Each layer is one
    `InstancedMesh` sized for 4 blasts at once, dropping the pieces of any more; the fire draws over
    the smoke and writes no depth. No light: a light's count is part of every lit program's key, so
    adding one would recompile them all. All the meshes are in the scene from the first frame, so
    their programs compile behind the title card. The flash writes no depth, so the outline pass
    draws the car's edges as faint lines through it for about 0.2 s.
  - Measured in headless Chrome on an M4 Pro, 1280×720, dev server, seed 7: "Press any key" at
    ≈ 0.66–0.69 s (0.68–0.85 s before the change); JS heap after GC at the spawn 96.1–96.6 MB
    (96.0 MB before), 97.2 MB with a full ring of marks and the smoke at its cap; 60 fps and no
    frame over 16.8 ms through handbrake slides on asphalt and a dirt track, and with 4,095 marks
    and up to 256 puffs in view.
  - Measured the same way with the damaged engines' smoke and fire (a fresh Chrome profile per run):
    "Press any key" at 758–811 ms (753–764 ms before), JS heap after GC at the spawn 92.9 MB
    (92.4–92.5 MB before); with every parked car started damaged (a third each burning, at 0.5 and
    at 0.8), 8 plumes in view, 226 puffs and 64 flames in the air: 60 fps, no frame over 16.8 ms,
    94.7 MB. With the two Carabinieri cars burning by the spawn and blowing up 3 s apart, over the
    12 s around both blasts: 60 fps, no frame over 16.8 ms (as without the blasts); JS heap after
    GC 93.9 MB before them and 94.0 MB after (93.6 and 93.8 MB without).
- `DrawCrossings` sets every level crossing's arms and lights from the `LevelCrossings` resource at
  the drawn moment (below). It, the audio's `heardCrossings` and the sim's `busyBoxes` and train
  senses go over every box each frame or step, which this map's five boxes make nothing; a railway
  with hundreds would want them looked up near the view, as the traffic's queue look is.
- `DrawSky`, after the placing systems so the cars and trains stand where they are drawn, hands the
  sky host (the `Sky` service, [The sky](#the-sky)) the game time blended at the render alpha
  (`seconds + alpha · rate`), the clock's rate, the `Weather`, the sim time
  (`(Time.step + alpha) · STEP.dt`) and every `Lightning` since the last frame. Then it switches
  every car's lamps, on in traffic and in the player's car, off when parked (a destroyed traffic
  car is abandoned, so its lamps go out; `SyncVehicles` hides a charred shell's), and every train's,
  on with an AI driver or the player at the controls, off when left; and it hands the sky the cars
  and trains whose lamps are on, for the headlight beams. A train's beam starts at its leading nose
  (handed `HEAD.ahead`, 2 m, behind it, and `HEAD.rise` under its head lamps) with the train's
  entity id, and the player's takes the driven slot. They are handed after `sky.sky()`, which
  empties the sky's list of lit cars.
- `FollowPlayer`, after the placing systems, hands the see-through cut (the `Cut` service,
  [See-through cut](#see-through-cut)) the player as drawn: on foot their figure's feet and height
  (0.5 m lying), driving their car's ground (`cg` under the node) and its spec's height, driving
  a train its leading cab at the driver's place (the crew door's 2.5 m behind the nose), on the rail
  head, and the train's height; with no player it shuts the cut. Like every render system it writes
  nothing: `src/render/__tests__/index.test.ts` counts the schedule's 14 systems and checks their
  declared access.

People and animals (`src/render/people.ts`, `src/render/animals.ts`, sharing `figure.ts` and
`blood.ts`) are low-poly box figures built from their look, one geometry per frame:

- **People** have seven frames: `stand`, `walk1`, `walk2`, `run1`, `run2`, `shock` (hands to the
  head) and `talk` (a forearm raised). The proportions are stylised, since a big head reads at the
  game's pixel size: an adult's head is 0.19 of its height and its legs 0.47; a kid's head is
  0.3·√(h / 1.2) m and its legs 0.42 of its height (the artists' canon: a 6-year-old is about six
  heads tall, an adult seven and a half). Widths go as √(h / 1.75 m) (a kid's as 1.1 × h / 1.75 m,
  a little stockier); the shoulders are 0.49 m across a man and 0.42 m across a woman at 1.75 m;
  elders stoop 0.17 rad (TUNED). The arm's segments follow Drillis & Contini 1966 (upper arm 0.186
  and forearm 0.146 of the height; the hand drawn at 0.09, shorter than their 0.108). Trousers
  cover the leg, shorts leave the shins bare, a skirt flares from the waist to the knee, and a
  dress is the skirt in the shirt's colour; shoes are dark. Every elder and about a third of the
  rest wear long sleeves (0.28–0.33 measured, in a dress or not), picked from the look's colours.
  Hair is short, long (to the shoulders), a bun, bald (a horseshoe fringe round a bare crown) or
  under a flat cap in one of two tweeds with a 7 cm brim. Each frame is lowered until its lowest
  foot touches the ground, and the standing frame is the look's height within 8 cm.
- **A person's frame** (`framePerson`): lying (down or dead), the standing frame laid flat; in
  shock, hands to the head; under 0.2 m/s, standing, and a chatting person turns to the talking
  frame every other 1.1 s (TUNED) at a phase of its own, so two talkers do not gesture in step;
  fleeing, or faster than 2.42 m/s, the run frames, a frame per 0.8 × its height covered (2.42 is
  the 2.06 m/s walk-to-run transition of Hreljac 1993, raised to 1.1 × the player's 2.2 m/s walk so
  that still looks like walking); otherwise the walk cycle `walk1`, `stand`, `walk2`, `stand`, a
  frame per half step of 0.41 × its height (an estimate, as is the run's).
- **Animals** have one box model per species at size 1: a dog 0.8 m long and 0.55 m at the back, a
  cat 0.45 m long and 0.25 m tall, a cow 2.3 m long and 1.4 m at the withers with horns and an
  udder, a pig 1.2 m long and 0.7 m tall with a snout and ears; each scaled by the animal's size.
  The patch colour marks the coat: not at all on a plain coat; as a belt round a pig's shoulders
  and forelegs (the Cinta Senese); paler, on the belly, chest, socks and face; darker, as a cat's
  tabby stripes; otherwise as patches placed by a seed from the entity (a Frisona's, a calico's).
  Its frames, `stand`, `step1` and `step2`, swing the legs ±0.3 rad in diagonal pairs, a frame per
  half step of 0.8 × the leg's height (an estimate); under 0.1 m/s it stands.
- **Lying**: the node stays upright and its body turns, so the pool under it lies flat: a person
  tips forward onto its face along its heading, its feet where it stood; an animal rolls onto its
  right side.
- **Blood pools** (`src/render/blood.ts`): a dead body's pool is a flat, dark red (`PALETTE.blood`)
  fan of 9 ragged corners, its outline seeded by the entity, under a person's chest and head or an
  animal's trunk. Its radius grows as √(t / 6 s) (`SPREAD`, TUNED: a steady flow of a fixed
  thickness covers an area in proportion to the volume shed) to 0.8 m for a person, 1.1 m for a cow,
  0.6 m for a pig, 0.45 m for a dog and 0.25 m for a cat (animals × their size; TUNED); t comes from
  `Dead.since` and the sim time (`Time.step` plus the render alpha), so it stands still while the
  game is paused. Each corner lies 5 cm over the ground or road ribbon under it (`drawnY`; over the
  centre dash's 2 cm and the tyre marks' 4 cm), in `bloodMaterial`: pulled toward the camera like
  the decals, but lit by the `actor` weather variant, so it takes the clouds' shadows and no snow or
  puddles cover it. On a bridge deck or in a tunnel (the body more than `ON_DECK`, 0.5 m, off the
  ground at grade) it lies flat: its corners past a deck's edge dropped metres to the ground below
  on 32 of 47 bridges. It is redrawn only when its radius or its node moves.
- **X-ray proxies**: a node builds a proxy the first time it shows one, and only the player and
  the car they drive ever do, so no other person, animal or car builds one. The player's proxy
  fits the gait shown, so the silhouette does not jump every half step and the body's own limbs
  never poke out in front of it (they would show yellow): walking it encloses the standing and
  walk frames (x −0.44 to 0.48 m, z ±0.41 m for the player's look), running the run frames (x
  −0.63 to 0.71 m, z ±0.41 m), lying the body as it lies (y 0.15 to 0.40 m). The shock and talk
  frames, which the player never shows, are left out: one box round all seven frames reached
  0.31 m into a wall the 0.35 m body touches, where the walking box reaches 0.06 m. Every proxy
  keeps its bottom 0.15 m over the ground (`XRAY_FLOOR`).
- **Measured**: in Node, a person (a skirt, long hair) builds in 0.92 ms with 192 triangles a
  frame, a patched cow in 0.62 ms with 348. In headless Chrome (M4 Pro, 1280×720, dev server, seed
  7, at the player's start, before the day cycle) the JS heap after GC is 101.1–101.5 MB
  (98.9–99.1 MB with the earlier box figures and pedestrians), and the game holds 60 fps with no
  frame over 16.8 ms for 20 s at the start and for 30 s in Gragnola's centre (19 people, 5
  animals).
- **Limit**: in the dense centres (Gragnola, Vinca) the camera sees mostly roofs, so people in the
  alleys are hidden; only the player has an x-ray silhouette and the see-through cut.

The static world (`src/render/world.ts`) is cut into 128 m chunks (`src/render/chunks.ts`), and
only the chunks around the camera exist as meshes. A built chunk has a terrain mesh, a solid mesh
(buildings, roofs, bridges, the railway's ballast bed, platforms, canopies and name boards, the
level crossings' housings and cabinets, tunnel portals, the lamps' iron, poles and lantern bodies),
a decal mesh (roads, the track's sleepers and rails, crossing panels and stop lines, the platforms'
yellow lines), a water mesh (rivers and streams, laid on their beds: the shader lifts them to the
level the rivers run at, [water.md](water.md#how-it-looks)), a glow mesh (lit window panes and lantern glass)
and one `InstancedMesh` per tree kind; the water and glow meshes exist only where the chunk has
some. A 192 m apron of extra chunks continues the terrain, lines and trees beyond the map
bounds. Terrain cells take their colours from the land cover (`src/sim/map/cover.ts`, painted by
`COVER_LOOK` in `src/render/terrain.ts`): the
map's areas, meadow where none covers a cell, paving where open ground lies within 3 m of both a
wall and a road's edge (house fronts, sidewalks, alleys), and pebble beds along the wide streams.

Streaming:

- `new World(scene)` prepares, once (245–251 ms in Node for the whole valley, five runs; 225–237 ms
  before the railway's platforms and crossings, 189–195 ms before the street lamps): the land-cover
  raster
  for the whole map (`mapCover()` in `src/sim/map/cover.ts`, ≈ 105 ms and 4.9 MB, cheaper than
  clipping areas per chunk; built on first use and shared read-only with the sim's surfaces and the
  audio host), the street lamps (`streetLamps()`, 34–37 ms on first use), the platforms' and the
  level crossings' geometry ([Track and stations](#track-and-stations)), every
  static item as a `Piece` (an anchor polyline plus a `draw` function; each lamp is a one-point
  piece at its lantern), the pieces bucketed per
  chunk with the range of segments that reach it, and the trees bucketed per chunk and kind. A chunk
  build reads only its own bucket; it draws each piece's segments plus one neighbour on each side
  (for ribbon mitres) and keeps exactly the triangles that fall in the chunk, so the result is the
  same as cutting a whole-map build.
- Distances are measured on the screen plane, from the focus to each chunk's box projected along
  the camera's right and up axes, terrain relief included. A valley far below a ridge counts as
  near when the camera shows it beside the focus. The boxes are measured once (`chunkBoxes`);
  their screen rectangles are projected again whenever the view's yaw changes, which is every
  frame of a turn and every frame the view follows a turning car (5,248 boxes of 8 corners each).
- `world.update(focus, yaw, reach, budgetMs)` runs every frame. `reach` is the half-diagonal of the
  view at the widest zoom (`WIDEST_ZOOM`, 5 texels/m), so zooming out never shows a missing chunk.
  Chunks within reach + 64 m are built, nearest first, until 4 ms of the frame are spent (at least
  one per frame). Chunks beyond reach + 64 + 128 m are dropped: removed from the scene, their
  geometry and instance buffers disposed (the tree shapes are shared and stay).
- Before the first frame, `main.ts` builds every chunk the spawn view needs, so nothing pops in.
- Measured (1280×720 and 2560×1440, focus swept at 40 m/s through Monzone, Equi Terme, Gragnola,
  Colognola, Campiglione and Viano): 20–37 chunks loaded, chunk builds ≈ 0.25 ms on average and
  under 3 ms at worst, first frame after ≈ 0.6–0.85 s, JS heap ≈ 185 MB (was ≈ 550 MB building the
  whole map), no frame over 30 ms, 60 fps. Widened to the whole valley (7.8 × 10 km, 3.3× the
  area), chunks per view do not grow; load times and heap are under [Start-up](#start-up).

The pixel pipeline (`src/render/pipeline.ts`):

- An orthographic camera at 30° elevation. At that angle the ground axes project to exact 2:1
  pixel lines.
- In its home view the camera sits north-west of the focus and looks south-east: the mountains
  rise to the south and east, so this side sees every street. On foot Q and E turn it a quarter
  at a time (the sim's `View`); driving it follows the car. `screenAxes(turns)` in
  `src/sim/view.ts` gives the screen axes on the ground for each turn, and `axesAt(yaw)` for any
  yaw. The sim maps on-foot keys through them, and the camera and minimap are built from them.
- The host turns the camera's yaw with `swingView` (`src/render/swing.ts`). On foot it eases
  toward `turns × π/2` (`turnToward`): a quarter turn takes about a third of a second and stops
  exactly on the heading, so at rest the 2:1 lines and the texel snapping are exact again.
  Driving, it follows the yaw that puts the car's heading up the screen (`followYaw`) on a
  critically damped spring (`followToward`), the short way round; getting out, the spring settles
  it exactly on the seat the sim picked (`settleOn`). Under `prefers-reduced-motion` the view turns
  at once, but in a car it only jumps onto it and then keeps the spring, which moves it less than
  the car's heading does. Measured in headless Chrome (1280×720, dev server, seed 7), driving the
  Carabinieri car round a corner with the view following: 60 fps, no frame over 16.8 ms, at most
  0.017 rad of turn in a frame; out of the car the view landed exactly on its seat.
- The scene renders into a low-resolution HalfFloat target about 270 texels tall. One fullscreen
  pass then darkens depth edges (outlines), lays the sky's atmosphere over each texel (fog, haze,
  exposure and grades: [Post pass](#post-pass)), converts to sRGB, and upscales by an integer
  factor.
- The camera snaps to the texel grid and the remainder becomes a sub-texel scroll offset. The
  static world never shimmers, but the view still scrolls smoothly.
- Zoom (`zoomFor`): 8 texels/m on foot, 6 in a car, 5 above 16 m/s (back to 6 below 13 m/s).
- The camera leads the player by 0.6 s of velocity, at most 14 m (`LOOK_AHEAD`), and eases
  toward its target, at the height of the ground under the player (`groundY`, on the level nearest
  the camera's), or driving a train the cab's (`PlayerView.z`), which a rail bridge has and the map's
  ground has not.
- The key light (the sun, or the moon at night) stands on its real arc for the game time over the
  map's origin, fixed in the sky whichever way the view looks ([Lights](#lights)): a turn moves the
  camera, never the shadows. Its shadow box follows the view, snapped to shadow-map texels. The box
  covers the ground the view shows (`shadowFit`): a 5 × 5 grid of rays across the view is marched
  down to the terrain, because a slope falling away from the camera shows ground far past the flat
  rectangle (at most 300 m across the light) and a valley seen between the view's edges can lie
  hundreds of metres deeper along the light. Its depth also reaches 1.5 km toward the sun for the
  ridges that shade a valley. The depth bias stays 0.45 m whatever the depth range.
- The far plane is 3 km from the camera (2.5 km past the focus): from the Apuan summits the
  deepest ground in view is ≈ 2.45 km from the camera, past the 1 km the plane used to stop at.

### Track and stations

The railway's static parts are chunk pieces like the roads: the track and the crossings' fixed
parts (`src/render/rail.ts`), tunnel portals (`portals.ts`), platforms (`platforms.ts`) and the
stations' furniture and lamps (`stations.ts`), all in the solid, decal and glow layers, so they add
no kind of mesh, material or program (5 of the 106 chunks the line runs through gain a solid mesh,
for the ballast bed or a portal: a draw call and a shadow cast each); only the moving parts are host
nodes ([Trains and crossings](#trains-and-crossings)).

- **Drawn widths are reading widths.** The camera draws 5 texels/m above 16 m/s, where a driven
  train lives, and ground lengths along the screen's vertical shrink by sin 30° = 0.5. A real
  sleeper every 0.6 m would be 1.5 texels a period there, under the 2 a pattern needs, and crawl in
  a moiré as the zoom eases; a real 0.07 m rail head would flicker, and at 0.18 m, 0.9 texel, the
  rails broke into dashes that crawled from frame to frame. So the sleepers are 0.6 m every 1.2 m
  (3 texels a period) and the rails 0.24 m wide (1.2 texels), both decals, the sleepers prestressed
  concrete (wooden on a siding) at 0.07 m and the rails at the rail head (`RAIL_LIFT`, 0.12 m over
  the bed's profile, where the sim's trains ride). A dashed ribbon is cut where each dash starts
  and ends (`ribbon` in `src/render/ribbons.ts`), so every sleeper is exactly 0.6 m: with even
  steps alone they ran 0.3–0.9 m.
- **The ballast bed** is 3D: a top 3.2 m wide 0.02 m over the profile and shoulders sloping to
  2.1 m out, down to the terrain where the line runs on a bank (to a near-vertical face where it
  falls away, as beside the Caldanella road). Its top stands 0.15 m or less over the terrain on
  90 % of the line at grade, because the sim's ground has no track: someone walking over it keeps
  their feet in sight. On a bridge the deck stays, the ballast a flat strip on it. Every `MAP.rail`
  piece is drawn this way, loops and sidings included; tunnels are not.
- **Level crossings** (`MAP.railway.crossings`): nothing 3D stands in a box, its road's
  carriageway (the bed stops a metre short of it), since the road ribbon floats 0.06–0.16 m over
  its profile and hides decal rails. Over the road, the box's piece lays a 2.6 m concrete panel
  under each track and two polished rails, 2 and 3 cm over the road ribbon drawn there (the
  nearby roads' own triangles, drawn again for the box by `surfaceNear` in `ribbons.ts`: the
  sim's `drawnZ` sat up to 11 cm under them at Via Castel dell'Aquila), and per approach a 0.5 m
  white stop line across its lane at the sim's stop line. A road's centre dashes, as high over it
  as the panels, stop under them (`underPanel` in `src/render/track-index.ts`): in a box, within
  half a panel and a metre of a track centreline (at three tertiary crossings they cut through the
  panels and broke their rails). Beside each arm (render/crossings)
  stand its white barrier housing (the TD96/2's 0.6 m box) on the traffic's side of the arm's
  plane, the arm hinged on its face, the road light's black back plate between the arm and the
  lens with a hood over it, on a grey pole, and one grey equipment cabinet per box; all 1.59 m or
  more off every track centreline. A foot crossing gets the panel and rails only.
- **Tunnel portals**, at each end of a tunnel piece that no other tunnel piece carries on and that
  is not on the map's edge (8 on this map): a stone face wall 10 m wide and 7.5 m over the rail
  head with a cornice, the dark mouth of a single-track tunnel (4.8 m wide, an arch in three steps
  to 5.8 m) on its face, and behind it a lined throat 6.4 m wide and 6.2 m tall that runs into the
  hill until the hill stands over its centreline (3–40 m): the map's ground over the first 5–15 m
  of a tunnel is too low to hide a train. A train passing the mouth vanishes behind its dark face.
  Where the hill falls away across the throat it still shows: at the 271 m tunnel's east mouth
  (s 5575) the cover over the rail head every 4 m in from the mouth is −0.7, −1.6, 0.3, 4.7 and
  6.9 m against the throat's 6.2 m, so seen from the opposite quarter its downhill side stands out
  of the slope as a dark block about 16 m long; the home view's hill hides it. Ending the throat
  where its downhill side's cover reaches its height, or the tunnel piece where the cover reaches
  about 4.5 m in the map, would hide it.
- **Platforms** (`MAP.railway.platforms`): each ring (holes included) is triangulated, then cut
  into strips every 2 m along the platform's axis, each corner at the map's platform top over it
  (the rail head beside it + 0.25 m, the ground the sim stands people on), so the top follows the
  rail profile within 2 cm (Monzone's rises 0.5 m along it; a flat slab was up to that wrong at one
  end). Cut points are computed from each edge's ends in a fixed order, so neighbouring triangles
  share them exactly (no cracks). A concrete kerb runs down to the ground under every edge, and on
  a platform (not a rail-level walkway) a 0.2 m yellow line lies 0.45–0.65 m in from the edges
  beside running track or a loop. Each triangle goes into the chunk of its middle.
- **Name boards**: one per platform people wait on, RFI blue with a white rim, as long as the
  station's name (0.16 m a character, 2–6 m), its words as white bars on both faces (lettering does
  not read at this pixel size), on two posts 1.8 m back from the track-side edge near the platform's
  middle, 2.1–2.6 m up.
- **Canopies** come from the map alone: a station's building (the station-style building of its
  name) gets a flat grey metal canopy like Gragnola's along its wall facing the track where a
  platform or walkway runs along that wall (its rim, holes left out, covers 80 % of the strip
  0.5–2.5 m out from the wall: a platform wrapping round its building has the eaves' footprint as
  a hole), along the whole wall, 4.5 m deep and 3.4 m up on posts, keeping 1.95 m off the nearest
  track centreline (a train's half width, 1.44 m, and a margin). On this map that is Gragnola's
  alone. Monzone's real canopy, a small green one over the door of a wall with grass between it
  and the platform, is not drawn: the CTR maps canopies (code 0208, 653 over the sheets, one 7.5 m
  from Monzone's building), but the map keeps no canopy yet (`ctr.ts`).
- **Platform lamps** (`platformLamps`): a grey pole every 18 m along each platform people wait on,
  1 m in from its track-side edge, clear of its name board and 1.5 m from a canopy, the lantern
  4 m over the top on the same 0.6 m bracket as a wall lamp, reaching toward the track. They join
  the street lamps (`streetLamps()`), so the glow and the light pool read one list: 24 on this
  map, Equi Terme's 8 its only street lights.
- **Near the chunk only.** A chunk's tests ask only what is near them: the boxes are bucketed by
  their reach (`boxAt`) and the track's segments in a grid (`trackNear`, which the platforms'
  track-side edges, the stations' walls and the crossings' panels read too), both in
  `src/render/track-index.ts`. Each rail chunk's build is measured in Node (median of 15 builds):
  0.84 ms on average, 1.38 ms at p90 and 2.17 ms at worst (chunk 3623); with 300 more crossings
  far off the map 0.87, 1.36 and 2.22 ms, where scanning every box took 1.52, 2.69 and 4.72 ms,
  past `STREAM_BUDGET_MS` (4).
- **Cost**: 76 chunks hold railway, 1,240 triangles a chunk at the median, 2,216 at p90 and 5,539
  at the worst (Gragnola's two tracks, platforms and canopy; a chunk's terrain is 2,048); 35,098
  solid and 66,562 decal triangles over the map, against about 4,000 and 48,300 for the flat
  ribbons and slabs before. In Node, `new World` takes 245–251 ms (225–237 before: the platforms'
  and crossings' geometry is built there, once, so no chunk build pays it), and 785 chunk builds
  swept along the line and through Monzone after the spawn view take 0.47–0.49 ms on average
  (0.43–0.44 before), 0.94–1.03 ms at p90 (0.93–0.96) and 4.5–8.6 ms at worst (4.1–7.4, garbage
  collection), over five runs. In headless Chrome (M4 Pro, 1280×720, dev server, seed 7, a clear
  noon) a 40 m/s sweep over the stations and crossings builds 132 chunks in 0.79–0.84 ms on
  average and 2.9–3.9 ms at worst (0.74–0.81 and 3.1–4.2 ms before), at 60 fps with no frame over
  16.8 ms; "Press any key" at 0.76–0.85 s (0.82–0.99 s), the JS heap after GC 229.6–229.8 MB after
  the sweep (225.6–226.2 MB), and a frame at Monzone's platforms 58–59 draw calls and 60,437
  triangles (56–57 and 53,215 before), still 19 programs.

### Trains and crossings

Trains are actors with a node per car, and each level crossing's barriers and lights are host
nodes set from the sim's cycle; both draw with materials compiled before the first frame.

- **Trains** (`src/render/train.ts`): a `TrainNode` is a group of `TrainCar`s (each an `ActorNode`:
  a body and a lazily built x-ray box) from the active cab back, placed by `PlaceTrains` (above)
  while the group itself stays at the origin, so three culls each car on its own. A model's cars
  come from its livery (`LIVERIES`, a `Record<TrainModel, …>`): a cab car (its cab at +X) and a
  middle car, built from each car's length, a cab's head and tail lamps, and the head lamps'
  height. Car 0 and the last car are cab cars, the last one's body turned about, so a train drawn
  with its cab facing either way along the same stretch is the same three cars. Bodies and lamps
  are merged once per model and car and never freed; `TrainNode.dispose()` frees only the cars'
  x-ray boxes.
- **The ATR 220 in DPR livery** (`src/render/atr220.ts`, the colours `dpr*` in `palette.ts`): three
  cars of 19.5, 16.5 and 19.5 m, 2.88 m wide; silver sides with a dark window band from 1.5 to
  2.45 m, the blue cantrail band and roof, the cab's front raked back 1.6 m at the roof (a red band
  under the windscreen, the glass and the dark dome in the middle, the blue hood wrapping either
  side and sweeping down over the cab's flank round its side window), a yellow swoosh over a blue
  one rising from each end car's door to the nose, a yellow line over a blue one along the rest of
  the low floor, lime doors (one a side a car), the roof's air-conditioning unit, cooler and
  exhaust stack, and the dark bogies, power pack and gangway bellows. Each body stops 0.35 m short
  of its Jacobs joint, where a dark bellows fills the gap, and rides 1 m up over the Jacobs bogies,
  0.85 m over the powered bogie under each cab and 0.45 m along the low floor. The livery's
  patches stand 1.2 cm out of the side (a door 2.4 cm, over the band it cuts).
- **Lamps**: the leading cab's three white head lamps (two at the windscreen's lower corners, one
  at its top) and the trailing cab's two red tail lamps, on `signalLampMaterials`, which shine by
  day as well: a train runs lit in daylight. They are on while an AI driver or the player drives,
  off on a train left alone. The beam is the sky's (`DrawSky`, above): no light of its own.
- **The x-ray** on the driven train: one box per car, trimmed 0.3 m at each Jacobs joint and open
  there. A whole-car box cut into its neighbour's at the joints, and seen along the train (the
  follow camera's view) the next car stood in front of a box's end face, which showed as a yellow
  block at every joint. On the line's sharpest curve (162 m in radius) no box reaches into its
  neighbour's.
- **Crossings** (`src/render/crossings.ts`): `makeCrossings`, called by `makeEffects`, builds for
  each road box of the sim's `CROSSINGS` a barrier per approach on the pivot the sim gives (on the
  post right of the way in) and one mesh of road lights per box, for the page's life and visible
  from the start, so `view.compile` sees them; the host hands them to the schedule as the
  `Crossings` service (`Lunigiana/CrossingNodes`). A barrier is the arm (red and white 0.5 m stripes
  from the tip, 0.26 m tall with its top 1.18 m over the road, a counterweight behind the pivot),
  three red lamps along it, and the skirt (*grembiale*, 0.6 m) whose bars stay plumb as the arm
  rises (a sheared matrix: its x along the arm, its y vertical), so it folds flat against the
  standing arm. The road light is a 0.45 m red lens 2.25 m over the road, facing the traffic coming
  in. The posts, the cabinets and the light's housing are the track's chunk pieces. `DrawCrossings`
  reads the `LevelCrossings` resource and asks `crossingAt` (`src/sim/rail/barriers.ts`) what each
  box shows at the drawn moment, step plus alpha: the arm's share down turns it from standing (0) to
  across the road (1), and `lit` (from the warning until the arms stand up again) puts the arm lamps
  and the road lights on `signalLampMaterials.on`. A train asking for the box while its arms rise
  lowers them from where they stood, since the saved state carries the arms' share down at the
  phase's start (`from`). A foot crossing shows nothing. Arms and skirts use `actorMaterial`, so no
  snow lies on the stripes; only the arms cast shadows.
- **Cost**, measured in headless Chrome (M4 Pro, ANGLE Metal, 1280×720, dev server, seed 7) by
  counting every `renderBufferDirect` by owner: a train in view takes 10 draw calls (3 bodies, 4
  lamp meshes, 3 shadow casts), the driven one up to 3 more for its x-ray boxes; a road box in
  view 9 (2 arms, 2 skirts, 2 arm-lamp meshes, its road lights, 2 shadow casts). Still 19 programs
  at "Press any key" and after trains, lit crossings, a driven train's x-ray and a night drive;
  60 fps with no frame over 16.8 ms with a train or a lit crossing in view.
- **Measured with every host wired** (`main.ts`, the same browser and seed, two runs): a frame at
  Via Riolo with a train standing over its closed box takes 80–87 draw calls and 85k triangles at
  noon (72–80 with no train and the box open) and 63–75 at night (55–69), the train adding 5–11;
  60 fps over 10 s with no frame over 16.8 ms, by day and at night. At the spawn, a fresh Chrome
  profile per load (12 each), "Press any key" comes at 0.94–1.10 s (0.91–0.93 s before the trains
  were drawn and heard; the first four),
  the JS heap after GC 5 s into play is 108.9–112.1 MB (105.7–108.6 MB), and a frame takes 78 draw
  calls and 54k triangles (73 and 45k); 60 fps over 10 s, with one frame of 33.4 ms in one of the
  12 loads and none over 16.8 ms in the others (the build before showed one of 33.3 ms too, in a
  reused tab).

### See-through cut

While the world hides the player, a circle round them on screen opens and the world inside it that
stands between them and the camera is not drawn, so the player and the ground they are heading for
show behind houses, trees and hills.

- **When** (`SeeThrough` in `src/render/sightline.ts`): each frame two sight lines run from the
  player toward the camera (along its back axis, 30° up), one 0.4 m over their feet and one 0.1 m
  under their top (`sight`). Every 2 m up to 500 m along each they look for terrain over the line,
  and where they first meet it; then every 0.75 m up to 100 m (50 m up) for a building (inside its
  walls, under its ridge: `topOf` in `buildings.ts`) and a tree crown as drawn (`inCrown` in
  `trees.ts`: the broadleaf's ellipsoid, the conifer's cone). Either line blocked holds the cut open; it opens over 0.2 s, stays 0.4 s after the
  player was last hidden (it does not flicker at a wall's edge) and shuts over 0.2 s. Under
  `prefers-reduced-motion` it opens and shuts at once. When sim time goes back (a state the
  devtools replay restores), it forgets when the player was last hidden, so the cut is not held
  open until the clock catches up. A sight line costs 0.004–0.06 ms in Node
  (in a forest, unblocked: the longest march), two a frame. Baldur's Gate 3 traces from its
  characters toward the camera the same way.
- **What** (`src/render/see-through.ts`): a circle of 54 texels' radius on screen (6.75 m on foot,
  9 m in a car, 10.8 m above 16 m/s: 40 % of the view's height across) round the middle of the
  player's body. Inside it, a fragment
  nearer the camera than that middle is dropped (`discard`, before it is shaded) when it is:
  - a building, bridge, platform, lamp, tree or lit pane (`CUT_ABOVE`) more than 0.4 m over the
    player's feet: walls stand as stubs round the ground, as in The Sims' cutaway, and the trunks
    as stumps;
  - the terrain, a road or a river (`CUT_GROUND`) more than `uCutGround` m nearer: 2 m (the
    march's step) short of where a sight line first meets the terrain, measured along the view from
    the body's middle, and at least 1 m; while no terrain hides the player, none is cut. A hill
    that hides the player goes in a full circle, however far off and high it stands, while the
    ground between them and the hill stays. The last value holds while the cut shuts. An earlier
    rule cut only the ground above the player's feet on screen, which left a half disc under a
    mountain. With the clear colour painted magenta, a path at a cliff's foot (the terrain 1–3 m
    off) and a mountain road under a ridge 135 m off showed no hole.
- **Look**: the edge is hard, and the outline pass (which darkens a texel whose neighbour lies over
  1 m deeper) draws it as a crisp ring; a dithered edge would have left outline specks. The shadow
  pass draws the whole world, so the cut moves no shadow. People, animals, vehicles, the marks and
  the blood are never cut. The x-ray silhouette still shows where the cut leaves the player hidden.
- **Cost**: every cut material reads the shared `CUT_UNIFORMS` cells (`uCutCentre`, `uCutFeet`,
  `uCutRadius`, 0 while shut, `uCutGround`) and picks its rule by a `#define` fixed at compile time, so opening it
  recompiles nothing. The terrain left `solidMaterial` for its own `terrain` variant, one program
  more (19 at "Press any key"). Measured in headless Chrome (M4 Pro, 1280×720, dev server, seed 7,
  a fresh profile per run, walking behind the houses at the spawn with the cut open for 15 s),
  against `main`: "Press any key" at 806–850 ms (809–812 ms), JS heap after GC 103.8–104.2 MB
  (104.1–104.2 MB), 60 fps with no frame over 16.8 ms (the same).
- **Limits**: the sight lines start at the body's middle, so a car whose rear alone is behind a
  wall keeps the cut shut (the x-ray shows the rear). Inside a cut house the floor is the terrain
  under it, and walls standing below the player's feet (a house downhill) stay whole. The ground
  cut is one depth for the whole circle, from the lines through the body: a hill off to one side of
  them, nearer than that depth, stays.

### The sky

The sky host (`src/render/sky/host.ts`) turns the saved clock and weather into the light, the
atmosphere and the weather on screen every frame; the parts it drives live beside it in
`src/render/sky/`. How each hour and regime looks is in [weather.md](weather.md).

- **One host, made before the first frame.** `main.ts` makes one `SkyHost` before the world and
  passes it as the `Sky` service. Its constructor adds every light and weather mesh to the scene
  (the key light and its target, the hemisphere, the rain and snow, the bolts, the night lights),
  so each lit program compiles once with the final light count; after that it drives them only by
  colour and intensity. In dev builds `gta.skyLook()` returns what it drew last: the sky frame, the
  sun and moon, the light, the exposure, whether shadows are drawn, the fog layers and the weather
  at the focus.
- **Each frame**, once the camera has moved, `draw(view, renderer)`:
  1. works out the sun (`sunOver`), the moon and its phase (`moonAt` over `place()`, the place
     `sunOver` reads, and `moonPhase`), the weather at the focus (`conditionsAt`) and the fog layers
     (`fogLayers`), all the sim's pure functions;
  2. takes this frame's light (`skyLight`) and eases the exposure (time constant 1.5 s, in log
     space) and the lamps (1.2 s), landing both at once after a clock jump of more than 1,800 game
     seconds beyond the clock's own run (the dev menu);
  3. strikes the steps' lightning and takes the scene flash;
  4. aims, colours and fits the key light and its shadows, and sets the hemisphere (which carries
     the flash) and the clear colour (dark forest, lit like the ground, where nothing is drawn);
  5. builds the `SkyFrame` every effect reads (sim time, night and lamp levels, ambient light,
     flash, wind, rain and snow at the focus), writes the shared uniforms (`applyFrame`), the post
     pass (`writePost`) and the surface weather (`applySurface`), and moves the rain, the snow and
     the night lights.
- **Two clocks.** Everything that animates (the rain's and snow's fall, the clouds' drift, the
  canopies' sway, bolts, flashes) runs on sim seconds, `(Time.step + alpha) · STEP.dt`, so it
  stands still in the pause and does not run 60 times too fast with the game clock. Only the sun
  and moon, the temperature, the regimes, the wetness and the snow line follow game time.
- **Shared uniforms** (`uniforms.ts`, `SKY_UNIFORMS`): the `{ value }` cells every patched and
  glowing material holds by reference. Three gives each program its own uniforms object, so a cell
  replaced or cloned would reach no material: write `.value` only. They are `uLamps`, `uNight`,
  `uAmbient`, `uExposure`, `uTime` and the 12 surface-weather cells. `uTime` is sim seconds modulo
  600 (`TIME_WRAP`), and every sine on it turns a whole number of times in 600 s (`phaseLocked`),
  so nothing jumps at the wrap (`uniforms.test.ts` and `surface.test.ts` check every shader).

#### Lights

The light is a pure function (`light.ts`) anchored on the settled look: with the sun 50.4° up in a
clear sky it gives exactly the fixed light the game had before the day cycle (sun 0xfff0d8 × 2,
hemisphere 0xdbe8f5 / 0x9a8a68 × 1.8, exposure 1).

- **One key light**, a `DirectionalLight`: the sun, or the moon once the sun is 4° under the
  horizon (fading in by 8° under, at 0.17 × its lit fraction^1.5 when full and high). One light and
  one shadow map at every hour, so the light count, and with it every program, never changes. The
  sun's colour comes from the clear sky's optical depth along its air mass, with half the real
  dimming toward the horizon kept so the golden hour still warms the walls it faces; it sets over
  2° to −1°. A `HemisphereLight` gives the sky and the ground's bounce, by keyframes of the sun's
  elevation from −18° (night) to 30° (the settled noon).
- **Its aim moves in steps** of 0.75° (every 3–4 real seconds at the normal clock), so hard shadow
  edges do not crawl; a clock jump lands at once. `keyDirection` maps it into three space untouched
  by the view's yaw: the settled rule that the sun stays where it really stands.
- **Shadows are cast from at least 20° up** (`SHADOW_FLOOR`) while the colour follows the true
  elevation: long low shadows stay legible and inside the streamed chunks, and at 15° a shadow edge
  across a wall broke into light dashes. The shadow pass is skipped (`shadowMap.autoUpdate =
  false`) while the key light times its share through the clouds is under 0.002, on a moonless
  night or under a full overcast: the costliest GPU item, saved without a recompile.
- **Clouds take the direct light only where their shadows fall** (the surface shader), so the key
  light keeps the clear sky's intensity and a cloudy sky keeps its sunny gaps. `Lighting.direct`,
  `throughClouds(cover)`, is the mean share through the clouds: it sets the irradiance, the
  exposure, the lamps, the fog's light and the shadow skip.
- **The exposure** is a partial adaptation, (settled noon / clear sky now)^0.6 × (clear sky /
  weather-dimmed sky)^0.15, clamped to 1…4; a flash never moves it. The lamps come on as the light,
  relative to the settled noon, falls from 0.125 to 0.08 (about 10 minutes after sunset), in a
  thunderstorm and in thick fog.

#### Post pass

The atmosphere (`post.ts`) runs per low-resolution texel in the blit, after the outlines: the
orthographic camera makes each texel's world point exact from the depth texture, so the fog is
world-locked and costs no extra texture taps.

- **Fog**: the valley fog and the hill cloud of the sim's `fogLayers`. A point is veiled along 60 m
  of view ray plus its depth past the focus plane, at most 0.6 at the focus plane, rising to 0.92
  400 m deeper, and thinned to 0.45 of itself within 6–50 m of the player, so the player and the
  road ahead stay readable in the thickest fog. It is lit as a level face of albedo `PALETTE.fog`:
  the key light as it falls on level ground through the clouds (a low sun only grazes its top),
  plus 0.8 of the sky and 0.2 of the ground's bounce.
- **Haze** from the rain and snow falling at the focus, more on ground deeper than the focus plane.
- **Exposure**, then two grades: an overcast or rainy sky's flat light takes colour out (up to 0.4
  overcast and 0.2 in rain), and at night dark texels move toward a scotopic blue (tint 0.66, 0.9,
  1.6 at weight 0.8). Both spare bright texels, so lamps, lit windows and what they light keep
  their colour.
- **The limit**: a texel past full brightness in any channel is scaled down whole, so it keeps its
  hue (at a night's exposure of 4 a lamp's pool would clip from amber to pale lemon).

At exposure 1, with no fog, haze or grade, every texel within full brightness is left exactly as
it was, so the outlines, the texel snapping and the integer upscale stay exact
(`pipeline.test.ts`).

#### Surface weather

The lit world's materials are patched once into six weather variants (`surface.ts`), and every
effect is driven by the shared uniforms, never by a `#define` flipped at run time, so the weather
never recompiles a shader.

| Material | Variant | Draws | Weather on it |
|---|---|---|---|
| `solidMaterial` | `solid` | buildings, bridges, the ballast bed, platforms, canopies, name boards, crossing housings, tunnel portals, the lamps' iron and poles | snow, wet darkening, cloud shadows |
| `terrainMaterial` | `terrain` | the terrain | snow, wet darkening, cloud shadows |
| `decalMaterial` | `road` | roads, sleepers and rails, crossing panels and stop lines, platform lines | snow (0.6 of it), wet darkening, puddles, cloud shadows |
| `waterMaterial` | `water` | rivers, streams | the level and the current's streaks the rivers run at, rain rings, cloud shadows; no snow, no darkening |
| `treeMaterial` | `tree` | the instanced trees | snow on the canopy tops, wet darkening, cloud shadows, sway |
| `actorMaterial` | `actor` | people, animals, vehicles, tyre marks, smoke | cloud shadows only |
| `bloodMaterial` | `actor` | blood pools, pulled toward the camera like the decals | cloud shadows only |

- `onBeforeCompile` replaces each anchor chunk exactly once (it throws on a missing or repeated
  anchor) and `customProgramCacheKey` returns `weather-<variant>`, so each variant is one program.
  Only the key light is clouded (`directLight.color *= weatherSun`), never the hemisphere or the
  night lights. The terrain and the solid variant differ only in how the see-through cut takes
  them ([See-through cut](#see-through-cut)).
- The snow cover and the wetness are the sim's (`groundAt`): the snow edge's lattice hash and value
  noise are ported to 32-bit unsigned GLSL, with the sim's `EDGE`, `FEATHER`, `MELT_BAND` and
  `MELT_FULL` written into the shader text, so the white edge on screen is where the tyres lose
  grip. On the GPU the edge came within 2 mm of the sim's over 65,536 map points;
  `surface.test.ts` holds the key GLSL lines verbatim and checks a line-for-line port against the
  sim.
- Snow settles only on faces flatter than `ROCK_NORMAL_Y` (0.64, `terrain.ts`), the slope the
  terrain paints as bare rock, so cliffs stay bare.
- Rivers and streams left the decal mesh for their own layer (`RibbonSpec.flowing` in `ribbons.ts`),
  cut by the same chunk rule, so a chunk still equals a cut: water takes no snow and no wet
  darkening. Its vertices lie on the bed and carry `stage` and `flow` (`WaterTriangles` in
  `geometry.ts`); `uRiverStage` (q^0.547) lifts them to the rivers' level and `uRiverSpeed`
  (q^0.453) carries the streaks, both written by `applySurface` from `SkyViewModel.flow`.
- Cost: +0.015 ms a render at Monzone with snow, wet, clouds and wind on (0.25–0.27 ms against
  0.24–0.26 ms unpatched, 640 × 317 target, about 92 draw calls).

#### Night lights and glow

Night is lit by a fixed pool of real lights and by unlit glowing materials, all made before the
first frame.

- **The light pool** (`night-lights.ts`): 4 `SpotLight`s for headlight beams (the first follows the
  player's car, the others the nearest cars with lamps on, taken within 80 m and kept to 110 m) and
  8 `PointLight`s under the street lamps nearest the focus (taken within 60 m, kept to 80 m). The
  sky host's constructor makes them, and they are never added, removed or hidden after: the light
  counts are in every lit program's key, so changing one would recompile everything, a frame
  hitch. An unused light has intensity 0; none casts shadows; a light hands over to another car or
  lamp only after fading out over 0.35 s.
- **The glow layer** (`Sink.glow`, `glow.ts`): half the windows of homes (a hash per window) add a
  0.56 × 0.9 m pane, while sheds, garages, barns, farm outbuildings, building sites and greenhouses
  keep their shutters closed; each lantern adds its glass. One glow mesh per chunk, unlit
  (`glowMaterial`, reading `uLamps`, `uAmbient` and `uExposure`), casting no shadow. By day the
  panes are not drawn at all (under `uLamps` 0.02), so the windows keep their settled daytime look;
  lit, their colour is divided by the exposure, so a window shines as bright at dusk as at
  midnight. The whole map holds 21,201 lit panes and 3,096 lantern-glass quads.
- **Street lamps** (`lamps.ts`): the map has no lamp data (two `street_lamp` nodes in the raw OSM),
  so wall lanterns are placed from `MAP` at load: along tertiary, unclassified, residential and
  service roads, about every 28 m, on a house wall that fronts the road within 6 m, with at least
  four buildings within 40 m, the bracket 4.5 m up between two windows: 492 lamps. After them
  come the platforms' 24 pole lamps (`platformLamps` in `src/render/stations.ts`,
  [Track and stations](#track-and-stations)), each `StreetLamp` saying which (`kind`: `wall` or
  `pole`), so the glow and the light pool read one list: `streetLamps()`, 34–37 ms on first use;
  `lampsIn` (32 m cells) finds them for the light pool. Bracket, cap, lantern body and foot are
  solid, a pole lamp's grey pole and bracket too; the glass glows.
- **Vehicle lamps** (`actors.ts`): head and tail lamps are a per-model shared child mesh of the
  body (the Ape and the truck have them too), never disposed with a node;
  `vehicleLampMaterials.on` and `.off` share one program, and `DrawSky` picks one per car each
  frame.
- **A train's windows** (`train.ts`, `glow.ts`): every car's window band carries a pane on each
  side, standing out of the body between the side's livery and its doors (so a door keeps its
  own), in the cool white of the saloon's LED light (`cabinLit`); the cab's windscreen and side
  window, the driver's, stay dark. `cabinLightMaterial` is on the lamp program with `uPane` 1:
  under `uLamps` 0.02 it is not drawn, as a house's panes are not, so by day the body's own dark
  window band shows; lit, its colour × `uLamps` × 1.2 (a pane's gain) over the exposure. One more
  draw per car at night.
- **Signal lamps** (`glow.ts`): a train's head and tail lamps and a level crossing's arm lamps
  and road lights shine by day too, so they take `signalLampMaterials`. A lamp shines with
  `uOn · max(uLamps, uDay)` over its day look, its colour × ambient × `uPaint`. `uDay` and `uPaint`
  are uniforms of each material (`uDay` 0 on the vehicle lamps, 1 on the signal lamps), not
  `#define`s, so all five lamp materials (the train's windows too) are one program
  (`uniforms.test.ts`). By day a lit signal
  lamp is its colour × (0.7 × ambient + 3), past full brightness, so the post pass dims it whole and
  keeps its hue: a lit red lamp shows (255, 72, 63) on screen at noon and at night alike. An unlit
  one is dark glass, × 0.25 × ambient (a car's unlit lamp keeps the 0.7 of its paint): a
  trailing cab's unlit head lamps show (134, 132, 127) at noon, where at 0.7 they showed (199,
  197, 189), a white dot as bright as a lit one (255, 252, 242). No light is added: a train's beam
  borrows the headlight pool, and the crossings' lights are emissive only.

#### Rain, snow and lightning

Precipitation and bolts are scene objects the sky host makes, drawn after the world.

- **Rain and snow** (`precipitation.ts`): static buffers of 12,288 one-texel streaks and 36,864
  one- to two-texel flakes (0.84 MB), anchored to the world on the camera plane and wrapped by the
  vertex shader in a box around the focus (the widest zoom's view plus 4 m a side, in 16 m steps),
  so nothing is uploaded per frame and zooming never reshuffles them. The count shown is the draw
  range, from the mm/h at the focus; the fall is integrated on the CPU in float64 from sim seconds,
  slanted by the wind. Over the widest 1080p view the buffers keep thickening past the heaviest the
  weather sends on high ground, 30 mm/h of water: rain to about 57 mm/h at 16:9 and 38 at 21:9,
  snow to about 54 and 33. The flakes are laid in order, so snow under about 11 mm/h (6.5 at 21:9)
  draws only the first 16,384, as before the buffer grew. In this orthographic view rain falls in
  front of what it falls on, so the drops ignore depth.
- **Bolts** (`lightning.ts`): a fixed pool of 3 `LineSegments` in an HDR colour, depth-tested but
  writing no depth; each channel is drawn from its flash's seed and timed at the event's
  `step · STEP.dt`. The scene flash is one smooth pulse per flash, carried by the hemisphere, and a
  new pulse waits at least 0.4 s after the last, so the screen never flickers (WCAG 2.3.1). Under
  `prefers-reduced-motion` the bolt does not flicker and the flash is halved. An in-cloud flash
  draws no bolt, only the flash, and may lie off the map (`terrainY` clamps its ground).

#### Shader warm-up and draw order

Every program is compiled before the first frame, and every transparent object has a fixed draw
order.

- `PixelView.compile(scene, extra)` binds the HalfFloat target, then compiles the scene and the
  stand-ins (`src/render/stand-ins.ts`): one tiny mesh per material the world and the actors draw,
  the blood pools' `bloodMaterial` included, built as the real meshes are (vertex colours; a tree
  instanced with instance colours; a car with its lamps off and its x-ray box shown, since a node
  builds its proxy only the first time it shows one, a mesh with lamps on, and meshes with the
  signal lamps on and off), never drawn and freed after. A train needs nothing more: its bodies,
  lamps and x-ray boxes use materials the stand-ins hold, so one first met mid-game compiles
  nothing. The level crossings' nodes are in the scene from the start (`makeEffects`). Without
  the target bound, each program compiled as an sRGB-output twin no frame uses (26 programs at
  ready), and the real one again at the first draw. `stand-ins.test.ts` fails when a material a
  world build, an actor, a driven train with its lamps both ways or a crossing lit and dark draws
  is missing from the stand-ins.
- Transparent objects draw in an explicit `renderOrder` (`DRAW_ORDER` in `src/render/order.ts`),
  so their order never depends on three's sort by distance: tyre marks 0, smoke (tyres, engines,
  blasts) and the x-ray proxies 1, a wreck's flames and a blast's flash 2, a blast's fireball and
  embers 3, bolts 4, rain and snow 5.
- 19 programs at "Press any key", still 19 after 15 s behind the houses with the see-through cut
  open (18 before the cut's terrain variant, still 18 after a blast beside the player in a night
  storm; 10 before the day cycle; 16 with it before the wrecks and blasts, still 16 after a tour of
  the map's corners, Monte Sagro and Viano at every hour and regime, bolts and a night drive):
  `weather-solid`, `-terrain`, `-road`, `-water` and `-tree`; `weather-actor` four times (people, animals,
  cars, trains, the crossings' arms and blood pools; marks with vertex alpha; instanced smoke; a
  blast's instanced debris); the glow and lamp materials (the vehicle and signal lamps share one);
  rain and snow; the bolts' line material; the fire (a wreck's flames, a blast's flash, fireball
  and embers); the x-ray; two depth programs; the blit. All but the blit write linear colour into
  the target.

#### Measured

Measured in headless Chrome (ANGLE Metal, 1280×720, seed 42, dev server), against `main` before
the day cycle:

| Measure | Day cycle | Before |
|---|---|---|
| "Press any key", warm server | 686–751 ms over 8 loads | 687–828 ms over 4 loads |
| programs at ready / after 60 s | 16 / 16 | 10 / 10 |
| JS heap after GC, after 60 s | 99.3 MB, a night storm | 97.2 MB, a clear noon |
| draw calls a frame (scene and blit) | 40, a night storm | 52, noon |
| 60 s of frames | 60 fps, worst 16.8 ms: a settled storm at 23:00, 5 mm/h, lamps on, 10 flashes with bolts | 60 fps, worst 16.8 ms: a clear noon |

A four-minute night drive in the storm also held 60 fps with no frame over 16.8 ms. In Node, 83
chunk builds swept through Monzone take 0.92 ms on average and 2.6 ms at worst, against 0.88 and
2.3 ms before the glow and water meshes and the lamps. With the rivers' level and current (the
water ribbons over the whole bed, with their own attributes), the 121 chunks within 640 m of Monzone
station build in 0.40 ms on average and 2.05 ms at worst, against 0.38 and 1.59 ms before (Node,
the third pass); a minute of a spate on the Lucido with the player swimming in it holds 60 fps
with no frame over 16.8 ms, 19 programs and 72 draw calls (headless Chrome, seed 1).

## Audio

The audio schedule (`src/audio/index.ts`) is host code beside render. Its one system,
`Lunigiana/Hear`, reads the player, the vehicles that run, move or burn (with the revs and load the
sim's drivetrain gives for their `Chassis`, speed, pedal and `Damage` at the `Time` step, and
whether their wheels are down), the people on foot (who they are, their mood and who they walk
with), the animals, every train car by car (its power packs' revs and load from `trainRevs`, its
brakes, its cab and which cars stand in a tunnel), the `LevelCrossings` (whose bells ring, by
`crossingAt`), the `Impact`, `Skid`, `Honk`, `Cry`, `Lightning`, `Explosion` and `Whistle` events (a
hit with a train in it rewritten as bodies the director knows, `railImpact`), the horn key, the
view's turns (the stereo image turns with the screen), the game clock (the Rome day, the time of day
and the sun's elevation, `skyAt`) and a copy of the `Weather`, and hands them as plain `Heard` data
to the `Audio` service. `main.ts` provides the director (`src/audio/director`, plain TypeScript),
which works out the weather at the ears with the sim's `conditionsAt`, runs the outdoor acoustics,
holds each thunder until its sound arrives, and drives the Web Audio speaker
(`src/audio/speaker.ts`) and its synths (`src/audio/synth`). The speaker starts its AudioContext on
the first key, click or tap once it exists (made during the last loading steps, so normally the one
that dismisses the title card), and suspends it while the full map or the settings are open or the
tab is hidden. In dev builds `gta.audio` exposes the speaker, its output level and the context.
Everything else is in [audio.md](audio.md).

## HUD

The HUD (`src/hud`) is plain DOM over the canvas, with its markup in `index.html`. It reads only
the `PlayerView` and `SkyView` inspectors (`src/sim/views.ts`, `hud.update(view, x, y, angle,
yaw, sky)`) and the map; the handling store also reads the `HandlingView` inspector, the dev
sky store `SkyView`, and the dev trains store `TrainView`:

- `PlayerView` returns a `PlayerViewModel`: previous and current pose, velocity, mode (`foot`,
  `driving`, `down`, `dead`), the driven vehicle's label and speed (`kind: "train"` for a train,
  its speed toward the active cab's way), driving a train the cab's ground (`z`, the rail head
  there, m a.s.l.), the vehicle or train in reach (label, occupied by a driver, stolen), and the
  view's quarter turns. The `Score` is not in it: the HUD shows no score until its design is settled.
- `TrainView` (`src/sim/rail/view.ts`) returns a `TrainViewModel` for the dev trains store, which
  the debug menu's Trains area and `gta.trains()` read: per line the seconds until its next train
  may enter (null when none is due) and the end it enters from; per train its id, label, line, s,
  speed, facing, its AI driver's state, the station it calls at next (or stands at), who drives it
  (`ai`, `player` or `none`) and whether it is stolen; per crossing its centre, road, whether it is
  a foot crossing, its phase and what it shows (`crossingAt`).
- `SkyView` returns a `SkyViewModel`: the game time (`seconds`) and `rate`, the Rome wall clock at
  that time (`local`), the `Weather` value, its seed and day plan included, and what the rivers
  carry (`flow`, m³/s per km² of catchment). Host code calls the
  sim's pure sky functions on it itself (`conditionsAt`, `sunOver`, `describeWeather`, `regimeAt`,
  `untilChange`), so the HUD reads the weather as the physics and the sound do; the month's odds
  are module content, which the menu reads with `oddsAt` at `place()`'s latitude.
- The clock and weather readout (`src/hud/clock.ts`, `.when` in `index.html`): `#hud-clock`, a
  `<time>`, shows Rome's time as a 24-hour "HH:MM" (`clockText`), and `#hud-weather` (`lang="en"`)
  the sim's word for the weather where the player stands and the air's temperature at the ground
  under them, to the whole degree ("Rain · 9 °C", `weatherText`). The ground's height is looked up
  with the place names, after 2 m of movement; the DOM is touched only when a text changes; neither
  is a live region, so screen readers are not told every minute. The top row is a three-column
  grid (`.top`: place, clock, and an empty right column), so the clock stays at the screen's
  centre and a long road name wraps in its own column. At 600 px wide or less the clock moves to
  the top-right corner; under 360 px the clock keeps its narrowest width and the road name may
  break inside a word.
- Killed (mode `dead`), the HUD darkens the screen, the minimap included, and shows "Sei morto"
  (`#hud-wasted`, an alert, so screen readers announce it), fading in over 1 s (at once under
  `prefers-reduced-motion`), until the player is back at the start; the touch controls hide all but
  ↺ and ↻, as on a keyboard only Q and E still act on the game; the full map (M, or a tap on the
  minimap) and the settings (Esc) still open.
- `boardingAt` (`src/sim/rail/boarding.ts`: the vehicle in reach by `vehicleInReach` in
  `src/sim/body.ts`, else the nearest train door in reach from the player's `Footing`) answers both
  the HUD prompt and the `EnterExit` action, so the prompt never offers something the key will not
  do; so does `boardable` for getting out of a train, which only slower than 1.5 m/s lets the player
  out. The touch controls' action button shows the prompt's verb (`actionFor` in `src/hud/hud.ts`).
- Location: the name of the nearest road within 15 m, if it has one (tracks and paths skipped,
  so an unnamed road never borrows a side street's name), and the district disc from `districtAt`.
  Looked up again only after moving 2 m.
- The minimap is drawn once to an offscreen canvas and then blitted around the player, 300 m
  across, turned with the view so that screen-up is up. At 0.3 px/m, the minimap's own scale (90
  canvas px over 300 m, so the blit is 1:1), the whole map is 2340 × 3000 px (7 MP, 28 MB): under
  every browser's canvas limit (the strictest, Safari's, is 16.7 MP). Drawing it takes ≈ 15 ms at
  load; the per-frame blit ≈ 1 ms. hud.css shows its 90 px at 180 CSS px (120 in mobile mode),
  and a click or tap on it opens the full map.
- The full map (`src/hud/worldmap.ts`, `#hud-map` in `index.html`): the key labelled M toggles it
  (matched by the character it types, so AZERTY works; non-Latin layouts fall back to the key's
  position) and Esc closes it; repeats and Ctrl/Cmd/Alt chords are ignored. A click or tap on the
  minimap opens it, one on the map closes it. It paints the whole area north-up at the resolution of
  its own box (the page's, which a phone held upright lays out sideways) with the same layers as the
  minimap (`paintMap`), but roads light and at least 1.5–2 px wide so the network reads. It names
  the OSM villages (big, placed first) and hamlets (`place=*` POIs, localities left out), then the
  peaks that are HUD landmark districts (Monte Sagro, Pizzo d'Uccello...), once per name; a label
  that would overlap another or the north arrow is dropped with its dot. The player is a red arrow
  in a red ring (no label is red), drawn on its own canvas over the map so CSS blinks it (steady
  under `prefers-reduced-motion`), with a 1 km bar and the player's district in the header. It is
  repainted on open, on resize, and when the pixel ratio changes. The dialog takes focus when it
  opens, so screen readers announce its title and the district. The data credits (`.credits`)
  show along its bottom edge; hud.css hides them while the map is closed, so play keeps a clear
  screen.
- The settings (`src/hud/settings.ts`), in every build: Esc opens and closes them, except that
  Esc closes the full map first while it is open, and does nothing on the title card. In mobile
  mode the pause button (`#hud-pause`, II, top right) opens them, and Resume
  closes them; the button gives up focus before the dialog opens, so closing it does not leave
  focus on the button for Space (the handbrake) to click again. A phone's short screen scrolls
  them, so mobile mode sets them in smaller type and keeps Resume stuck to their bottom edge: on an
  844 × 390 screen the presets alone overflow it. They pause
  the game as the map does, the last frame drawn dimmed behind them (drawn again when the window
  is resized). Their Gameplay section holds "Vehicle physics": a radio button for each preset
  (`HANDLING_PRESETS`, with its description), the current one checked, and none with a Custom note
  when the knobs match no preset ([gameplay.md](gameplay.md#presets)). The data credits close
  the dialog, below Resume.
- The handling store (`src/hud/handling.ts`) holds the player's handling for the settings and the
  debug menu, so both show the same choice: it sends each change as `SetHandling` events and
  keeps it in `localStorage` under `gta-lunigiana/handling`. A preset is stored by its name, so a
  preset retuned in a later build reaches the player; knobs set by hand are stored as the knobs.
  At load it sends the stored handling before the first step.
- While the full map or the settings are open the host pauses the game: the FixedLoop keeps
  running, but `pausable` (`src/hud/hud.ts`) skips the sim update and `main.ts` skips the frame
  (no world render, so actors do not jitter between `PrevPose` and `Pose`, and no audio tick) and
  suspends the AudioContext (`speaker.pause`). With no update the game clock stops too. Each
  skipped update drains the controls' press edges, keys and touch, so a key tapped on the map (F,
  Enter) does nothing on resume, while a key held through the pause is still held.
- The debug menu exists in dev builds only: `main.ts` loads it inside its `import.meta.env.DEV`
  block, beside the Ritmo monitor, so production builds leave it out. P or the Debug button beside
  the Ritmo monitor's (bottom left; under the minimap in mobile mode, off the touch controls and
  the clock) opens and closes it, and keys pressed inside it do not reach the game.
  `src/hud/debug.ts` is the shell (the panel, its keys and styles, focus on the first control at
  open); it holds four areas, each a `section` under an h3 heading, whose readouts refresh in an
  animation-frame loop that runs only while the menu is open and never moves a focused slider or
  date input:
  - Time (`debug-sky.ts`): the rates Stopped, Normal (a game minute a second), ×10 and ×60, a
    time-of-day slider, a date, and Sunrise and Sunset buttons from the sim's `sunTimes`, with the
    sun and moon read out.
  - Weather (`debug-sky.ts`): Auto and a button for each regime (`REGIME_SPECS`), "Settle now",
    readouts of the regime (and when the day's plan next changes it, `untilChange`), the air, the
    ground, the snow line, the wind and the sky where the player stands, and the weather seed in
    hex (`seedText`); then an Odds group, an h4 headed with Rome's month ("Odds (October)"), a line
    naming the map's latitude, and one row per `DayOdds` field from `oddsAt` through `oddsReadout`,
    snowfall at the player's ground height ([weather.md](weather.md#the-hud-and-the-dev-menu)).
    Over the paused map a regime sent but not yet taken reads "(on resume)".
  - Handling (`debug-handling.ts`, [gameplay.md](gameplay.md#handling)): a button for each preset,
    Custom shown when the knobs match none, and a control for every knob. It reads the handling
    from the store, not from the game: the game applies a `SetHandling` event only on its next
    step, and not while the full map or the settings pause it, so reading the game could show and
    store a stale value. What it sets goes through the store, so the settings show it and a reload
    keeps it.
  - Trains (`debug-trains.ts`): "Call trains now" (`#debug-trains-call`, the trains store's
    `call`), then readouts of each line, named by its first and last stations, with when its next
    train is due (in real seconds) and the end it enters from, named by the station nearest it;
    each train by its entity id, with its model, line, km along it (on a run-out, how far short of
    its start or past its end), speed forward or backing up, the end it faces, who drives it (an
    AI driver and its state, the player, or no one), whether it
    is stolen and the station it calls at next or stands at; and each level crossing by its road,
    with its phase, its arms' share down, its road light and its bell. Nothing in it names a line,
    a station or a crossing of this map: they come from `MAP.railway`, `LINES` and `TrainView`.
- The sky store (`src/hud/sky.ts`, dev builds only) holds the clock and the weather for the debug
  menu and for `gta.sky` in the console, so each shows what the other set. It checks a request as
  the sim does (`setClock`, `isRegime`), sends `SetClock` or `SetWeather`, and shows what it sent
  only until the game has stepped (the game takes requests on its next step, and not while
  paused), then the game's own state, whoever set it: the host holds the clock behind the title
  card, so it reads Stopped there. `heading()` is the regime the weather moves toward: the one held,
  else (Auto) the game's, or, while a hand-back to Auto has not been taken yet, the day's plan's
  regime now (`regimeAt`); "Settle now" sends one request, `{ regime, settle: true }` with the
  regime held, or in Auto `{ regime: null, settle: true }`, which hands the weather back to the
  day's plan settled on its values. It stores nothing: the clock and the weather are saved sim
  state.
- The trains store (`src/hud/trains.ts`, dev builds only) holds the railway for the debug menu's
  Trains area and for `gta.trains` in the console: `now()` reads `TrainView`, and `call()` sends
  `SetTrains`. Until the game has stepped (the view reads saved state only, so it changes only on a
  step) `now()` shows the call taken, each line it reaches with its next train due now, by the rule
  `ApplyTrains` applies (`takesCall` in `src/sim/rail/dispatch.ts`); so over the paused map the
  menu shows the trains called. It stores nothing: the service is saved sim state.
- Mobile mode: an inline script in `index.html`'s head marks the page `touch` when a touch screen
  is the main pointer (`(pointer: coarse)`), before the first paint, so the title card shows right.
  hud.css then shows the touch controls and a smaller HUD (the minimap top left, the pause button
  top right, the speedometer
  and the full map's credits between the left controls and the right ones) and hides the key
  prompt: the action
  button shows its verb, without the vehicle. The card trades its key list for three touch hints and
  "Tap to play", and hides on the tap's click, not its press, so the click cannot land on the
  minimap under it. The keyboard keeps working. In headless Chrome emulating an 844 × 390 phone at 3× on an M4
  Pro, the view is 633 × 293 texels and runs at 60 fps with no frame over 30 ms while the stick is
  held; no real phone has been measured.
- Touch controls (`src/hud/touch.ts`, `#hud-touch`): Ritmo's `Touch` tracks the fingers on the
  canvas. On foot, a thumb on the left half brings the stick under it (full tilt at 56 px), and
  Run shows on the right. In a car the stick goes, and buttons hold the arrow keys like the
  keyboard: ◀ and ▶ on the left steer, Gas and Brake take the bottom right, and Hand brake, the
  action button and Horn a row above them. In a train, which has no steering, ◀ and ▶ hide
  (`draw` sets `data-vehicle` to the view's vehicle `kind`, and hud.css hides `.steer` under
  `train`); the rest stay. The action button shows only when it would act; ↺ and ↻ only out of a
  car (driving, the view follows it). The zones are read from the drawn buttons on every snapshot
  and every new touch, so they follow hud.css, the mode and the vehicle: a control they hide is
  `null`, and `Touch` lets go of it under a thumb that stays down, so its key releases once.
  `withTouch` turns them into keys ([Input](#input)).
- Landscape only: a phone held upright lays the page out sideways (`width: 100dvh`, the height
  Safari's toolbars leave) and turns it a quarter clockwise, to be held sideways (hud.css). The
  renderer and the full map size to the page's box, not the window, and each touch is turned back
  through the inverse of the page's transform about its origin (`unturn`) before `Touch` reads it.
  The settings dialog opens in the top layer, which the page's turn does not reach, so it turns
  on its own.
  On the first tap's click, `holdLandscape` asks for the full screen and then locks the screen to
  landscape, which Android grants; iPhones grant neither to a page, so the page turns itself there.
  It waits for the click because the full screen uses up the tap's user activation, which the
  speaker needs first, on the `touchend`, to start the sound.

## Checks

`pnpm check` runs the format, type, lint and test gates in that order; CI runs each as its own
step, and git hooks run the first three before a commit or push.

- `oxfmt --check` (`.oxfmtrc.json`): no semicolons, double quotes, 100 columns, sorted imports,
  over the code, JSON, YAML, HTML and CSS. Markdown is skipped: oxfmt pads every table cell to
  its column's width, which turns the docs' long tables into rows hundreds of characters wide,
  and the docs keep their own wrapping (see CODING_STANDARDS.md). `pnpm format` rewrites the
  files.
- `tsc`: strict TypeScript with `noUncheckedIndexedAccess`, no emit.
- `oxlint --deny-warnings --report-unused-disable-directives` (`.oxlintrc.json`), type-aware
  through `oxlint-tsgolint`:
  - the `correctness`, `suspicious`, `perf` and `pedantic` categories as errors, minus the rules
    whose fix would change behaviour (`| 0` wraps to int32 in the seeded generators,
    `Math.trunc` does not), that misread the code's idioms, or that only restyle it; each turned
    off with its reason beside it in the config;
  - a few style rules on top: `eqeqeq`, `prefer-const`, `object-shorthand`, `prefer-template`,
    inline `type` imports, `no-explicit-any`, `prefer-optional-chain`, `prefer-nullish-coalescing`
    (a string's `||` still treats `""` as absent), `switch-exhaustiveness-check`,
    `import/no-cycle` and `node:` imports;
  - `max-lines` at 700 code lines a module (tests exempt);
  - `node:test`'s `test` and `describe` may float their promises; any other promise is awaited or
    `void`ed;
  - the Ritmo plugin everywhere: `handle-tick-result`, `prefix-descriptor-and-system-names`,
    `use-cell-value`;
  - the project's own plugins in `lint/`, one file each, named after its plugin (a unique name,
    never a shared project-wide one): `test-files/in-tests-folder` (`lint/test-files.ts`) fails a
    `*.test.ts` that does not sit directly in a `__tests__` folder;
  - in `src/sim/**`: `use-clock-for-time`, `use-random-for-randomness`, `use-ops-for-math`,
    `keep-simulation-headless`, `no-infinity-in-simulation-data`, and a ban on importing
    `render`, `hud`, `audio` or `main.ts`;
  - in `src/audio/**`: a ban on importing `hud` or `main.ts` (they wire the audio host, never the
    reverse).

  A rule broken on purpose takes an `oxlint-disable-next-line <rule> -- <reason>` comment.
- `ritmo-devtools lint src/lint.ts`: loads `lintTarget` and lints the `setup`, `update` and
  (described, not run) `render` and `audio` schedules. Any warning fails: without the audio schedule
  described, `Cry`, which no sim system reads, would be `event-never-read` (`CrashDamage`,
  `Perceive` and `Startle` read `Impact` in `update`, `Perceive` and `Animals` read `Honk` and
  `Whistle`, which the audio's `Hear` reads too; `Lightning` has two readers, the render's `DrawSky`
  and the audio's `Hear`). `lintTarget` declares
  `SetHandling`, `SetClock`, `SetWeather` and `SetTrains` host events (`hostEvents`), since only
  the host sends them; undeclared they would be `event-never-written`. It also fails if a module the
  sim loads is not covered by the oxlint simulation override.
- `node --test` over every `*.test.ts` in `src` and `lint`. A test lives in a `__tests__` folder
  beside the module it tests (`src/sim/route.ts` is tested by `src/sim/__tests__/route.test.ts`;
  `test-files/in-tests-folder` enforces it). Beside the unit tests, these guard the architecture:
  - `determinism` (`src/sim/__tests__/index.test.ts`): `Determinism.check` runs a 600-frame scripted
    joyride twice, with the handling off its real values (`SetHandling`), the clock at ten game
    minutes a step (`SetClock { rate: 600 }`: 100 game hours of weather, its days planned from the
    weather seed, the roads wetting and drying under the car), a car crashing into a house wall to
    drive on misfiring and a wreck blowing up beside a passer-by, and requires identical state,
    transient components included. Its cast reaches the population's state: a mother, her son and
    their dog on a lead come on a man lying dead (shocked, they run), and a cat sits across the
    street.
  - `saves`: a snapshot taken mid-joyride, with a changed handling, the clock at rate 600 and a
    forced, settled thunderstorm, goes through JSON, restores into a fresh runtime, and plays on
    identically for 1,200 frames, its lightning included (some, and the same); so does one taken
    while a walker stands shocked by a body (a `Witness`), whose choice to gather or run comes out
    alike. `src/sim/__tests__/animals.test.ts` replays a walk about a farm with its animals, and
    restores animals mid-roam and a save taken in the step a car strikes a dog, the cat by it
    scared in that step (`Startle`).
  - `src/sim/__tests__/sky.test.ts`: the clock in the runtime (08:00 in Rome on the start day, each
    step's rate, none at rate 0, through a save), `SetClock` and `SetWeather` sent before the first
    update still applied, a forced storm's lightning (bolts on the map, with the clock stopped, the
    same in the same game), the weather seed kept through a save and replaying the same days, the
    seed alone planning the days whatever the storms drew, the weather's stream never reaching
    traffic or pedestrians, and a car braking further on a wet road.
  - `src/sim/sky/__tests__/*.test.ts`: the calendar (every day from 1900 to 2100, the summer-time
    switches), the sun and the moon against JPL Horizons and USNO, the national normals, the odds
    and the day plan against their tables (300 years at 38, 42 and 45.5 N), the weather as it falls
    against the table and the snow targets (30 years, `calibration.test.ts`), the weather's steps,
    ground, fog, wind, storm cell and lightning, and the readout's words; `mapfree.test.ts`: the
    schema, the train models and the map-free sky modules decode no map, and once the map is decoded
    `place()` is its origin, its 5th-percentile height and its slope.
  - `src/sim/__tests__/trains.test.ts`: the service (a new game's train dwelling at the station
    nearest the start and its body passing the line's point nearest the start within 2 minutes, for
    seeds 1–8; a train running the whole line both ways, calling at every station within 3 m of its
    stop on dry and wet rail and under snow, never reaching a road box before its arms are down,
    laying over and removed the step it runs past the drawn run, whistling for the long tunnels;
    keeping 30 m behind a train ahead, and dropping back to it from 15 m behind a moving one; the
    dispatcher waiting for its braking distance clear, 1 m either side of it, and stopping behind on
    its plan; `SetTrains`, a call sent before the first update applied after another schedule's
    tick; a dwell held while the clock stands), Via Riolo's cycle for a train leaving Monzone, a
    train standing short of an open box closing it and waiting where it stands, one past its hold
    point never on the road before the arms are down, one standing 900 m out demanding the box from
    its strike-in and never braking for it, no train past its run-out's end and dry rail in tunnels,
    `RailRng` never reaching traffic, people or `Rng` (with other dwells, and with no trains at
    all), a `Determinism.check` over 60 s of the whole `update` on a staged map (a train leaving
    Monzone over the crossing through its whole cycle, one arriving at a station, one whistling into
    a tunnel), and a save taken while the arms come down playing on alike. Its long runs step the
    railway alone (`railStep` in `src/sim/rail/testing.ts`). Beside it, with the whole `update`:
    `trains-traffic.test.ts` (a queue at Via Riolo's closed box clear of the box and of the junction
    before it, patient, and a walker holding short of the track, all going on once it opens; a queue
    for a box a standing train holds down honking 6 s after 120 s, and a walker there going another
    way after them; keep-clear at an open box, and of a car standing on the road's axis past the box
    with the widest lanes, no car at cruise standing on the track; the warning's gentle stop or
    clearing; no car onto the track from Via Riolo's south-east arms, the arms down or no room past,
    nor a truck from the north-west at 13 m/s), `trains-strikes.test.ts` (a car struck at 80 km/h
    wrecked and thrown off; a car into a standing train taking a wall's hit; the player sprinting
    into a standing train's side stopped, not knocked down; a train creeping into a car pinned under
    the road bridge shoving it unharmed, one at 6 m/s wrecking it with two hits in all; a car shoved
    against a wall beside the track (`BESIDE_WALL`) scraped past at a walk, unwrecked and never hit;
    a man on the track running off at the alarm and the train stopping short; a train held for a car
    sounding the horn 10 s, keeping the box ahead down and creeping on; the player stepping on and
    off the track's edge in front of a held train hearing its alarm every 2 s, never two at once;
    someone too near struck, the player killed and back at the start; a `Determinism.check` over 20
    s of a train held, striking and wrecking a car, and a save taken mid-hold playing on alike) and
    `trains-world.test.ts` (a car and a walker under the two rail bridges by Monzone as with no
    train; a swimmer under the Aulella's rail bridge in a spate as with no train; the player on the
    track over a road tunnel struck, and a man there held for; walking in along every road into the
    road tunnels under the line (`UNDERPASS_WAYS`), the footing their floor under the track, and the
    player there not struck by a train passing over; walking down a road onto a level crossing
    (`DOWN_TO_BOX`), struck by a train passing over; animals brought out along the whole line, none
    on its track at grade; a cow over the tunnel unmoved and one beside the track at grade running
    from the train's body and from a whistle, a cow keeping to its side of the track for 3 minutes,
    and traffic, people, animals and `Rng` the same with a train far off as with none) and
    `trains-driving.test.ts` (the player's train, driven with `liveKeys`, keys a test plays as it
    goes, through `start`'s `keys`, or seated aboard with `aboard`: a train stolen at Monzone, its
    driver running from the cab's other door; the lever forward ringing Via Riolo's bell before the
    train moves; an AI train boarded at its far cab with its active cab on a bridge, its driver out
    of the far one; driven to the next station and stopped on its platforms, backed up no faster
    than 30 km/h and boarded at its far cab; no getting out above 1.5 m/s, over a stream or inside a
    tunnel's mouth, where the player goes through to the far cab, and stepping down at grade over a
    road underpass and under a road bridge; the view's ground on the highest rail bridge; SCMT
    stopping it at the buffer stop, and one too fast striking it; a train driven into an AI train,
    running or dwelling, both stopping; a stolen train left removed once out of view and its line's
    next train due; a knockdown scored; a save taken while driving playing on alike; and a
    `Determinism.check` over 30 s of the theft and the drive). `src/sim/rail/__tests__/*.test.ts`:
    the lines (their s, run-outs from the end speeds, points, speed limits, `linesNear`, stops,
    shared track over three synthetic lines, one stretch over their joints), the cars on their
    pivots, the crossings' cycle, demand and strike-in (`barriers.test.ts`), the boxes, their lines
    at grade and their approaches with a second box on one road (`crossings.test.ts`), the train's
    dynamics against the FSE poster's figures, the AI driver's stops and limits, and in
    `service.test.ts` a map whose second line runs the first's track the other way round: every box
    closing for either line's trains, an AI train keeping behind the other line's, and the
    dispatcher keeping an entry clear of it on their shared run-out, and the two lines' trains
    meeting on it, two AI trains running at each other both stopping 30 m apart, the dispatcher
    holding a train back from the other line's running at its end, a new game standing their first
    trains on platforms apart and the same way, with no hit and nobody face to face in its first 15
    min, and two trains overlapping over a piece joint pushed apart just to touch; boarding and
    getting out (`boarding.test.ts`), SCMT, the end stops and trains meeting (`collisions.test.ts`);
    the trains as bodies, fouling the track and the animals' side (`bodies.test.ts`), the look-out's
    reach, its held states and its alarms at least 2 s apart, held again and again for someone
    stepping on and off the track included (`lookout.test.ts`), the crossing rules for traffic, a
    car already braking stopping at 6 m/s² in the warning and one too fast for the line holding
    short of a full way in's junction included (`roads.test.ts`), and the senses with the train's
    death curve (`senses.test.ts`).
  - `src/sim/__tests__/handling.test.ts`: each handling knob's effect, the weather grip loss's
    included (a Panda brakes about 1.3 times further on a wet road and 3 times on packed snow, and
    turns its wheels less at speed; at 0 the weather changes nothing), each preset's behaviour, and
    `SetHandling` kept in range and through a save.
  - `src/sim/__tests__/walls.test.ts` (traffic): a driver stops for a car standing across its lane,
    backs up short of the car queued behind, waits for a car beside its front as it steers back
    into its lane, backs up straight past a car alongside, and keeps slower and further back on a
    wet road.
  - `src/hud/__tests__/handling.test.ts`: the handling store (what it stores, restores and
    sends); `src/hud/__tests__/settings.test.ts`: the settings' keys (Esc on to the router, every
    other key kept from the game) and the preset they show (Custom for a hand-set mix);
    `src/hud/__tests__/hud.test.ts`: the Esc and M routing (`overlayKey`), the pause, and a
    train's prompt as a car's, offering to get out only below `BOARD_SPEED`;
    `src/hud/__tests__/touch.test.ts`: the stick and buttons as keys, a hidden control letting go
    of its key, and in a train only ◀ ▶ hidden (read from hud.css and
    index.html, and marked by `draw` on the controls, `data-vehicle="train"`).
  - `src/hud/__tests__/trains.test.ts`: the trains store (a call shown taken until the game steps,
    by `takesCall`, and over a real game read as the game holds it after the step);
    `src/hud/__tests__/debug-trains.test.ts`: the Trains area's texts (lines and their ends named
    by their stations, waits, trains, crossings).
  - `src/hud/__tests__/clock.test.ts`: the clock's and the weather's texts;
    `src/hud/__tests__/sky.test.ts`: the sky store (clamped as the sim clamps, what it sent shown
    until the game steps, Auto heading for and settling on the day's plan, the title card's hold);
    `src/hud/__tests__/debug-sky.test.ts`: the menu's rates and readouts, the odds and seed texts,
    the odds readout equal to `oddsAt`, and the regime's countdown;
    `src/hud/__tests__/title.test.ts`: the clock held behind the title card while the world moves
    on.
  - `src/render/__tests__/index.test.ts`: every system of every described schedule (`render`,
    14 systems, and `audio`) declares no writes; a detached node frees its frames, pool and
    proxies, not a vehicle's or a train's shared bodies; people, animals, vehicles, trains and the
    crossings' arms draw with the actor material; traffic and the player's car shine and get the
    headlight beams, parked cars stay dark; the player's and an AI train shine, the player's beam
    in the driven slot from its leading nose, its x-ray shown and the cut at its cab, a train left
    alone dark; a crossing drawn as `LevelCrossings` has it at the drawn moment, step plus alpha.
  - `src/render/__tests__/train.test.ts`: every car on the rail head under its pivots at grade, on
    the highest deck and round the sharpest curve, both ways; the train's s blended, never the
    cars' poses; the same cars with the cab facing either way; the head lamps at the leading nose
    and the tail lamps at the trailing one, none on a train left alone; the x-ray boxes trimmed and
    open at the joints; a train node frees only its x-ray boxes.
  - `src/render/__tests__/crossings.test.ts`: a barrier and a road light per way in at each road
    box, none at the foot crossing; the arms standing up open and in the warning, across the road
    to the left of the way in closed, at 45° halfway; a demand while they rise lowering them from
    where they stood; the lamps and lights lit from the warning until the arms are up; the skirt
    plumb at every angle and folded flat standing up.
  - `src/render/__tests__/rail.test.ts`: a chunk build of the track and stations keeping exactly
    its cut of the whole-map build; nothing 3D in a crossing's carriageway and the bed stopping a
    metre short of it; each panel, its rails and the stop lines over the road ribbon, and no
    road's centre dash under a panel; sleepers and rails at reading widths; the bed's top within
    0.15 m of the terrain on 90 % of the line at grade; a portal at every tunnel mouth, facing out
    of the hill; each arm hinged on its housing and the road light's plate behind its lens, all
    clear of the trains.
  - `src/render/__tests__/stations.test.ts`: the platforms' tops following the rail profile,
    their yellow lines, nothing standing in a train's way, one name board per platform people wait
    on, the platform lamps, a canopy only where a platform runs along a station building, and no
    render code naming a station.
  - `src/render/__tests__/atr220.test.ts`: no piece of an ATR 220 car's side, its livery's
    patches included, painted twice over itself.
  - `src/render/sky/__tests__/*.test.ts`: the light (the settled look at 50.4°, the key's aim and
    floor, clouds taking the sun only under their shadows), the post pass against a mirror of its
    GLSL (fog, grades, the limit), the surface shader's key lines verbatim and its port against the
    sim's snow cover and wetness (its melt band's straight line equal to `celsiusAt`), the host (the
    shadow skip, the fog's colour, the puddles' mirror, the key fixed in the sky at four yaws, the
    sun and the moon over the loaded map's place), the lamps' placement and lanterns, the bolts and
    the flash's limits, the drop counts and wrap (both buffers under their cap at 30 mm/h), the
    light pool, the phase-locked sines, and every lamp material, a vehicle's or a signal's, one
    program with its own day term; in `src/render/__tests__/`, `stand-ins.test.ts`: every material a
    world build, the actors, a driven train and the crossings draw has a stand-in;
    `pipeline.test.ts`: `compile` builds into the scene's target; `actors.test.ts`: the vehicle
    lamps and the x-ray's yellow; `buildings.test.ts`: lit panes on homes only; `world.test.ts`: the
    glow and water meshes; `index.test.ts`: no x-ray in the water, a swimmer floating at its
    shoulders; `sightline.test.ts`: a person behind a house near the spawn, under a tree's crown or
    under the ground is hidden, the player at the spawn is not, a hill hiding a road says where it
    meets the line, and the cut's easing, hold, radius, ground depth, reduced motion and sim time
    going back.
  - `src/sim/map/__tests__/map.test.ts`: invariants of the generated map (see [map.md](map.md)).
  - the audio tests, in Node without Web Audio (see [audio.md](audio.md#tests)).

Git hooks come from `lefthook.yml`; `pnpm install` installs them (lefthook's own install script,
allowed in `pnpm.onlyBuiltDependencies`). Before a commit, `oxfmt` rewrites the staged files and
stages the result, with any unstaged edits to them held aside, then `oxlint` checks them. Before a
push, `pnpm format:check`, `pnpm typecheck` and `pnpm lint` run in parallel; the tests are left to
CI. `git commit --no-verify` skips the hooks, never CI.

`src/sim/testing.ts` is the headless test kit: `start(timeline, staging, { alone, trains, keys })`
makes a runtime with scripted keys (or `keys`, a source the test plays as it goes) and collects
every `Impact`, `Honk`, `Cry`, `Lightning`, `Explosion` and `Whistle` emitted (`heard`); it has no
train unless `trains` (it ticks `noTrains`, from `src/sim/rail/testing.ts`, before setup: every
line's service off, so setup stands no train and no test meets one it did not ask for; the direct
`makeRuntime` tests by the line tick it too); with `alone`, whatever `Populate` brings is despawned
the step it comes, so a staged scene plays out undisturbed. `stage` clears the map (vehicles,
trains, people and animals) and places exactly the cars, trains, pedestrians, animals, bodies lying
dead and parties with their followers a test needs (`battistiTraffic(color, at?, speed?)` a traffic
car on Via Cesare Battisti), `wear` sets every vehicle's damage, `burning` makes a wreck that blows
up at a given step, `World` inspects everything as plain data (each person's look, mood, route,
leader, `Down`, `Dead` and `Witness`, each animal, the handling, the damage, the clock, the weather
and the world's random stream, `rng`, and through `TrainWorld` the trains, whether stolen,
`Railway`, `LevelCrossings` and `RailRng`), `LOOK` is a test person, `facing` places things in front
of a house wall on Via Cesare Battisti, and `drive` steps one vehicle with `advance` alone (test
ground, no walls) under a given handling, its engine worn as given, on ground as wet and snowy as
its `weather` (dry when omitted); after `stage` a game started with `trains` runs only the cast's
trains until a `SetTrains`, since setup's first trains are gone and no line has another due.
`src/sim/rail/testing.ts` adds `placeTrains` (replace every train), `railStep` (the railway's
systems alone, in `update`'s order), `groundTo` (wet or snowy ground everywhere), `setCrossing(box,
state)` (a box's cycle), `aiTrain(s, dir, v?, until?)` (an AI train on Monzone's line, running or
dwelling), `crossedBy(box, line)` (where a box crosses a line), `wayInto(box, approach)` (the tabled
traffic step farthest back into a box and the one leading into it), `liveKeys()` (keys held, let go
and tapped as a test goes, for `start`'s `keys`), `aboard` (the player seated in the first train's
active cab), `atDoor(s, facing, end, side)` (where someone stands to board at a cab door) and the
fixtures `MONZONE` (the station nearest the start), `RIOLO` (its level crossing), `RAIL_BRIDGE` (the
line's highest bridge), `LOW_BRIDGE` (its longest over a stream, the ground beside on the rail's
level), `TUNNEL_MOUTH` (3 m inside a portal whose cutting is on the rail's level), `UNDER_ROAD`
(at grade under the road bridge by Equi Terme), `OVER_ROAD` (at grade over a road tunnel, the
pedestrian underpass at Equi Terme), `BESIDE_WALL` (the first two stretches at grade with a wall
3.3–5 m off the centreline) and `UNDERPASS_WAYS` (every way on foot along a road into a road tunnel
under the line, to under the track), found by geometry. `src/sim/scene.ts` holds the
reaction tests' scenes on Via Cesare Battisti and a `start` on a seed of the test's choosing, so a
rule that rolls dice is checked over several rolls.
