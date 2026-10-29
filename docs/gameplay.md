# Gameplay

All rules are simulation systems in `src/sim/systems`, and the railway's in `src/sim/rail`. The step
order is in [architecture.md](architecture.md). Units are metres, seconds and radians. One step is
1/60 s. The keys named here are the keyboard's; in mobile mode the touch controls press the same
keys ([architecture.md](architecture.md#input)).

## Start

`SpawnWorld` puts the player on the Via Cesare Battisti sidewalk in front of the Carabinieri
station. 200 of the map's parked spots (`PARKED`) get a car, picked at random, so the cars spread
over the villages as the spots do. Spots where a parked car would tilt more than 15° are skipped (72
of the 805: the 4 m terrain puts some verges on a bank), and each car settles on its springs with
the ground's slope. The two spots nearest the station get Carabinieri cars. The rest are randomly
chosen spots, about 80% Pandas and 20% Apes. On a tertiary-road spot where it fits, a roll under 10%
makes a marble truck instead, at most two of them. Then the first fill puts the people and animals
around the start out at once ([The first fill](#the-first-fill)), and each line's first train stands
at its station nearest the start ([Trains](#trains)). The world's `Rng` makes every choice but the
trains' (`RailRng`), so `?seed=N` replays the same start. The game begins on today's date at 08:00
in Rome, under a clear sky on dry roads, once the title card is dismissed; the clock, the sun and
the weather are in [weather.md](weather.md).

## The view

The camera turns a quarter at a time on foot and follows the car while the player drives.

`TurnView` (`src/sim/index.ts`) turns the camera a quarter left (Q, counter-clockwise seen from
above) or right (E), once per press, on foot. The `View` resource counts the net quarter turns. It
is saved state, because the on-foot keys follow it. In the home view (0), the camera sits
north-west of the player and looks south-east: the mountains rise to the south and east, so this
side sees every street.

Driving, the view follows the car instead: it turns with it, so the road ahead is always up the
screen, and Q and E do nothing (mobile mode hides ↺ and ↻). `TurnView` keeps `View` on the
quarter seat nearest the car's heading (`nearestSeat` in `src/sim/view.ts`, counted on from the
last seat so it winds with the car). Getting out, or killed at the wheel, the player is left in the
seat nearest where the car faced, at most 45° from its heading, and the view settles on it. Driving
keys steer the car and do not depend on the view.

The host (`src/render/swing.ts`) swings the camera through each quarter turn in about a third of a
second. Following the car it eases on a critically damped spring (`followToward`), so it never
jumps or overshoots: from rest it covers 95% of a half turn in 1.2 s, and it trails a car turning
steadily by half a second of its turn. At rest it holds still until the car's heading is 1.1°
(0.02 rad) off, so it does not creep after every wobble. Got out, the same spring settles the view
on the seat the short way round (`settleOn`), closing at least 0.1 rad/s at the end. The view
trails a turning car, so out of a car turning at 0.5–1.5 rad/s it can be 58–87° off the seat, and
it lands there within 1.7 s; until then the walking keys follow the seat, not the screen. Under
`prefers-reduced-motion` the view turns at once, except while it follows the car: it jumps onto it
on getting in, then follows on the spring, which turns it less than the car's own wobbles would.
The minimap turns with it, so its top always matches the screen; the sun stays where it really
stands, so the shadows hold still on the ground while the view turns. While it follows the car the walls lose their exact 2:1 pixel lines, which come
back once it rests on a seat.

## On foot

`PlayerFoot` (`systems/foot.ts`):

- The movement keys walk along the screen axes of the turned view (`screenAxes` in
  `src/sim/view.ts`). In the home view, up walks south-east on the ground and right south-west;
  each quarter turn of the view swings both a quarter. The body turns to face the keys.
- Walking speed is 2.2 m/s, sprinting (Shift) 5.5 m/s, with an acceleration of 30 m/s². Wet
  ground and snow slow only tyres, not feet.
- The body is a circle of radius 0.35 m. It slides along walk walls and never passes through them
  (`walkBy` in `src/sim/body.ts`). Velocity is what actually happened, so a wall stops it. Water is
  no wall.
- Knocked down, the player cannot steer and slides to a stop (10 m/s²).
- **In a river or stream** the player wades, slower the deeper it is (a sprint most of all) and
  pushed by the current, until the water reaches his chest or the current takes his feet (an adult's 1.2 m²/s of depth ×
  speed); then he swims with the current at 0.9 m/s of his own (sprinting, a hard crawl at 1.4
  m/s), and swims out wherever he heads. He never drowns. Knocked down in the water, the current
  takes him. The rivers' depth and current follow the rain ([water.md](water.md)).

## Entering, stealing, carjacking, exiting

`EnterExit` (`systems/enter-exit.ts`) handles the action key (F or Enter), once per press. A
train is boarded at its cab doors ([Driving a train](#driving-a-train)); the rest is about vehicles:

- **Enter**: on foot and standing, the player enters the vehicle whose body is nearest, within
  2 m (`ENTER_GAP`), with no walk wall in between, unless it lies on its side or roof or is
  destroyed ([Damage](#damage)), or a train's door nearer still. The HUD prompt uses the same test
  (`boardingAt`, `rail/boarding.ts`, over `vehicleInReach`), so it shows exactly what the key would
  do: `steal`, `enter` or `carjack`.
- **Steal**: the first entry of any vehicle or train scores one theft and tags it `Stolen`.
  Entering it again scores nothing.
- **Carjack**: entering a traffic car removes its AI. Its driver gets out at the first free door
  as a pedestrian, on the verge on that side, and flees for 4 s. If no door is free, no driver
  appears.
- **Exit**: the player gets out at the first free door, tried in this order: left (the driver's
  side, in Italy), right, front, back. A door is free when it is clear of walk walls with no wall
  between it and the car. If no door is free, the player stays in. The car is left with its
  handbrake on.

Entering or leaving sets the player's velocity to zero. The camera's look-ahead follows velocity,
not the pose, so the hop to the seat or the door does not swing the view.

## Driving

Every vehicle is driven by its physics, whoever is at the wheel. `PlayerDrive` maps the keys to
the car's `CarInput`: throttle = up − down, steer = left − right (left turns counter-clockwise),
and Space for the handbrake. `VehiclePhysics` (`systems/physics.ts`) moves every vehicle, player or
AI, from its `CarInput` and its model's data in `src/sim/vehicles.ts`. Nothing about the handling
is tuned per model: top speed, acceleration, braking, grip and tipping follow from the masses,
dimensions, engines, gears and tyres. The handling knobs ([Handling](#handling)) scale that data
for every vehicle alike; outside that subsection every figure here is at their real values (the
Simulation preset). A new game starts on the Balanced preset ([Presets](#presets)).

### Controls to forces

- **Steering** turns the road wheels toward the keys at 2.5 rad/s (back to straight at 4 rad/s),
  within a lock that shrinks with speed: full lock at walking pace (each model's turning radius),
  at speed just enough to turn at the tyres' grip (0.85 g × the tyres' grip factor × the share of
  their dry grip the wet or snowy ground leaves them), or at 0.6 of the sideways acceleration that
  tips the vehicle over when that comes first (the Ape ≈ 3.2 m/s², the laden truck ≈ 3.7 m/s²). A
  held key corners at about the grip limit; yanking the wheel or the handbrake can still tip the
  tippy ones. The lock follows the weather because keys steer all or nothing: on packed snow a held
  key would otherwise ask the tyres for 0.85 g of their 0.3 and slide the car straight on (a design
  call the user approved). At 15 m/s on Simulation a Panda's wheels turn 8.9° on a dry road, 0.92
  of that on a wet one and 0.66 on snow; braking, the handbrake or more speed in a bend still slide
  it.
- **Engine and gearbox** (`src/sim/drivetrain.ts`): a full-load torque curve per engine (60% of
  peak at idle, peak torque from `torqueRpm`, the rated power at `powerRpm`, a fuel cut at the
  redline) through an automatic gearbox: up at 50–92% of the redline and down at 24–42% (more
  pedal, later), never hunting, the drive cut while a shift lasts. In first gear and reverse the
  clutch slips up to idle plus the pedal's share of the launch revs. With the pedal up, the
  engine brakes. The truck's limiter holds it to 90 km/h.
- **Throttle against the motion** above 0.5 m/s is the brake pedal; slower, it drives the other
  way (reverse). Standing (under 0.5 m/s) with no pedal, the driver keeps a foot on the brake, so a
  car sat in on a hill stays put. The handbrake locks the wheels that do not steer.

### The body

`integrate` (`src/sim/dynamics.ts`) advances each vehicle in four substeps of 1/240 s:

- **Suspension**: each wheel is a spring (the body's ride frequency, 1.5–2 Hz) and a damper
  against the ground under it (`groundZ`: the drawn terrain, station platforms and road ribbons,
  blended where a junction's ribbons overlap, see [map.md](map.md#known-data-limitations)), plus a
  bump stop past 0.1 m of travel and anti-roll bars, stiffer at the front so cars understeer at the
  limit.
  The body pitches when it brakes or accelerates, rolls in corners (about 4° per g in a Panda),
  leaves the ground over a crest or a ramp and lands. In the air the tumbling slows a little.
- **Tyres** (`src/sim/tyres.ts`): sideways force rises with the slip angle to a peak (0.12–0.15
  rad) and falls toward sliding friction past it; along the tyre the drive, the brakes and the
  rolling resistance share one friction ellipse. A tyre asked for more than its grip spins (drive)
  or locks (brakes without ABS, the handbrake) and slides. ABS holds a braked tyre at 85% of its
  grip, leaving some to steer with; traction control holds a driven one under what cornering
  leaves. A loaded tyre grips less per newton (12% less at twice its static load). Nearly
  standing, a tyre holds like static friction, so the brakes and the handbrake hold a car on a
  slope up to the tyres' grip; past it, it slides.
- **Surfaces** (`GRIP` in `tyres.ts`, per wheel from `surfaceAt`): peak friction, sliding share
  and rolling resistance, dry and wet (`WET`).

  | Surface | Peak μ dry / wet | Sliding / peak, dry / wet | Rolling resistance, dry / wet |
  |---|---|---|---|
  | asphalt | 1.1 / 0.79 (×0.72) | 0.7 / 0.65 | 0.013 / 0.015 |
  | stone (setts, paving) | 0.9 / 0.59 (×0.65) | 0.75 / 0.7 | 0.016 / 0.018 |
  | gravel | 0.62 / 0.56 (×0.9: it drains) | 0.9 / 0.9 | 0.03 / 0.033 |
  | dirt | 0.6 / 0.39 (×0.65: mud) | 0.85 / 0.85 | 0.045 / 0.06 |
  | grass | 0.45 / 0.32 (×0.7) | 0.8 / 0.75 | 0.07 / 0.075 |
  | leaves (forest floor) | 0.5 / 0.33 (×0.65) | 0.8 / 0.75 | 0.06 / 0.065 |
  | packed snow (`SNOW`, over any surface) | 0.3 | 0.85 | 0.03 |

- **Weather** (`weathered` in `tyres.ts`): each wheel asks the weather how wet and how
  snow-covered the ground is at its contact (`groundAt`,
  [weather.md](weather.md#the-ground-wetness-snow-and-meltwater)). Its surface's grip goes from dry
  toward wet by the wetness, then toward packed snow by the snow cover, and the handling's weather
  grip loss scales the difference from dry ([Knobs](#knobs)). A wet road keeps 0.72 of its dry grip,
  as wet asphalt holds 0.7–0.8 against about 1.1 dry, and packed snow about 0.27 of it.

- **Gravity** pulls along the slope (the springs push along the ground's normal), and air drag is
  ½ ρ Cd·A v².
- **Rollover**: past 60° of tilt the wheels carry nothing and the body's eight corners take the
  ground (stiff contacts, sliding friction 0.6; each measures the ground's slope over ±0.1 m and
  ignores a sample more than 0.3 m off, the far side of a step): a car rolls onto its side or
  roof and slides to a stop there. An overturned vehicle cannot be driven or entered (`vehicleInReach`); the player
  can still get out.
- **Walls**: the body is a row of circles of radius width/2 along its length. Its planar move
  sweeps against drive walls. A hit keeps the sliding part of the motion, bounces back 0.2 of the
  impact speed, and loses 4% of its speed per m/s of impact (keeping at least 20%). A turn that
  would wedge the body into a wall is undone; if any move would, the car stops.
- **Sleep**: a vehicle with its pedal up that has been still (under 0.05 m/s) for two steps
  without gathering speed is tried 10 steps from exact rest under the same pedals. If it ends
  under 0.002 m/s, or creeping no faster than half way through and under 0.045 m/s (the creep a
  body on the ground keeps under its friction's cap), it settles to exact zero and costs no work
  until something moves it or its driver presses a pedal. What its brakes cannot hold (a bank
  steeper than its tyres' grip, a car on its roof on a slope steeper than its sliding friction)
  slides on instead: a Panda coasting up a 50% grass bank at 0.5–14 m/s never sleeps on it, one
  on its roof sleeps on a 50% slope and slides off a 62% one. With the handling's self-righting
  on ([Handling](#handling)), a vehicle lying on its side or roof does not sleep, and one already
  asleep there wakes to roll back onto its wheels; a destroyed one stays where it lies
  ([Damage](#damage)). A vehicle standing in a river never sleeps.
- **Water**: a river buoys each quarter of the underbody by the water over it, so the springs and
  tyres unload as it rises (a Panda floats in 0.7 m of still water), drags the wheels ploughing
  through it (a Panda coasting in at 10 m/s loses a third of its speed in a second of ankle-deep
  water) and the body toward its current, and stalls the engine once over its air intake (a Panda's at 0.6 m). Drive walls stop no
  vehicle at the water's edge ([water.md](water.md#vehicles-in-the-water)).

Events: a wall or ground hit is an `Impact` (a ground hit names the face that struck: `under`
when the suspension bottoms out on landing, `roof`, `side`, `front`, `rear`), and each step a
tyre slides past its grip it is a `Skid` (sliding speed, how far past its grip: 0.25 for ABS at
the limit, 1 sliding, spinning or locked; the surface, and how snow-covered the ground is there).
The renderer lays tyre marks and smoke from `Skid`, dark slush ruts and white spray on snow; the
audio plays both ([audio.md](audio.md)), and every crash `Impact` harder than a scuff wears the
vehicles it struck ([Damage](#damage)).

### Vehicles

`src/sim/vehicles.ts` holds each model as it is: kerb mass with a driver, wheels, centre of mass,
tyres, brakes, engine and gearbox, from the Fiat Panda III 1.2 FIRE and Alfa Romeo Giulia 2.0
Turbo data sheets, the Piaggio Ape 50 (1.8 kW two-stroke) and an Iveco Trakker 6x4 tipper laden
with a marble block. Gear ratios are representative, set so each engine reaches its published top
speed.

| Model | Label | Length × width (m) | Mass | Drive | Engine | Gears |
|---|---|---|---|---|---|---|
| `panda` | Fiat Panda | 3.7 × 1.65 | 1015 kg | front | 1242 cm³ petrol four, 102 N·m, 51 kW | 5, manual-style |
| `ape` | Piaggio Ape | 2.9 × 1.4, three wheels | 385 kg | rear | 50 cm³ two-stroke single, 3.4 N·m, 1.8 kW | 4 |
| `truck` | Camion del marmo | 7.6 × 2.45 | 26,000 kg | rear tandem | 12,880 cm³ turbodiesel six, 2100 N·m, 302 kW | 12, limiter 90 km/h |
| `carabinieri` | Alfa Romeo Giulia dei Carabinieri | 4.6 × 1.85 | 1580 kg | rear, ABS, traction control | 1995 cm³ turbo petrol four, 330 N·m, 147 kW | 8 |

What follows from them, measured on flat ground with `advance` (the physics tests in
`src/sim/__tests__/physics.test.ts`; published figures in brackets):

| Model | 0–100 km/h | Top speed | Stop from 100 km/h | Cornering limit | Tips over at |
|---|---|---|---|---|---|
| `panda` | 12.6 s (14.2) | 164 km/h (164) | 42.4 m, ABS | 0.84–0.96 g, understeers | never on the flat (static 1.29 g) |
| `ape` | 0–30 km/h in 17 s | 41 km/h (37–45) | 9.6 m from 40 km/h, wheels locked | lifts a rear wheel past ≈ 0.4 g | 0.55 g static: a handbrake turn at its top speed |
| `truck` | 0–50 km/h in 15.1 s | 90 km/h (limiter) | 56.9 m from 90 km/h, ABS | ≈ 0.5 g | 0.63 g static: full lock from 16 m/s (58 km/h) |
| `carabinieri` | 6.5 s (6.6) | 242 km/h (235) | 39.4 m, ABS | ≈ 1.0 g | never on the flat (static 1.65 g) |

On gravel a Panda stops from 100 km/h in 68.4 m and on grass in 84.9 m; full throttle from rest
spins its front wheels on gravel but not on asphalt, and after 10 s up a 15% grade it does 16 m/s
on asphalt and 1.5 m/s on grass. On a new game's Balanced handling it stops in 47.0 m on gravel
and does 14.9 m/s up the 15% grass ([Presets](#presets)). On a fully wet road it stops from
100 km/h in 56.1 m and on packed snow in 128 m. The Ape climbs 15% at 2.6 m/s. Adding a model to
`VEHICLE_MODELS` fails to compile until it has data here, a durability ([Damage](#damage)), a mesh
and an engine for its smoke and fire in `src/render/actors.ts`, and a trim in the audio.

The camera zooms out with speed (6 texels/m in a car, 5 above 16 m/s). The HUD speedometer shows
km/h.

### Handling

The handling is 16 knobs over the vehicles' real data that make driving easier or harder: each is
a multiplier (×) of the real value, a share from 0 (none) to 1 (real), or an on/off switch
(`HANDLING` in `src/sim/handling.ts`). At every knob's real value (`REAL_HANDLING`) each vehicle
drives as its data says. Three presets set every knob at once ([Presets](#presets)), and a new
game starts on Balanced (`DEFAULT_HANDLING`).

- **Every vehicle**: one handling applies to every vehicle on the map, the player's, parked and
  traffic alike. `tuned` applies the knobs that are part of a vehicle's data to its spec, and
  `rigFor` (`src/sim/chassis.ts`) adds the surface grips, the weight transfer and the steering.
- **Traffic keeps its real comfort**: the traffic AI keeps the sideways acceleration it takes a
  curve at and the lean at which it stops ([Traffic AI](#traffic-ai)) from the real rigs
  (`RIGS`), so it drives no faster where a knob adds grip and no slower where one takes it away;
  it reads only how far the physics will turn its wheels (`comfortSpeed` steers with `rigFor`),
  so at steering at speed ×2 it slows to the same comfort rather than corner twice as hard. Its
  caution on wet and snowy roads does follow a knob, the weather grip loss: it drives as carefully
  as the grip that knob leaves, as a real driver feels the road.
- **Saved**: the `Handling` resource is part of the saved world, so a restored snapshot or a
  replay drives with the handling it was played with.
- **Set from the settings and the debug menu**: the player picks a preset in the game settings
  (Esc, Gameplay, "Vehicle physics"), in every build; the dev-only debug menu (P, or the Debug
  button beside the Ritmo monitor) has the same presets and every knob (see
  [architecture.md](architecture.md#hud)). Each change is a `SetHandling` request, which
  `ApplyHandling` keeps inside the knob's range (a switch to 0 or 1) and drops when it is not a
  number. The choice persists in the browser (`localStorage`), so a reload keeps it, and a mix of
  knobs set by hand that matches no preset shows as Custom in both.

#### Presets

Each preset (`HANDLING_PRESETS` in `src/sim/handling.ts`) sets all 16 knobs; their values are
the Simulation, Balanced and Arcade columns of the [knob table](#knobs).

- **Simulation** (`REAL_HANDLING`): the real data. Cars slide on gravel, grass, wet roads and
  snow, wheels lock and spin without driver aids, and the Ape and the laden truck roll over in
  sharp turns.
- **Balanced**, a new game's (`DEFAULT_HANDLING`): in the middle. A little more grip, power,
  braking and steering, ABS and traction control on every vehicle, half the off-road grip loss and
  0.6 of the weather's, less weight transfer and stiffer bars: the Panda and the Giulia stay upright
  in corners, while the Ape still tips in a hard handbrake turn and the laden truck at full lock
  from 84 km/h.
- **Arcade**: pure fun. Twice the grip, off the road too (no off-road loss), rain and snow taking
  0.3 of what they really take, two and a half times
  the power and the brakes, razor-sharp steering, and the two assists no real car has at full: the
  stability assist keeps a car on the line it steers (full lock held 5 s at 100–160 km/h slides a
  Giulia or a Panda at most 4°, and a Giulia floored at full lock circles at 128 km/h), and
  self-righting rolls a vehicle left on its side or roof back onto its wheels. Nothing rolls over
  in a turn. Less weight transfer leans a vehicle further on a side slope: an Ape crawling across
  a grass bank at 2 m/s stays upright up to 45% on Balanced and 75% on Simulation, and on Arcade
  to 75% because self-righting catches it (50% without).

What each preset drives like, measured with `drive` (`src/sim/testing.ts`) on flat test ground
and asphalt unless named; `src/sim/__tests__/handling.test.ts` pins the Panda's quicker 0–100 km/h and
shorter gravel stop from preset to preset, which vehicles roll over on which, and Arcade's
half-second tap. Top speed is the speed after 180 s floored; a lateral g is the steady sideways acceleration at full lock held
at 15 m/s; a rollover is the lowest speed a vehicle set going at 15–120 km/h, in 3 km/h steps,
tips over from, at full lock held for 10 s or in a handbrake turn (the Ape is set going faster
than it can drive):

| Model | Case | Simulation | Balanced | Arcade |
|---|---|---|---|---|
| `panda` | 0–100 km/h | 12.6 s | 10.9 s | 5.2 s |
| | top speed | 164 km/h | 176 km/h | 182 km/h |
| | stop from 100 km/h, asphalt | 42.4 m | 38.0 m | 20.9 m |
| | stop from 100 km/h, gravel | 68.4 m | 47.0 m | 20.9 m |
| | stop from 50 km/h, asphalt: dry / fully wet / packed snow | 10.8 / 14.2 / 33.2 m | 9.6 / 11.3 / 16.0 m | 5.4 / 5.8 / 6.7 m |
| | after 10 s floored up a 15% grass bank | 1.5 m/s | 14.9 m/s | 31.6 m/s |
| | lateral g | 1.01 | 1.06 | 2.08 |
| `carabinieri` | 0–100 km/h | 6.5 s | 5.8 s | 3.1 s |
| | top speed | 243 km/h | 260 km/h | 357 km/h |
| | stop from 100 km/h | 39.4 m | 35.8 m | 19.8 m |
| | lateral g | 0.99 | 1.11 | 2.26 |
| `ape` | 0–30 km/h | 16.9 s | 13.5 s | 5.7 s |
| | top speed | 41 km/h | 45 km/h | 47 km/h |
| | stop from 40 km/h | 9.6 m | 8.4 m | 4.4 m |
| | lateral g | 0.70 | 0.74 | 1.09 |
| | rolls over at full lock from | 78 km/h | 90 km/h | never |
| | rolls over in a handbrake turn from | 39 km/h | 42 km/h | never |
| `truck` | 0–50 km/h | 15.1 s | 13.4 s | 8.1 s |
| | top speed | 90 km/h | 90 km/h | 90 km/h |
| | stop from 90 km/h | 56.9 m | 49.9 m | 25.5 m |
| | lateral g | 0.55 | 0.54 | 0.95 |
| | rolls over at full lock from | 57 km/h | 84 km/h | never |

The Panda and the Giulia roll over in neither test on any preset, nor the truck in a handbrake
turn; on Arcade nothing does, and on Balanced the Ape's full-lock rollover lies beyond its top
speed.

#### Knobs

The knobs, in the menu's order and groups (Tyres; Engine and brakes; Driving aids; Steering;
Body and suspension), with each preset's value. Multipliers and shares move in steps of 0.05.

| Knob | Key | Range | Simulation (real) | Balanced (new game) | Arcade | Changing it |
|---|---|---|---|---|---|---|
| Tyre grip | `grip` | 0.5–2.5 × | 1 | 1.1 | 2 | every tyre's grip on every surface: higher corners faster, stops shorter and slides less, but lets a tall vehicle corner hard enough to roll over (a Panda held at full lock tips from 36 km/h at ×1.1 once held for 30 s, 41 km/h within 5 s, and from 24 km/h at ×1.5), so lower the weight transfer with it (at 0.5 none of the four tips at full lock at ×1.5); lower slides and spins sooner |
| Off-road grip loss | `looseGround` | 0–1 | 1 | 0.5 | 0 | how far every surface but asphalt (stone, gravel, dirt, grass, leaves) differs from it in grip, sliding friction and rolling resistance; at 0 every surface drives like asphalt |
| Weather grip loss | `weatherGrip` | 0–1 | 1 | 0.6 | 0.3 | how much wet ground and snow cover take from every tyre's grip ([Surfaces](#the-body)): at 1 a wet road keeps 0.72 of its dry grip and packed snow 0.27, so stops are longer, corners slower and the lock at speed smaller; at 0 every vehicle drives as on a dry day whatever the weather. The traffic AI drives as carefully as the grip it leaves |
| Engine power | `power` | 0.5–4 × | 1 | 1.15 | 2.5 | every engine's torque and power: harder acceleration where the tyres can take it (else the driven wheels spin), steeper climbs and a higher top speed; the truck's limiter still holds it to 90 km/h |
| Brake power | `brakes` | 0.5–4 × | 1 | 1.15 | 2.5 | the brakes' force: higher stops shorter until the tyres' grip runs out, lower stops longer |
| Air drag | `drag` | 0–2 × | 1 | 0.9 | 0.6 | air resistance: lower raises the top speed and coasts further, higher holds a vehicle back at speed |
| ABS on every vehicle | `abs` | off, on | off (each vehicle's own) | on | on | on: no vehicle's brakes lock its wheels, so it still steers braking hard (the Ape has no ABS of its own); the handbrake still locks the rear wheels |
| Stability assist | `stability` | 0–1 | 0 (off) | 0 | 1 | an assist no real car has: it turns a sliding car's yaw back toward the line it steers (the steered yaw rate, v · tan(steer) / wheelbase, capped at what the tyres' grip can turn the path at) and damps the rear axle's sideways slide (not the centre of mass's, which a clean turn has too); at 1 a car holds the line it steers and does not spin (a Panda tapped to full lock at 160 km/h off the throttle, which spins round at 0; on Arcade, full lock held 5 s at 100–160 km/h slides a Giulia or a Panda at most 4°), except while the handbrake is held, so a handbrake turn swings it round exactly as without it; off in the air and under 2 m/s |
| Self-righting | `selfRighting` | off, on | off | off | on | on: a vehicle lying on its side or roof, or rolling up onto some of its wheels, tilted more than 25° and nearly stopped (under 3 m/s), rolls back onto its wheels by itself, hopping off its roof: every model from its side in 0.3 s and from its roof in about 1.1 s on flat ground, and the laden truck across a 20% slope too, without falling back; an overturned vehicle asleep wakes for it; a destroyed one stays where it lies ([Damage](#damage)) |
| Traction control on every vehicle | `traction` | off, on | off (each vehicle's own) | on | on | on: no vehicle spins its driven wheels; the engine gives only what the tyres can take and leaves them grip to corner (only the truck and the Giulia have it of their own) |
| Steering at speed | `steering` | 0.5–2.5 × | 1 | 1 | 2 | how far the wheels turn at speed, where the lock shrinks to what the grip (the weather's included) and the tipping point allow (full lock at walking pace stays): higher turns tighter but slides or tips sooner, lower is steadier |
| Steering speed | `steeringRate` | 0.5–4 × | 1 | 1.4 | 3 | how fast the wheels turn toward the keys (2.5 rad/s) and back to straight (4 rad/s): higher reacts at once but is twitchy, lower is smoother but slower |
| Weight transfer | `weightTransfer` | 0–1 | 1 | 0.8 | 0.4 | how much cornering, braking, accelerating and a crash's sideways shove tilt the body onto its outer, front or rear wheels (the lever of the tyres' forces about the centre of mass): lower keeps the body flatter and the grip even; at 0 none of them tips a vehicle over, though a jump or a side slope still can, and a side slope leans it further (with no lever the tyres no longer hold the body up against it: an Ape parked across a 40% slope leans about 38° at 0 against 23.5° at 1) |
| Anti-roll bars | `antiRoll` | 0–3 × | 1 | 1.3 | 2.5 | the bars that share the load between an axle's left and right wheels: stiffer leans less and, on four wheels, resists tipping (the Ape's only bar is at the rear, and stiffer tips it a little sooner), softer leans more and keeps the wheels on the ground over bumps |
| Suspension stiffness | `stiffness` | 0.5–2 × | 1 | 1.1 | 1.5 | the springs' stiffness (the ride frequency goes as its square root): stiffer leans, dives and bottoms out less, softer soaks up bumps but wallows and dives |
| Suspension damping | `damping` | 0.3–2 × | 1 | 1.2 | 1.8 | the dampers: higher settles the body at once after a bump or a landing, lower lets it bounce |

What one knob changes, measured with `drive` (`src/sim/testing.ts`: `advance` alone, flat test
ground and asphalt unless named, no walls), the scenarios of `src/sim/__tests__/handling.test.ts`:

| Knob | Case | Real | Changed |
|---|---|---|---|
| Tyre grip 1.5 | a Panda's stop from 100 km/h on gravel | 68.4 m | 47.7 m |
| Off-road grip loss 0 | a Panda floored for 10 s up a 15% grass bank | 1.5 m/s | 16.2 m/s |
| Weather grip loss 0 | a Panda's stop from 50 km/h on packed snow (on a fully wet road) | 33.2 m (14.2 m) | 10.8 m, as dry (10.8 m) |
| Weather grip loss 0 | a Panda's road-wheel angle after 0.5 s of full left at 15 m/s on packed snow | 5.9° (0.66 of dry) | 8.9°, as dry |
| Engine power 2 | a Panda floored from 20 m/s, 5 s on | 25.4 m/s | 32.1 m/s |
| Brake power 0.5 | a Panda's stop from 100 km/h | 42.4 m | 72.0 m |
| Air drag 0 | a Panda coasting from 30 m/s, 5 s on | 27.2 m/s | 28.8 m/s |
| ABS on | an Ape braking from 11 m/s: steps of the first 2 s (120) with a locked wheel | 17 | 0 |
| Traction control on | a Panda floored from rest on gravel: steps of the first 2 s (120) with a wheel spinning | 120 | 0 |
| Steering at speed 2 | a Panda's road-wheel angle after 1 s of full left at 20 m/s | 7.1° | 14.4° |
| Steering speed 2 | a standing Panda's road wheels after 5 steps (1/12 s) of full left from straight | 11.9° | 23.9° |
| Weight transfer 0 | an Ape's handbrake turn at 11.5 m/s | tips over | stays upright |
| Anti-roll bars 3 | a Panda's lean 2.5 s into a corner at 14 m/s, steering 0.6 | 3.0° | 1.5° |
| Suspension stiffness 2 | a Panda's deepest dive braking hard from 20 m/s | 3.5° | 1.7° |
| Suspension damping 2 | a Panda dropped 0.3 m onto its wheels: still (under 1 cm/s) after | 1.7 s | 0.8 s |
| Stability assist 1 | a Panda tapped to full lock for 0.5 s at 160 km/h, off the throttle | spins round | holds its line |
| Self-righting on | a Panda left on its roof | stays there | on its wheels after 1.1 s |

### Horn and siren

H sounds the car's horn while held, from the driver's seat only: on foot, or in a destroyed car
([Damage](#damage)), it does nothing. In the Carabinieri Giulia each press of H turns the two-tone
siren on or off instead; the siren stops when the player gets out or the car is destroyed. Neither
has a gameplay effect: nobody gets out of the way. The `horn` binding is read only by the audio
host ([audio.md](audio.md)); the people and cows that react to a horn react to the traffic AI's
`Honk` events ([Reactions](#reactions), [Animals](#animals)).

## Damage

Crashes wear vehicles out, every vehicle alike: the player's, parked and traffic. `CrashDamage`
(`systems/damage.ts`, the rules in `src/sim/damage.ts`) keeps each vehicle's `Damage`: the share of
its durability its crashes have used up, from 0 (as new) to 1 (destroyed). Nothing repairs it.

- **What a crash costs.** Each `Impact` is a hit at the struck vehicle's barrier-equivalent speed:
  the speed into a wall that would shake it as hard. A wall counts at the impact's speed; two
  vehicles split their closing speed by mass, each taking the other's share, so a Panda driven
  into the laden truck takes 96% of it and the truck 4%. A landing on the wheels (`under`) counts
  less the 2 m/s the bump stops take, and a side or the roof striking the ground counts at least
  half the body's speed over it, so a car rolling over at speed takes a beating at each turn.
  Knocking a person down costs nothing. An animal struck counts as a vehicle of its mass would,
  so a cow dents the car and a cat does not: by the rule, a Panda into a 600 kg cow takes 0.01 at
  50 km/h and 0.07 at 90 km/h (more than a scuff from 29 km/h), a 120 kg pig only scuffs it below
  102 km/h, and a dog or a cat only ever scuffs it. A person or a light animal pinned against a
  wall does not cushion the car: it is a wall hit as hard as the car was going into it. A hit up
  to 3 m/s (`SCUFF`) only scuffs. Past that a crash at `v` costs ((v − 3) / (d − 3))^1.5, where the
  durability `d` is the barrier speed of the one crash that destroys the model outright
  (`DURABILITY`): growing faster than the speed but slower than the crash's energy, so one
  ordinary fast crash rarely skips a stage. A crash makes more than one contact with what it
  strikes (the body still pressing into the wall the next step, a rebound), so hits within 0.2 s
  of the crash's first on the same vehicle or animal, or on any wall or the ground (an `Impact`
  does not say which wall), cost only what a harder one adds: a crash costs what its hardest hit
  does.
- **A train** counts as a wall at the full closing speed (it is about 100 times a Panda's mass),
  the train being what was struck. A train that strikes a vehicle faster than 14 m/s, or drags one
  a wall holds, wrecks it outright ([Trains](#what-a-train-strikes)).
- **Stages.** What the player sees and hears, by damage (`STAGE_FROM`): under 0.4 no smoke shows and
  the engine loses no drive, though it already sounds duller, and rough from 0.2
  ([audio.md](audio.md#engines)); from 0.4 (medium) the engine smokes white, from 0.7 (severe)
  black, and at 1 (destroyed) it burns under black smoke
  ([architecture.md](architecture.md#rendering), [audio.md](audio.md)).
- **The engine.** From the medium stage the engine gives less torque, falling in a straight line
  to 60% just short of destroyed, and from the severe stage it misfires: a share of 0.25 s
  windows, none at 0.7 and 20% at the brink, gives no drive at all, so the car coughs and lurches
  under the pedal. The drivetrain reports both (`engineRevs`), so the engine heard misfires when
  the one that drives does. The misfires are drawn per vehicle and window from its entity id, so
  a replay misfires alike.
- **Destroyed.** The engine is dead, and with it the horn and the siren: no drive and no engine
  braking, though the steering and the brakes still work and the wreck rolls. It burns until it
  blows up ([Explosions](#explosions)), and the handling's self-righting leaves it where it lies.
  Nobody can get in (`vehicleInReach`, so the HUD offers nothing); a player inside can still get
  out. A traffic car is abandoned the step it is destroyed: its driver gets out at the first free
  door and flees for 4 s, as from a carjacking, and it stops being traffic, its handbrake on.
  `Populate` removes a wreck once it is out of view (farther than `VIEW_REACH`, 90 m), whoever it
  belonged to, so wrecks never pile up.

A vehicle rolled square on into a house wall on Via Cesare Battisti, its damage after the one
crash (the handling does not change what a crash costs):

| Model | Durability | 30 km/h | 50 | 70 | 90 | 110 | 130 | 150 |
|---|---|---|---|---|---|---|---|---|
| `ape` | 26 m/s (94 km/h) | 0.11 | 0.32 | 0.60 medium | 0.93 severe | destroyed | | |
| `panda` | 40 m/s (144 km/h) | 0.05 | 0.16 | 0.30 | 0.46 medium | 0.64 medium | 0.84 severe | destroyed |
| `carabinieri` | 46 m/s (166 km/h) | 0.04 | 0.13 | 0.24 | 0.37 | 0.51 medium | 0.67 medium | 0.85 severe |
| `truck` | 60 m/s (216 km/h) | 0.03 | 0.08 | 0.15 | 0.24 | 0.34 | 0.45 medium | 0.56 medium |

So a Panda turns white after three crashes into a wall at 50 km/h, black after five and burns
after seven; at 90 km/h it takes one, two and three.

How a worn engine drives, floored from rest on flat test ground (`drive`, the Simulation preset,
misfire seed 7): the time to 100 km/h (30 km/h for the Ape, 50 km/h for the truck), the speed
after 180 s, and the steepest grade it still climbs from rest. The 0.85 and 0.99 columns depend on
when the misfires fall, drawn from the vehicle's id: over seeds 1, 3, 7, 42 and 100 the times move
by 1–4 s, except the Ape at 0.85, which reaches 30 km/h in 61–107 s:

| Model | As new (and up to 0.4) | 0.55 | 0.7 | 0.85 | 0.99 |
|---|---|---|---|---|---|
| `panda` | 12.7 s, 164 km/h, 36% | 14.2 s, 159 km/h, 32% | 16.3 s, 152 km/h, 28% | 22.0 s, 137 km/h, 21% | 30.7 s, 125 km/h, 16% |
| `carabinieri` | 6.5 s, 243 km/h, 60% | 7.0 s, 233 km/h, 60% | 7.6 s, 222 km/h, 60% | 9.0 s, 204 km/h, 55% | 11.6 s, 184 km/h, 42% |
| `ape` | 17.0 s, 41 km/h, 18% | 20.3 s, 40 km/h, 16% | 25.9 s, 38 km/h, 14% | 106.9 s, 31 km/h, 10% | never, 24 km/h, 8% |
| `truck` | 15.1 s, 90 km/h, 16% | 16.5 s, 90 km/h, 15% | 18.3 s, 90 km/h, 16% | 24.3 s, 90 km/h, 15% | 31.6 s, 84 km/h, 16% |

The Giulia's climb is held by its grip on the steepest grades (60% is as far as was tried), and the
laden truck's by its tyres at about 15% whatever the damage. Traffic hardly wears itself out: with
the player standing 3 minutes at the start while traffic fills the roads (seed 1, in Node), 5 of
the 224 vehicles on the map in that time (210 at once) took any damage, at most 0.06.

### Explosions

`Explode` (`systems/explosions.ts`) blows burning wrecks up:

- **The fuse.** The step after a vehicle is destroyed its fuse is lit: 5–10 s (`FUSE`), drawn from
  the world's `Rng`, so a replay blows up alike. When it burns down the wreck explodes (an
  `Explosion` event, which the render draws and the audio plays) and is left a charred shell
  (`Damage.exploded`): it leaps 4 m/s and tumbles at up to 1.5 rad/s, then lies smoking.
- **Vehicles.** Every other vehicle whose body is within 10 m of the wreck's (their half lengths
  apart) takes a hit like a crash at up to 45 m/s barrier-equivalent, less in a straight line with
  the gap, and a shove of up to 12,000 N·s away from it and a third as much again upward (`BLAST`).
  A Panda parked bumper to bumper (0.8 m) is destroyed and blows up in turn 5–10 s later, one 6.3 m
  off takes 0.22, and the laden truck 2.35 m behind 0.41; the shove sends a Panda off at up to 12
  m/s and the truck at under 0.5.
- **People.** On foot within 5 m of the wreck's body they die (`Dead`), within 12 m of it they are
  knocked down for 2.5 s, and both are thrown away from its centre at up to 9 m/s; walkers within
  30 m of its centre run off for 4 s. The reach is from the body (`offBody`: the hull its collision
  circles sweep), not the centre, so standing 1.3 m off a truck's tail, 5.1 m from its centre, is
  as deadly as standing beside a Panda. The player sitting in the wreck dies with it, thrown out at
  a door. Anyone sitting in another vehicle is shielded by it. The dead lie where they fall and
  never get up, as those a car kills do: walkers who come on a body are shocked
  ([Witnesses and the dead](#witnesses-and-the-dead)), traffic stops for it but does not wait for
  it to move on ([Traffic AI](#traffic-ai)), and `Populate` removes it beyond 140 m, as it does
  the living ([Population](#population)). A blast neither harms nor scares the animals. Nothing
  scores.
- **Dying and coming back.** Killed, the player lies still for 4 s (`WASTED`) under the HUD's "Sei
  morto", unable to act, then `Respawn` brings them back on foot at the start, where a new game
  begins (in front of the Carabinieri station). The score, the world and its wrecks stay as they
  are.

## Traffic AI

`TrafficAI` (`systems/traffic.ts`) drives the cars tagged `Traffic` on `graph.trafficEdges`, using
the lane helpers in `src/sim/route.ts`.

- **Keep right.** The lane offset is w/4 + 0.2 m on roads at least 5 m wide, otherwise 0.5 m. It
  shrinks in 0.25 m steps where houses crowd the road, until the body clears the walls. Each model
  has its own lane table. A model only uses edges where it fits, and where the drive walls across
  the road leave room for it and an oncoming Panda plus 0.3 m (`PASS_MARGIN`): in single-file
  lanes between houses two cars met head-on with no room to back out or turn round. It only uses
  the largest connected part of those edges, so villages reached only by such lanes (Terma, Monte
  dei Bianchi, Vezzanello) get no AI traffic; the player can still drive there. Trucks keep to
  tertiary and unclassified roads and to the loops of that network, because they cannot turn round.
- **Steering.** The car aims at a point 6 m + 0.6 s × speed ahead along this edge and the next.
- **Route choice.** At each node the car picks a random legal edge. Oneways are driven a → b only.
  It avoids dead-end spurs, then hairpins, while another way exists, and makes a U-turn only at a
  dead end.
- **Speed.** Cruising speed by class: tertiary 12 m/s, unclassified 9, residential 7, service 5.
  The car slows before sharp corners (down to 3 m/s) and when pointing away from its target, and
  never goes faster than the curve it steers allows in comfort: a sideways acceleration under
  3.5 m/s², or under 0.45 of what tips its vehicle over (the Ape ≈ 2.4 m/s², the laden truck
  ≈ 2.8). The physics decides how fast it actually goes: an Ape climbs the steep village streets
  at walking pace.
- **Leaning.** A car rolled sideways more than half the angle that tips it (the Ape ≈ 14°, the
  laden truck ≈ 16°, a Panda ≈ 26°, the Giulia ≈ 29°), a wheel up a bank or down the edge of a
  stream, stops rather than tip over: it brakes while moving, then holds the handbrake with the
  wheel straight once under 0.5 m/s. Stuck there, it backs up like for anything else.
- **Braking.** Anything whose body reaches into a cone ahead, a vehicle, a person or an animal,
  living or dead, slows the car to keep a 2 m gap. The cone is 8 m + 1.2 s × speed long, bends
  along the arc the front wheels steer (a straight line under a curvature of 0.001 per m), and is as
  wide as the car plus 0.15 m to either side (`CONE_CLEARANCE`); an obstacle counts by its
  footprint (half its length and width turned to the car's heading, a person or an animal a
  circle), so a car standing across the road holds it back as well as one ahead. For a Panda
  following a Panda in line that is 1.8 m to either side of its axis. Each car of a train on its
  level is such an obstacle too, one that moves on. Standing still, it holds the handbrake.
- **Level crossings.** The car stops for a box that is not open and keeps boxes and the junctions
  before them clear ([Traffic at the crossings](#traffic-at-the-crossings)).
- **Unsticking.** A car stuck below 1 m/s for 3 s reverses for 1.5 s at 3 m/s. If it is lined up
  with its lane, it may turn round: half the time when the way back is not a dead end, always
  from its second try, never on a oneway, and never on a bridge or in a tunnel, nor on an edge
  touching one (`roomToTurn`: a circle there leaves the deck), nor within 12 m of a railway's track
  at grade (the circle would sweep over it). A truck never turns round: it
  only backs up. Waiting for a living person or animal in the way (ahead of the bumper, on the
  carriageway or the verge pedestrians walk), or for a train across it, counts four times slower:
  the car holds about 12 s for them to move on, then backs up and turns round like for anything
  else. Waiting at a level crossing closed for a train does not count at all
  ([Traffic at the crossings](#traffic-at-the-crossings)). One beside the car or
  off the road, or a body, counts like any other obstacle. Backing up, the car slows as its tail
  nears anything behind it, as when following, and stops 0.5 m short (`BACK_GAP`; about 1 m in
  practice, as it stops once the gap allows less than 0.5 m/s), holding the handbrake, so it does
  not reverse into the car queued behind it; with anything within 0.6 m alongside (`ALONGSIDE`) it
  keeps the wheel straight, so its swinging nose does not sweep into it.
- **Honking.** Half-way to backing up (`HONK_STEPS`: 1.5 s stuck, about 6 s when waiting for a
  person or an animal) the driver honks once, a `Honk` event the audio host plays and the people
  and cows near it react to ([Reactions](#reactions), [Animals](#animals)). It honks again only in
  a new stuck episode: after backing up, or after getting going above 2.5 m/s.
- **Lost.** A car more than 12 m from its edge joins the nearest usable road.
- **Wrecked.** A damaged car drives on, as slowly as its worn engine goes; a destroyed one is
  abandoned, its driver fleeing ([Damage](#damage)). Other traffic treats the wreck like a parked
  car in its lane until it is removed out of view.
- **Wet and snowy roads.** The driver reads the share of its dry grip the road under the car
  leaves (`weatherFactor`: 1 dry, 0.72 fully wet and 0.27 on packed snow at a weather grip loss of
  1, [Knobs](#knobs)). It cruises and corners slower by its square root, as the speed a curve
  allows goes with the grip, takes curves at that share of its comfort, looks further ahead for
  braking (the cone's length ÷ the share), and follows and backs up more gently (both limits × the
  share). On a fully wet road at a weather grip loss of 1 its top speed is 0.85 of the dry one.
- **Tests.** `src/sim/__tests__/walls.test.ts` stages each rule on Via Cesare Battisti, and each
  test fails with its rule removed: a car standing across the lane (the footprint cone), a car
  queued 4.5 m behind one that backs up (the backing limit), a car alongside one backing up askew
  (the straight wheel), a driver steering back into its lane beside a standing car (the bent cone),
  and the same road wet (slower, easing off sooner, stopping and backing further from the cars
  around it).
- **How it flows.** With the player standing 3 real minutes while traffic fills the roads, on a
  new game (22 October 2026 from 08:00, Balanced handling) with the weather held clear, the share
  of the traffic's time under 1 m/s and the honks were 0.18 and 82 in Monzone's street, 0.13 and
  61 at Equi Terme, and 0.17–0.28 and 71–119 at four spots 15 m apart in Gragnola's walled centre;
  the mean speed was 18–22 km/h. Cars wait rather than shove through each other: the six runs gave
  4 car-to-car hits of 1.5 m/s or more, the speed the audio plays a crash from. Traffic is
  chaotic, and a run is one sample: a few junctions and narrow streets still deadlock head-on until
  the drivers back up and retry. In settled rain the same runs gave 0.12, 0.08 and 0.13–0.34 at
  13.9–22.2 km/h; on full snow cover, the clock stopped, 0.10, 0.08 and 0.17–0.39 at
  11.1–17.9 km/h. Now and then a car overturns, nearly always slowly on a steep bank: in the six
  clear runs a Panda at 0.3 m/s at (1677, 704) near Equi Terme, the bank where Pandas overturn in
  every weather, and an Ape at 1.5 m/s at (1790, 805).

## People and their reactions

People on foot walk the village streets at their own pace, alone or in parties, and react to what
happens around them. `Perceive` (`systems/perceive.ts`, with the vehicle checks in
`systems/senses.ts`) sets each pedestrian's mood from what it sees and hears, and `Pedestrians`
(`systems/pedestrians.ts`) moves it as the mood says. Who is out, and where, is under
[Population](#population).

### Walking

- **Water.** People take no step into the water by choice, unless they flee; knocked
  or swept into it, they wade or swim for the nearer bank, and the current takes the down and the
  dead ([water.md](water.md#people-and-animals-in-the-water)).
- **Routes.** People walk `graph.walkEdges`: on the verge of roads (w/2 + 0.8 m, on either side)
  and 0.3 m off the middle of paths, steps and tracks, or nearer the middle where a road's verge
  would run within 2.8 m of the railway (its `verge`: Piazza della Liberazione by Monzone
  station, Via Riolo and Piazza Paolo Sist by its level crossing;
  [map.md](map.md#9-the-railway-railwayts-platformsts-rail-clearts)). At a junction a walker
  takes each way with the weight of the most lived-in walk edge up to 120 m down it
  (`WALK_AHEAD`, TUNED: about a village block) plus 0.5 (`WALK_FLOOR`, TUNED), and turns back
  only at dead ends. The ways are weighed by where they lead, not by the edge itself, because
  residents are counted within 60 m of each edge, so all the edges at one junction count about the
  same houses. With the floor, a lane into the fields draws about 1 walker in 35 against a typical
  village street (17 residents, the median of the peopled walk edges). Of 200 walkers set off for
  1.5 km from each centre, the share of the distance walked on peopled streets:

  | Centre | This choice | The edge's own residents | Random |
  |---|---|---|---|
  | Gragnola | 92 % | 69 % | 68 % |
  | Vinca | 95 % | 60 % | 55 % |
  | Monzone | 83 % | 61 % | 62 % |
  | Equi Terme | 63 % | 40 % | 40 % |

  36 % of the walkers from Gragnola still end more than 300 m out of it (68 % with a random choice).
- **Pace.** Comfortable walking pace (Bohannon & Andrews 2011, a meta-analysis of 23,111 people)
  and running pace (TUNED), m/s, each scaled by the person's height over its group's mean, within
  ±10 %:

  | | Men | Women | Running |
  |---|---|---|---|
  | Adults | 1.40 | 1.35 | 4.5 |
  | Elders | 1.25 | 1.15 | 2.5 |
  | Kids (an estimate: a child walks at a grown-up's side) | 1.2 | 1.2 | 3.5 |

- **Moving.** A person changes velocity at most 3.5 m/s² (estimate: an untrained adult reaches a
  4.5 m/s run in about 1.3 s), so someone startled by a car needs time to get clear. Stopping to
  chat, look or in shock, they slow at 3 m/s² and turn on the spot at 6 rad/s to face what they
  attend to (TUNED). Gathering, they walk to a spot near the victim on the side they came from,
  each at its own distance from 2 to 2.8 m so a crowd forms a loose ring (a kid 1 m), and stand
  facing it.
- **Blocked** (making less than half the wanted progress along the lane), a walker tries the other
  verge after 0.5 s, then turns back, alternating. Stepping across to the other verge is progress;
  sliding sideways along a wall that blocks the way is not. Someone fleeing is never counted as
  blocked: turning and speeding up would read as a wall, so they keep to the way they chose.
- Knocked down or dead, they slide to a stop.
- Rain, snow and the night do not change how they walk.

### Walking together

A party's followers (a kid, a partner, a dog on a lead: `Follows`) keep a place beside its leader:
`side` m to its right and `back` m behind it, in the leader's heading frame.

- A follower moves at the leader's velocity plus 2/s × the gap to its place (`FOLLOW_GAIN`,
  TUNED), at most its own running pace. More than 3 m from its place it heads for the leader
  itself, whose path is walkable. When a walk wall stands in the way, it heads 1.5 m on along the
  leader's lane, no nearer the leader than its place: in single file round a corner. At a house
  corner in Vinca a kid stays within 1.92 m and a dog within 1.46 m of their leader; with no such
  rule they fell 19.7 m and 17.1 m behind.
- It takes the leader's route each step, so it can carry on alone, and copies the leader's
  reactions: the mood, its point and its end.
- A fleeing leader runs no faster than its slowest follower on its feet, so a 1.1 m kid stays
  within 0.6 m of a fleeing parent (it fell 8.1 m behind a 1.85 m father who ran at his own pace).
- Members of a party never push each other apart: they walk touching.

### Reactions

Each step, after the contacts, every pedestrian on its feet who follows nobody takes in what is
around it and keeps the strongest stimulus. Moods rank `walk` < `chat` < `look` < `gather` <
`shock` < `flee`. A stimulus takes over a mood it ranks at least as high as, or one that has run
out; on a tie a death seen wins over a car to dodge, which comes again the next step. A mood
changing into a reaction may draw a cry (`Cry`, which the audio voices; a kid cries in surprise
where a grown-up would in anger). All values are TUNED unless a source is given.

| Stimulus | When | Mood | Cry |
|---|---|---|---|
| Danger | a vehicle faster than 3 m/s (`KNOCK_SPEED`: any that could knock them down) whose body, both keeping their velocities, passes within 0.5 m of them in the next 1.5 s, or 0.6 s when it comes from behind (they only hear it); or one faster than 10 m/s, closing, that passes within 0.75 m plus 0.1 s × its speed above 1.2 × its street's traffic | `flee` 4 s along their route away from it, to the verge on their own side of its path | fright, only when it alarms them (below) |
| Someone struck | an `Impact` on a person or an animal, seen within 40 m with no walk wall between, or heard within 15 m | within 8 m of the car, `flee` 6 s from it; farther, a person killed: `shock` 3 s; a person knocked down: `look` 4 s; an animal: `look` 3 s (`shock` if it died) | fright when fleeing, else shock or surprise |
| A body | a dead person within 10 m, in sight, for a walker out of a cooldown | `shock` 2.5 s | shock |
| A crash | a vehicle into a wall, another vehicle or the ground faster than 6 m/s within 35 m | `look` 3 s | surprise, 60 % |
| Speeding | a vehicle faster than 13.9 m/s (50 km/h, the limit in built-up areas, Codice della Strada art. 142) within 15 m, or 8.3 m/s (30 km/h, a village's zona 30) within 6 m, and faster than 1.2 × its street's traffic | `look` 2.5 s | anger, 50 % |
| A horn | an AI driver's `Honk` within 12 m | `look` 1.5 s | anger, 30 %, only from the one it honks at |
| A shove | the player on foot faster than 3 m/s within 1 m | `look` 2 s | anger, 70 % |
| Panic | someone running away, not a follower, within 8 m | `look` 2 s toward what they run from; a look never spreads further | none |
| A chat | two calm grown-ups (walking, out of a cooldown, neither following anyone) within 1.6 m | `chat` 8–25 s, a chance of 0.35 a second, facing each other; it ends when the partner leaves | none |
| A train's whistle | an AI train's `Whistle` within 60 m | `look` 1.5 s | none |
| A train's alarm | an urgent `Whistle`, standing in the train's path: on its track ahead of its leading end within 700 m, their body within its half-width and 1.3 m of the centreline, on its level | `flee` 4 s from its nose, to the verge on their own side of its path | fright |
| A crossing closing | a level crossing within 30 m in every phase but open (a foot crossing while a train demands it), their next metre along their way within 3 m of a track crossing it, they not | `look` 1 s at the box, renewed each step: they stand short of the track | none |

- **Trains.** Each car of a moving train is a vehicle to the Danger and Speeding stimuli, with its
  line's speed as its street's traffic, so a train at line speed passes the people waiting at a
  crossing (3.5 m from the centreline, 1.7 m between their body and its) and on the platforms' paths
  (2.6 m or more from the centreline)
  without a flight or a glare. Only people on its level sense it: under a rail bridge, over a
  tunnel or on a road bridge over the line it passes them by
  ([Around the trains](#around-the-trains)).
- **The gap, not the distance.** Danger is the gap to the car's body, because a distance from its
  centre made every walker on the verge run from ordinary traffic. A Panda in its lane passes a
  walker on the verge with 0.88 m or more between its body and them on 95 % of the map's 12 m/s
  (tertiary) lanes and 0.62–0.67 m on most 9 m/s ones (measured over the traffic lanes), and nobody
  runs from that; a car at 28 m/s (100 km/h) on a 12 m/s street startles them from 2.1 m.
- **Every threat re-aims a flight.** Someone already running turns from a new threat and steps out
  of a car's path too.
- **Fright only when it alarms them.** Everyone steps aside, but cries out only when the car is
  faster than 1.2 × its street's traffic, or they stand in its path (within half its width plus
  0.35 m of its axis, ahead of the bumper) closer than its full-braking stopping distance,
  v² / (2 × its braking deceleration): 4.05 m for a Panda at 9 m/s. Coming that close while already
  running draws the cry too. Crying out at every car made an idle Gragnola scream 5 times a minute.
- **Speeding counts over the street's traffic.** Only a vehicle faster than 1.2 × its street's
  `cruiseSpeed` counts, so people do not glare at every car on the main road, whose traffic keeps
  12 m/s about 1 m from the verge.
- **A horn angers only the one it honks at**: standing in front of the honking car within 1.8 m of
  its axis (the traffic AI's cone, which honks at whoever holds it up), out of a cooldown. When
  every bystander could, the 41 AI honks a minute in Gragnola's centre drew 7 angry yells a minute.
  The player's horn is heard only by the audio, so it moves nobody
  ([Horn and siren](#horn-and-siren)).
- **Cooldowns.** A look, gather, flight, chat or shock that runs out ends in a walk with a cooldown:
  30 s, 45 s after a chat, and 180 s after a mood about a body (a dead person within 2 m of its
  point), so nobody makes small talk a minute after a killing. In a cooldown a walker neither chats
  nor reacts to a body, and a horn does not anger them.

Measured with the player standing still: in Gragnola's centre traffic and its horns draw under
1 cry of fright and 2 of anger a minute (`reactions.test.ts` checks it over two seeds of 3 min);
at Monzone's start (seed 11, 3 min) people cry out 2.5 times a minute (surprise and anger) and cats
3 times.

### Witnesses and the dead

- **A killing.** Witnesses within 8 m of the car jump back from it for 6 s, crying out in fright;
  once clear they are shocked for 3 s (crying out in shock). Farther witnesses are shocked at once.
  A walker who comes on a body is shocked for 2.5 s. Each is a `Witness` (saved), and its shock ends
  in a choice: a grown-up with no kids who can see the body stays by it for 20–40 s with a chance of
  0.4, while fewer than 4 already gather within 3 m of it; everyone else runs from the body for 6 s.
  A witness who only heard it through a house never goes to stand by the body.
- **A knockdown** draws a 4 s look and nobody goes over: the victim is up and running after 2.5 s.
- A witness's, a shocked person's and a gatherer's point keeps to the body lying within 2 m of it
  as the body slides to a stop.
- **Parties.** A leader stays by a follower knocked down while it lies there, and followers by a
  knocked-down leader. A leader whose follower is killed stops running as soon as nothing comes at
  it, is shocked for 3 s if it saw the killing, then keeps a 120 s vigil by the body, crying out in
  shock, and walks on. A partner whose leader is killed lets go and keeps the same vigil. A kid whose
  parent is killed stays by the body, going back to a body within 40 m whenever something drives it
  off, until both are despawned: it never walks alone. A kid cries out in fright when its family
  runs and its leader cried out in that step, or when its leader falls. In a staged scene, a car at
  25 m/s kills a child beside its mother at 1.2 s; she is shocked at 1.3 s, begins her vigil at
  4.3 s and stands 2.36 m from the body from about 12 s.

## Knockdowns, deaths and score

`Contacts` (`systems/contacts.ts`) resolves touching bodies after physics. Nothing is ever shoved
through a wall.

- **Car and car**: they separate by mass share and exchange an impulse (restitution 0.2).
- **Car and a standing person or a light animal** (a dog, a cat, a pig): a car moving into them
  faster than 3 m/s (`KNOCK_SPEED`) knocks them down for 2.5 s or kills them (below). They are
  thrown with 0.6 of the car's velocity plus 3 m/s away from it. Slower, the car pushes them aside.
  One pinned against a wall stops the car instead (a wall hit for the car, [Damage](#damage)). The
  car's own speed decides, so running into a parked car never floors the runner.
- **Car and cow** (an animal of 200 kg or more): it meets the car like another vehicle would: they
  separate by mass share, the cow never shoved through a walk wall, and exchange an impulse
  (restitution 0.2). Closing faster than 3 m/s is an `Impact`; only faster than 6 m/s
  (2 × `KNOCK_SPEED`) does she fall, or die. A Panda nudging a cow at walking pace shoves her.
- **People and animals** step apart, each moving by the other's share of the mass (a person 70 kg,
  an animal its species' mass × its size³). The members of a party do not.

A vehicle that knocks a pedestrian or an animal down kills them with the chance
1 / (1 + e^((h − v) / 3.59)), v the impact speed and h the speed that kills half the time, rolled
with the world's `Rng`. The curve is fitted by least squares in log-odds to Tefft 2011 (AAA
Foundation for Traffic Safety): 10, 25, 50, 75 and 90 % at 23, 32, 42, 50 and 58 mph (10.3–25.9 m/s),
where the fit gives 9.7, 24.7, 53.3, 75.6 and 89.3 %.

- h is 18.3 m/s for adults, and for kids (an estimate), and 13.8 m/s for elders: 4.5 m/s lower, an
  estimate after Tefft's age comparison, in which a 70-year-old struck at 25 mph runs the risk of
  severe injury or death of a 30-year-old at 35 mph, carried over to death alone. An elder hit at
  11.2 m/s (25 mph) dies 32.6 % of the time, an adult at 15.6 m/s (35 mph) 32.0 %.
- An animal's h is its species' `lethal` speed ([Animals](#animals)).
- Nobody dies under 5 m/s, and no vehicle kills the player; a blast can
  ([Explosions](#explosions)), and so can a train, which strikes by a curve of its own
  ([What a train strikes](#what-a-train-strikes)).
- The killed get `Dead` (the step they died) beside their `Down`, are thrown like a knockdown, and
  lie where they slide to: the dead never get up. The `Impact` says `fatal`.

`Recover` lifts the knocked down when their 2.5 s are over, never the dead: a pedestrian then runs
along its route away from the nearest vehicle for 4 s, an animal bolts from it for 3 s. The player
can be knocked down too, and cannot act until they get up.

`Score` has two counters, kept in the save but not shown: the HUD has no score until its design is
settled.

- **Auto rubate** (cars stolen): +1 on the first entry of a vehicle or a train.
- **Persone investite** (people hit): +1 for each person the car (or the train) the player is
  driving knocks down or kills. Animals score nothing.

## Population

As many people are out around the player as live nearby, in parties on the streets they live on,
and the traffic keeps the roads busy. `Populate` (`systems/populate.ts`) runs every 0.5 s around
the player and spawns out of view, farther than `VIEW_REACH` (90 m, the farthest ground the camera
shows). The animals have their own system ([Animals](#animals)).

| | Traffic | People |
|---|---|---|
| At most | 10 | `peopleOut` living people (below), never more than 22 |
| Spawn distance | 110–220 m (edge midpoint) | 90–120 m |
| Spawns per run | 2 | 3 parties |
| Despawn beyond | 320 m | 140 m, the dead too |
| Also despawned, once beyond 90 m | more than 12 m off its road, or 4 unstick tries | a living walker blocked for more than 5 s; the followers, people and dogs, of a leader that has gone |

- New traffic is 75% Pandas, 15% Apes and 10% trucks, falling back to a smaller model where one
  does not fit. It spawns at least 15 m from any vehicle and from the middle of any level crossing
  (`SPAWN_CLEAR`, `rail/roads.ts`: brought out at an edge's middle, a car could stand on the box),
  clear of walls, heads out of dead-end spurs, and starts at 0.6 × cruising speed. Each rule turns
  a spot down after its draws, so a spot turned down draws what one in a wall would.
- The player's car is never despawned. Parked, stolen and carjacked cars are not traffic, so they
  stay where they are left. A destroyed vehicle, traffic or not, goes once it is beyond 90 m
  (`VIEW_REACH`), out of view. A body lies where it fell until it is beyond 140 m, as the living
  do, so a player who drives off and turns back finds it still there with whoever stands by it.

### How many people are out

Each home holds residents in proportion to its floor space (`src/sim/population/density.ts`): its
footprint × its floors (eave height / 3 m, 1–5) × 0.3 (`LIVED_IN`, an estimate: many village houses
in the Apuan valleys are holiday homes or empty) / 56 m² (`GROSS_PER_RESIDENT`: ISTAT's 2023
average occupied dwelling is 101 m² for 2.25 people, 45 m² each, and walls and stairs take about a
fifth of the gross). Homes are the CTR's houses and the OSM homes (`house`, `residential`, `yes`,
`apartments`, `detached`, `semidetached_house`, `terrace`, `farm`, `bungalow`), ruins left out. The
map's homes hold 3,247 residents.

`peopleOut` is 0.09 (`OUT_SHARE`, an estimate of the share of residents out on the street by day) ×
the residents within 140 m of the player, rounded, at most 22. Only the living count.

| Spot | Residents within 140 m | People out |
|---|---|---|
| Gragnola's centre (−1751, 3360) | 195 | 18 |
| Vinca (2273, −2620) | 166 | 15 |
| Monzone Alto (−34, −300) | 115 | 10 |
| Monzone, the player's start (−412, 438) | 96 | 9 |
| Equi Terme (1804, 721) | 98 | 9 |
| The SR445 out in the country (−279, 3736) | 0 | 0 |

The most anywhere on the map is 19, at (−1700, 3367) in Gragnola, so the cap of 22 leaves room for
a party's followers and never binds.

### Where they come out

- A party comes out on a walk edge drawn by the residents within 60 m of its midpoint
  (`residentsAlong`), so the village centres fill first. An edge with fewer than 6 (`PEOPLED`, within
  `EDGE_REACH` = 60 m) never gets one: a lone house or two, the woods and the fields stay empty.
  2,309 of the map's 23,228 walk edges are peopled.
- The leader stands on a verge at a random point along the edge, never inside a building (where a
  verge runs into houses that crowd the road) and clear of walk walls and the water's edge; 4
  spots are tried a party.
- Each follower stands at its place beside the leader, or at the mirror place where that is taken;
  with room for neither it stays home, so a kid never comes out alone.

### Parties

Who goes out together (`src/sim/population/parties.ts`). The weights are TUNED so that the people
out are Fivizzano's residents by age (ISTAT, 1 January 2025: 7.7 % under 15, 53.8 % aged 15–64,
38.5 % over 65); kids come out only in families, so families are rarer than the kids' share
suggests.

| Party | Weight | Who |
|---|---|---|
| A lone adult | 0.34 | |
| A lone elder | 0.25 | |
| A pair | 0.13 | two adults or two elders (elders 42 % of the time, `ELDERS`) side by side, the second 0.7 m to one side |
| A family | 0.075 | an adult, or a grandparent 25 % of the time (estimate: Italian grandparents often mind the kids while the parents work), with one kid, or two 40 % of the time (estimate), each 0.5 m to a side and 0.4 m back; two walk one on each side |
| A dog walker | 0.09 | an adult or an elder (42 %) with a dog on a lead 0.5 m to a side and 0.9 m back |
| Neighbours | 0.12 | two grown-ups (each an elder 42 % of the time) stopped on the verge 1.1 m apart (`FACE_TO_FACE`), facing each other, chatting for 30–120 s (`DOORSTEP`, estimate: a chat on the doorstep); then each walks away from the other, the neighbour on up the lane, the leader back down it |

- A family is of one origin: its kids take the leader's, and its natural hair or one shade fairer
  (40 % of the time, `FAIRER`, estimate; red stays red). A kid whose grown-up has greyed or dyed
  hair draws from the kids' colours. A partner shares the leader's origin 90 % of the time
  (`SAME_ORIGIN`, estimate).
- Over 100,000 parties: kids 7.7 %, adults 54.5 % and elders 37.8 % of the people, 1.35 people a
  party, 50.6 % women and girls, 2.9 % darker-skinned, a dog with 9.1 % of the parties and
  neighbours 12 %.

### Looks

`lookOf` (`src/sim/population/looks.ts`) draws a person of an age group:

- **Sex**: women and girls are 0.49 of kids (the birth ratio of 105 boys to 100 girls), 0.48 of
  adults and 0.55 of elders (1,453 of Fivizzano's 2,656 over-65s; ISTAT, 1 January 2025).
- **Origin**: 3 % have darker skin (`DARKER`, an estimate: Fivizzano's foreign residents are 6.2 %,
  428 of 6,907, and 37 % of Massa-Carrara's are African or South Asian, which gives 2.3 %, a little
  more with those who took Italian citizenship), in North African, South Asian and West African
  tones, with black or dark brown hair until it greys. The rest have Italian tones, light to olive.
- **Height**: men 1.75 ± 0.068 m and women 1.62 ± 0.062 m (between NCD-RisC 2016 and the CUORE
  survey of 2018–19); elders 5 cm shorter (an estimate); kids 1.00–1.45 m, about 4 to 11 years old
  (WHO growth medians).
- **Hair, hairdo and clothes** (estimates): mostly dark brown or black hair, some blond, rare red;
  kids fairer, elders grey or white (many elder women dye theirs chestnut or auburn). Men short,
  bald for 12 % of adults and 40 % of elders, a flat cap (the coppola) on 30 % of elder men; women
  long 45 %, a bun 25 %, short 30 %, elder women mostly short or in a bun. Men in trousers 85 % and
  shorts 15 %, elder men always in trousers; women in trousers 45 %, a skirt 30 %, a dress 25 %,
  elder women mostly in a skirt or a dress; kids more often in shorts. Kids wear brighter colours,
  elders muted ones; a dress is the skirt in the shirt's colour.
- The player is an adult man, 1.78 m tall, in a yellow shirt. A carjacked driver is a random
  grown-up.

### The first fill

`setup` peoples the start before the first frame: `FillPeople` puts out `peopleOut` people in
parties from 4 m (`FILL_NEAR`: round the player, none on them) to 120 m, and `FillAnimals` the
animals `PopulateAnimals` keeps, the cats out to 120 m and the farm animals to 140 m. The title card
hides them coming; after it, people and animals spawn only out of view. Over 40 seeds at the start:
9.2 people out (the target is 9), 2.75 of them within 45 m (the residents there are 28 % of those
within 140 m), 2 cats and 2.8 free dogs. Standing still 3 minutes (seed 11), the player has 2.7
people within 45 m on average at the start, and 3.3 in Gragnola's centre.

### Limits

- After the first fill people come out only out of view, and neighbours chatting stand where they
  came out, so a player standing still hears a chat only when one starts near; one walking about
  meets them.
- In Vinca's narrow alleys about half the walkers stall in place, blocked by the walk walls
  whatever way they choose: of 8 walkers staged at its centre, 4 never move in 2 minutes, with a
  random walk choice as with this one. Vinca's centre stays nearly empty.
- The clock and the weather change nothing here: as many people and animals are out at 03:00 or
  in a thunderstorm as on a fine morning (`OUT_SHARE` is a share by day), and nobody takes shelter
  from the rain.

## Animals

Dogs and cats live in the villages, cows and pigs on the farms out in the country. `Animals`
(`systems/animals.ts`) moves them, running from what `scare` (`systems/fright.ts`) finds them
afraid of, `Startle` (in the same file) scares cats and pigs at a crash, and `PopulateAnimals`
(`systems/populate-animals.ts`) keeps them around the player.

| Species | Radius (m) | Mass (kg) | Walk (m/s) | Run (m/s) | Home range (m) | Lethal (m/s) |
|---|---|---|---|---|---|---|
| dog | 0.3 | 25 | 1.2 | 7 | 20 | 9 |
| cat | 0.15 | 4.5 | 0.7 | 7 | 12 | 7 |
| cow | 0.75 | 600 | 0.9 | 4 | 35 | 22 |
| pig | 0.4 | 120 | 0.6 | 4.5 | 8 | 13 |

`FAUNA` (`src/sim/fauna.ts`): the radii fit the drawn bodies; a cat weighs 3.5–4.5 kg; a Bruna
Alpina cow 600–650 kg (the local Pontremolese 450 kg, ARAER breed sheet); a cow led between pasture
and milking parlour walks 0.92 m/s (55 m/min, Massey University grazing studies). The other walks
are estimates; the runs, home ranges and lethal speeds (the impact speed that kills half the time)
are TUNED. Each animal is 0.85–1.15 × its species' usual size (estimate), its radius × that and its
mass × its cube. Coats, by share (estimates): dogs black, brown, tan, white (a Maremma sheepdog),
or tan, black or brown with white; cats grey tabby (35 %), black, black and white, orange, white,
calico; cows crossbred 30 %, Limousine 25 %, Bruna Alpina 15 %, Frisona 15 %, Chianina 12 % (Tuscan
herds are mostly crossbred, Limousine and Chianina beef cows: University of Florence survey of
Tuscan cow-calf farms) and the Pontremolese, Lunigiana's own breed with 35 head in 2022 (ARAER), 3 %;
pigs pink 70 %, black 10 %, Cinta Senese (black with a white belt) 20 %.

### What they do

- **Water.** Animals keep out of the water as people do, unless they bolt; a cow wades a shallow
  slack stream to its pasture, and in deeper or faster water an animal paddles for the nearer
  bank ([water.md](water.md#people-and-animals-in-the-water)).
- **Roaming.** An animal rests (a cat 4–20 s, a dog 3–12, a cow 8–40 grazing, a pig 4–15; TUNED),
  then walks to a random point within its home range of home where it may stand: cows on pasture
  cover (meadow, grassland, farmland), pigs on open ground, cats and dogs anywhere outdoors. A
  point on the railway's track at grade or over it is brought back to the animal's side, 3 m off
  the centreline beside where it was drawn (`ownSide`, `rail/bodies.ts`, with the same draws), so
  animals never wander onto the line; a line on a bridge or in a tunnel there is no barrier. Blocked
  for 1 s on the way it picks another point; with 4 points that will not do, it rests again.
- **Fear.** What scares each species (TUNED; a crash is `Startle`'s, below):

  | Species | A vehicle | A person | A horn | A train's whistle | A crash or a body struck | Cries out (`Cry`) |
  |---|---|---|---|---|---|---|
  | cat | faster than 3 m/s within 8 m | on the move (faster than 0.3 m/s) within 2.5 m | | within 30 m | within 20 m | fright, 50 % |
  | dog | faster than 8 m/s within 6 m | | | within 20 m | | fright, 30 % |
  | cow | faster than 8 m/s within 10 m | | an AI `Honk` within 15 m | within 40 m | | surprise, 50 % |
  | pig | faster than 5 m/s within 8 m | within 3 m | | within 30 m | within 20 m | fright, 80 % |

  A train's car counts as a vehicle by the distance to its body (a car's middle can be 10 m from
  an animal beside its end), and only on the animal's level. A train's horn sounds 120–125 dB(A)
  at 5 m (UIC 644), about 20 dB over a car's (an estimate), so its whistle carries further than an
  AI horn.

  A scared animal runs at its running speed for 2–5 s away from the threat, and from a vehicle off
  its path (away from the point beside it on the car's path ahead); scared again while running, it
  runs at least 2 s more. It cries out only when the fright is fresh.
- **Startle** runs right after `Perceive`: cats and pigs within 20 m of a vehicle's crash at 4 m/s
  or more, or of a person or an animal struck, run in the step it happens. It reads that step's
  `Impact` events, which a save does not keep. The struck animal itself is skipped: it bolts when it
  gets up.
- **Barking.** A free dog that is walking or done resting barks (a `Cry` in anger) at the player on
  foot within 12 m (about once a second), at a walker coming within 6 m (30 %) or a vehicle faster
  than 2 m/s coming within 10 m (40 %), then stands facing them for 8 s: at most one bark every 8 s.
- **A dog on a lead** keeps its place by its walker by the same rule as a person
  ([Walking together](#walking-together)), up to its own run of 7 m/s; it stands when the walker
  stands and runs when the walker flees. When the walker is gone or knocked down it lets go and
  stays where it is; when the walker is killed it lies by the body for 60 s (`MOURN`, TUNED), then
  wanders from there.
- Knocked down or dead, an animal slides to a stop; knocked down, it gets up after 2.5 s and bolts
  from the nearest vehicle for 3 s ([Knockdowns, deaths and score](#knockdowns-deaths-and-score)).
- Traffic brakes for an animal in its way, standing or lying dead, and waits for a living one as
  for a person ([Traffic AI](#traffic-ai)).

### Where they live

A farm (`src/sim/population/farms.ts`) is a house, barn, shed, `farm_auxiliary` or silo, not a ruin,
whose centre lies on meadow, grassland, farmland or farmyard cover. It is rural when fewer than 60
residents live within 140 m (`RURAL`, TUNED), and a pen (pigs live there) when it is a barn, shed or
`farm_auxiliary`, or stands on a farmyard. The map has 2,405 farms, 1,710 of them rural, 796 pens
and 647 rural pens. A pasture for a herd is meadow, grassland or farmland no steeper than 0.47
(25°, TUNED), 15 m from any building, 5 m from any road's edge (roads in tunnels left out) and within
250 m of a rural farm.

`PopulateAnimals` runs every 0.5 s and keeps each kind's count near the player (`ANIMALS`); cows and
pigs come out only where the player is out in the country, with fewer than 60 residents within
140 m:

| Kind | How many | At most | Where they come out | Despawned beyond |
|---|---|---|---|---|
| Cats | 0.02 × the residents within 140 m (Italy keeps about 0.2 pet cats a resident, 11.9 M cats for 59 M people, Assalco–Zoomark 2025; about one in ten out on the street at a time is an estimate) | 5 | 90–120 m out, on a peopled walk edge's verge 0.3–1.2 m past the walkers' line, or 1–3 m off the wall of a house along it | 140 m |
| Free dogs | 0.15 × the farms within 140 m (TUNED: about one farm in seven has its dog lying out in the yard) | 3 | 90–140 m out, 4–8 m off a farm building, on open ground | 140 m |
| Cows | 0.15 × the rural farms within 250 m (TUNED) | 8 | a herd of 2–5 around a middle 90–140 m out on pasture, each within 8 m of it on grass, 2.5 m apart | 180 m: a herd grazes up to 35 m from where it came out |
| Pigs | 0.15 × the rural pens within 140 m (TUNED) | 5 | 1–3 by a pen, 5–15 m off it on open ground | 140 m |

- Each run brings out at most one cat, one dog, one herd and one litter, never indoors and clear of
  walk walls, the water's edge and the railway's track at grade (3 m or more off a line's
  centreline, `offTrack` in `rail/bodies.ts`: 18 of 362 animals brought out along the line came out
  on it before, and a train braked for them). Every animal beyond its kind's reach is despawned, the
  dead and dogs on a lead included. Dogs on a lead come with their walkers ([Parties](#parties)) and
  count for no kind.
- Free dogs come out in village outskirts too, where houses stand on meadow or grassland cover
  (Monzone's start has 65 farms within 140 m, Equi Terme 111, Gragnola's centre none).
- With the player staged at each spot for 30 s: Gragnola's centre 4 cats; Vinca 3 cats; Monzone Alto
  2 cats and 2 dogs; Monzone's start and Equi Terme 2 cats and 3 dogs; the SR445 none; the farm at
  (375, 388) 8 cows, 2 pigs and 3 dogs.

## Trains

One AI train runs each line of the map end to end and back, calling at every station, with no
timetable; level crossings close for it, traffic queues at them, people hold short of them and
animals keep off the line. A train stops for what is on its track if it can and strikes what it
cannot avoid, but only what is on its level. The player can steal one at its cab and drive it
([Driving a train](#driving-a-train)). The systems are in `src/sim/rail/`
([architecture.md](architecture.md)); the render draws the trains, lit at both ends, and the
crossings' arms and lights ([Trains and crossings](architecture.md#trains-and-crossings)), and the
audio plays the trains, their horns and the crossings' bells
([Trains and level crossings](audio.md#trains-and-level-crossings)).

### The service

The same on every line, from `MAP.railway` alone (`rail/service.ts` drives the trains,
`rail/dispatch.ts` brings them in and takes them off), so a map with more railways needs no new
code:

- **A line** (`LINES`, `rail/lines.ts`) is the map's running track from one terminal to the other
  ([map.md](map.md)), joined into one polyline in arc length s (0 at its first terminal) and
  extended straight and level past both terminals: over the drawn apron (`DRAWN_RUN`, 192 m, the
  render's) to the end of the run-out, where trains enter out of view. Each run-out is sized from
  the line speed at its end (`runOut`): the strike-in of a box at the map's edge
  ([Level crossings](#level-crossings)) plus the longest train's length, and never less than the
  drawn run, so a train entering at that speed is beyond view and finds even that box down before
  it would brake for it: 1128.6 m at 85 km/h, 2057 m at 130. Today's one line, Lucca–Aulla from
  the east edge by Minucciano to the north edge toward Fivizzano, is 10,910.9 m, with Equi Terme at
  s 4103.7–4239.3, Monzone at 6675.7–6779.4 and Gragnola at 10093.9–10240.
- **Shared track.** Lines that run on the same pieces of `MAP.rail`, or past the same terminal,
  share that track (`SHARED`): one line's s there maps onto the other's, either way round, one
  stretch for as many pieces in a row as they share (`sharedTrack` joins them, so two trains
  meeting over a joint are pushed apart just to touch). The build makes such lines at every
  junction, a branch sharing the main line up to it. Each AI train keeps clear of every train on
  its track, whichever line it runs, and each level crossing closes for the trains of every line
  crossing it. Trains of two lines sharing track run it the same way: a new game faces them so,
  and no train enters toward another line's train running at it there (below). Two AI trains that
  still meet head-on both brake to a stand 30 m apart ([The AI driver](#the-ai-driver)). Measured
  on a map with a second line running the first's whole track the other way round
  (`service.test.ts`): 2 h of game time from a new game in each of seeds 1–6, 25–28 trains run,
  none strikes another and no two stand face to face.
- **One train per line.** It calls at each station in turn, stopping centred on the platforms, and
  dwells 30–60 s (`DWELL`: opening, the passengers, the 3 s closing warning and closing take about
  30–45 s at such halts, after Rail Engineer's door timings, and the timetable books 1 min). A
  dwell runs on the game clock: while the day stands still (behind the title card, or at the dev
  menu's rate 0) the train waits on. Past its last station it runs on at line speed and is removed
  in the step its whole body runs past the drawn run, beyond view (`Dispatch`). The line's next
  train is then due after a layover of 60–180 s (`LAYOVER`), from that end, going the other way.
  The dwells and layovers are the "small random delays"; they draw from the railway's own stream,
  `RailRng`, never from `Rng`, so trains change nothing traffic, people, animals or parking draw.
- **A stolen train** is its line's one train while the player has it: the line gets no other
  (unless a `SetTrains` call brings one in, which keeps 30 m behind it as behind any train). Once
  the player has left it and all of it is out of view (`VIEW_REACH`, 90 m, as people and cars are
  quietly removed), it is removed, and the line's next train is due after a layover, from the end
  nearer where it stood. Left in view (Monzone's platforms are 58.6 m from the start, where the
  player comes back too), it stays, and so does the line's wait.
- **Entering.** A due train enters with its tail at the run-out's end, at line speed, once no AI
  train runs on its line, no train is on its run-out and none lies within its braking distance
  ahead of its nose, short of `KEEP_BEHIND` (`entryClear`: the driver's plan, 0.6 m/s² begun 1.5 s
  early, plus 30 m; 530 m from 85 km/h), and no AI train of another line runs the other way on
  track the two share, anywhere on it: it would meet that one head-on, so it waits until that one
  has run off. Entering 1 m outside that clearance of a train standing on
  the line, it stops 30.2 m behind it, braking at 0.609 m/s² at most.
- **A new game** starts with each line's train already dwelling at the station nearest the player's
  start whose platforms no train placed already stands on, with 30 m to spare (lines sharing track
  take the next nearest; a line with every one taken gets its first train from a run-out), its dwell
  drawn from `RailRng` (`FillTrains`). It faces the way that takes it past the line's point nearest
  the start, so it passes the player (drawn from `RailRng` where either way does), unless a train
  placed already ahead that way on track the lines share faces it: then the other way, and, facing
  one either way, the next station. The player starts 36.8 m from the line at Monzone, 81 m from Via
  Riolo's crossing: the train leaves Monzone toward Equi Terme and passes the line's point nearest
  the start 44–68 s after play starts in seeds 1–16 (behind the title card the day, and the dwell,
  stand still), unseen at 1280×720 ([The first train passes out of view](#train-limits)).
- **`SetTrains`** makes a train due now on every line no AI train runs on (`ApplyTrains`): the
  tests send it, and so do the dev debug menu's "Call trains now" (P, Trains) and
  `gta.trains.call()`. Measured at seed 1 with the player's stolen train standing at Monzone: the
  call made the line's train due, and it entered at once from the Equi Terme end at 85 km/h.

Measured over a round trip from the east end (dry rail unless named; the dwells are those seed 1
draws):

| Run | Terminal to terminal | Of it dwelling | Top speed under 85 / 80 / 85 km/h |
|---|---|---|---|
| east to north, dry | 745.9 s | 112.4 s | 85.0 / 80.0 / 82.6 km/h (the last 711 m start from Gragnola) |
| east to north, wet / under snow | 746.6 s / 750.9 s | 112.4 s | the same; 82.2 km/h out of Gragnola under snow |
| north to east, dry | 825.2 s | 127.4 s | 85.0 / 80.0 / 79.8 km/h (the climb to the east edge, 21 ‰ in the Ugliancaldo tunnel) |
| north to east, wet / under snow | 826.1 s / 831.9 s | 127.4 s | the same |

Every stop of those runs landed 0.22 m short of its stop point, and the hardest braking was 0.612
m/s².

### The AI driver

`TrainAI` (`rail/service.ts`, with `rail/driver.ts`) works each AI train's lever (`CarInput`):

- **The speed it may run at** is the least of the line speed (OSM's `maxspeed`, the lowest under the
  train until its tail clears; a stretch with none at its lower neighbour's, a line with none at 80
  km/h, rank B on a secondary line) and the braking curves to everything ahead it must meet slower:
  a lower limit, its next station's stop point, 30 m behind any train ahead on its track
  (`KEEP_BEHIND`, at that train's speed, on its own line or another's shared track; nearer, 0.5
  m/s slower than it per metre short, `FALL_BACK`, so it drops back: from 15 m behind at 8 m/s it
  is 20.5 m behind 4 s on), 30 m short of where a train coming at it on its track stands once its
  driver brakes as this one plans to (its braking distance on, so two meeting head-on both stop
  30 m apart: 30.2 m from 20 m/s each, 1500 m apart), and 30 m
  short of a level crossing whose arms are not down (`CROSSING_HOLD`: the crossing's protection
  signal clears only once they are, RFI's signal rules art. 53), ahead with its near edge short of
  its next stop.
- **At a crossing not yet down**, standing (under 0.5 m/s) with that hold point within its
  braking distance from the line speed there (the plan below from that speed: 445 m from 80 km/h),
  it waits where it stands until the arms are down, so it never moves off only to brake again;
  past the hold point it brakes to a stand. Standing ready, it has the box closing already
  ([Level crossings](#level-crossings)). Standing in state `run` 50–450 m short of Viale 20
  Settembre (80 km/h there), it waits the 19 s the arms take and moves off 0.7–1 s after they are
  down, the brakes letting go; 550–1300 m short it moves off at once; it never slows for the box.
- **Each curve** is planned at `min(0.6, 0.8·μ(v)·grip·g + g·rise/d)` m/s² (0.6: RAIB's middle
  braking step; 0.8 of the rail's adhesion, which the wheel-slide protection sheds past 0.9; the
  rise or fall to the target over at least 20 m) and begun 1.5 s early, the brakes' ease time. On
  the curve the driver asks the dynamics for the deceleration that meets its target; off it, it
  closes on the speed at 0.5 m/s² per m/s. Once it and the speed it may run at are both under 0.5
  m/s, it lets go of the lever and the brakes hold the train.
- **Calls.** Stopped (under 0.01 m/s) within 3 m of its stop point or past it, it dwells; when the
  dwell ends it runs on to the next station, or off the line past the last.
- **Whistle.** 30 m before the mouth of a tunnel 200 m long or more (RFI's signal rules, art. 5:
  curved tunnels and long straight ones), it sounds a moderately long whistle (`Whistle`, about
  1.5 s, for the audio to play): the Ugliancaldo tunnel (3194.5 m), and those of 271.2 and 225.0 m;
  the 66.8 m one gets none.
- **The look-out** (`rail/lookout.ts`; RFI's signal rules art. 5(e): people on or next to the track
  call for the whistle; the Italian investigation report on the Caluso crossing crash of 2018, of a
  driver at Bojano: the urgent brake and the horn together). A person, an animal or a vehicle on the
  track ahead holds the train (`TrainRun.state` `braking`, `horn`, then `creep`): their body within
  the train's half-width and 0.3 m of the centreline (`CLEARANCE`), on its level (their ground
  within 2 m of the rail head, `LEVEL`), on a platform only reaching into the train's body itself
  (at its very edge, 1.7 m off the centreline), ahead of the nose within its emergency stop and 20 m
  more (`lookoutReach`: v²/(2 × 1 m/s²), the emergency brake under snow, plus 1.5 s of brake ease:
  334 m from 85 km/h, 20 m standing), and short of its next stop by no more than 5 m. Held, the
  driver pulls the emergency brake and sounds the alarm (an urgent `Whistle`, 1.6 s long) on taking
  the hold and every 2 s after it; standing with the track still fouled within 60 m (`HELD_SIGHT`,
  so what it stopped short of keeps it held), it sounds the horn until 10 s (`HORN`) after the
  alarm's last beat (8–10 s from the stand), the alarm going on every 2 s, then creeps on at no more
  than 1 m/s (`CREEP`), its nose pushing what is there off the track, until the way is clear; then
  it runs again. The alarm keeps its 2 s beat however often the train is held again
  (`TrainRun.until`, the step the next is due from), so no two overlap: with the player stepping
  half a pace on and off the track's edge (1.4 and 2.4 m off the centreline) in front of a held
  train every 0.5, 0.8, 1.2 or 2 s for 48 s, the alarms sounded 2.0–4.0 s apart (taking each hold
  with the alarm at once, every 0.5 s they would start 1.0 s apart, each over the last). A vehicle
  touching its body alongside, within 0.1 m of its side (`SCRAPE`), from its nose to its tail, holds
  it too (`touchingAlong`): one it shoved aside and now scrapes past, pinned by a wall, or one that
  ran into its side. So it creeps past at a walk and runs on only once its tail is by. A held train
  is ready to go: it keeps the boxes ahead within their strike-in closed. Measured at Via Riolo: a
  car standing across the track 120 m short of the box, the train 420 m short at 80 km/h, stops 39 m
  short of it, sounds the horn 10 s, creeps 40 m in 40 s, pushes the car 16 m along and 3.4 m off
  the centreline (at 1 m/s: no hit, no damage) and runs on, the box down throughout; a man standing
  on the box, the train 320 m off, hears the alarm at once and runs off the track, and the train
  stands short of where he stood, then goes on.

### Train physics

`TrainPhysics` (`rail/systems.ts`, with `rail/dynamics.ts`) moves every train, AI or not, as one
rigid body along its line, the single-mass model of OpenRails and TrainRuns.jl:
`m·ξ·dv/dt = traction − brakes − (A + B·v + C·v²) − m·g·grade − m·g·curve`.

| ATR 220 Tr "Swing" (`TRAINS`, `rail/models.ts`) | Value | Source |
|---|---|---|
| Cars | 19.535 + 16.5 + 19.535 m = 55.57 m, on Jacobs bogies at the joints, the outer bogies 2.5 m in from the noses | pesa.pl (55.57 m); the FSE poster's side drawing (±0.5 m); pl.wikipedia (B′2′2′B′) |
| Width, height over the rail, floor | 2.883 m, 4.185 m, 0.6 m | pesa.pl, FSE poster, pl.wikipedia |
| Mass, rotating-mass factor | 108 t in service, ξ 1.08 | pl.wikipedia; TrainRuns.jl after Wende 2003 |
| Power at the rail, starting force | 640 kW, 95 kN | estimates: 2 × 390 kW (pesa.pl) × about 0.82 through the hydrodynamic transmission; fitted to the FSE poster |
| Driven share of the weight | 0.5 (4 of 8 axles) | pl.wikipedia |
| Running resistance A, B, C | 2.0 kN, 76 N·s/m, 5 N·s²/m² | Dittus et al. 2011's 100 t DMU, × 1.08 for the mass |
| Top speed | 130 km/h | pesa.pl |
| Full service, emergency brake | 0.9, 1.2 m/s² | RAIB Report 25/2006 |
| Engines | 2 × MAN D2876 LUE623: diesel six, 12,816 cm³, turbo, 390 kW at 1800 rpm, idle 600 rpm, torque 2300 N·m from 1300 rpm (estimate), one per end car; crew doors 2.5 m behind each nose | MAN, pesa.pl |

- **Traction** is the least of the starting force, the power over the speed and the driven axles'
  adhesion, `μ(v) = 7.5/(3.6·v + 44) + 0.161` (Curtius–Kniffler, OpenRails' constants: 0.33 at rest,
  0.23 at 60 km/h), times the rail's grip: 1 dry, 0.6 fully wet (OpenRails' lowest rain factor), 0.5
  under snow, from the weather's wet and snow at the train's nose (`groundAt`); in a tunnel the rail
  is dry. It cuts out past 130 km/h, and backing up past 30 km/h.
- **Brakes** are a share of the emergency rate, held to 0.9 of the rail's adhesion (the wheel-slide
  protection); the curve's drag is Röckl's, 650/(R − 55) N/kN from 300 m up and 500/(R − 30)
  under; the grade is the rise between the train's ends over its length.
- **The lever** (`CarInput.throttle`, −1…1, toward the active cab's facing) is power along the
  motion or from rest, and the brake (up to full service) against it; the handbrake is the
  emergency brake. The power eases from none to full over 2 s, the brakes over 1.5 s (estimates for
  engine spool-up and brake-cylinder fill).
- **Brakes and resistance never reverse a train**: they hold it like static friction at rest. The
  grade does: released on 25 ‰ it rolls back. Below 0.5 m/s with the lever at rest the brakes hold
  it at full service, as a driver's would. No train runs past the ends of its line's run-outs, and
  the player's not past the buffer stops ([Driving a train](#driving-a-train)).
- **Trains that meet** on one track (one line's, or track two lines share) strike each other in
  one dimension, inelastically (restitution 0: what a train strikes is pushed, not bounced off):
  they are pushed apart to touch, the
  lighter the more, and go on together at their common speed. Closing faster than 0.5 m/s
  (`TOUCH_SPEED`: trains couple at a walk) it is a `train` `Impact`, its `car` the train that ran
  faster into the other, `other` the one struck; slower they only touch. A train takes no damage
  and never derails. An AI train with another train against either end (within 0.5 m, `AGAINST`)
  is held as for something on the track ahead ([The AI driver](#the-ai-driver)): the emergency
  brake and the alarm, then the horn and a creep on once the way is clear; one dwelling, shoved
  along, pulls the emergency brake.
- Measured on level track: 0–40 km/h in 16.9 s (0.66 m/s² on average; the FSE poster: at least
  0.5), 0–60 in 32.4 s over 315 m, 0–80 in 56.0 s over 779 m; it holds 97.5 km/h up 15 ‰ and
  72.0 up 25 ‰, and starts on 27 ‰ (the poster: it does). From 80 km/h the full service brake
  stops it in 275 m (24.5 s), the emergency brake in 215 m dry, 221 m wet and 254 m under snow.

### Driving a train

The player steals and drives a train as a car, with the same keys (`EnterExit`, `PlayerDrive`,
`RideAlong`; `rail/boarding.ts`, `rail/collisions.ts`):

- **Boarding.** A train has a crew door each side 2.5 m behind each nose. Within 2 m of one
  (`ENTER_GAP`), the player's `Footing` on the rail's level there (within 2 m of the rail head,
  `LEVEL`: not from a road bridge's deck over it, nor from the road tunnel under it), with no walk
  wall between, and the train moving
  slower than 1.5 m/s (`BOARD_SPEED`, a walk), the action key gets in: the nearest door, unless a
  vehicle's body is nearer still. The HUD prompt offers the same (`ATR 220 Swing`, `carjack` while
  an AI driver is aboard).
- **Stealing.** Taking an AI train removes its driver (`TrainRun`), who gets out of the active cab,
  across it from the player when the player boards there, else by its left door first, or, with no
  door there to step down from (on a bridge, in a tunnel), out of the far cab, and flees along the
  verge as a carjacked driver does; with no door free at either, none appears. The first boarding
  tags the train `Stolen` and scores a theft.
- **The far cab.** Boarded at the far cab, that cab becomes the active one: the train's nose is
  that end, the cab faces the other way, and the power keeps its pull.
- **Controls** (`CarInput`, [Train physics](#train-physics)): up powers toward the cab's way and
  down away from it; against the motion either brakes, up to the full service brake; from a stand
  down backs the train up, no faster than 30 km/h (`REVERSE_MAX`: its power cuts out past it and
  the train's SCMT brakes it, down a grade too); Space is the emergency brake; left and right do
  nothing, so on a touch screen ◀ ▶ hide in a train; H is the horn key, as in a car,
  sounding the train horn's high tone. With no key held the train coasts, and below 0.5 m/s its brakes
  hold it.
- **Riding.** The player rides at the active cab's driver's place, 2.5 m behind the nose, facing
  its way, moving with the train; the camera follows them as a car. The view carries the cab's
  ground (`PlayerView.z`, the rail head there), so the camera stays on the train on a rail bridge,
  where the map's ground is the valley below.
- **Getting out.** Only slower than 1.5 m/s (`boardable`, which the HUD prompt and the touch
  action button ask too, so neither offers `exit` faster), at a door of the active cab, on the side
  of a station's platforms where the door is along them, else its left first (the driver's side, as
  in a car), then its right, 0.6 m out from it: where the door is at grade (on no bridge and in no
  tunnel) between the line's terminals, with ground there on the rail's level (the ground on foot
  nearest the rail head: beside the track over a road underpass, or under a road bridge, it is the
  track's bank, not the tunnel's floor or the deck), clear of walk walls with none between it and
  the track. The player stands on the ground there on the rail's level. None that is: the player
  goes through the train to the far cab, which becomes the active one, so a train stopped on a
  viaduct or in a tunnel can be driven back the way it came, and the action key there again gets
  out at that cab where it can. The train is left on its emergency brake.
- **SCMT and the buffer stops.** The player's train runs no farther than the end of the drawn track,
  192 m past each terminal (`DRAWN_RUN`, the render's apron): a buffer stop there. Its SCMT
  (`supervise`; on overspeed SCMT warns, cuts the traction and brakes, then applies the emergency
  brake, Lupi's railway course, University of Pisa 2022–23) watches its speed against the braking
  curve to the buffer ahead, the
  AI driver's plan (0.6 m/s², or what the rail's adhesion allows, begun 1.5 s early), and, backing
  up, against 30 km/h: over it, it cuts the power and applies the full service brake; 5 km/h over
  (`OVER`, the tolerance of SCMT's continuous supervision), the emergency brake. A train that still
  reaches the buffer stops dead against it, and faster than 0.5 m/s that is a `wall` `Impact` with
  the train as its `car`. Measured with the up key held from 1500 m short: from 20, 30 and 36 m/s
  the train tops out at 98.8, 117.0 and 130.5 km/h, begins braking 663, 923 and 1135 m short, at the
  service brake (never the emergency), and stops touching the buffer, under 0.5 m/s; one 60 m short
  at 25 m/s pulls the emergency brake and strikes it at 22.8 m/s.
- **What it meets**: other trains ([Train physics](#train-physics)), and vehicles, people and
  animals as any train ([What a train strikes](#what-a-train-strikes)): someone it knocks down
  scores a hit, as the car's do.
- **Left behind**, a stolen train goes once all of it is out of the player's view
  ([The service](#the-service)).

Measured, the player's train stolen at Monzone toward Equi Terme, driven on a 0.6 m/s² braking curve
(the test's driver): 2.56 km, climbing 58 m (23 ‰ on average), in 175 s at most 70 km/h, stopped 0.8
m short of Equi's stop point, its body on the platforms; backing up from there, down the grade, at
30.03 km/h at most. Driven at 12 m/s into an AI train running 3 m/s ahead it strikes at 6.6 m/s;
together at 10 m/s, the AI train on its emergency brake (and sounding the alarm) and the player's on
full service, both are under 0.5 m/s 10.6 s later. Into a train dwelling at Monzone at 12.5 m/s,
they stand 6.5 s later, the dwelling train shoved 22 m along.

### Level crossings

`MAP.railway.crossings` gives the boxes (`CROSSINGS`, `rail/crossings.ts`; the cycle and demand
are in `rail/barriers.ts`): today Via Riolo by Monzone, Viale 20 Settembre, Via Castel dell'Aquila
(over Gragnola's two tracks) and Via Nuova, all automatic full barriers (half barriers need a median
the roads lack, CdS art. 44), and Equi Terme's foot crossing, a path over the track: it runs the
same cycle with no arms, light or bell, for walkers.

- **The lines it crosses** (`on`): every line whose track passes within 0.5 m of one of the box's
  nodes (each node is a vertex both the road and a rail piece have; parallel tracks lie 4 m apart),
  at grade there, each with its s, the carriageway's reach either side of it along the line (the
  road's half-width over the crossing angle's sine) and its strike-in. So a box on track two lines
  share, or over two lines' tracks, closes for the trains of each, and it is level-aware: a line
  passing over the road on a bridge, or under it in a tunnel, does not cross it. Today each box has
  one, the map's line; Gragnola's loop, which Via Castel dell'Aquila also crosses, is no line's.

- **Each road approach** has a stop line whose nearer corner stands 3.75 m from the nearest track
  centreline (3.5–4 m keeps a waiting car's nose clear of the train), the box entry and the arm 1 m
  past it, and the arm's post on the right of the way in, 0.5 m off the carriageway, with the steady
  red road light (CdS art. 44). Down, the arm spans the road: 5, 7, 8 and 7 m (RFI's 4–8 m arms, the
  shortest that reach the far edge). The traffic steps leading in, up to the first junction, another
  box or 100 m back, are tabled with their distances to the stop line, the entry and the far side
  (`APPROACHES`), each step into the box it reaches first; Via Riolo's south-east stop line falls
  inside the junction 6.5 m from the box.
- **The cycle** (`LevelCrossings`): a demand lights the light and rings the bell 7 s before the arms
  move (`WARNING`; the law asks at least 5 s, DPR 495/1992 art. 186), the arms come down over 12 s
  (`LOWERING`; the TD96/2 box sets 10–15 s) and stay down; 2 s after the last demand (`RELEASE`)
  they rise over 12 s (`RAISING`). The bell rings in the warning and while the arms come down (art.
  186 c.4); the light is lit from the warning until the arms are up (`crossingAt`, shared with the
  render and the audio). A demand while they rise lowers them again from where they are. Drawn,
  each way in has its arm with three red lamps and a hanging skirt, and the red road light on its
  post; the lamps and the light are lit, by day too, while the light is. The arm hinges on a white
  housing beside the road, each way in has a white stop line, and the track crosses the road on a
  concrete panel, its rails laid over the road
  ([architecture.md](architecture.md#track-and-stations)).
- **The strike-in** (`strikeIn`) is fixed by the line speed at the box, as a real crossing's
  closing point is: the run in which a train at that speed covers the warning, the lowering and 4 s
  to spare (`SPARE`, room for the driver's slack), then brakes on its plan to the hold point 30 m
  short, so the arms are down before it would brake for them. 1073 m at 85 km/h, 45 s there, as a
  strike-in set for 45 s of warning at line speed (the law asks at least 30 s for half barriers,
  art. 187); 986 m at 80 km/h, 2.0 km at 130. A train braking, crawling or standing ready inside it
  keeps the box down rather than letting it rise and come down again.
- **Demand**: a train on a line crossing the box with any part within the box and 2 m either side
  (`MARGIN`); one moving toward it (over 0.5 m/s) with the end leading its motion within the
  strike-in, or within the strike-in at its own speed if it runs faster than the line; or a train
  standing ready to go with the box ahead within the strike-in: an AI train running, or 20 s before
  its dwell ends (`DEPARTURE`: the 19 s the arms take, and 1 to spare), and the player's with its
  lever forward (the bell rings the step the up key goes down, before the train moves; backing up,
  it demands the boxes once it moves). An AI train does not demand a box
  whose near edge (the carriageway and 2 m) lies past its next stop: that one waits for its
  departure, so Via Riolo stays open while a train from Gragnola comes into Monzone and dwells
  there, until 20 s before it leaves; a box its head would stop on is demanded on the way in.
- Measured closures, the bell to the arms fully up, for a train calling at every station (dry; wet
  rail adds at most 0.3 s, snow 2.0 s):

  | Crossing | East to north | North to east |
  |---|---|---|
  | Equi Terme's foot crossing | 73.9 s | 52.4 s |
  | Via Riolo | 66.5 s | 57.7 s |
  | Viale 20 Settembre | 61.7 s | 71.8 s |
  | Via Castel dell'Aquila | 54.2 s | 71.0 s |
  | Via Nuova | 69.8 s | 62.9 s |

  The arms were down every time the train's leading end reached a road box, the bell having rung
  34.7–53.6 s before (35.8–55.4 s under snow); the foot crossing's cycle began 32.1–52.1 s before.
  An estimate from the legal minimums and the TD96/2's settings gives 45–75 s for a regional train
  at 70–100 km/h.

### Around the trains

What the world does about the trains (`rail/roads.ts`, `rail/senses.ts`, `rail/strikes.ts`,
`rail/bodies.ts`), the same on every line, from the map's lines and boxes alone:

- **On its level only.** Every rule between a train and a body applies only where the body's
  ground stands within 2 m of the rail head there (`LEVEL`): a vehicle's from its chassis, a
  person's or an animal's on foot from its `Footing` ([Footing](#footing)). So a train on the rail
  bridge over Via delle Cave by Monzone, over the underpass east of the station (a road in a tunnel
  5.5 m under the track, which crosses it on a 20.7 m bridge), in the Ugliancaldo tunnel under the
  fields (at its middle the ground stands 440 m over the rail) or under the road bridge by Equi
  Terme meets nothing on the other level: a car and a walker on the road under it go on exactly as
  with no train overhead, a cow over the tunnel keeps grazing, and a walker on the deck over the
  track is passed by. Someone on the track itself under the road bridge, or over Equi Terme's
  pedestrian underpass (the track at grade over it), is on the train's level: struck, held for and
  whistled at, as anywhere at grade; walking the track onto the bridge over the underpass, they step
  down under its deck ([Train limits](#train-limits)).
- **Under the rail bridges, in the water.** No deck of a rail bridge is ground anyone stands on, so
  whoever is at one is under it, wading or swimming on the river's bed (someone walking the track
  onto a bridge steps off its end, [Train limits](#train-limits)): a swimmer swept under the
  Aulella's bridge at Gragnola in a spate (its deck 9 m over the bed) is passed over exactly as with
  no train. The three streams that cross the track run through its culverts or under its deck
  ([water.md](water.md#depth-and-current)), so its whole rail bed stays dry there at every flow up
  to the record flood.
- **A train's bodies** (`trainCars`): each car is a capsule along its axis, round at the train's two
  noses (a radius of half its width, 1.44 m) and square at the joints, moving along the track at the
  train's speed, its line's speed its street's pace.

#### Footing

Where each body on foot stands (`Footing`, `systems/footing.ts`), so the railway's rules can tell
its level:

- **Kept from step to step.** Each step, before anything moves (`FindFooting`), every body on foot
  (the player out of a vehicle, each pedestrian and each animal) keeps to the level it was on: the
  ground where it is now nearest its last footing, a road bridge's deck or a road tunnel's floor
  reaching out to its walkers' verges (`footZ` with that height, as the render places a figure).
  So it walks onto a deck or into a tunnel along the road, and stays on the track over a road
  tunnel or under a road bridge.
- **Into a road tunnel's mouth.** An at-grade road's surface never dips under the terrain, and the
  map build cuts the mouths of the underpasses (it once buried them 5.0–5.4 m deep,
  [map.md](map.md)), so walking in along a road keeps to it and onto the tunnel's floor, with no
  rule of its own: one keeping walkers within 6 m of a mouth to their road's profile changed no
  walk's footing by more than 0.5 m (walking in along every road at grade out of every road tunnel's
  mouth, on its centreline, its carriageway's edge and its verge, both sides, from 12 m out to 3 m
  in: 228 walks); off those walks it only held a few metres of verge at the road's level by a 7 m
  road tunnel whose road runs 5 m over the terrain, where every other stretch of that road's verge
  lies on the terrain. Along every road into the road tunnels under the line (`UNDERPASS_WAYS`: both
  ends of the four under its bridges and Equi Terme's pedestrian underpass from the street, nine
  ways), the footing under the track is the floor, 5.5–9.7 m under the rail; the player standing
  there, a train passes over at 25 m/s and they are not struck. Equi Terme's underpass from the
  north, its path joined 1.7 m over its floor, is a map limit ([Train limits](#train-limits)).
- **The first.** One with none yet (just brought out, or from a save made before footings) takes
  its way's road where that is a deck or a tunnel's floor, else the ground at the terrain's level
  (`firstFooting`).
- **Set down.** Getting out of a vehicle, the player stands on the ground beside it on the level
  its wheels stand on, out of a train on the rail's; thrown from a wreck, the same; coming back at
  the start, on the ground there. A driver who gets out and runs starts on the same level.
- Measured on the track over Equi Terme's pedestrian underpass (s 4080, the tunnel's floor 6 m
  under the rail): the player there is struck by a train at 30 m/s, and a man standing there holds
  an AI train 300 m off, which sounds the alarm. Taken from the place alone, they were in the tunnel
  below, and neither happened.

#### Traffic at the crossings

`TrafficAI` keeps to `atCrossings` (`rail/roads.ts`) on each way into a box (`APPROACHES`: the step
the car is on or the next one):

- **Stop for a box not open.** A car stops with its nose 0.3 m short of the stop line (`LINE_SLACK`),
  or, once past it, of the box entry, braking along a 3.5 m/s² curve (`STOP_DECEL`) and then the
  cone's 0.8 m/s per m, and never nearer the track than 0.5 m outside a train's envelope
  (`ENVELOPE_SLACK`; the envelope is the widest train's half-width and 0.3 m, 1.74 m from the
  centreline), measured from its body along its heading: where a junction lies inside the box, as
  at Via Riolo's south-east side, a car coming round its corner is past the table's line and entry
  before it reaches the track. In the warning it stops only if it can at 3.5 m/s² or gentler (one
  braking already, at 6 m/s², `HARD_DECEL`, under the Ape's and the truck's 6.5): else, or past the
  entry, it clears the box, as the law asks of a car already at the line when the light comes on
  (CdS art. 147). From the lowering on it always stops: no car drives onto the track under arms
  coming down or down. A car whose body already reaches into the envelope clears the box, whatever
  the phase. At 7 m/s with the bell just rung, a Panda 12 m short of the line (2.1 m/s² to stop)
  stops; one 5 m short (4.3 m/s²) goes over.
- **Keep clear.** Within 30 m of the entry, a car does not drive onto a box, open or not, while a
  vehicle slower than 2.5 m/s stands in its lane within its length and 2 m past the far side: the
  box is no place to stop. In its lane is within 0.15 m of its footprint, as its braking cone keeps
  clear (`LANE_CLEAR`), and, for one heading its way, 0.5 m more (`PATH_SLACK`): the box's straight
  on past its far side, where the lane is measured from, may stray from where the lane runs (0.37 m
  on Via Volturno, where the road bends a little past the box), the car from its lane (0.14 m
  there), and the cone bends with the wheel. One coming the other way, queued in its own lane, never
  takes the room: it drives through toward the car, and the two holding for each other would wait
  for good. Too near its line to stop there at 6 m/s², it stops short of the envelope instead. That
  hold counts as stuck as usual, so a deadlock beyond the box still unsticks; but no car turns round
  on a road within 12 m of a line's track at grade (`nearTrack`: its turning circle would sweep over
  it), it backs up instead. Measured with a Panda standing on the road's axis 3.5 m past the far
  side of each box, the box open, and a Panda, an Ape and a truck at its road's cruise speed (7–12
  m/s) on every way in each may drive: none stands in the envelope (on Via Volturno from Viale 20
  Settembre a Panda did for 5.3 s at a time with no slack).
- **No backing onto the track.** A car backing up to get unstuck near a box that is not open stops
  0.5 m outside the envelope (`backRoom`): one that has just cleared the box and stands stuck in
  the queue past it, heading away, counts as stuck (nothing ahead of it is a box to wait for), and
  without this it backed onto the track behind it with the arms down. Measured at Via Riolo with a
  Panda stopped just over, its tail 0.5 m short of the far entry and a parked Panda 1 m ahead: it
  backs 2.5 m and stands 1.4 m clear of the envelope, where it backed 4.3 m and 0.5 m into it.
- **The junction before the way in.** Toward a box not open, a car whose way in starts at a
  junction it has not reached does not enter the junction while the way in holds a queue with no
  room for it behind (its length and 2 m): it stands short of the junction by the widest other road
  there's half-width and 0.5 m. The first in line may stand with its tail in the junction: Via
  Riolo's north-west stop line is 3.65 m from the junction with Via delle Cave. Its south-east one
  lies 1.41 m short of the junction where Piazza Paolo Sist and Via Riolo meet, which is itself in
  the box, 4.9 m from the centreline: cars from either arm stop short of the envelope there.
  Measured, a Panda and an Ape coming at 8 m/s from 20 m up either arm (or its whole 8.8 m) keep
  their bodies 2.4–6.1 m from the centreline with the arms down, and 2.4–5.8 m with the box open
  and a car standing just past it. No truck crosses Via Riolo: its ways in are too narrow for one
  (`allowsModel`).
- **Patience.** While a box is not open, every car on a way into it (and any other within 60 m of it
  heading toward it, the queue spilling back past the tabled ways in, found through a static grid of
  the boxes, so the look costs the same however many the railway has: 0.004–0.008 ms a step for 60
  cars with 5 to 2,000 boxes, against 0.23 ms at 2,000 checking each) waits patiently, its stuck
  count frozen: no honk, no backing up, no turning round. That lasts while the arms rise, for 120 s
  from the start of the warning (`PATIENT_FOR`; the closures measured below last 52–74 s), and
  longer only while a train moves within the box's strike-in. A box held down by a standing train
  (stolen and left on it, or an AI train held there) lets its queue honk and turn round after that:
  in the test the first honk comes 6 s after the 120 s, a train across the road counting four times
  slower.
- **Trains as obstacles.** Each car of a train on the car's level is an obstacle in its cone that
  moves on ([Traffic AI](#traffic-ai)).
- **No traffic brought out within 15 m of a box** ([Population](#population)).

Measured at Via Riolo from the north-west, two Pandas arriving 4 m and 14 m short of the junction
with Via delle Cave as the bell rings and a walker on the verge 1 m into the way in, the train 980 m
off at 80 km/h: the first car stands with its nose 0.87 m short of the stop line, the second short
of the junction, its middle 6.9 m from the node; the walker holds 3.5 m from the centreline. The arms
are down at 19 s, the train reaches the box at 46.7 s, they rise from 54.2 s and are up at 66.2 s;
the cars are over the box 3.9 and 6.2 s later, the walker 15.6 s later. Nobody honked or counted as
stuck, and no car came within 2 m of the track while the train was on the box.

#### People and animals

- **Danger and speeding** ([Reactions](#reactions)): each car of a moving train is a vehicle, at its
  line's pace, felt only on its level. Its braking is the emergency rate, so someone ahead in its
  path within its stopping distance cries out in fright.
- **The whistle** draws a look from everyone within 60 m (`WHISTLE_RANGE`); the alarm (urgent)
  sends whoever stands in the train's path, on its track ahead of its leading end within 700 m,
  their body within 1.3 m of the train's side, on its level, running off it in fright.
- **Holding at a crossing.** A walker whose next metre along its way would take it within 3 m of a
  track crossing a box within 30 m (`HOLD_CLEAR`, outside the 2.54 m at which a passing train at
  line speed alarms), while it is not, holds there watching the box: at a road box in every phase
  but open, warning included (CdS art. 147 c.3: not while the light shows or the arms move), at
  Equi Terme's foot crossing while a train demands it. Someone already on the track walks clear.
  Followers stand with their leader, and a dog on a lead with its walker. Walkers wait as
  patiently as drivers (`patientAt`): for 120 s from the warning, while the arms rise, and longer
  only while a train moves within the box's strike-in. Then they walk on, and where a train stands
  in the way they turn back, as a walker blocked does: by a train left across Via Riolo, a walker
  holds 115 s on and has gone another way, more than 8 m from the track, 40 s later.
- **Animals** run from a train's car by its body and from its whistle (`FEARS`, [Animals](#animals)),
  and never pick a place to go on or over the track at grade.

#### What a train strikes

`TrainContacts` (`rail/strikes.ts`), right after `Contacts`, resolves what touches a train's cars on
their level. A train is shoved by nothing and keeps its speed (a car is under a hundredth of its
mass): the other body takes the whole separation and, with no bounce (restitution 0), the train's
speed along the contact.

- **A vehicle** is shoved clear, walls permitting; closing faster than 3 m/s it is a `train`
  `Impact` (its `car` the vehicle, `other` the train), which `CrashDamage` counts as a wall at the
  closing speed. A train striking it faster than 14 m/s (`WRECK_SPEED`, 50 km/h: a train's broadside
  crushes a car a wall at that speed would only dent; an estimate) wrecks it outright, `fatal`: it
  burns and blows up 5–10 s later ([Explosions](#explosions)). One a wall holds, a moving train
  drags along with it, sliding along the wall at the train's pace as far as the wall lets it, and
  wrecks it so faster than 3 m/s (`IMPACT_SPEED`): creeping on at a walk, the AI driver only shoves
  it along, and the AI driver creeps for as long as a vehicle touches its body
  ([The AI driver](#the-ai-driver)). A contact is one `Impact`: only one that begins (the two were
  apart when the step began) is a hit, so a car held against the train is not struck again each
  step, and the blow that wrecks it is the other. Measured under the road bridge by Equi Terme, a
  Panda across the track between the abutments: an AI train coming at 20 m/s stops, sounds the horn,
  creeps into it and shoves it along unharmed; a driverless train at 6 m/s strikes it at 6.2 m/s and
  wrecks it against the abutment 0.57 s later, two hits in all (21 when every step of the drag was
  one), and slid along the abutment it makes 3 wall hits there, not 24. Beside a wall 3.3–5 m off
  the centreline (`BESIDE_WALL`, s 4300 and 4623), a Panda across the track that an AI train from
  400 m at 15 m/s and from 600 m at 20 m/s stops for, then creeps into, is shoved against the wall
  and left beside the track 3.0–3.1 m off its centreline; the train creeps past it scraping its side
  at 1 m/s, then runs on 172 and 175 s after it set out, no hit and no damage. A Panda standing
  across Via Riolo, struck at 18.9 m/s by a train coming at 80 km/h from 60 m (its emergency brake
  on from the first step), is destroyed and thrown 47 m along, off the track and down its bank into
  the Torrente Lucido beside it, where it comes to rest 5 m off the centreline in 0.3 m of water; a
  Panda rolling at 8 m/s into a standing train's side takes a wall's hit at 8 m/s and stops against
  it.
- **A person or an animal** is pushed aside; struck by the train's own speed into them faster than 3
  m/s (`KNOCK_SPEED`; as with a car, running into a standing train only stops the runner) it is
  knocked down and thrown on with 0.6 of the train's velocity and 3 m/s to the side, away from the
  track, or killed, by that speed: a `person` or `animal` `Impact` with the train as its `car`. The
  player on foot too: killed, they come back at the start ([Explosions](#explosions)); in the cab,
  never. A knockdown by the train the player drives scores, as a car's does.
- **The death curve** (`trainDeath`): a train striking someone at v m/s kills them with the chance
  1 / (1 + e^((10.5 − v) / 8.1)), or a car's at that speed where that is higher, nobody under 5 m/s.
  It is fitted by weighted least squares in log-odds to the 2136 train–pedestrian casualties of
  Southwest China in 2011–2020 by train speed ("Characteristics of Train–Pedestrian Collisions in
  Southwest China, 2011–2020", Int. J. Environ. Res. Public Health 2022, 19(10), 6104): 57.3, 57.7,
  71.7, 80.0 and 89.7 % died at up to 50, 51–60, 61–70, 71–80 and over 80 km/h (taken at 40, 55.5,
  65.5, 75.5 and 90 km/h), where it gives 52, 65, 72, 78 and 86 %; at 30 km/h it gives 43 %, where
  a tram kills almost 40 % (Gaca & Franek 2021, "Pedestrian fatality risk as a function of tram
  impact speed", Open Engineering 11). An estimate: the data pools every age, and animals take it
  as people do. At 80 km/h it kills 81 % of adults and 91 % of elders (a car's curve, higher for
  them there), at 30 m/s 96 % of adults.

### Train limits

- **One train per line, no track reserved.** On single track there is no opposing train to protect
  against. Lines that share track (a future map) run it the same way, but a train enters seeing
  only the trains on its own track: a branch's train still on its own track when the main line's
  enters toward it may come onto the shared track and meet it head-on. Then both stop 30 m apart
  and wait for each other for good: the hook is a block table both `TrainAI` and `Dispatch` would
  consult.
- **Terminals are open ends** at the map's edge: the build makes no other kind, and `lines.test.ts`
  fails on a terminal off the edge. A buffer stop inside the map would need the AI train to dwell
  and turn back there instead of a run-out; the player's train already turns back by its far cab.
- **SCMT watches only the buffers and backing up**: the player may run at up to 130 km/h anywhere,
  over the line speed, through a box whose arms are not down and onto another train. The lever
  forward rings the bell at once, but driven off Monzone at full power the train's nose reaches
  Via Riolo, 115.6 m on, 18.3 s later at 11.7 m/s, the arms still coming down (they take 19 s);
  an SCMT hold short of a box not down, as the AI's, would change the controls and is not built.
- **One line's train at a time**: while the player has a line's train, the line runs no other, so
  the crossings and stations along it wait until the stolen train is left and removed.
- **A standing AI train ready to go** keeps every box within its strike-in ahead down for as long as
  it stands there, as a real crossing stays closed for a train held in its approach.
- **The arms are no wall.** A car whose body already reaches the envelope when the arms start down
  clears the box under them, and a walker holds by choice: the arm is drawn down through a car still
  under it.
- **A dead end beside the track.** A car that reaches a dead end within its turning circle of the
  track (Via Castel dell'Aquila's, 5.9 m from it by Gragnola) still turns round there, over the
  track, and may stand on it; traffic is never brought out heading into a dead end and never picks
  one while another way goes on, so only a car pushed or lost there gets in.
- **Fleeing walkers keep to no crossing rule**: someone running from a car may cross a closed box,
  as the look-out then holds the train for them.
- **A train keeps its speed** whatever vehicle, person or animal it strikes, and a car it drags is
  never let go until the wall that held it ends. Trains are never damaged. A car wedged where it can
  move neither off nor along (under the road bridge by Equi Terme, between its abutments) is not
  moved at all: the creeping train passes through it, up to 1.34 m deep for 1.1 s, measured; a
  train that stopped for it instead would block its line for good.
- **Animals can still end up on the track**: brought out off it and walking only to its own side,
  an animal that bolts runs straight away from its fright, over the track too, and a cow shoved by
  its herd can stand inside the envelope (by Gragnola, one rested 1.3 m off the centreline after
  bolting, another 2.5 m off after a shove). The look-out then holds the train for it.
- **The first train passes out of view.** At 1280×720 the view is 427 × 240 texels (`PixelView`
  rounds 720 / 270 up to a 3× upscale), ±26.7 m of ground across and ±30 m deep about the player
  at 8 texels a metre, and the line's nearest point is 36.8 m from the start: in seeds 1–16 the
  train goes by just past the frame's top-right corner, never on screen. A 1440×900 or 1920×1080
  window (480 × 300 or 480 × 270 texels) catches it in that corner for 6.0–6.4 s, under the HUD's
  score. Showing it from the start would take a start nearer the line or a wider view there.
- **No platform passengers**: nobody waits on the platforms or boards.
- **A footpath tunnel's data.** The path into Equi Terme's pedestrian underpass from the north (way
  1306844336) meets it 1.7 m over its floor (264.6 against 262.9 m), so someone walking in that way
  stays on the bank over it, on the track's level: the map build cuts no path's mouth (paths keep
  the terrain's level).
- **Nobody on a rail deck.** The track over a rail bridge is no ground to stand on, so someone
  walking along it onto a bridge steps off the end onto the ground under it: over the underpasses
  at s 6324.6 and s 4777.6, walking the track, the footing falls 5.5 and 5.8 m into the road's cut
  under the deck within 9 m and climbs back out on the far side; onto the Torrente
  Lucido's bridge by Monzone (from s 6599), the player's footing falls from the rail bed's 210.4 m
  to 201.2 m within 7 m, the figure sinking through the drawn deck, and at the mean flow he wades
  the Lucido under the bridge and climbs out on the far side at s 6625. Walls across the rail bed
  at each bridge's ends, or a deck walkers stand on (where a train would strike them), would mend
  it; neither is built.
- **No derailment**: a train keeps to its line at any speed and whatever it strikes, though by a
  rule like OpenRails' (unbalanced lateral acceleration over 2.5 m/s² for a second or two derails,
  over 3.5 m/s² tips) one would leave a 300 m curve at 116–125 km/h, and the map's sharpest curve
  is 193 m (over 20 m chords).

## Tuning

| Where | What |
|---|---|
| `src/sim/tuning.ts` | `ENTER_GAP`, `DOOR_GAP`, `PERSON_RADIUS`, `WALK_SPEED`, `SPRINT_SPEED`, `KNOCK_SPEED` |
| `src/sim/handling.ts` | `HANDLING`: each handling knob's group, name, description, kind, range and step; `REAL_HANDLING`; `HANDLING_PRESETS`, the three presets; `DEFAULT_HANDLING` (a new game's: Balanced) |
| `src/sim/vehicles.ts` | `VEHICLES`: each model's body, mass, wheels, tyres, brakes, engine, gearbox, drag and suspension; `CAR_COLORS` |
| `src/sim/systems/explosions.ts` | `FUSE` (how long a wreck burns before it blows), `BLAST` (who dies, falls, flees, how hard vehicles are hit and shoved), `WASTED` (how long the dead player lies) |
| `src/sim/damage.ts` | `DURABILITY` per model, `SCUFF`, the stages (`STAGE_FROM`), how ground hits count (bump stops, tumbling), how long one crash lasts, the torque a worn engine keeps and how often it misfires |
| `src/sim/tyres.ts` | `GRIP` per surface, wet (`WET`) and packed snow (`SNOW`), the slip curve, ABS and traction-control shares, load sensitivity, the static-friction speed |
| `src/sim/dynamics.ts` | substeps, bump-stop travel, damper limit, the body's ground contacts, in-air tumbling damping, the ground-hit speed |
| `src/sim/drivetrain.ts` | shift points, engine braking, driveline efficiency |
| `src/sim/view.ts` | `screenAxes` (screen axes of the home view), `LOOK_AHEAD`, `VIEW_REACH` |
| `src/sim/route.ts` | lane offsets, passing room (`PASS_MARGIN`), pedestrian verge, `cruiseSpeed`, truck road classes, hairpin limit, the walk choice (`WALK_AHEAD`, `WALK_FLOOR`) |
| `src/sim/systems/populate.ts` | `TRAFFIC` and `PEDESTRIANS` population limits and bands, `OUT_SHARE` (the residents out), `FACE_TO_FACE` (neighbours), `FILL_NEAR` (the first fill), spawn model mix |
| `src/sim/population/density.ts` | residents per home (`HOMES`, `STOREY`, `GROSS_PER_RESIDENT`, `LIVED_IN`), the streets people come out on and walk (`EDGE_REACH`, `PEOPLED`) |
| `src/sim/population/looks.ts` | `FEMALE`, `ELDERS`, `DARKER`, skins, hair and `FAIRER`, hairdos, outfits, clothes, `HEIGHT` |
| `src/sim/population/parties.ts` | `PARTY_WEIGHTS`, `GRANDPARENT`, `SAME_ORIGIN`, `TWO_KIDS`, `DOORSTEP`, the followers' `PLACES` |
| `src/sim/population/farms.ts` | what a farm and a pen are, `RURAL`, `RURAL_REACH`, `PASTURE_ROOM`, `STEEPEST` |
| `src/sim/fauna.ts` | `FAUNA` (each species' body, gait, home range and lethal speed), coats, `SIZE` |
| `src/sim/systems/perceive.ts`, `src/sim/systems/senses.ts` | each reaction's trigger, length and cry chance (`WHISTLE_LOOK`, `HOLD_LOOK`, `TRAIN_SENSED` for the trains), `COOLDOWN`, `CHAT_COOLDOWN`, `SHAKEN`, `VIGIL`; `DANGER`, `USUAL`, `HORN_AIM` |
| `src/sim/systems/pedestrians.ts` | `WALK_PACE`, `RUN_PACE`, `HEIGHT_SPREAD`, `ACCEL`, `STOP`, `TURN`, the gatherers' distances, `FOLLOW_GAIN`, `CATCH_UP` |
| `src/sim/systems/contacts.ts` | `DOWN_TIME`, the death curve (`DEATH_HALF`, `DEATH_SPREAD`, `ELDER_FRAILTY`, `NO_DEATH`), `HEAVY`, `PERSON_MASS` |
| `src/sim/systems/animals.ts` | `IDLE`, `BARK`, `MOURN` |
| `src/sim/systems/fright.ts` | `FLEE`, `FEARS` (a train's whistle's reach included), `CRIES`, `CRASH_SPEED` (Startle) |
| `src/sim/systems/populate-animals.ts` | `ANIMALS` (each kind's share, reach, cap and despawn), the spawn bands and spots |
| `src/sim/systems/spawn.ts` | parked cars (`PARKED`), trucks (`TRUCKS`) |
| `src/sim/rail/models.ts` | `TRAINS`: the ATR 220's cars, bogies, mass, power, resistance, brakes and engines; `MOVING`, the speed over which a train counts as moving |
| `src/sim/rail/lines.ts` | `DRAWN_RUN`, `runOut`, `DEFAULT_SPEED`, `CHORD`, `STOP_REACH` |
| `src/sim/rail/service.ts` | `DWELL`, `KEEP_BEHIND`, `FALL_BACK` (dropping back to it), `LONG_TUNNEL`, `WHISTLE_LEAD`, `AGAINST` (another train against an AI train) |
| `src/sim/rail/dispatch.ts` | `LAYOVER`, `entryClear`; a stolen train left goes beyond `VIEW_REACH` (`src/sim/view.ts`) |
| `src/sim/rail/boarding.ts` | `BOARD_SPEED`; the crew doors are `TRAINS`' `door` |
| `src/sim/rail/collisions.ts` | SCMT's `OVER`, `TOUCH_SPEED` (trains and buffers only touched), the buffers at `DRAWN_RUN` |
| `src/sim/rail/driver.ts` | the plan's deceleration (`PLAN_DECEL`, and `brakingDistance` from it), its share of the adhesion, `GAIN`, `SLACK` |
| `src/sim/rail/dynamics.ts` | `POWER_EASE`, `BRAKE_EASE`, `HOLD_SPEED`, `REVERSE_MAX`, the brakes' share of the adhesion |
| `src/sim/rail/barriers.ts` | `WARNING`, `LOWERING`, `RAISING`, `RELEASE`, `MARGIN`, `CROSSING_HOLD`, `DEPARTURE`, `SPARE` (in `strikeIn`) |
| `src/sim/rail/crossings.ts` | the stop line's clearance, the arms, how near a line passes a box's node (`NODE_REACH`), how far back the approaches go |
| `src/sim/rail/bodies.ts` | `LEVEL` (the level every train rule keeps to), `CLEARANCE` (the envelope past a train's body), how far a picked place keeps off the track (`KEEP_OFF`) |
| `src/sim/rail/lookout.ts` | the look-out's planned brake and margin (`lookoutReach`), `HELD_SIGHT`, `HORN`, `CREEP`, how often the alarm sounds, `SCRAPE` (a vehicle touching a train's side) |
| `src/sim/rail/roads.ts` | `STOP_DECEL`, `HARD_DECEL`, `LINE_SLACK`, `ENVELOPE_SLACK` (how far outside the trains' envelope a car holds), the room past a box (`ROOM`, `KEEP_REACH`, `SLOW`, `LANE_CLEAR`, `PATH_SLACK`), `JUNCTION_CLEAR`, `PATIENT_FOR` (drivers' and walkers'), the queue's reach and heading, `SPAWN_CLEAR`, `TURN_SWEEP` (no turning round nearer a line's track) |
| `src/sim/rail/senses.ts` | `WHISTLE_RANGE`, the alarm's path (`PATH_WIDE`, `PATH_REACH`), the hold at a crossing (`HOLD_LOOK`, `HOLD_CLEAR`, `HOLD_NEAR`, `HOLD_SPAN`) |
| `src/sim/rail/strikes.ts` | `WRECK_SPEED`, the train's death curve (`TRAIN_HALF`, `TRAIN_SPREAD`), the throw (`CARRY`, `THROW`), the train hit's and a crushing drag's least speed (`IMPACT_SPEED`) |
| `src/sim/systems/*.ts` | each system's own constants at the top of its file (physics: steering rates and the speed-sensitive lock; traffic: comfort, leaning, turning room, the cone's `CONE_CLEARANCE`, backing's `BACK_GAP` and `ALONGSIDE`; foot, enter/exit) |
| `src/sim/sky/` | the clock, the map's place, the climate, the odds, the day plan, the regimes and the ground's weather (see [weather.md](weather.md#tuning)) |
| `src/sim/map/kinds.ts` | road widths and which classes carry traffic, the player's car, or only people |
| `src/render/pipeline.ts` | `zoomFor` zoom levels |
| `src/render/swing.ts` | `turnToward` view turn speed; the follow spring's `FOLLOW`, `HOLD`, `SETTLE` and `LAND` |
| `src/render/people.ts`, `src/render/animals.ts`, `src/render/blood.ts` | the figures' proportions and `STOOP`, the frame choice (`STILL_SPEED`, `RUN_GAIT`, `WALK_STEP`, `RUN_STEP`, `TALK_BEAT`), the animals' builds, the blood pools' sizes and `SPREAD` |
| `src/audio/director/levels.ts` | how loud each sound is and how far it carries (see [audio.md](audio.md#known-limits-and-tuning)) |

Gameplay changes need a test: the scenario tests in `src/sim/__tests__/index.test.ts`,
`src/sim/__tests__/walls.test.ts`, `src/sim/__tests__/people.test.ts`,
`src/sim/__tests__/damage.test.ts` and `src/sim/__tests__/explosions.test.ts` stage exact situations
with `src/sim/testing.ts`; `src/sim/__tests__/reactions.test.ts` and
`src/sim/__tests__/aftermath.test.ts` stage reactions on Via Cesare Battisti with
`src/sim/scene.ts`, over several seeds where a rule rolls dice;
`src/sim/__tests__/population.test.ts` checks the looks, parties, density, walk choice and first
fill, and `src/sim/__tests__/animals.test.ts` the animals in a village, at a farm and on a rural
road; `src/sim/__tests__/trains.test.ts` runs the train service with `src/sim/rail/testing.ts` (the
railway stepped alone), `trains-traffic.test.ts`, `trains-strikes.test.ts` and
`trains-world.test.ts` beside it stage the world around the trains (queues and walkers at Via
Riolo, strikes and the look-out, the level under the bridges, in the river under one, over the
tunnel and down a road onto a crossing, the animals brought out off the track and kept to their
side, the draws), `trains-driving.test.ts` the player's train (driven
with `liveKeys`, keys a test plays as it goes), and `src/sim/rail/__tests__/` checks the lines,
the cars, the crossings, the dynamics, the AI driver, the bodies, the look-out, the crossing rules
for traffic, the senses, boarding and the collisions;
`src/sim/__tests__/physics.test.ts` drives each model on flat, sloping and ramped test ground with
`advance` (no walls), and `src/sim/__tests__/handling.test.ts` proves
each handling knob's effect the same way, the weather grip loss's on wet and snowy ground included.
Fixtures find map features by geometry, never by index (`BATTISTI` is the Via Cesare Battisti
traffic edge nearest (-412, 438), eastbound), so they survive map rebuilds. Re-run `pnpm check`
after any change.
