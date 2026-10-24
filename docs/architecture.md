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
`seed ^ 0x9e3779b9`), `Score` (zeroed), `View` (home view), `Handling` (a new game's knobs,
`DEFAULT_HANDLING`: the Balanced preset), `GameClock` (`start` at rate 1), `Weather`
(`initialWeather(start, weatherSeed)`, `weatherSeed` being `WeatherRng`'s first state: clear and
calm, dry ground, the season's snow line, and a calm plan the first step draws that holds clear for
90 game minutes, so the tests' first 600 steps stay storm-free) and `Input` (idle keys).

- `start` is the game time a new game begins at, in whole Unix UTC seconds: a fraction fails to
  decode and no runtime is made. Without it the game starts at `DEFAULT_START`, 1792648800
  (2026-10-22 08:00 CEST), so tests replay the same day.
- The weather draws from its own stream so that it never changes traffic, people, animals or
  parking. mulberry32 runs through every 32-bit state in one cycle, so the two streams are one
  sequence at an offset the seed sets: at least 7,179 draws apart over all 2³² seeds, and at least
  1.2 million for seeds 0–200,000. Only the storm cell and its lightning draw from `WeatherRng`;
  each day's plan comes from the weather seed (kept in `Weather.seed`) and the day alone, so a
  storm never changes the days after it.
- The clock, the sun and moon, the climate and the weather are pure functions in `src/sim/sky/`
  ([weather.md](weather.md)). The host calls the same functions to draw, play and show them, so the
  snow it draws is the snow the tyres feel.

### Schedules and system order

`setup` runs once after the runtime is made:

1. `SpawnWorld` (`systems/spawn.ts`): the player and the parked cars on 200 of the map's parked
   spots (`PARKED`), the two Carabinieri cars included.
2. `ApplyHandling` (`index.ts`)
3. `ApplyClock` (`index.ts`)
4. `ApplyWeather` (`index.ts`)
5. `applyDeferred`
6. `FillPeople` (`systems/populate.ts`): the first fill, as many people out around the player's
   start as `Populate` keeps, from 4 m to 120 m ([gameplay.md](gameplay.md#the-first-fill)).
7. `FillAnimals` (`systems/populate-animals.ts`): the animals `PopulateAnimals` keeps there. It
   asks for the farms first, so the farm list is built here, behind the title card, not in a step
   of play.
8. `applyDeferred`

The three apply systems run here once, before any request exists, so they are listening when the
host first sends: a request sent before the first `update` (the host re-sending the player's
stored handling at load, or holding the clock behind the title card) would otherwise be dropped by
whichever schedule ticked first.

In Node, setup takes about 12 ms once the land cover is built, as `main.ts` builds it first (the
farm list about 9 ms of it); a test that has not built the cover pays for it here too, about
109 ms. Setup draws from the world's `Rng`, so the fill replays with the seed.

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
| 8 | `AdvanceClock` | `systems/sky.ts` | moves `GameClock` on by its rate (a game second a step at rate 1); at rate 0 it stands still, unwritten |
| 9 | `AdvanceWeather` | `systems/sky.ts` | over the step's game seconds, draws the day's plan from the weather seed when a new Rome day begins (at rate 0 only that), moves toward the regime it sets for the hour and eases `Weather` toward it, wetting, drying, snowing and thawing the ground; over its real time, drifts a thunderstorm's cell and emits `Lightning`, drawing from `WeatherRng` |
| 10 | `EnterExit` | `systems/enter-exit.ts` | action key: enter, steal, carjack, get out |
| 11 | `applyDeferred` | | applies the enter/exit commands, so the blast knows who sits in which vehicle |
| 12 | `Explode` | `systems/explosions.ts` | lights a burning wreck's fuse; a wreck whose fuse has burnt down blows up (`Explosion`): hits and shoves the vehicles near it, kills, knocks down and scares the people |
| 13 | `applyDeferred` | | applies the blast's deaths and knockdowns before anything moves |
| 14 | `PlayerFoot` | `systems/foot.ts` | player walking, sprinting, sliding when down |
| 15 | `PlayerDrive` | `systems/drive.ts` | player keys into the driven car's `CarInput` |
| 16 | `TrafficAI` | `systems/traffic.ts` | AI drivers write their `CarInput`, braking for vehicles, people and animals, slower and keeping further back where the road is wet or snowy; a driver held up honks (`Honk`) |
| 17 | `Pedestrians` | `systems/pedestrians.ts` | people move as their mood says: walk their routes, keep by their leader, stop, gather, run; the down and the dead slide |
| 18 | `Animals` | `systems/animals.ts` | animals rest, wander, keep by their walker and run from what scares them; free dogs bark; the down and the dead slide; cries are `Cry` events |
| 19 | `VehiclePhysics` | `systems/physics.ts` | every vehicle moves on its springs and tyres from its `CarInput` under the `Handling`, each tyre's grip lowered by the wet and the snow under it; wall and ground hits are `Impact` events, sliding tyres `Skid` events |
| 20 | `Contacts` | `systems/contacts.ts` | car–car, car–person, car–animal, person and animal contacts, knockdowns and deaths (`Down`, `Dead`); car–car hits, knockdowns, kills, a cow struck and a car stopped against a wall by a pinned person or animal (faster than `KNOCK_SPEED`) are `Impact` events |
| 21 | `CrashDamage` | `systems/damage.ts` | this step's `Impact` events wear the vehicles they struck (`Damage`); a traffic car destroyed is abandoned, its driver fleeing |
| 22 | `RideAlong` | `systems/drive.ts` | the driving player takes the car's pose and motion |
| 23 | `Recover` | `systems/contacts.ts` | knocked-down people and animals get up, never the dead; pedestrians then flee, animals bolt |
| 24 | `Perceive` | `systems/perceive.ts` | pedestrians take in this step's hits, crashes and horns, and the vehicles, bodies and people around them, and set their moods; cries are `Cry` events; marks `Witness`es, lets go of a leader gone or dead |
| 25 | `Startle` | `systems/animals.ts` | cats and pigs run from this step's crashes and struck bodies (`Cry`) |
| 26 | `Respawn` | `systems/explosions.ts` | the dead player comes back on foot at the start after 4 s |
| 27 | `Populate` | `systems/populate.ts` | every 0.5 s spawns and despawns traffic and parties of people (the dead beyond 140 m, like the living), and removes destroyed vehicles once out of view (`VIEW_REACH`) |
| 28 | `PopulateAnimals` | `systems/populate-animals.ts` | every 0.5 s spawns and despawns the free animals |
| 29 | `applyDeferred` | | applies spawns, despawns, inserts and removals |

Controls, the handling, the clock and the weather are settled before movement, a blast is set off
once getting in and out are applied and before anything moves, all movement happens before
contacts, crash damage is counted after both, from the same step's hits, and contacts happen
before the player's pose follows the car. The physics drives on the crash damage counted the step
before, and on a blast's in the same step. `Perceive` and `Startle` run after the contacts and
`Recover` because they read this step's `Impact` and `Honk` events, which a save does not keep:
read a step later, a restored game would miss them. The moods they set move people and animals
from the next step. `TrafficAI` and `VehiclePhysics` read `GameClock` and `Weather` and work out
the air once a step (`airAt`), so every wheel meets the wet and the snow this step's weather left,
meltwater included. Gameplay is in [gameplay.md](gameplay.md), the weather in
[weather.md](weather.md).

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
| `Dead` | the killed: pedestrians and animals a vehicle struck, people on foot by a blast, the player in a wreck that blew up | step they died (`since`); always with `Down` |
| `Animal` | animals | species (`dog`, `cat`, `cow`, `pig`), coat and patch colours, size × the species' usual (immutable) |
| `Roam` | animals | mood (`idle`, `walk`, `flee`), the step it ends, home (hx, hy), and the point (tx, ty) it walks to or runs from |
| `Vehicle` | vehicles | model and paint colour (immutable) |
| `CarInput` | vehicles | throttle, steer, handbrake for this step |
| `Chassis` | vehicles | centre-of-mass elevation and vertical speed, pitch and roll with their rates, road-wheel steering angle, gear, step the current shift ends |
| `Damage` | vehicles | share of its durability its crashes used up (0 as new, 1 destroyed); its latest crash's hardest hit (barrier-equivalent m/s), first step and what it struck (another vehicle's or an animal's entity id, −1 a wall or the ground); the step its fire blows it up (`fuse`) and whether it has (`exploded`) |
| `Traffic` | AI vehicles | tag |
| `Route` | traffic, pedestrians | current graph edge, direction, lateral offset (a follower's is its leader's) |
| `Autopilot` | traffic | next edge, stuck counter, reverse end step, unstick tries |
| `Stolen` | vehicles | tag: already entered once by the player |
| `Driving` | the player | handle of the vehicle being driven |

`Schema.requires` enforces the bundles: a `Player` has a pose, previous pose, motion and look; a
`Pedestrian` the same and a `Route`; an `Animal` a pose, previous pose, motion and `Roam`; a
follower a pose, previous pose and motion; a `Witness` is a `Pedestrian`; a `Vehicle` has a pose,
previous pose, motion, `CarInput`, `Chassis` and `Damage`; `Traffic` also needs `Route` and
`Autopilot`; the `Dead` are always `Down`. Spawns put a vehicle on its springs at rest on the
ground (`settle` in `src/sim/chassis.ts`), in the gear for its speed, undamaged. No save is ever
persisted, so the new and reshaped state (`Chassis`, `Damage`, `Dead`, the wider `Person` and
`Pedestrian`, `Handling` with its `weatherGrip` knob, `GameClock`, `WeatherRng` and `Weather`)
needs no snapshot migration.

Saved resources:

| Resource | Holds |
|---|---|
| `Time` | the fixed step's count and length (Ritmo's clock) |
| `Rng` | the world's random stream: traffic, people and animals, parking |
| `WeatherRng` | the weather's own random stream: the storm cell and lightning (its first state is the weather seed) |
| `Score` | `stolen`, and `knocked`: people the player's car knocked down or killed |
| `View` | `turns`, the net quarter turns of the camera; driving, the seat nearest the car's heading |
| `Handling` | the 16 handling knobs ([gameplay.md](gameplay.md#handling)) |
| `GameClock` | `seconds`, the game time in whole Unix UTC seconds, and `rate`, the game seconds each step adds: 1 in play (a game minute per real second, a 24-minute day), 0 standing still, up to 3600 from the dev debug menu |
| `Weather` | the weather `seed` (never changed); the `regime` it moves toward and whether it is `forced`; the eased `cloud`, `precip` (mm/h at sea level), `storm`, `wind` (on the map's low ground) and `windAngle`, `gust`, `fog` and temperature `anomaly`; the ground's `wet` and `snowLine` (m a.s.l.); the storm cell's centre (`cellX`, `cellY`); and the day's `plan` (its Rome `day`, whether `drawn`, `from` when it holds, `wet`, a wet day's `event`, `intensity`, `start`, `end` and `precip`, the `sky`, a dry day's `fog` until `lift` and strong wind from `windyFrom` to `windyTo`, and the `airMass`; times in seconds since the Rome day's midnight) |

`Input` is transient: it is rebuilt every step and never saved.

Events are transient too. `Impact` (a vehicle hit a wall, another vehicle, a person, an animal or
the ground: where, which is the contact point for a wall, a vehicle or the ground, how hard, with
how much mass in tonnes, for the ground which face of the body struck, and for a person or an
animal whether it killed them, `fatal`), `Skid` (a tyre slid this step: where, how fast, how far
past its grip, on what surface, how snow-covered), `Honk` (an AI driver held up sounds the horn),
`Cry` (a person or an animal cried out: who, where, and in `fright`, `shock`, `anger` or
`surprise`), `Lightning` (a thunderstorm's flash this step: a ground strike or a flash in the
cloud at x, y, its power 0…1, the seed of its bolt and its thunder, its step) and `Explosion` (a
burning wreck blew up: which, of what model, where) carry moments. `VehiclePhysics`, `Contacts`,
`TrafficAI`, `AdvanceWeather` and `Explode` emit the hits, skids, horns, flashes and blasts;
`Perceive`, `Animals` and `Startle` emit `Cry`. The audio schedule reads all six
([audio.md](audio.md#data-flow)), and the render schedule reads `Skid` (tyre marks and smoke),
`Lightning` (the bolt and the flash) and `Explosion` (the blast). In `update`, `CrashDamage` reads
`Impact` later in the same step, `Perceive` this step's `Impact` and `Honk` events, `Startle` this
step's `Impact` events and `Animals` the `Honk` events since its last run: these are the only
traces an event leaves in the components (`Damage`, and the moods and `Witness`es it sets). An
in-cloud flash may lie off the map; a bolt never does. Three events are host intents, which no
system emits and the host sends with `runtime.send`:

- `SetHandling` (set one handling knob to a value): the host's handling store
  (`src/hud/handling.ts`) sends it for the settings and the dev debug menu; `ApplyHandling` reads
  it.
- `SetClock` (set the game time and/or its rate): the host sends it to hold the clock behind the
  title card (`holdClock`, see [Host loop](#host-loop)), and the dev sky store for the debug menu;
  `ApplyClock` reads it.
- `SetWeather` (force a regime, or `null` to hand the weather back to the day's plan, `settle` to
  jump to its steady state): the dev sky store sends it; `ApplyWeather` reads it.

Snapshots hold no events: `CrashDamage`, `Perceive` and `Startle` read each `Impact`, and
`Perceive` each `Honk`, in the step it is emitted (`thisTick`), so a snapshot between steps loses
none and a restored save plays on alike.

Static data is module content, not state. `MAP` and `graph` (`src/sim/map/index.ts`), the wall,
tree, building and edge lookups, the per-model lane tables in `src/sim/route.ts` and the per-model
rigs in `src/sim/chassis.ts` (`RIGS`: static wheel loads, springs, inertias, steering lock, tipping
threshold) are built once at load and never change, so they are safe to share between runtimes.
A rig under a handling off its real values (`rigFor`) is a pure function of the model and the
`Handling`, derived on first use and cached (the whole cache empties once it holds 64 rigs, 16
for each of the four models), so it is safe to share too.
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
- `groundZ` (`src/sim/map/ground.ts`) is where every wheel, foot, sound source and drawn actor
  stands, in m a.s.l.: the terrain as its mesh is drawn (each 4 m cell split along its SW–NE
  diagonal), at-grade roads `ROAD_LIFT` above their profile (blended where several overlap, so a
  junction's ground stays continuous where their profiles disagree), and bridge decks and tunnels
  kept to the level nearest the caller's previous height. Road segments are bucketed in 16 m
  cells at load. The renderer converts it to render y (`src/render/ground.ts`).

The population's tables are static data too, pure functions of `MAP` shared by every runtime: the
residents of each home and within 60 m of each walk edge, and the walk edges people live along
(`residentsNear`, `residentsAlong`, `peopledIndex` in `src/sim/population/density.ts`), built at
load; the 2,405 farms in a 64 m grid (`farmsNear` and the ground checks in
`src/sim/population/farms.ts`), built on first use, which `setup` makes (about 9 ms in Node with
the land cover built); and the residents ahead of each way out of a junction (`nextWalkEdge` in
`src/sim/route.ts`), cached as walkers first reach it.

Host state stays in the host: the camera, the render clock, the three.js scene and nodes, the
streamed world's chunks, the tyre marks and smoke, the wrecks' smoke and flames, the sky host (its
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
   from a key. Only the controls shown in the player's mode count: one the mode hides under a
   thumb that stays down (the stick on getting in, ◀ on getting out) lets go of its keys.
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
   card: the land cover (`mapCover`), the world (`new World`, which places the street lamps), then
   the HUD, the runtime, `setup` (about 12 ms in Node: the farm list and the first fill), the
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
first steps' `Impact`, `Honk`, `Cry`, `Skid`, `Lightning` and `Explosion` events. Each animation
frame it:

1. writes the loop's `alpha` (fraction of a step since the last one) into `RenderClock`;
2. ticks the `render` and `audio` schedules (`runtime.tick(render, audio)`); the render's `DrawSky`
   hands the sky host the clock, the weather, the steps' lightning and the cars with lamps on, and
   its `FollowPlayer` hands the see-through cut the player as drawn;
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

The render schedule (`src/render/index.ts`) uses `@typeonce/ritmo-render`. Its eleven systems run
in this order: `SyncPeople`, `SyncAnimals`, `SyncVehicles`, `MarkDriven`, `PlacePeople`,
`PlaceAnimals`, `PlaceVehicles`, `SpreadPools`, `DrawEffects`, `DrawSky`, `FollowPlayer`.

- `SyncPeople`, `SyncAnimals` and `SyncVehicles` (`RenderSync.system`) keep one three.js node per
  entity with a `Person`, an `Animal` or a `Vehicle`, in the `People`, `Animals` and `Vehicles`
  node registries (the services `Lunigiana/PeopleNodes`, `Lunigiana/AnimalNodes` and
  `Lunigiana/VehicleNodes`, which `makeRegistries` makes in `main.ts`). A detached node frees what
  it owns: its frames, its blood pool and its x-ray proxies; a vehicle node frees only its proxy,
  since its body is shared per model and paint. A person in a car is hidden. `SyncPeople` hands
  each node the person's mood, speed (from `Motion`, so a follower catching up is drawn running)
  and the sim time, and lays it down while `Down` or `Dead`; `SyncAnimals` hands on the speed and
  lays the animal down. A vehicle that has blown up (`Damage.exploded`) shows a charred shell
  (`vehicleBody` in `src/render/actors.ts`): its body's geometry with every vertex colour turned to
  its luminance and blended 90% toward `PALETTE.outline`, cached per model and paint like the
  intact one and never disposed.
- `MarkDriven` shows the x-ray silhouette (drawn only where the world hides the actor) on the
  player's car and no other vehicle. `SyncPeople` shows it on the player's figure. Its yellow is
  divided by the post pass's exposure, as the lamps are, so it stays the same yellow at night as at
  noon (at a night's exposure of 4 it would clip to lemon).
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
- `SpreadPools` spreads each dead body's blood pool under its node as placed this frame (below).
- `DrawEffects` reads the `Skid` and `Explosion` events since the last frame and every vehicle's
  `Damage`, and feeds the effects host (`makeEffects` in `src/render/index.ts`, made in `main.ts`
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
- `DrawSky`, last in the schedule so the cars stand where they are drawn, hands the sky host
  (the `Sky` service, [The sky](#the-sky)) the game time blended at the render alpha
  (`seconds + alpha · rate`), the clock's rate, the `Weather`, the sim time
  (`(Time.step + alpha) · STEP.dt`) and every `Lightning` since the last frame. It switches every
  car's lamps, on in traffic and in the player's car, off when parked (a destroyed traffic car is
  abandoned, so its lamps go out; `SyncVehicles` hides a charred shell's), and hands the sky the
  cars whose lamps are on, for the headlight beams.
- `FollowPlayer`, after the placing systems, hands the see-through cut (the `Cut` service,
  [See-through cut](#see-through-cut)) the player as drawn: on foot their figure's feet and height
  (0.5 m lying), driving their car's ground (`cg` under the node) and its spec's height; with no
  player it shuts the cut. Like every render system it writes nothing:
  `src/render/__tests__/index.test.ts` counts the schedule's 11 systems and checks their declared
  access.

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
(buildings, roofs, bridges, platforms, the street lamps' iron and lantern bodies), a decal mesh
(roads, rail), a water mesh (rivers and streams), a glow mesh (lit window panes and lantern glass)
and one `InstancedMesh` per tree kind; the water and glow meshes exist only where the chunk has
some. A 192 m apron of extra chunks continues the terrain, lines and trees beyond the map
bounds. Terrain cells take their colours from the land cover (`src/sim/map/cover.ts`, painted by
`COVER_LOOK` in `src/render/terrain.ts`): the
map's areas, meadow where none covers a cell, paving where open ground lies within 3 m of both a
wall and a road's edge (house fronts, sidewalks, alleys), and pebble beds along the wide streams.

Streaming:

- `new World(scene)` prepares, once (216–222 ms in Node for the whole valley, three runs; 189–195 ms
  before the street lamps): the land-cover raster
  for the whole map (`mapCover()` in `src/sim/map/cover.ts`, ≈ 105 ms and 4.9 MB, cheaper than
  clipping areas per chunk; built on first use and shared read-only with the sim's surfaces and the
  audio host), the street lamps (`streetLamps()`, 31–33 ms on first use), every
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
  toward its target.
- The key light (the sun, or the moon at night) stands on its real arc for the game time over the
  map's origin, turned with the view's yaw ([Lights](#lights)): in the home view it stands where it
  really is, and a turn carries it round with the camera, so the lit and shaded wall faces look the
  same whichever way the camera looks. Its shadow box follows the view, snapped to shadow-map
  texels. The box
  covers the ground the view shows (`shadowFit`): a 5 × 5 grid of rays across the view is marched
  down to the terrain, because a slope falling away from the camera shows ground far past the flat
  rectangle (at most 300 m across the light) and a valley seen between the view's edges can lie
  hundreds of metres deeper along the light. Its depth also reaches 1.5 km toward the sun for the
  ridges that shade a valley. The depth bias stays 0.45 m whatever the depth range.
- The far plane is 3 km from the camera (2.5 km past the focus): from the Apuan summits the
  deepest ground in view is ≈ 2.45 km from the camera, past the 1 km the plane used to stop at.

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
  edges do not crawl; a clock jump lands at once. `keyDirection` turns it about the vertical by the
  view's yaw: the settled rule that the sun turns with the view.
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
| `solidMaterial` | `solid` | buildings, bridges, platforms, the lamps' iron | snow, wet darkening, cloud shadows |
| `terrainMaterial` | `terrain` | the terrain | snow, wet darkening, cloud shadows |
| `decalMaterial` | `road` | roads, rail | snow (0.6 of it), wet darkening, puddles, cloud shadows |
| `waterMaterial` | `water` | rivers, streams | rain rings, cloud shadows; no snow, no darkening |
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
- Rivers and streams left the decal mesh for their own layer (`RibbonSpec.layer` in `lines.ts`),
  cut by the same chunk rule, so a chunk still equals a cut: water takes no snow and no wet
  darkening.
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
  midnight. The whole map holds 21,201 lit panes and 2,952 lantern-glass quads.
- **Street lamps** (`lamps.ts`): the map has no lamp data (two `street_lamp` nodes in the raw OSM),
  so wall lanterns are placed from `MAP` at load: along tertiary, unclassified, residential and
  service roads, about every 28 m, on a house wall that fronts the road within 6 m, with at least
  four buildings within 40 m, the bracket 4.5 m up between two windows. 492 lamps, placed in
  31–33 ms on first use; `lampsIn` (32 m cells) finds them for the light pool. Bracket, cap,
  lantern body and foot are solid; the glass glows.
- **Vehicle lamps** (`actors.ts`): head and tail lamps are a per-model shared child mesh of the
  body (the Ape and the truck have them too), never disposed with a node;
  `vehicleLampMaterials.on` and `.off` share one program, and `DrawSky` picks one per car each
  frame.

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
  builds its proxy only the first time it shows one, and a mesh with lamps on), never drawn and
  freed after. Without the target bound, each program compiled as an sRGB-output twin no frame
  uses (26 programs at ready), and the real one again at the first draw. `stand-ins.test.ts` fails
  when a material a world build or an actor draws is missing from the stand-ins.
- Transparent objects draw in an explicit `renderOrder` (`DRAW_ORDER` in `src/render/order.ts`),
  so their order never depends on three's sort by distance: tyre marks 0, smoke (tyres, engines,
  blasts) and the x-ray proxies 1, a wreck's flames and a blast's flash 2, a blast's fireball and
  embers 3, bolts 4, rain and snow 5.
- 19 programs at "Press any key", still 19 after 15 s behind the houses with the see-through cut
  open (18 before the cut's terrain variant, still 18 after a blast beside the player in a night
  storm; 10 before the day cycle; 16 with it before the wrecks and blasts, still 16 after a tour of
  the map's corners, Monte Sagro and Viano at every hour and regime, bolts and a night drive):
  `weather-solid`, `-terrain`, `-road`, `-water` and `-tree`; `weather-actor` four times (people, animals,
  cars and blood pools; marks with vertex alpha; instanced smoke; a blast's instanced debris); the
  glow and vehicle-lamp materials; rain and snow; the bolts' line material; the fire (a wreck's
  flames, a blast's flash, fireball and embers); the x-ray; two depth programs; the blit. All but
  the blit write linear colour into the target.

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
2.3 ms before the glow and water meshes and the lamps.

## Audio

The audio schedule (`src/audio/index.ts`) is host code beside render. Its one system,
`Lunigiana/Hear`, reads the player, the vehicles that run, move or burn (with the revs and load the
sim's drivetrain gives for their `Chassis`, speed, pedal and `Damage` at the `Time` step, and
whether their wheels are down), the people on foot (who they are, their mood and who they walk
with), the animals, the `Impact`, `Skid`, `Honk`, `Cry`, `Lightning` and `Explosion` events, the
horn key, the view's turns (the stereo image turns with the screen), the game clock (the Rome day,
the time of day and the sun's elevation, `skyAt`) and a copy of the `Weather`, and hands them as
plain `Heard` data to the `Audio` service. `main.ts` provides the director (`src/audio/director`,
plain TypeScript), which works out the weather at the ears with the sim's `conditionsAt`, runs the
outdoor acoustics, holds each thunder until its sound arrives, and drives the Web Audio speaker
(`src/audio/speaker.ts`) and its synths (`src/audio/synth`). The speaker starts its AudioContext on
the first key, click or tap once it exists (made during the last loading steps, so normally the one
that dismisses the title card), and suspends it while the full map or the settings are open or the
tab is hidden. In dev builds `gta.audio` exposes the speaker, its output level and the context.
Everything else is in [audio.md](audio.md).

## HUD

The HUD (`src/hud`) is plain DOM over the canvas, with its markup in `index.html`. It reads only
the `PlayerView` and `SkyView` inspectors (`src/sim/views.ts`, `hud.update(view, x, y, angle,
yaw, sky)`) and the map; the handling store also reads the `HandlingView` inspector, and the dev
sky store `SkyView`:

- `PlayerView` returns a `PlayerViewModel`: previous and current pose, velocity, mode (`foot`,
  `driving`, `down`, `dead`), the driven vehicle's label and speed, the vehicle in reach (label,
  occupied, stolen), the score, and the view's quarter turns.
- `SkyView` returns a `SkyViewModel`: the game time (`seconds`) and `rate`, the Rome wall clock at
  that time (`local`), and the `Weather` value, its seed and day plan included. Host code calls the
  sim's pure sky functions on it itself (`conditionsAt`, `sunOver`, `describeWeather`, `regimeAt`,
  `untilChange`), so the HUD reads the weather as the physics and the sound do; the month's odds
  are module content, which the menu reads with `oddsAt` at `place()`'s latitude.
- The clock and weather readout (`src/hud/clock.ts`, `.when` in `index.html`): `#hud-clock`, a
  `<time>`, shows Rome's time as a 24-hour "HH:MM" (`clockText`), and `#hud-weather` (`lang="en"`)
  the sim's word for the weather where the player stands and the air's temperature at the ground
  under them, to the whole degree ("Rain · 9 °C", `weatherText`). The ground's height is looked up
  with the place names, after 2 m of movement; the DOM is touched only when a text changes; neither
  is a live region, so screen readers are not told every minute. The top row is a three-column
  grid (`.top`: place, clock, score), so the clock stays at the screen's centre and a long road
  name wraps in its own column. At 600 px wide or less the clock moves under the score, in the
  top-right corner; under 360 px the score and the clock keep their narrowest width and the road
  name may break inside a word; a count never shrinks below its digits.
- Killed (mode `dead`), the HUD darkens the screen, the minimap included, and shows "Sei morto"
  (`#hud-wasted`, an alert, so screen readers announce it), fading in over 1 s (at once under
  `prefers-reduced-motion`), until the player is back at the start; the touch controls hide all but
  ↺ and ↻, as on a keyboard only Q and E still act on the game; the full map (M, or a tap on the
  minimap) and the settings (Esc) still open.
- `vehicleInReach` (`src/sim/body.ts`) answers both the HUD prompt and the `EnterExit` action, so
  the prompt never offers something the key will not do. The touch controls' action button shows
  the prompt's verb (`actionFor` in `src/hud/hud.ts`).
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
  mode the pause button (`#hud-pause`, II, top right beside the score) opens them, and Resume
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
  open); it holds three areas, each a `section` under an h3 heading, whose readouts refresh in an
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
  action button and Horn a row above them. The action button shows only when it would act; ↺ and
  ↻ only out of a car (driving, the view follows it). The zones are read from the drawn buttons on
  every new touch, so they follow hud.css and the mode, and a control the mode hides lets go of
  its key. `withTouch` turns them into keys ([Input](#input)).
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
- `ritmo-devtools lint src/sim/index.ts`: loads `lintTarget` and lints the `setup`, `update` and
  (described, not run) `render` and `audio` schedules. Any warning fails: without the audio schedule
  described, `Cry`, which no sim system reads, would be `event-never-read` (`CrashDamage`,
  `Perceive` and `Startle` read `Impact` in `update`, `Perceive` and `Animals` read `Honk`;
  `Lightning` has two readers, the render's `DrawSky` and the audio's `Hear`). `lintTarget`
  declares `SetHandling`, `SetClock` and `SetWeather` host events (`hostEvents`), since only the
  host sends them; undeclared they would be `event-never-written`. It also fails if a module the
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
    schema and the map-free sky modules decode no map, and once the map is decoded `place()` is its
    origin, its 5th-percentile height and its slope.
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
    `src/hud/__tests__/hud.test.ts`: the Esc and M routing (`overlayKey`) and the pause.
  - `src/hud/__tests__/clock.test.ts`: the clock's and the weather's texts;
    `src/hud/__tests__/sky.test.ts`: the sky store (clamped as the sim clamps, what it sent shown
    until the game steps, Auto heading for and settling on the day's plan, the title card's hold);
    `src/hud/__tests__/debug-sky.test.ts`: the menu's rates and readouts, the odds and seed texts,
    the odds readout equal to `oddsAt`, and the regime's countdown;
    `src/hud/__tests__/title.test.ts`: the clock held behind the title card while the world moves
    on.
  - `src/render/__tests__/index.test.ts`: every system of every described schedule (`render`,
    11 systems, and `audio`) declares no writes; a detached node frees its frames, pool and
    proxies, not a vehicle's shared body; people, animals and vehicles draw with the actor
    material; traffic and the player's car shine and get the headlight beams, parked cars stay
    dark.
  - `src/render/sky/__tests__/*.test.ts`: the light (the settled look at 50.4°, the key turned with
    the view at three yaws, clouds taking the sun only under their shadows), the post pass against
    a mirror of its GLSL (fog, grades, the limit), the surface shader's key lines verbatim and its
    port against the sim's snow cover and wetness (its melt band's straight line equal to
    `celsiusAt`), the host (the shadow skip, the fog's colour, the puddles' mirror, the sun and the
    moon over the loaded map's place), the lamps' placement and lanterns, the bolts and the flash's
    limits, the drop counts and wrap (both buffers under their cap at 30 mm/h), the light pool, and
    the phase-locked sines; in `src/render/__tests__/`, `stand-ins.test.ts`: every material a world
    build and the actors draw has a stand-in; `pipeline.test.ts`: `compile` builds into the scene's
    target; `actors.test.ts`: the vehicle lamps and the x-ray's yellow; `buildings.test.ts`: lit
    panes on homes only; `world.test.ts`: the glow and water meshes; `sightline.test.ts`: a person
    behind a house near the spawn, under a tree's crown or under the ground is hidden, the player at
    the spawn is not, a hill hiding a road says where it meets the line, and the cut's easing, hold,
    radius, ground depth, reduced motion and sim time going back.
  - `src/sim/map/__tests__/map.test.ts`: invariants of the generated map (see [map.md](map.md)).
  - the audio tests, in Node without Web Audio (see [audio.md](audio.md#tests)).

Git hooks come from `lefthook.yml`; `pnpm install` installs them (lefthook's own install script,
allowed in `pnpm.onlyBuiltDependencies`). Before a commit, `oxfmt` rewrites the staged files and
stages the result, with any unstaged edits to them held aside, then `oxlint` checks them. Before a
push, `pnpm format:check`, `pnpm typecheck` and `pnpm lint` run in parallel; the tests are left to
CI. `git commit --no-verify` skips the hooks, never CI.

`src/sim/testing.ts` is the headless test kit: `start(timeline, staging, { alone })` makes a
runtime with scripted keys and collects every `Impact`, `Honk`, `Cry`, `Lightning` and `Explosion`
emitted (`heard`); with `alone`, whatever `Populate` brings is despawned the step it comes, so a
staged scene plays out undisturbed. `stage` clears the map (vehicles, people and animals) and
places exactly the cars, pedestrians, animals, bodies lying dead and parties with their followers a
test needs (`battistiTraffic(color, at?, speed?)` a traffic car on Via Cesare Battisti), `wear`
sets every vehicle's damage, `burning` makes a wreck that blows up at a given step, `World`
inspects everything as plain data (each person's look, mood, route, leader, `Down`, `Dead` and
`Witness`, each animal, the handling, the damage, the clock, the weather and the world's random
stream, `rng`), `LOOK` is a test person, `facing` places things in front of a house wall on Via
Cesare Battisti, and `drive` steps one vehicle with `advance` alone (test ground, no walls) under a
given handling, its engine worn as given, on ground as wet and snowy as its `weather` (dry when
omitted). `src/sim/scene.ts` holds the reaction tests' scenes on Via Cesare Battisti and a `start`
on a seed of the test's choosing, so a rule that rolls dice is checked over several rolls.
