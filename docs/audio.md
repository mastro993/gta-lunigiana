# Audio

Every sound in the game is synthesised at run time with Web Audio; there are no sample files.
Vehicles, trains and the level crossings' bells, people (their steps, and their chatter and cries in
Italian-sounding speech), animals, the wind, the rain, thunder, crickets, songbirds and owls, farm
dogs, church bells and running water all make sound, and each one reaches the player's ears through
a model of outdoor acoustics. A sound gets quieter and duller with distance, is muffled by houses,
hills, woods and snow, shifts in pitch when it moves, arrives late from far away, and fades out
under the background noise. That last step is what lets the player hear only what is near. The
valley sounds as the game's clock and weather say: still at night, roaring in a downpour, hushed
under snow.

Audio is host code beside render and the HUD (`src/audio`). The simulation never imports it; the
audio reads seven of its events (`Impact`, `Skid`, `Honk`, `Cry`, `Lightning`, `Explosion`,
`Whistle`), its components, the level crossings' cycle, the game clock and the weather. No sound
has a gameplay effect.

## Data flow

```
VehiclePhysics, Contacts,
TrainPhysics, TrainContacts Impact─┐
VehiclePhysics ─────────────Skid───┤
TrafficAI ──────────────────Honk───┤
Perceive, Animals, Startle ──Cry───┤
AdvanceWeather ────────Lightning───┤
Explode ───────────────Explosion───┤
TrainAI ─────────────────Whistle───┤
components, Time, GameClock,       │
LevelCrossings, Weather,           │
Input (horn) ──────────────────────┴─► audio schedule (Lunigiana/Hear) ──Heard──► director
                                                                                     │
                                 hold / play / stop / flush, each with a Placement   │
                                                                                     ▼
          speakers ◄── mixer (reverb, limiter) ◄── emitters ◄── synths ◄── Speaker (Web Audio)
```

1. **Simulation events** (`src/sim/schema.ts`). Seven events carry moments; only `Impact`, `Honk`
   and `Whistle` leave a trace in the world's state: the damage an impact does (`CrashDamage`,
   [gameplay.md](gameplay.md#damage)), and the moods both set in the people and animals around
   (`Perceive`, `Startle`, `Animals`, [gameplay.md](gameplay.md#reactions)):
   - `Impact` (`hit`, `x`, `y`, `speed`, `mass`, `car`, `other?`, `face?`, `fatal?`): a vehicle
     hit something this step, with the mass behind it in tonnes (the vehicle's, or the reduced
     mass of two).
     `VehiclePhysics` emits `ground` when a car lands hard or its body strikes the ground rolling
     over, naming the `face` that struck: `under` (the suspension bottoming out over a hump or on a
     landing: routinely 1.5–4 m/s on rough roads, a few steps a landing), `roof`, `side`, `front` or
     `rear`. It emits `wall` for every drive-wall hit that costs over 0.05 m/s, with the
     car's velocity into the wall at contact (a car wedged so that no move fits emits its whole
     speed). The speed lost in the step would be less by what the step travelled before contact,
     the rest lost the next step, so one hit would read as two softer ones: a 15 m/s hit as 7 and
     4 m/s. The contact point is where the car's collision capsule (circles of radius W/2 along
     ±(L/2 − W/2)) reaches furthest in the direction of the lost velocity u (the velocity, when
     wedged): the end circle that leads, W/2 along u from its centre. So an oblique hit lands on the
     front corner, on the wall itself, and a square-on side hit in the middle of the side. The
     speed is never more than the car was going (a push-out of the body is not part of the hit).
     `Contacts` emits `car` when two vehicles close on each other: the closing speed, the reduced
     mass 1/(1/m₁ + 1/m₂), at the contact point (`car` and `other` follow query order, not who
     struck whom). It emits `person` or `animal` for each person or light animal it knocks down or
     kills (`fatal`): the car's speed before a pin stops it, the car's mass, at the body; `animal`
     for a cow it closes on faster than 3 m/s, at the closing speed; and `wall` when a person or a
     light animal pinned against a wall stops a car faster than 3 m/s, as fast as it was going into
     them, at the wall behind them. Trains strike too ([gameplay.md](gameplay.md#trains)):
     `TrainContacts` emits `train` when a vehicle and a train meet faster than 3 m/s (`car` the
     vehicle, `other` the train, `fatal` when it wrecks the vehicle), and `person` or `animal` with
     the train as `car`; `TrainPhysics` emits `train` when two trains meet (`car` the striking one,
     `other` the struck one, the reduced mass) and `wall` when the player's train strikes its
     buffer stop (the train as `car`, 108 t).
   - `Skid` (`car`, `wheel`, `x`, `y`, `z`, `slip`, `amount`, `surface`, `snow`, `step`): a tyre
     slid this step, sideways past its grip, spinning or locked: `slip` its sliding speed in m/s,
     `amount` 0…1 how far past its grip (0.25 an ABS stop at the limit, 1 sliding, locked or
     spinning), on `surface`, `snow` 0…1 how snow-covered the ground is there. The audio ignores
     `snow`; the render lays tyre marks and smoke from it too (slush ruts and white spray on snow).
   - `Honk` (`car`, `model`, `x`, `y`): `TrafficAI` emits it once per stuck episode, when a driver
     has been held up for `HONK_STEPS` (1.5 s; see [gameplay.md](gameplay.md#traffic-ai)).
   - `Cry` (`who`, `x`, `y`, `feeling`): a person or an animal cried out this step, in `fright`,
     `shock`, `anger` or `surprise`. `Perceive` emits it when a pedestrian's mood changes into a
     reaction ([gameplay.md](gameplay.md#reactions)), `Animals` and `Startle` when an animal takes
     fright or a dog barks ([gameplay.md](gameplay.md#animals)).
   - `Lightning` (`x`, `y`, `bolt`, `power`, `seed`, `step`): `AdvanceWeather` emits it for each
     flash of a thunderstorm ([weather.md](weather.md)): a ground strike at (x, y) when `bolt`,
     else a flash in the cloud above it (which may lie off the map), `power` 0…1, and `seed`, the
     integer that draws both the bolt the render shows and the channel the thunder is rendered
     from.
   - `Explosion` (`car`, `model`, `x`, `y`, `z`): `Explode` emits it once when a burning wreck blows
     up, 5–10 s after it caught fire, at its centre of mass (`z` m a.s.l.); the wreck is left a
     charred shell (`Damage.exploded`) that burns no more.
   - `Whistle` (`train`, `x`, `y`, `urgent`): `TrainAI` emits it when an AI train sounds its horn at
     its nose: once, 30 m before it enters a tunnel 200 m long or more, or, `urgent`, while it is
     held by something on the track: on taking the hold and every 2 s after, however often it is
     held again, so no two alarms (1.6 s each) overlap ([gameplay.md](gameplay.md#trains)).
   - The `horn` binding (H) is read only by the audio schedule.

   Events are not saved: snapshots hold components and resources only. `CrashDamage`, `Perceive` and
   `Startle` read each `Impact`, and `Perceive` and `Animals` each `Honk` and `Whistle`, in the step
   it is emitted, so neither determinism nor saves lose one (both tests run with the events emitted,
   a crash included).
2. **The audio schedule** (`src/audio/index.ts`): one system, `Lunigiana/Hear`, ticked once per
   animation frame. It reads the world and builds one `Heard` (`src/audio/types.ts`, its trains
   and crossings in `src/audio/rail-types.ts`):
   - `listener`: the player's pose and velocity, the vehicle they sit in, and the view's yaw, which
     the stereo image turns with: the `View` resource's quarter turns on foot, the yaw that puts the
     car's heading up the screen (`followYaw`) driving;
   - `vehicles`: every vehicle that runs (AI traffic, or the player's car, unless destroyed), moves
     (faster than 0.01 m/s, spinning, or its body rising, falling, pitching or rolling faster than
     0.01 m/s or rad/s, so a car rolling over on the spot is heard) or burns (destroyed, its
     `Damage` at 1, and not yet blown up: `burning` in `src/sim/damage.ts`), however still it lies.
     Parked cars nobody touches are left out, and so is a charred shell once it lies still: it burns
     no more. Each carries the elevation of its centre of mass (`Chassis.z`), its `Damage` amount (0
     as new … 1 destroyed), whether it burns, the engine's revs, load and misfire as the sim's
     drivetrain turns them (`engineRevs` from the `Chassis` gear and shift, the forward speed, the
     `CarInput` throttle, the `Time` step and the engine's wear: what is heard is what pushes the
     car; the load is the pedal's share, the misfire the 0.25 s windows in which a badly damaged
     engine gives no drive, and a destroyed engine has no revs at all), whether its wheels are down
     (not overturned, as `chassis.ts` has it, and its centre of mass less than 0.3 m above where it
     sits at rest over the ground under it), whether its body is down (`hullDown`: a corner of its
     box at or under the ground, as the physics's hull contacts take it: on its roof, side or belly,
     never on the bump stops alone), and its skid: of the `Skid` events since the last frame, the
     most any wheel went past its grip, the fastest any slid, and the surface under the one furthest
     past;
   - `people`: everyone on foot (pedestrians, and the player when not driving), living or dead:
     age group and sex (the voice), the mood and the point (fx, fy) it is about (the player walks,
     about their own position), knocked down, dead, and `with`, the person they walk with: a
     follower's leader, and for a leader its first follower who is a person (a dog on a lead is no
     partner);
   - `animals`: every animal: species, position, velocity, size, its `Roam` mood, knocked down,
     dead;
   - `trains` (`src/audio/rail.ts`): every train, running or standing (its engines idle): its line,
     its active cab's nose `s`, its speed toward +s and the way that cab faces, its cars from that
     cab back (`carsOf` at its `s`: each car's middle on the track with the rail head's z, its
     heading, length, its middle's s and whether it stands in a tunnel), its power packs' revs and
     load (`trainRevs`: through the hydrodynamic transmission the engine idles with the power off
     and runs up to its rated 1800 rpm at full power, the load the power's share), its brakes
     (0…1 of the emergency rate), the rail head at the active cab's driver's place (`cabOf`) and
     whether the player drives it;
   - `crossings`: every road's level crossing (`CROSSINGS`; a foot crossing has no bell), how far
     its nearest arm's post is from its centre (`posts`), and whether its bell rings now
     (`crossingAt` at the `Time` step: from the warning until the arms are down);
   - `happenings`: the `Impact`, `Honk`, `Cry`, `Lightning`, `Explosion` and `Whistle` events since
     its last run, in that order. A flash carries `x`, `y`, `bolt`, `power` and `seed`; an
     explosion its wreck and the point it blew up at (`car`, `x`, `y`, `z`); a whistle its train,
     where it sounded and the rail head under the train's cab car (`z`: the ground knows no rail
     decks), and `urgent`. Each impact
     carries the `body` of the vehicle `car` (and `otherBody` of `other`, for a `car` hit): its
     model, and the zone of its L × W box the contact point lies on, by the face it is nearest in
     proportion (front when along/L exceeds |across|/W, rear when −along/L does, else the side: a
     Panda's wall hit is front to about 54° off square, a T-bone on its front door a side). A
     ground hit's zone is its face's: `under` under, the roof and a side the side (no bumper and
     no airbag, the glass goes), the nose the front, the tail the rear. They come from every
     vehicle, parked ones too (a struck parked car is not in `vehicles`); an impact whose vehicle
     has despawned since is dropped. A hit with a train in it is rewritten as bodies the director
     knows (`railImpact`): a vehicle and a train meeting is the vehicle's own `wall` hit, its
     `material` the train's steel (`sheet`, until a train's own is judged by ear) and the train its
     `other`, so the player driving the train hears it as their own hit; a train's own
     hits (two trains meeting, a hit for each; its buffer stop) are `wall` hits of a heavy steel
     body (the truck's, on the train's front or rear by the nearer end) on steel; a person or an
     animal it strikes is a hit with no `body` (the director never reads one there);
   - `horn`: whether the horn key is held;
   - `sky` (`skyAt` from the `GameClock`): the game time in Unix UTC seconds, the Rome calendar day
     (days since 1 January 1970 there), the hour and minute there, and the sun's elevation over the
     map in degrees;
   - `weather`: a copy of the `Weather` resource, which the director turns into the weather at the
     ears.

   It hands that to the `Audio` service and writes nothing (`src/render/__tests__/index.test.ts` checks it).
   It does no acoustics. Once a system has run, it receives every event of the update steps
   between two frames; `main.ts` ticks the schedule once right after `setup`, so the first steps'
   events are not lost.
3. **The director** (`src/audio/director`) is the `Audio` service: plain TypeScript, tested in
   Node. Each frame (`index.ts`) it:
   - places the ears 1.6 m above the ground under the listener (a bridge deck, not the river under
     it), in a car 1.6 m above the level it stands on (`Chassis.z` − `cg`, so they fly with it),
     or in a train's cab 1.6 m above its floor, 1.2 m over the rail head at the driver's place (on
     a rail deck 20 m over a valley too, `seatOf`), and notes the cabin around them;
   - works out the weather at the ears with the sim's own `conditionsAt` (at the ground under
     them): the air's temperature, the rain and snow falling (mm/h), the ground's wetness and snow
     cover, the fog ([Day, night and weather](#day-night-and-weather));
   - asks the world part for the masking floor and how enclosed the street is (`world.ts`), and
     every 1 s or 10 m looks up the rock faces that echo;
   - lets its vehicle (`vehicles.ts`), train and crossing (`rail.ts`), people (`people.ts`: steps
     and cries), talk (`talk.ts`: conversations), animal (`animals.ts`), world (`world.ts`) and
     thunder (`thunder.ts`) parts place their sounds through the acoustic chain (`hearing.ts`);
   - plays one-shots at once (with their echoes; the direct sound of a crash at most 8 dB over
     gain 1, of an explosion 10, of a thunder or a train's honk 2, `MOST_DB`), and keeps the
     loudest offered continuous voices of each kind up to its cap (`frame.ts`);
   - re-measures a few stale obstacle paths (`occluder.ts`) and flushes the speaker.

   Time is the speaker's clock. Before the AudioContext exists it reads 0 and the frame is not
   `live`: the director still tracks who sits where, but measures and plays nothing, thunders no
   flash and rings no bell. A frame longer than 0.25 s counts as a stall, not as time passing.
4. **The speaker** (`src/audio/speaker.ts`) plays the requests with Web Audio. `hold(key, sound,
   at)` keeps one live voice per key, built from the `Voices` table on the first frame it is held
   and updated every frame after; at `flush` every voice not held since the last flush fades out
   and is freed. `play(sound, at, delay)` schedules a one-shot from the `Shots` table. At most 32
   one-shots play (or wait to) at once: a new one replaces the quietest if it is louder, else it is
   dropped. `stop(sound)` fades out every play of that params object, its echoes included, with a
   0.25 s time constant (`STOP_FADE`: a tail under a louder sound ebbs away, 35 dB a second); the
   director stops a thunder so. A synth that throws is logged once and that kind is muted for the
   session; the game loop never sees the error.
5. **Emitters and the mixer.** Each voice or one-shot plays through its own emitter
   (`emitter.ts`): a lowpass (Butterworth, at the placement's cutoff), the placement gain, a
   stereo pan, and a send to the shared reverb. A started `ConstantSourceNode` carries the Doppler
   shift in cents into the synth's detunes. Gain, pan, send and pitch glide with a 50 ms time
   constant, the cutoff with 100 ms. The mixer (`mixer.ts`) sums the dry signals and the reverb
   return into a master gain (0.8), then a limiter (threshold −6 dBFS, knee 6 dB, ratio 12, attack
   1 ms, release 250 ms, its built-in makeup gain of 2.14 dB trimmed off), an analyser for the
   level meter, and the output. The 1 ms attack holds the near sounds that still go past gain 1 (the
   own horn and siren, a clunk, a door): before their cap, crashes got through a 3 ms attack to
   +0.1…+2.4 dBFS (see [Calibration and mix](#calibration-and-mix)).

## Where state lives

- **Nothing is saved.** The events are transient, and the audio host never writes the world.
- **The director's memory**, all of it per entity and pruned:
  - vehicles: the listener's car and the running vehicles of the last frame (to hear getting in,
    getting out and the starter), the horn key's last state (the siren toggles on a press), engines
    still cranking, sirens on (off once the car is destroyed), each car's last crash or clunk (to
    merge one hit's steps), the cars scraping, with what they scrape along (and a new wall met but
    not yet switched to), and each car's last skid, held 0.05 s (a frame with no sim step in it, as
    on a 120 Hz display, reports none, and the squeal would flutter). Each entry ends when its time
    is over or its vehicle stops running. Each crashed vehicle's wear, the hardest crush each of its
    zones took, is kept for the 256 most recently crashed;
  - people: per person on foot, the last position, the step phase, the last voice cue and the
    person last heard walking with them (so a death, when the sim takes the party's `Follows`
    away, still finds their own), and the lines waiting for their frame. A person not heard in a
    frame (despawned, or the player now in a car) is dropped;
  - conversations: per pair talking, who speaks first and whose turn it is, when the next line
    may start, the lines said, a party's burst and whether the last line asked; dropped once the
    pair no longer talks;
  - animals: each animal's last call, and the calls waiting for their frame;
  - trains: nothing of their own. Each train's rolling voice keeps, per axle, the s up to which its
    clacks are scheduled (in the voice, `synth/rail.ts`), so each joint clacks once per pass;
  - the valley: the water, farm dogs and owls near the ears (looked up again every 0.25 s or 2 m),
    the eased street, the loudest water heard last frame, each owl's last call, the last bell ring
    (the game's day and hour) and its strokes to come;
  - the thunders: each flash on its way (where it struck, the ground under it, the speaker time of
    the flash, its level, and its render once made) until its sound arrives, and those still
    rolling, until they end;
  - the occluder: the obstacles of each source's path, forgotten 2 s after nobody asks for them;
  - the echoes around the ears, looked up again every 1 s or 10 m.
- **The speaker:** the live voices by key, the one-shots playing, and the kinds muted after a
  failure. The crash, explosion, thunder, speech and animal-call shots keep each render per params
  object (a `WeakMap`), so an echo replays its sound.
- **Static data** never changes once built. The bells are found at load; each line's switches on
  the first train heard (`places/track.ts`); the crossing bell's loop is rendered once per context
  on its first ring (1.287 s of samples, 1.9 ms at 48 kHz in Node); the ambience grid, the
  water reaches, the farm dogs and the owls in the first `hear`, during the audio tick after
  `setup` (≈ 155 ms in Node, ≈ 100 of it the cover raster, which the browser has already built for
  the renderer; the 209 owls take 0.7 ms once the raster exists); the road-surface index on the
  first footstep or tyre, unless the physics built it first. The land-cover raster and `surfaceAt`
  are the sim's (`src/sim/map/cover.ts` and `surface.ts`), built once and shared with the tyres'
  grip and the renderer.
- **Randomness** in the director (birds, owls, farm dogs, animal calls, what people say) and the
  synths (variants, jitter, a fire's crackle, a backfire) is `Math.random`: `?seed=N` replays the
  world, not the birds. The owls draw after the farm dogs and only at night, so a day's draws come
  in the order they always did. A worn engine's misfires are the sim's (`misfires` in
  `src/sim/damage.ts`, drawn per vehicle from its entity id), so they replay with the world. The
  crash, explosion, speech and animal-call renderers take their random source as a parameter (the
  game passes `Math.random`), so their tests seed it and every render is reproducible; a thunder's
  channel is drawn from its flash's `seed`, so one flash always thunders alike.

## How sound travels

`hearing.ts` runs one chain per source, every loss in dB relative to the source's level at 1 m,
summed and converted once:

- level at the ears = level at 1 m − spreading − ground − snow − foliage − diffraction − cabin;
- gain = `mixGain(level at 1 m, losses)` × `audibility(level at the ears, floor)` (the beds and
  water, whose level is known at the ears, are compressed at that level: see
  [Calibration and mix](#calibration-and-mix));
- lowpass = the lowest of the air, diffraction and cabin cutoffs;
- pitch = the Doppler shift (vehicle voices only);
- reverb send = from the street around the ears and the distance; none in the open.

Distances are three-dimensional. The ears are 1.6 m above the ground; sources stand at their own
height above theirs: a vehicle's voices at its centre of mass (`Chassis.z`: at rest the Panda's
0.56 m up, the truck's 1.7 m, and in the air wherever it flies), a vehicle's one-shots 0.8 m over
the contact point (a blast at the wreck's centre of mass), a person 1 m (the thud of anyone hit,
an animal too), an animal's mouth (`MOUTH`: a dog 0.5 m, a cat 0.25, a cow 1.3, a pig 0.5), water
2 m (lifted out of its carved bed), a bell at its tower's top, a bird 6–12 m up a tree, an owl 8 m,
a farm dog 0.5 m, a thunder where its render starts over the ground under the flash (an in-cloud
flash's channel about 4 km up, `IN_CLOUD`). A train's sources stand over its rail head, on a rail
deck or in a cutting alike: its wheels 0.4 m, its power packs 0.8 m (under the floor), its horn
3.6 m (on the cab's roof, at the nose); a level crossing's bell 2.5 m over the road at the box's
centre.

Each class of sound behaves differently:

| Class | Source | Doppler | Waits its travel time | Echoes | Occluded |
|---|---|---|---|---|---|
| Vehicle voices: engine, tyres, horn, siren, beeper, scrape, fire | point | yes | no (continuous) | no | yes, except the player's own car |
| Vehicle one-shots: crash, explosion, clunk, thud, door, ignition, honk | point | no | past 40 m | crashes from 6 m/s, explosions, honks | yes, except the player's own crashes, clunks, doors and starter |
| People: steps, talk, yell, scream, groan | point | no | past 40 m | yells, screams | yes, except the player's own steps |
| Animals: moo, grunt, squeal, yelp, meow, hiss, bark | point | no | past 40 m | barks, moos, squeals | yes |
| Water | line (rivers, streams), point (fountains, the Cascata di Equi) | no | no (continuous) | no | yes |
| Birds, owls, farm dogs, bells | point | no | past 40 m | barks, bells | yes |
| Thunder | a point aloft, its channel kilometres above every ridge and roof: no ground or snow loss | no | yes, in the director, from its first sound; at once within 40 m | yes | no (through the cabin only) |
| Wind, rain, crickets | a bed at the ears, centred | no | no | no | no (through the cabin only) |
| Rain on the roof | at the seat, centred | no | no | no | no, nor the cabin: the roof drums inside |
| Train voices: engine (a power pack under each end car), rails, brakes, the player's horn | point; the wheels a line along the cars in the open; in a tunnel at its portal | yes | no (continuous) | no | yes, per car, except the player's own train |
| A train's honk (`trainHonk`) | point at its nose; in a tunnel at its portal | no | past 40 m | yes | yes |
| A level crossing's bell (`plBell`) | point at the box's centre | yes (the listener's motion) | no (continuous) | no | yes |

### Point and line sources

- **Point sources** lose 20·log10(r) dB: 6 dB per doubling of distance. Inside `rMin`, the
  source's size, they get no louder (the calibration table gives it per kind).
- **Rivers and streams are line sources** (`lineLevel` in `acoustics.ts`): each water piece is a
  polyline of incoherent segments, and the level at the ears is the exact sum
  Lp = 10·log10 Σ 10^(Lw′/10)·θ/(4π·d), with d the distance to each segment's line (at least 1 m)
  and θ the angle it subtends. Close to a long reach that falls 3 dB per doubling; far away, 6.
  Pieces of one named river are one body, heard from its nearest point.
- **A train's wheels are a line source** too: each car in the open is a segment from its rear end
  to its front, of Lw′ = 99.9 dB(A) per metre at 130 km/h (`ROLLING`), and the level at the ears
  is the same exact sum, d counting the ears' height over or under the train (on a deck over the
  listener, a hill over a cutting), heard from its nearest point. So 10 m abreast the rear car of
  a passing ATR 220 it rolls 0.4 dB under abreast its middle, where a point at its middle would be
  6 dB down; and from under a rail bridge 22 m up it plays 2.6 dB over 22 m beside it at grade
  (less ground effect under a source aloft), where the ground's distance alone made it 13 dB
  louder.
- **Water loudness** (`places/water.ts`): each reach's sound power Lw′ comes from the water's
  width (a stand-in for discharge) and its grade smoothed over ±40 m (rapids against calm
  reaches), calibrated at 2 m from the bank: the Torrente Lucido ≈ 70 dB(A) in rapids and ≈ 62 on
  calm reaches, the 8 m torrents ≈ 64, the 4 m named streams ≈ 55, the unnamed 2 m gullies ≈ 40.
  Drinking fountains, taps and the Fontana di Aiola lavoir are point sources of 65 dB(A) at 1 m,
  and the Cascata di Equi (hard-coded at (1835, 530): only the raw OSM has it) one of 80. Bodies
  within 400 m are looked up; those under 13 dB(A) at the ears, even in the clear, are left out:
  the cull at the still night's floor (`NIGHT_DB` − 15), so a stream does not vanish at night.
  The loudness does not follow what the rivers carry ([water.md](water.md)): a spate sounds as the
  river does at its usual flow, and the water's voice stands at the built surface `Water.z`.

### Air absorption

Air absorbs high frequencies first, so distance is a lowpass, not a level loss. The cutoff is where
absorption reaches 3 dB (ISO 9613-1, 15 °C, 70 % relative humidity), log-log between the rows:

| Distance | 6 m | 10 m | 25 m | 50 m | 100 m | 200 m | 500 m | 1 km | 2 km |
|---|---|---|---|---|---|---|---|---|---|
| Cutoff | 20 kHz | 15.1 kHz | 9.1 kHz | 6.3 kHz | 4.3 kHz | 2.9 kHz | 1.5 kHz | 680 Hz | 315 Hz |

### Ground and foliage

- **Ground effect** over soft ground (ISO 9613-2 §7.3.2): max(0, 4.8 − (2h/r)(17 + 300/r)) dB,
  h the mean height of the path above the terrain at both ends. Up to 4.8 dB at a distance.
- **Foliage** (ISO 9613-2 Annex A, at 1 kHz): the metres of forest on the straight path (sampled
  every 8 m on the cover raster) cost nothing under 10 m, 1 dB for 10–20 m, then 0.06 dB per
  metre, at most 12 dB.
- **Snow** (`snowLoss` in `acoustics.ts`): fresh snow is soft, porous ground, over which a pulse
  falls as r^−1.6 against r^−1.2 over summer ground (Albert, CRREL), so a snow cover adds
  cover · min(12, 8·log10 r) dB. The cover at the ears stands for the whole path. A source aloft
  (thunder) takes neither the ground effect nor this.

### Buildings and terrain

`occlusion.ts` finds the worst edge between source and ears: building walls up to their eaves
(`z0 + h`; the outline's exact crossings, found through the shared building grid) and the terrain
sampled every 7 m (3 m in from each end). The edge with the largest Maekawa path difference
δ = |ST| + |TR| − |SR| wins; `diffraction` turns it into a loss and a lowpass (the 250 Hz Maekawa
value, and a cutoff matching the tilt):

| δ | 0 | 0.05 m | 0.1 m | 0.25 m | 0.5 m | 1 m and more |
|---|---|---|---|---|---|---|
| Loss | 0 | 6.5 dB | 7.7 dB | 10.1 dB | 12.5 dB | 15 dB |
| Cutoff | 20 kHz | 1.8 kHz | 1.5 kHz | 1.4 kHz | 1.9 kHz | 2.8 kHz |

- A building an endpoint stands in hides nothing from it: a bell at the top of its tower rings
  out over its own walls.
- Trees, water banks and the sim's collision walls are not edges (trees count as foliage).
- Paths are cached per source (`occluder.ts`): a new source is measured at once; a known one keeps
  its value until a refresh, at most every 150 ms, at most 12 a frame (oldest first), and only if
  someone asked for it since. A source too faint to hear even in the clear is never measured.

### Tunnels

The hill over a tunnel would take only 15 dB off a train in it (one edge, capped), so a train
1.6 km into the 3.2 km tunnel would rumble through 440 m of rock. Instead a car standing in a
tunnel (its middle on a tunnel segment) is heard from a portal (`places/track.ts`, from the line's
`tunnels`): of the two, the one losing least on its way to the ears, its depth along the track
× 0.1 dB a metre (`TUNNEL_DB`, TUNED: a bore's walls take little) plus its spreading. A source
deeper than 400 m (`DEEP`) is not heard at all. A power pack and a horn in a tunnel are placed so.
The wheels are one voice summed from two parts (`rollingOf`): the cars in the open as a line,
heard from its nearest point, and each car in a tunnel at its own best portal as a point of its
own length's sound power (Lw′ + 10·log10 of the car's length, 11 dB under at 1 m), its tunnel's
loss taken. Their energy at the ears adds up, heard from the louder part's place, so the level runs
on as the cars pass a portal: 20, 40 and 60 m off the line beside each portal of the three short
tunnels, at 80 km/h and 60 frames a second, the summed level at the ears (before the obstacles on
the way) steps under 1 dB from frame to frame. Before, the cars
inside added nothing while one was in the open, and a train wholly inside carried its whole length
from one portal: its wheels jumped 2.9 dB as its last car went into the 271 m tunnel and fell up to
15.9 dB as its cab car came out of the 67 m one. The player's own train is heard from its cab
([Inside a vehicle](#inside-a-vehicle)), in a tunnel too.

### Doppler

Vehicle voices shift with the motion of both ends: f′/f = (c − v_L·u)/(c − v_S·u), u the unit
vector from source to listener, c = 340.4 m/s (15 °C), the ratio clamped to 0.7–1.4 and no shift
within 1 m. A car at 12 m/s coming straight at the player sounds 62 cents sharp; at 42 m/s,
+228 cents approaching and −201 receding. Water, the beds and one-shots do not shift.

### Propagation delay

One-shots farther than 40 m start r/c later: 0.29 s from 100 m, 0.88 s from 300 m. Nearer, the lag
(under about 120 ms) goes unnoticed, so they play at once (ITU-R BT.1359). Continuous voices are
never delayed. Thunder waits in the director instead, seconds to tens of seconds, and is placed
only when its sound arrives, wherever the listener has moved meanwhile ([Thunder](#thunder)).

### Inside a vehicle

From the driver's seat, outside sounds pass the body's insertion loss: 15 dB and a 1.4 kHz lowpass
in the closed cabins (Panda, truck, Giulia), 6 dB and 3.5 kHz in the Ape's cab, open at the back,
24 dB and 1.2 kHz in a train's cab (`CABIN.atr220`, TUNED: a sealed cab, quieter than a car's, so
its own 130 dB horn 2.6 m away on the roof reaches the driver at 97.6 dB(A), near TSI Noise's
95 dB(A) limit in the cab while the horn sounds).
Sounds of the player's own car are heard from inside it:

- the engine has its own fixed level (68 dB(A), centred, no Doppler), and its voice switches to
  the cabin tone behind the firewall (a 2.5 kHz lowpass and +4 dB at 120 Hz);
- the horn (in the grille), the siren (on the roof) and the fire of a car destroyed around them
  pass the whole cabin, like any outside sound;
- its crashes, scrapes, doors, starter and the thud of a person it hits pass none, but their
  street reverb and their echoes come back from outside and pass the whole cabin (its blast is
  always heard on foot: the sim throws the driver out of the door in the step it blows up);
- the rain drums on its roof and windscreen (`roof`), heard from the seat through no cabin, while
  the rain bed outside passes the whole cabin;
- the tyres, the truck's beeper, the beds and thunder pass the whole cabin.

In a train's cab, the player's own train is heard as a car's own engine is from its seat, at its own
levels at the ears (`OWN_TRAIN_DB` in `levels.ts`, TUNED): its power pack under the cab's car 66
dB(A) at its rated revs under full power, its wheels 72 at 130 km/h, its brakes 64, each through the
mix's compression with no loss within half the cab's car of the ears, falling off with distance down
the train past that (the far pack 43 m back 13 dB under), panned from where it is, Doppler-free, with
nothing in the way and no ground effect, and dulled by the cab's 1.2 kHz lowpass (the engine voices
play outside's tone, `inside` false). Heard instead through the cab's 24 dB as the 97 dB sources
they are outside, compressed by the mix as such, the cab played 24–25 dB under a car's seat: in the
game, idling −53.9 dBFS and under power −37.4 to −37.8, its idling engines 13.8 dB under the wind
bed. Now, seed 1, the output's level over 3 s: the cab idling at Monzone −31.3 dBFS and under full
power at 9.8 and 15.5 m/s −14.9 and −14.6, against the Carabinieri car's −28.6 idling and −13.5
with W held and −42.4 on foot at the start; the idling pack plays 9 dB over the wind bed. The horn
plays from the roof 2.6 m ahead through the cab (8.5 dB over gain 1; −12.1 dBFS held). A car the
player's train strikes crashes as the player's own car's crash (open, at its cap) and grinds along
it as their own scrape. Getting in and out of a train plays no door and no starter (its engines
idle already).

### Masking and proximity

Every sound is heard against a floor: the energy sum of the wind bed, the rain and the loudest water
heard in the last frame, each as it plays at the ears (occlusion included, so a river behind houses
masks only as loud as it sounds; inside a car, the wind and the rain bed through the cabin, and the
roof's drumming). The wind bed is never stiller than the rural background: 35 dB(A) by day
(`AMBIENT_DB`), falling to 28 at night (`NIGHT_DB`) as the sun sinks from 0° to 10° under the
horizon (`floorDb` in `director/sky.ts`). What masks is what plays: the background is the wind bed,
not a silent number, so from a closed car in a calm street the floor is 20 dB(A), and a downpour
drowns a car at full load 300 m across a meadow that the dry day lets through. A sound at most 5 dB
under the floor plays at full gain. Below that it fades linearly in dB, and 15 dB under the floor it
is culled: a one-shot is dropped, a voice is no longer held and fades out. The margin is there
because a narrow-band sound stays detectable 5–10 dB under a broadband dB(A) floor.

The wind's strength comes from the place and the weather. In the usual wind (3 m/s at 10 m on the
map's low ground, `USUAL_WIND`: a cloudy day's, a little over the weather's own mean, 2.5 m/s in
October and 2.3–2.7 by month over 30 simulated years) it rises with the ears' height over the
map's floor (`place().floor`, its 5th-percentile height), from 0.15 at 80 m under the floor to
0.85 at 770 m over it (a smoothstep; on the shipped map, floor 230 m and lowest ground 147 m, that
is the 150–1,000 m it was tuned on, within 0.3 m), up to 0.15 more on open ground, and 0.3 less in
a street; the weather's low-ground wind scales that by wind / 3 m/s (`windFactor`). Counting from
the floor, a flat coastal map hears its floor as the shipped map's valley does, and an Alpine map
its own floor as calm rather than a gale everywhere. It is never under the floor's stillest,
0.24 by day and 0.16 at night (the 35 and 28 dB(A) backgrounds themselves: leaves and the far
valley, heard even in a sheltered street), and at most 1.33, a gale's bed at `GALE_DB`
(65 dB(A)). Its level is 60 + 40·log10(strength) dB(A): in the usual wind 35 in Monzone's streets,
about 40–43 on open ground on the valley floor, 57–60 on the ridges. The voice plays at most its
full strength 1, and past it the bed's gain carries the gale, so the usual wind keeps the voice it
was tuned with.

Over flat, open ground with nothing in the way, at the day's 35 dB(A) floor (at night's 28 every
radius is about 2.2 times longer: 7 dB more of spreading):

| Source (dB(A) at 1 m) | Full level up to | Silent beyond |
|---|---|---|
| talk, a woman or a child (55) | 18 m | 39 m |
| walking step (58) | 22 m | 52 m |
| talk, a man (58) | 22 m | 52 m |
| running step (62) | 30 m | 80 m |
| meow (63) | 33 m | 87 m |
| hiss (65) | 39 m | 108 m |
| grunt (70) | 64 m | 187 m |
| groan (72) | 80 m | 240 m |
| a cat's yowl (75) | 108 m | 329 m |
| yell, a woman or a child (82) | 234 m | 730 m |
| yell, a man (89) | 518 m | 1.6 km |
| Panda engine at the redline under full load (90) | 580 m | 1.8 km |
| yelp (90) | 581 m | 1.8 km |
| moo, a level crossing's bell (92) | 730 m | 2.3 km |
| an ATR 220's power pack at full power (97) | 1.3 km | 4.1 km |
| scream (100) | 1.8 km | 5.8 km |
| squeal (105) | 3.2 km | 10 km |
| crash, horn, bell, explosion (115–124), a train's horn (130) | over 10 km | |

At a ridge's 57 dB(A) floor every radius is about ten times shorter. In the valley the obstacles
shorten them more (a house or a spur in the way takes up to 15 dB, the woods up to 12), and so do
the sim's ranges: traffic despawns beyond 320 m, pedestrians and animals beyond 140 m (cows
180 m). Far sounds are faint in the mix long before they are culled.

### Voice caps

At most this many continuous voices of each kind play, the loudest at the ears first:

| `engine` | `tyres` | `scrape` | `horn` | `siren` | `beeper` | `fire` | `water` | `wind` | `crickets` | `rain` | `roof` | `rails` | `brakes` | `plBell` | `trainHorn` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 4 | 2 | 3 | 2 | 2 | 2 | 4 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 1 |

An engine ranks, and is masked, at its gain law's level for its revs, load and damage
(`engineQuiet`): an idling one 11 dB under one at the redline under full load (2 dB more at full
damage), so a car revving 100 m away keeps its voice over idling ones 40–54 m away. A train's two
power packs share the engines' 8; its wheels rank at 30 dB under per decade of speed under 130
km/h (`railsQuiet`), its brakes by their squeal (`brakesQuiet`). A voice held in
the last frame ranks 3 dB louder (`KEEP_DB`), so two near-equal engines do not swap every frame
(each swap would build a new voice). At the hour, only the 4 loudest bell towers in earshot ring
(`TOWERS`).

### Echoes

Loud impulsive one-shots answer off rock faces (`echoesAt` in `places.ts`): crashes from 6 m/s,
explosions, honks and trains' honks, bells, yells, screams, barks, moos, squeals and thunder (its
echoes worked out from its capped direct sound, and stopped with it). The search runs along 16
directions from 40 to 400 m in 8 m steps and takes the first face the listener can see (rising above
every sight line before it) that climbs at least 50°, the slope the terrain paints as bare rock, and
stands at least 10 m above the ears. A gentler slope, grassed or wooded, mirrors sound up into the
sky and scatters back too little to hear (even a forest edge returns 16–31 dB under the direct
sound), so it does not echo. Rock is in sight from about half of the map. Up to two echoes play, the
strongest first and at least 45° apart:

- delay 2d/c after the direct sound;
- loss 20·log10(2d) + air absorption (0.0041 dB/m at 1 kHz) + 10 dB off the rock; always at least
  10 dB under the direct sound (natural cliffs return 10–20 dB under it), which is what a distant
  source's echo gets;
- times the open share around the ears, 1 − street: facades hide the faces, so a narrow street
  hears none;
- panned toward the face, low-passed at the direct sound's cutoff or the echo path's air cutoff,
  whichever is lower, with the direct sound's reverb send (none in the open);
- skipped when the masking rule would cull it.

Buildings are not echo faces: village streets get reverb, not echoes.

### Street reverb

Reverb is sound scattered back by the surfaces around the listener. Over open ground the energy
that arrives after the direct sound stays 15 dB and more under it (the ground's own reflection,
under 2 ms late, is the ground effect), so the fields and the open valley play dry. A forest's
trunks scatter more: its tail sits about 30 dB under the direct sound 10 m away, but the direct
sound falls faster than the diffuse tail, which is only 10–16 dB under it 100 m away. The woods
play dry all the same (see Known limits): only streets send to the reverb.

`streetAt` measures how enclosed the ears are: 8 directions out to 15 m, each counting the facade it
meets by its height above the listener's ground (4 m and more count fully). The mean, 0 (open) to 1
(a narrow stone street), eases with a 0.5 s time constant. The mixer has one reverb, a generated
stone street's impulse response (1.2 s long, RT60 1 s, 12 ms pre-delay: the first facade's return
across a 4 m lane), and a fully wet send returns 12 dB under the dry sound. Each source's send
(`REVERB`) is

wet = street² · 10^(8/20) · √(r / 10), with r clamped to 2.5–40 m

- **Distance.** In a narrow street the reverb returns 10 dB under the dry sound 2.5 m away, 4 dB
  under at 10 m and 2 dB over from 40 m. Along a street the reverberant field falls like a line
  source's and the direct sound like a point's, so the reverb gains 3 dB on it per doubling.
- **Gaps.** The tail leaks out of every gap in the facades, hence street²: a straight lane open at
  both ends (0.75) is 5 dB drier, a lane with gaps (0.5) 12 dB, a single wall (0.3) 21 dB, which is
  as good as dry.
- **Cabin and beds.** Inside a vehicle the send is a quarter (the cabin's own noise masks the
  tail). The tail comes back from outside, so a sound of the player's own car that skips the
  cabin sends that much less again (15 dB in the closed cabins, 6 dB in the Ape). The wind, rain
  and cricket beds are diffuse already and send nothing, nor do the roof's drumming and thunder,
  whose render holds the valley's roll.
- **Snow.** Under a full snow cover the send is halved (`REVERB.snow`, 0.5 × the cover): the
  street's floor no longer reflects (fresh snow's noise reduction coefficient is near 0.9).

Held voices glide their send as the street eases, so walking into a village fades the reverb in.

### Stereo

The pan is the source's direction along the screen's right axis, scaled to ±0.85 so nothing sits
in one ear only, and fading to the centre within 2 m. The axis is `axesAt(yaw).right` for the
listener's yaw, so a car on the right of the screen is heard on the right whichever way the
camera looks; an echo pans toward its face the same way. A turn moves the pan at once: held voices
glide to it with a 50 ms time constant, about as fast as the camera eases through the turn (83 ms).
Driving, the pan turns with the car's heading at once, while the view follows it on its spring,
half a second behind a steady turn.
There is no front and back.

## Day, night and weather

The valley sounds as the game clock and the weather at the ears say: `Heard` carries the sky (the
Rome day and time, the sun's elevation) and a copy of the `Weather`, and each frame the director
works out the weather at the ears with the sim's `conditionsAt`. The laws are plain functions in
`director/sky.ts`; under the defaults the director's tests use (a 10:10 sun 22° up, dry, the
usual wind) each is the identity, so a dry morning in the usual wind sounds as it did before the
weather.

- **The floor** falls from the day's 35 dB(A) to the night's 28 as dusk ends, the sun 0° to 10°
  under the horizon: night stills the valley, so steps carry farther. Water is left out only under
  13 dB(A) at the ears, the night floor's cull (`NIGHT_DB` − 15), so a stream does not vanish at
  night.
- **The wind** blows as the weather does: its strength × the weather's low-ground wind / 3 m/s,
  never stiller than the floor, up to a gale's 65 dB(A) on a ridge. Its gustiness is the weather's
  gust factor − 1 (`gustsOf`): 1.5, open ground's usual, gives the voice's usual 0.5, and 2 and over
  squalls. Snow on the ground stills 0.7 of its leaves (`SNOW_LEAVES`).
- **Rain** of 0.1 mm/h or more at the ears (`RAINING`: a drizzle finer than that is not heard)
  plays a bed at its rate, on the ground's shares of leaves, roofs and paving, and water (a river
  or a fountain within 5–40 m, or the puddles of a wet village: the wetness × the built share); in
  a car it also drums on the roof ([Rain](#rain)). Snow falls silent: only the liquid rate plays,
  so sleet plays its rain.
- **Snow** on the ground hushes the valley: up to 12 dB more loss on the way, the street's reverb
  halved, the leaves stiller; a step crunches where the snow covers half the ground or more.
- **Songbirds** sing by the sun (`birdActivity`): robins from 7° under the horizon, the rest by 3°
  under; a dawn chorus 2.5 times the day's song from −1° to +5°, back to the day's by +15° (Thomas
  et al. 2002); a last round at dusk, 1.3 times, all roosting under −6°; none at night; heavy rain
  silences them (0.5–8 mm/h).
- **Owls**: the tawny owl calls once the sun is 2–6° under (10–20 minutes after sunset) until as
  long before sunrise (`owlActivity`), and rain silences it (0.5–4 mm/h). There are 209 territories,
  one in 70 % of the map's 500 m squares with woods, each 8 m up a tree in forest; those within
  600 m call, each resting 30 s after a call, then calling about once in 20 s.
- **Crickets** sing where open ground outweighs buildings, in air of 10 °C or more at the ears
  (chirping faster as it warms) and dry. They follow the temperature and the rain, not the hour,
  so an October evening's cooling slows them and its night silences them.
- **Bells** strike the game clock's hours in Rome time, hours only, from 07:00 to 21:00: the night
  is silent from 22:00 to 07:00, as Tuscany's parishes keep it. Each ring sounds once per game day
  and hour (keyed `day:hour`, so a clock set back rings again), and a new ring takes over what is
  left of the last. A ring waits for the audio context: a new game's 08:00, held behind the title
  card, strikes eight times once the card is dismissed. Frames that skip minute 0 (the dev menu's
  fast rates) miss the ring.

Measured in the game (headless Chrome, the spawn, a clear settled sky): the wind bed sat at
35.0 dB(A) at 10:00 and 28.0 at 02:00; songbirds called 7 times in 63 s at 10:00 and never in 93 s
at 02:00; 21:00 rang 9 strokes from each tower in earshot, 22:00 none; a new game's first 40 s
after the card rang 32 strokes from 3 pitches.

## Sound catalogue

Levels are dB(A) at 1 m at the synth's nominal peak, with the source's size `rMin` in brackets.

Continuous voices (held every frame they play):

| Kind | Made of | Plays when | Level |
|---|---|---|---|
| `engine` | `synth/engine.ts`: an oscillator at the firing frequency (a sawtooth, or a band-limited pulse for the Ape's two-stroke and the truck's diesel), a half-order sub, a waveshaper driven by the load, two exhaust formants, noise gated at the firing rate, and a turbo whine on the truck and the Giulia, all from how the engine is built ([Engines](#engines)). The revs, load, `damage` and `misfire` are the sim's: damage makes it duller, weaker, rough and knocking, and a misfire cuts it out with a backfire ([Engines](#engines)); each vehicle's `variant` (from its id) moves its pitch ±2 % and its formants ±4 % | a vehicle runs (AI traffic, or the player at the wheel) and is not destroyed, once its starter, if any, has caught; a train's two power packs always, one under each end car, at its `trainRevs` | at the redline under full load: Panda 90 (2 m), Ape 92 (2 m), truck 98 (4 m), Giulia 93 (2.5 m), an ATR 220's power pack 97 (3 m: TSI Noise's diesel-unit starting limit, 82–83 dB(A) at 7.5 m for both); the player's own car's 68 from the seat, their train's pack 66 from its cab (`OWN_TRAIN_DB`) |
| `tyres` | `synth/tyres.ts`: rolling noise rising as (v / 70 km/h)^1.5, a sett rumble at v / 0.14 m on stone, a two-tone squeal (980 and 1460 Hz) on asphalt and stone while the tyres skid, a gravel crunch on loose ground that grows with the skid; the truck's 6 dB louder and darker. The skid is the sim's: its `amount` past grip, faded in as the tyre slides from 0.5 to 2.5 m/s, so a standing burnout and a locked wheel in a straight line squeal, an ABS stop at the limit (0.25) faintly | its wheels are down and it moves faster than 1 m/s or skids (a skid holds 0.05 s). The surface is the skidding wheel's, else the road's OSM surface on a carriageway (or within 0.5 m of its edge), else the land cover's | 98 (2 m) |
| `scrape` | `synth/scrape.ts`: the wall's surface played at the car's speed, ringing the car's panels and the wall's own modes, by `material` (below) | a car hits a wall at under 1.5 m/s while still moving faster than 2 m/s, or slides faster than that with its body down on the ground (`hullDown`: a corner of its box on the ground, on its roof, side or belly; the physics reports no hit for a slide); held 0.2 s past the last such frame, along the material of the wall or of the ground under the car (below). The wheels bottoming out do not grind; a landing hard enough to put the belly on the ground (the Giulia from about 0.6 m) does | 105 (2 m) |
| `horn` | `synth/horns.ts`: Panda 420 Hz, Ape 610 Hz, truck air horn 150 + 185 Hz, Giulia 410 + 500 Hz | the player holds H at the wheel of anything but the Giulia, unless it is destroyed | 116 (2 m) |
| `siren` | `synth/horns.ts`: the Italian *bitonale*, 466 and 622 Hz for 0.75 s each (D.M. 20/03/1979) | toggled by H in the Giulia the player drives; it stops when they get out or the car is destroyed | 117 (2.5 m) |
| `beeper` | `synth/horns.ts`: a 1 kHz tone, 0.5 s on and 0.5 s off | a running truck reverses (faster than 0.3 m/s backwards) | 100 (2 m) |
| `fire` | `synth/fire.ts`: the roar, brown noise under 500 Hz flickering with the gust signal played 24× faster (0.75–12 Hz), and the crackle, noise bursts drawn at random and scheduled 0.3 s ahead: about 10 sharp pops a second at 2–6 kHz (2–6 ms), one deeper snap a second at 600–800 Hz (12–18 ms), mostly faint (each peak the square of a uniform draw), so it never repeats over the 5–10 s a wreck burns | a vehicle burns: destroyed (its `Damage` at 1) and not yet blown up, however still it lies, until the blast 5–10 s after it caught fire (or it is removed out of view) | 82 (2 m), TUNED: no recording measured; it sits 3–6 dB over an idling Panda at the same distance |
| `water` | `synth/water.ts`: bubbles ringing at their Minnaert frequency (van den Doel's model, `synth/bubbles.ts`), a pink-noise bed, and in rivers a boulder rumble and a slow surge. `body` is `river` (OSM rivers, and water 8 m wide or more), `stream` or `fountain`; `flow` comes from width and grade | the 4 loudest bodies within 400 m | from the water's level at the ears (above) |
| `wind` | `synth/nature.ts`: a brown-noise band breathing with gusts, a whistle on strong gusts, leaves in proportion to the forest around (stilled by snow on the ground). `gusts` 0…1 deepens the swells from half to 0.95 of its level and quickens them from half to twice the pace; the valley's usual is 0.5 (`VALLEY_GUSTS`) | always, one bed | 60 at the ears at strength 1, never under the floor (35 by day, 28 at night), up to 65 in a gale (`GALE_DB`) |
| `rain` | `synth/rain.ts`: a pink hiss, the drops near the ears coloured by what they land on, a runoff roar in heavy rain, bubbles on water ([Rain](#rain)); `rate` mm/h, and the ground's `forest`, `built` and `water` shares | rain at the ears of 0.1 mm/h or more (`RAINING`) | `rainDb`: 64 at the ears in a 60 mm/h downpour (`BEDS.rain`, estimated), 43 at 1 mm/h, 50 at 4, 55 at 10, 62 at 40 |
| `roof` | `synth/rain.ts`: the drops ringing the roof panel's and the windscreen's modes, a dense patter, the roar of a sheet of water | rain at the ears while the listener sits in a car | `roofDb`: 66 at the ears at 60 mm/h (estimated), 45 at 1 mm/h, 52 at 4, 57 at 10, 64 at 40, heard through no cabin |
| `rails` | `synth/rail.ts`: the wheels' roar, pink noise in a band at v / 2.5 cm (the rails' roughness: 890 Hz at 80 km/h) with a brown rumble under 160 Hz, both (v / 130 km/h)^1.5, and a clack (a 1.9 kHz crack and a 130 Hz thump, rising as v / 130 km/h) as each of the 8 axles runs over a rail joint (every 36 m, `JOINT`) or a switch ([Trains and level crossings](#trains-and-level-crossings)) | a train moves: masked under about 0.5 m/s | a line source of 99.9 dB(A) per metre at 130 km/h along the cars in the open (`ROLLING`), 30 dB less per decade of speed (`railsQuiet`) |
| `brakes` | `synth/rail.ts`: white noise in three bands of Q 50 at 2.85, 4.1 and 5.6 kHz (disc brakes squealing), juddering with the gust signal ×40 | a train braking harder than a tenth of its emergency rate, opening up from 6 m/s to a stand (`brakesTargets`), from its wheels' place | 95 (3 m), TUNED: no recording measured |
| `plBell` | `synth/crossing.ts`: an Italian crossing's bell, measured: one stroke every 1.287 s of twelve partials (1.2–10.3 kHz, two beating doublets), a loop of its steady ring ([Trains and level crossings](#trains-and-level-crossings)) | a road's level crossing from its warning until its arms are down (`crossingAt`), one voice per box at its centre | 92 (0.3 m, raised to the box's posts' distance): at least 90 dB at 1 m (the Wegh eLCSP's data sheet), heard from at least 100 m by law |
| `trainHorn` | `synth/horns.ts`: EN 15153-2's high tone, 660 Hz, a sawtooth climbing out of a 5 % droop over a 0.12 s attack, voiced at 1.2 kHz | the player holds H in a train's cab | 130 (2 m): TSI's 115–123 dB 5 m ahead, its lower end at 1 m; through the cab 97.6 dB(A) at the ears |
| `crickets` | `synth/nature.ts`: six Italian tree crickets (*Oecanthus pellucens*) on a 2.6 kHz carrier, chirping at the rate Dolbear's law gives for `celsius`, the air at the ears (once a second at 22 °C; `chirpRate` never slower than the 10 °C rate, so a voice held in the cold still chirps) | open ground outweighs buildings around the ears (`open − built` > 0), in air of 10 °C or more (`echemeRate` > 0) and dry (under 0.1 mm/h) | 42 at the ears at density 1 |

The scrape is built from what the wall is made of. Each material has a surface: 32 m of wall
ridden at 10 m/s (3.2 s), rendered in plain TypeScript the first time that material is scraped
(4–10 ms in Chrome, once per material). It holds a pink bed (equal energy per octave, as in the reference recordings), grit (micro-impacts
with power-law heights), level dips at the joints between stones or sheet ribs, and damped knocks:
a guard rail's posts every 2 m and splices every 4 m, glazing bars, chips. The voice loops it at
v / 10 m/s like a record, so stones pass at v / 0.3 m and rail posts thump at v / 2 m. The loop
rings 8–12 of the car's panel resonances, drawn fresh for every scrape (Q 60–120, 150–3000 Hz),
and the wall's own modes:

- the guard rail: 12 bands at Q 300–500, half of them near its 176, 428 and 771 Hz bands, and a
  stick-slip squeal below about 3 m/s;
- sheet cladding: a wobbling ring;
- a tree: a short wood bank.

Masonry, stone and rock add grit and chips only; masonry is finer and brighter, stone swings
10 dB at every stone, rock is the harshest. Earth rings nothing: a dirt hiss at 0.8–3 kHz. Glass
adds a rare shard screech. The judder (the gust signal ×40) shakes the grind and opens the squeal
and the screech. The level rises 4.5 dB per doubling of speed (roughness noise, v^0.75), up to
full at 12 m/s, where every material peaks near 0.5. Doppler moves every band. A car sliding from
one wall onto another switches to the new material once it has met it for 0.25 s (a trunk passed
along a wooded bank, or contact jitter, keeps the old one) and crossfades in about 0.3 s; the voice
fades out over 0.3 s once it is no longer held.

Measured in Chrome at 12 m/s against the closest reference (a car's slide and grind after a BBC
crash: centroid 1.5–1.8 kHz, band flatness 0.33–0.51, octaves within 5 dB from 125 Hz to 2 kHz):

- the walls: centroid 1.8 kHz on stone and 2.0–2.1 on masonry, rock and sheet, band flatness
  0.36–0.45, octaves within 6 dB from 125 Hz to 2 kHz;
- the rail is the tonal one (band flatness 0.18–0.31);
- a tree is the darkest (1.5 kHz), earth sits at 2.4 kHz and glass at 3.8 kHz.

One-shots:

| Kind | Made of | Plays when | Level |
|---|---|---|---|
| `crash` | `synth/crash/`: rendered on demand from its exact params (pure TypeScript, a few ms; an echo replays the same render): each body's crunch, the parts that break and fall, what it hit: a wall's or the ground's material, or the other car's shell ([Crashes](#crashes)) | a `wall`, `car` or `ground` Impact of 1.5 m/s or more, but an underbody one under 5 m/s (a clunk). One hit spans a few steps: within 0.1 s of a car's crash or clunk only a 1.5× harder hit plays again. Its params (below): the closing speed, the mass behind it (t), both bodies and their wear, the wall's or the ground's material, the surface debris lands on | 115 (2 m) for the reference crash; the render plays its own level under or over that. Its direct sound plays at most 8 dB over gain 1 (`MOST_DB.crash`) |
| `explosion` | `synth/explosion.ts`: rendered on demand (pure TypeScript, about 8 ms; an echo replays the same render): the blast wave's crack, the boom and thump of the fuel going up, the fireball's roar and whoosh, debris raining down on `surface` ([Explosions](#explosions)) | an `Explosion` event, from the wreck's centre of mass, its debris landing on the ground under it (a bridge's deck, not the river under it) | 124 (3 m), TUNED: no recording measured; 9 dB over the reference crash, 5.4 in the mix. Its direct sound plays at most 10 dB over gain 1 (`MOST_DB.explosion`) |
| `clunk` | `synth/impacts.ts`: the bump stops' rubber thump (110 → 55 Hz, the truck's a third lower), the suspension's steel clunking at about 330 and 760 Hz, loose trim ticking; three variants each, light and heavy | an underbody `ground` Impact of 1.5–5 m/s: the suspension bottoming out over a hump or on a light landing, several a second on a rough road, a landing's few steps merged like a crash's | 85 (1.5 m) at 5 m/s, 20 dB under a Panda's crash at that speed, 6 dB less per halving of speed down to 14 dB under; estimated, not measured against a recording |
| `thud` | a low thump and a cloth swish, full level from 12 m/s | a `person` or `animal` Impact (a knockdown, a kill, a cow struck), by a car or a train | 85 (1 m) |
| `groan` | `synth/voices.ts`, a formant voice in the person's own register (`cueVoice`: a man's from the lower half of the voice range, a woman's from the upper, a child's from its top) | 0.25 s after a thud, from a person hit who lives; a killed one is silent | 72 (1 m) |
| `door` | per model: opening (latch clicks, the seal), closing (thump, latch, panel ring) | the player gets in (open, then close 0.7 s later) or out (at their new spot), not when the blast of their car throws them out | 82 (1 m) |
| `ignition` | the starter whirring with a dip at each compression, then the engine catching: the engine voice blipped 70 % of the way from idle to the gearbox's `launch` revs at 70 % load for 0.12 s, settling back with a 0.25 s time constant | the player gets into a car whose engine was off; the engine voice takes over after `CRANK` (Panda 0.8 s, Ape 0.4 s, truck 1.5 s, Giulia 0.6 s). Carjacking a running car plays doors only | 85 (1 m) |
| `honk` | one long or two short presses of the model's horn | a `Honk` event | 116 (2 m) |
| `trainHonk` | `synth/horns.ts`: the train's horn, one high blast of 1.2–1.8 s (RFI's "fischio prolungato moderatamente"), or `urgent` the alarm: four 0.3 s blasts, high and low in turn, 0.1 s apart (more than three short) | a `Whistle` event, at the train's nose (in a tunnel, at its portal) | 130 (2 m), as the player's; its direct sound plays at most 2 dB over gain 1 (`MOST_DB.trainHonk`: 20 m away in the open it would play 14.7 dB over) |
| `step` | `synth/steps.ts`: heel then ball, per surface (asphalt, stone, gravel, dirt, grass, leaves) and gait, plus a snow crunch (`snow`, the `SNOW` tread: 56 sets baked, 48 before), four variants each, played ±8 % in rate and ±2 dB | everyone on foot, at 2 steps a second at a 2.2 m/s walk and 3 at a 5.5 m/s sprint, counted from the distance actually moved (none while down or dead, none for a jump of more than 3 m in a frame); a run above 3.5 m/s; crunching where snow covers half the ground or more (`snowCoverAt`). The player's steps come from under the ears | 62 (0.5 m) for a running step on stone; walking 4 dB under |
| `scream` | `synth/voices.ts`: a sawtooth glottis on a pitch contour, breath noise, three vowel formants and a fast roughness, in the person's own register (`cueVoice`), so a child screams at the top of a woman's range; each person keeps one voice | a fright `Cry` from a child, and from 35 % of grown-ups (by id, `SCREAMERS`, TUNED); at most one cue per person per 4 s | 100 (1 m) |
| `talk` | `src/audio/speech`: a line of Italian-sounding speech in the speaker's own voice ([Speech](#speech)) | a turn in a conversation, a gatherer's question to the victim ([Conversations and cries](#conversations-and-cries)) | 58 (1 m) for a man, 55 for a woman or a child (Pearsons, Bennett and Fidell 1977: normal effort) |
| `yell` | the same line, yelled: higher, brighter, its vowels longer | a person's `Cry` that is not a scream, a gatherer's call, a robbed driver ([Conversations and cries](#conversations-and-cries)) | 89 (1 m) for a man, 82 for a woman or a child (Pearsons et al. 1977: shouted) |
| `bell` | `synth/nature.ts`: a bell's inharmonic partials (hum, prime, tierce, quint, nominal...), each split to beat; four primes rendered, any pitch resampled from the nearest | the game clock, in Rome time: the hours only (1–12 strokes, 2.5 s apart) from 07:00 to 21:00, from the 4 loudest towers in earshot, each starting up to 6 s late ([Day, night and weather](#day-night-and-weather)) | 118 (5 m) |
| `bird` | `synth/nature.ts`: autumn calls of the robin, great tit, blackbird ("chink" or "seee") and chaffinch ("pink"), 35/30/20/15 %; the tawny owl (`owl`): the male's hoot sequence, about 6 s, or in 30 % of calls the female's "kewick" (0.46 s) | songbirds from a tree 15–70 m away: 0.3 calls a second in full forest, plus 0.05 near houses, by the sun and the rain (`birdActivity`); owls at night from their woods ([Day, night and weather](#day-night-and-weather)) | songbirds 85 (1 m); the owl 90 (1 m, `OWL`, estimated) |
| `bark` | `synth/nature.ts`: two to five barks of a big or a small dog through a formant tract | 225 farm dogs (about one in eight barns, sheds, houses and farm buildings with open ground and no paving 5 m out): those within 200 m bark every 45 s on average, four times as often while the player runs or drives within 30 m; and a free dog's anger `Cry` in the sim, a big dog's bark from 0.95 of the usual size (`BIG_DOG`), a small dog's under it | 96 (1 m) |
| `moo` | `synth/animals.ts` ([Animal calls](#animal-calls)) | a cow on its own (every 40 s on average), its `Cry`, its pain after a hit | 92 (1 m), an estimate between a man's shout and a bark |
| `grunt` | `synth/animals.ts` | a pig on its own (every 6 s on average), a `Cry` that is not a fright | 70 (1 m), an estimate within pigs' 60–90 dB |
| `squeal` | `synth/animals.ts` | a pig's fright `Cry`, its pain after a hit | 105 (1 m): piglets peaked at 101.9 dB (Engenharia Agrícola 2018), a grown pig's squeal is commonly put at 110–115 |
| `yelp` | `synth/animals.ts` | a dog's fright `Cry`, its pain after a hit | 90 (1 m), an estimate |
| `meow` | `synth/animals.ts`: a meow, or a cat's yowl of pain (`yowl`) | a cat on its own (every 60 s on average) and half its fright `Cry`s; the yowl after a hit | 75 (0.5 m) for the yowl, an estimate; a plain meow 12 dB under it (`MEOW_QUIET`) |
| `hiss` | `synth/animals.ts` | half a cat's fright `Cry`s | 65 (0.5 m), an estimate |
| `thunder` | `synth/thunder.ts`: rendered on demand in plain TypeScript from the flash's `distance` (horizontal), the ears' height over its ground (`ears`), `bolt` and `seed`: a near bolt's crack and boom, a far one's low rumble, an in-cloud flash's rumble with no crack, at most 20 s ([Thunder](#thunder)) | each `lightning` happening heard at all, once its sound reaches the ears | 154 (300 m, aloft): 88 at 1 km and 66 at 5 km after its render's own air (`thunderQuiet`), 20 dB less per decade of `power` down to 0.3. Its direct sound plays at most 2 dB over gain 1 (`MOST_DB.thunder`) |

A crash's params say what met: `body` is the Impact's `car` (query order, not necessarily the one
that struck; model and zone), `against` either the wall's or the ground's `material` or the other
vehicle's body (the contact sounds the same from either car). Each body carries its
`worn`: the director's record of the hardest crush (the barrier-equivalent speed, `crushSpeeds`
in `synth/crash/hit.ts`) that zone of that vehicle took before, so a mirror, a window, a lamp, a
windscreen or an airbag that went then does not go again. `surface` is what debris lands on: read
like a tyre's under the car for a wall hit (its contact point lies on the house front, often on a
verge or a paved strip off the street), at the contact point between two cars or under a car that
struck the ground. The ground a car lands or rolls on is no drive wall, so `wallAt` (which would
find the nearest house, trunk or rail within 3 m) is not asked: the road and paving (`asphalt`,
`stone`) crash against `road` (a heavy thump under the car's weight, the body grating on it) and
scrape like `masonry`, loose ground (`gravel`, `dirt`, `grass`, `leaves`) like `earth` (the soft,
slow contact, the thud, dirt sprayed up). The material of a
drive wall (`wallAt` in `places.ts`) is that of the nearest wall source within 3 m of the contact
point, if it is the wall the car met (within 0.6 m of the nearest drive wall of any kind): a tree
trunk (`tree`); a building's walls by kind and style (a greenhouse `glass`, the industrial style,
which takes in substations and silos, `sheet`, the stone, church, tower and ruin styles `stone`,
the rest `masonry`); a barrier (a guard rail `rail`, a wall `stone`, a cliff `rock`); else the
bank itself: `rock` in the bare-stone covers (a quarry's cut face, a crag, scree), and anything
else, a steep bank or the end of the map, is `earth`, though trees stand a metre
or two off it (35 % of the probes 0.15 m off the map's banks read `tree` before that rule, 3.6 %
after).

### Engines

Each engine's sound comes from how the sim says it is built (`VEHICLES[model].engine`: fuel,
strokes, cylinders, displacement, aspiration, idle and redline), through `timbreOf` in
`synth/engine.ts`; the revs and load it plays are the sim's drivetrain's. The rules were fitted to
the four hand-tuned engines they replaced:

- **Pulses** per crank revolution: half the cylinders on a four-stroke, all of them on a
  two-stroke. The firing frequency is rpm / 60 × pulses.
- **The cycle and fuel** set the class: the waveform (a petrol four's sawtooth, a diesel's 0.3
  pulse, a two-stroke's sharp 0.12 pulse), the mechanical noise (a diesel's knock gated at the
  firing rate at 0.6, a two-stroke's rattle at 0.15, a petrol four's valve train not gated), the
  formants' Q, gains and spacing (the second at 3.3× the first on a four-stroke, 2.3× on a
  two-stroke) and the waveshaper's drive (2.5; 4 on a two-stroke).
- **Size scaling**: the first exhaust formant is 330 Hz for 1242 cm³ and goes as the cube root of
  the displacement (a resonance goes as 1/length), 1.3× higher on a two-stroke's expansion
  chamber. The idle lowpass sits 2.7× above it (2× on a two-stroke), the highpass at an eighth of
  it (a fifth on a two-stroke), never under 30 Hz. The sub (the half-order triangle) is 0.25 at
  310 cm³ a cylinder, rising 0.15 per decade of the size of each cylinder, held to 0.1–0.4.
- **The redline lowpass** keeps a number of harmonics of the firing frequency there: 20 on a petrol
  four, 11 on a diesel, 66 on a two-stroke.
- **A turbo** whines (0.015, the diesel's bigger one 0.02), tightens the formants' Q by 0.8,
  lifts their gains to 0.8 and 0.35, the drive by 1 and takes a fifth off the noise.

| Model | Pulses | Wave | Sub | Formants (Hz) | Lowpass idle–redline (Hz) | Highpass (Hz) | Noise gated | Turbo |
|---|---|---|---|---|---|---|---|---|
| Panda (1242 cm³ petrol four) | 2 | sawtooth | 0.25 | 330, 1089 | 891–4133 | 41 | no | no |
| Ape (50 cm³ two-stroke single) | 1 | 0.12 pulse | 0.13 | 1252, 2879 | 2503–7480 | 250 | 0.15 | no |
| Truck (12 880 cm³ turbo-diesel six) | 3 | 0.3 pulse | 0.38 | 151, 499 | 409–1265 | 30 | 0.6 | 0.02 |
| Giulia (1995 cm³ turbo petrol four) | 2 | sawtooth | 0.28 | 211, 697 | 571–4000 | 30 | no | 0.015 |
| ATR 220 power pack (12 816 cm³ turbo-diesel six, the MAN D2876) | 3 | 0.3 pulse | 0.38 | 152, 500 | 409–990 | 30 | 0.6 | 0.02 |

The ATR 220's power pack is a train's (`TRAINS.atr220.engine`, through `engineSpec`): built like the
truck's six, it differs only in its redline lowpass, its rated 1800 rpm against the truck's 2300.
It idles at 600 rpm, firing at 30 Hz, on the 30 Hz highpass: the tone rests on the formants and
the shaper's harmonics, and plays 16.9 dB (RMS) under its rated revs at full power, the truck's
17.0. Trains take no damage, so its `KNOCK` is 0.

Geometry alone is wrong for the Giulia: its 2 l would put its formants at 282 and 930 Hz, barely
under the Panda's, but its sports exhaust is voiced darker, so `EXHAUST` scales its formants by
0.75. Each vehicle also draws a `variant` from its entity id (`hash01`), which moves its pitch ±2 %
and its formants ±4 %, so two Pandas side by side do not sound alike; the calibration renders and
the ignition's catch play the nominal 0.5.

Crash damage (the sim's `Damage`, [gameplay.md](gameplay.md#damage)) wears the voice (`WORN` in
`synth/engine.ts`). An engine as new plays exactly as built: its damage nodes are made only on the
first update with any damage (few engines ever take some). Its output gain only falls with damage,
while the knock and the backfires it adds are sized so a worn engine still peaks under its nominal
(0.385–0.436 at the redline at damage 0.9, measured below).

- **Duller and weaker** from the first crash: the lowpass closes by up to 35 % and the load's drive
  by up to 30 %, and the output loses up to 2 dB, which `engineQuiet` counts.
- **Rough** from damage 0.2, before any smoke shows: slow brown noise (its corner at 77 Hz: lumps,
  not hiss) wobbles the output under its unity gain up to 0.4 deep and jitters the firings' pitch
  up to 40 cents.
- **Knocking** from the medium stage: a 1.4 kHz band of noise (Q 3) struck once a crank turn, at
  each model's measured `KNOCK` (Panda 4, Ape 1.5, truck 8, Giulia 5.5, so that idling at damage
  0.9 it plays 16 dB (RMS) under the firing tone), half as loud under full load, which masks a
  real knock.
- **Misfiring** from the severe stage, when the sim's drivetrain does (`misfire`, its 0.25 s
  windows, so the cough heard is the lurch felt): the voice falls toward 0.15 with a 5 ms time
  constant (settled in about 25 ms) and each misfire pops a backfire, a thump at about 180 Hz and a
  crack at about 1.5 kHz.
- **Dead** once destroyed: the vehicle no longer runs, so the engine fades out (0.3 s), and with it
  the horn and the siren; the fire takes over until the blast.

### Trains and level crossings

A train is heard as the sim moves it, car by car (`director/rail.ts`):

- **Power packs.** One engine voice under each end car (`engine:id:0` under the active cab,
  `engine:id:1` under the far one), at the train's `trainRevs`: idling at 600 rpm with the power
  off, up to 1800 under full power, whatever the speed (the hydrodynamic transmission). Each
  draws its `variant` from the train's id and its index.
- **Wheels and clacks.** One `rails` voice per train, at the nearest point of its cars in the open
  (above). Its params carry each axle's s (8 on the ATR 220's B′2′2′B′: two per bogie, 2.6 m
  apart, `WHEELBASE`, the outer bogies 2.5 m in from the noses, the Jacobs bogies at the joints)
  and the joints and switches near them on the line (`jointsBetween`): a joint every 36 m
  (`JOINT`, the longest FS bar; TUNED, the line's track is unverified) and a switch wherever an end
  of a piece of track the line does not run on lies on it (the Gragnola loop's two, found from the
  map's geometry, so any line's switches are found alike). The voice schedules each axle's clack
  0.3 s ahead (`LOOKAHEAD`, as the fire's crackle) when it will reach a joint, keeping per axle the
  s up to which it has scheduled (`clacksAhead`): each joint clacks once per axle per pass, at any
  frame rate, and a reversal or a stall starts afresh. Under 0.5 m/s nothing clacks. So the bogie
  pairs give the "ta-tak" of a passing train, 72 ms apart at 130 km/h.
- **Brakes** squeal from the wheels' place while the train brakes harder than a tenth of its
  emergency rate below 6 m/s, loudest just before it stands.
- **Horns.** The player's H in the cab holds the high tone from the roof at the nose, through the
  cab; an AI train's `Whistle` plays its honk there, echoing off rock faces.
- **Tunnels** and **the cab** as above ([Tunnels](#tunnels), [Inside a vehicle](#inside-a-vehicle)).
  Riding through a tunnel (the cab's car in a bore, `seatOf`), no wind, rain, roof drumming or
  crickets play, and the masking floor is the stillest air's; the own wheels play as in the open
  (6.0 dB over gain 1 in the 225 m tunnel past Monzone, as just before it), where the wind bed had
  blown as loud as them and the ground effect, both ends of the path under the terrain, had taken
  4.5 dB of them.
- **Hits** with trains crash as steel ([Data flow](#data-flow)): a car into a train, two trains, a
  buffer stop; a person or an animal a train strikes thuds, groans or cries out as from a car.

A level crossing rings one bell per box (`plBell:index`), at its centre, while `crossingAt` says so:
two bells on its posts started apart would flam. Inside its posts it gets no louder: its `rMin` is
the distance from the centre to its nearest arm's post (`posts`, 5.2–8.9 m on this map), where the
real bells stand; at its 0.3 m Via Riolo's bell played 15.6 dB louder at the centre than at the
posts and ducked the whole mix 8.8 dB on every stroke. Each box's bell is its own unit (`variant`,
from its index), detuned up to ±20 cents (±1.2 %, pitch and stroke rate together; an estimate):
Gragnola's two boxes, 242 m apart, go into their warning in the same step, and two copies of one
loop started together would fuse into one bell between them. The bell (`synth/crossing.ts`) is the
trains research's measurement of an Italian automatic crossing's (Commons, "Il segnale acustico di
un passaggio a livello automatico", CC BY-SA 4.0, analysed only): single strokes every 1287.4 ms (9
intervals of 1285–1291 ms), each ringing until the next, falling −12 dB in 100 ms and −30 dB in
about 1 s, its partials at 1233.5, 1526, 1720 and 2502.6 Hz (the hum, T60 5–8 s), two doublets at
3737/3762.7 and 5157/5182 Hz beating at 25–26 Hz (the stroke's brightest, T60 1.2–2.5 s), 4398,
6720, 8536 and 10314 Hz (0.4–0.65 s). One period is rendered in pure TypeScript per context: each
partial's ring summed over every stroke before it in closed form (a geometric series), so the loop
holds the steady ring of a minute of strokes and wraps on a stroke with no seam; a 1.2 ms seeded
click marks the stroke. It plays from offset 0, so it starts on a stroke, and stops within 0.3 s
when the arms are down.

### Crashes

A crash is rendered in pure TypeScript (`synth/crash/render.ts`) into a buffer the `crash` shot
plays (`synth/crash/index.ts`), once per params object: the director's echoes pass the same object,
so they replay the same render. Its structure comes from the crash research (physics of crash
pulses, crumpling, panel damping and glass; synthesis methods; a critique that measured 16 real
crash recordings and set the acceptance targets), and every number below is tuned against those
measurements, not by ear.

What a crash is made of, in time:

- **The contact** builds over 11–20 ms (earth ×2.8, a greenhouse or rail ×1.1, a tree ×1.2, a
  side hit ×0.9) and is the loudest moment of its first 50 ms. Its brightness follows how long the
  two surfaces stay in contact, springs in series (−6 dB at 0.83/τ): a PP bumper cover over foam
  (3–8 ms) is dull, bare steel (0.3–1 ms), a door skin (0.6–1.5 ms) and steel on stone bright.
- **The crunch** of each body (`render.ts`): dense Gaussian band noise, overlapping buckle grains
  (1500–3000 a second, 2–5 ms each), whose power follows the crush rate cos(πt/T) inside the crush
  pulse T = 0.1 s·√(μ/k) (±10 %; k the two stiffnesses in series), is held by the rebound and the
  continued deformation for the **main block** (60–75 ms for a bump, 150–400 ms for a crash, longer
  with speed and on a side hit), then falls into the tail; its drive tops out the same whether it
  crumples or only rubs, so the level law alone sets how loud it is. Its spectrum is flat within
  ~5 dB over 125 Hz–2 kHz with a random tilt per render (±1.3 dB per octave) and falls away above
  and below it (the medians over the exterior matrix at 30–150 ms, re the loudest octave: 63 Hz
  −9…−17 dB, 4 kHz −6.5…−13, 8 kHz −15…−22, 16 kHz −25…−35, the brightest a side hit and a wreck,
  the dullest earth and the truck): no boom outside. It rings on in the body's dense modal field,
  each octave decaying with T60 = 2.2 / (f·η), η 0.015–0.045 (at most 0.8 s). A bump (no crumple
  under ~3 m/s) is the cover rubbing instead: darker, peaking near 250 Hz; so is a landing on the
  wheels at any speed, as the floor does not crumple.
- **1–3 sub-hits** at +80…600 ms (more on a side hit and with speed): a second contact, rising in
  4–10 ms, 40–120 ms long, driven at 15–40 % of the block's top. They come back 13 dB and more under
  the hit in most renders (a Panda into a house at 10 and 14 m/s: medians 15 and 19 dB under, in
  10 ms RMS, within 6 dB in 2 and 1 of twenty): a real second contact the physics reports as its
  own Impact, which plays its own crash, and twice as strong they sounded like an echo of the hit.
  Past the level cap (a barrier-equivalent of about 30 m/s) a wreck goes on
  growing in time: from 25 to 60 m/s equivalent the block lengthens by up to 80 ms, the third
  sub-hit grows likelier, the sub-hits spread to 1.2 s and the tail by up to a second.
- **3–30 major buckles** (power-law energies, α 1.3–1.6, over 20 dB), mostly inside the pulse, the
  rest through the block and the sub-hits: each a bright burst and 4–8 freshly drawn panel modes
  (fewer each past a dozen buckles, where they merge into the dense field anyway).
- **1–3 long partials**, stiff parts ringing through the crunch: 0.6–4.3 kHz, T60 0.3–0.9 s
  (η 0.001–0.01), about 9–18 dB clear of it in a narrow band.
- **What breaks** (`parts.ts`), by threshold, read at each body's barrier-equivalent speed (the
  speed into a wall that crushes it as much) and chosen by the zone hit. Front and rear: the PP
  cover's thock (modes at 150–700 Hz ringing 20–100 ms), cracks and clip pops from 3 m/s, the lamps
  from 4–6 m/s. Front only: the airbag from 5–7.2 m/s (a muffled whump) and the laminated windscreen from 10–15 m/s (a crack chain, no shower). A side: the
  door skin (a brighter crunch), the mirror snapping, the tempered side glass from 5–10 m/s; front
  and rear take it from 15–20 m/s. **Tempered glass**: a pop, a near-silent gap, then cubes landing
  in 10–60 clumps over a granular bed from 150–250 ms to ~1.4 s, centred on the 8 kHz octave, a
  second cascade 1.5–2 s later in 40 % of panes; about 9 dB under the crunch it rides on (the
  pop 5 dB), so a hard frontal or a side hit stays under 3.5 kHz of centroid through 600 ms like
  the recordings. Under (a hard landing from 5 m/s; softer ones are clunks): nothing breaks, as no
  bumper, lamp, pane or airbag faces the ground, and the floor meets it through the tyres and bump
  stops, as dull a contact as a PP cover's (3–8 ms), without crumpling. A part breaks once: the mirror, the side
  glass, a lamp, the windscreen and the airbag go only if no earlier hit on that zone of the
  vehicle (its `worn`) passed their threshold.
- **The aftermath**: the car settling (a low-mid bed 8–13 dB under the block, the recordings'
  tails are loudest at 125–500 Hz), debris landing from 0.25 s (none at 2 m/s, dozens at 10–15,
  ~220 in a wreck, up to ~440 at 60 m/s; a third of it metal clinks ringing 20–100 ms), loose
  parts rattling, creaks at an Omori rate (t + 0.2 s)^−0.9 (more past the cap), coolant hiss after
  a hard frontal hit. The tail lasts 0.5–2.5 s, growing with speed, to 3.5 s past the cap; a
  render is at most 4 s (a 35 m/s Giulia wreck reaches it), trimmed 60 dB under its peak and faded.

Each vehicle (`bodies.ts`; masses are the sim's, which the laws count in Panda masses: the Ape
0.38, the laden truck 25.6, the Giulia 1.56; the rest the research's estimates):

| Model | Stiffness | Crunch | Field η | Partials | Front and rear | Its own |
|---|---|---|---|---|---|---|
| Panda | 1 | the reference | 0.025–0.045 | 1–2, 0.7–3.5 kHz | PP cover | a hubcap wobbling down after 9 m/s (40 %) |
| Ape | 0.5 | thin and tinny, little boom | 0.015–0.03 | 2–3, longer | bare steel, no airbag | big rattles (2.5× a car's) |
| Truck | 3 | deeper (the frame sweetener from 10 m/s) | 0.02–0.04 | 1–2, 0.6–2.5 kHz | a heavy steel bumper's clang (4 modes at 150–900 Hz, η 0.004, driven by the closing speed; 12 dB clear of the crunch in about half of Panda–truck hits at 12 m/s, its 250–500 Hz lifting the spectrum to within 8 dB) | the marble shifting by its velocity change (2–6 thunks from 0.5–3 m/s: its own hits shift it, while a Panda hitting it at 12 m/s barely moves it, 0.5 m/s), a chain rattling from 2.5 m/s |
| Giulia | 1.3 | aluminium skins: brighter | 0.025–0.045 | 1–2, 0.9–4.3 kHz | PP cover | the light bar cracking, its electronics rattling (not on a landing) |

Car into car: both bodies crunch from one pulse, sharing it by compliance (each takes
k_other / (k + k_other): a Panda takes 75 % against the truck, an Ape 67 % against a Panda), each
with its own spectrum, partials and parts; the contact sounds the same from either car. Both
steel shells clank where they met (`shells` in `render.ts`): 6 modes each from 0.7 kHz to the top
of the model's panel range, η 0.008–0.015, driven up over the crush pulse, so a Panda–Panda hit at
10 m/s measures a band flatness of 0.45 in its first 30 ms against a house wall's 0.55 (medians):
metal on metal rings where a wall's dead mass rings nothing.

What was hit (`targets.ts`) takes part of the crush (the car's share is k / (k + k_car)) and adds
its own sound:

| Material | Stiffness | What it adds |
|---|---|---|
| `masonry` | rigid | plaster grit, chips landing above ~8 m/s, the building's dull mass (40–80 Hz, η 0.1); no ring |
| `stone` | 6 | more grit; above ~8 m/s stones knocked out, thudding and clacking as they land; a short rumble |
| `rock` | rigid, the hardest contact | harsh grit, pebbles trickling down for seconds |
| `sheet` | 3 | a big, wobbly thin-sheet ring (14 modes at 100–2500 Hz, η 0.002–0.004, each beating against a near-twin, driven up while the sheet deflects: band flatness 0.38 through 150–600 ms against masonry's 0.55), the sheet clattering |
| `glass` | 1 | annealed greenhouse panes: a crack as the pane breaks (fading in from 1.5 to 4 m/s), ringing shards falling over 0.1–2 s from about 2 m/s, a granular bed |
| `rail` | 2 | the only long tonal ring: W-beam modes near 180, 430, 770 Hz and 2–2.7 kHz with split partners, T60 1.4–2.4 s, driven while it deflects; a post's thud, bolts rattling |
| `earth` | 0.43 (the car crushes 30 %) | the softest, slowest contact, a dull crunch, a 60–110 Hz thud, dirt sprayed up, clods |
| `tree` | 1.5 (the car crushes 60 %) | a wood knock (Farnell's wood bank), a creak above ~8 m/s, leaves rustling faintly for 2–4 s (at 2–2.5 s about 23 dB under the crash's first 300 ms in 2.5–8 kHz, 9–13 dB over a house wall's tail there), twigs and burrs ticking dully on the bonnet (300–2000 Hz, η 0.01) |
| `road` | rigid | the asphalt or paving a car lands or rolls on: the body's slap and a 50–90 Hz thump under its weight, grating along the coarse surface for 0.2–0.5 s, grit flicked; landing on its wheels, the bump stops' 70–110 Hz thump and the suspension's steel clanking (about 330 and 760 Hz, as a clunk's). Medians: a 6 m/s landing has 56 % of its energy under 200 Hz and falls 10 dB in 80 ms (a house wall as hard: 30 % and 220 ms); an 8 m/s roll lifts 63 Hz to 0.4 dB under the loudest octave (a side into a house wall: 12 dB under) |

Pieces land on the `surface` under the car: asphalt as is, stone setts brighter and bouncier,
gravel, dirt, leaves and grass muffled and quieter (grass about 16 dB under asphalt). A crash is
always rendered as heard from outside, the listener's own too: through a cabin's balance (most of
the energy under 200 Hz, 2–16 kHz 18–20 dB down) a wall, a car and the road sounded alike, and
the cabin's air mode boomed again at every sub-hit.

**One level law, applied once.** The render's gain is the dissipated energy ½·μ·v²·(1 − e²)
(e from Cipriani's fit, 0.46 at 1 m/s to 0.1 from 7 m/s; μ the Impact's tonnes in Panda masses),
each body's share of it (all of it against a wall but the wall's own share; two cars split it by
compliance) counted at 1/√ of the body's mass in Panda masses, relative to the reference crash: a
Panda nose-first into masonry at 15 m/s, which peaks near the nominal 0.5. That is −18 dB at
2 m/s, −10 at 5, −3.5 at 10, +2.5 at 20; +6.5 dB per doubling of speed; a Panda–Panda 3 dB under
a Panda into a wall at the same closing speed (μ = 0.5); an earth bank 5.2 dB and a tree 2.2 dB
under masonry. The √ is there because a heavier vehicle's extra mass is mostly frame, running
gear and load, which do not crumple and ring like a light car's thin skins: the laden truck plays
7 dB over a Panda at the same speed, not 14, so its 2 m/s nudge into a house plays at −11.2 dB
(a Panda's 4 m/s bump is −11.8) with nothing broken, and it reaches the cap from about 13.4 m/s.
It also gives back the masses the crashes were tuned with (Ape 0.62, Giulia 1.25, truck 5.1, where
the hand-set table had 0.6, 1.3 and 4). Above +6 dB (a Panda at ~30 m/s) the level stops:
the front is used up, and the main block's length, the sub-hits, the debris and the tail carry
the severity. `crashQuiet` is that level, negated, for masking, less what a ringing wall or two
clanking shells add to it (`adds`, measured: the guard rail and a sheet wall play 2 dB over the law
once their ring is driven fully, from 8 m/s, and the road's thump 3.5 (a roll) to 6 dB (a landing),
counted as 4.5; `SHELL_ADDS`, 1 dB of the 0.5–2.6 dB a car–car clank adds). Event counts, durations and thresholds never touch the level. The
peaks follow it within about 1 dB from a 2 m/s bump to a 20 m/s hit on every material (a
Panda–truck hit, its bumper clang, 1.8 dB over). A render never peaks over 0.95.

**Cost.** A render is mostly multiply-adds: every noise layer only adds power to ten octave
bands' envelopes (at 6 kHz control rate), played at the end over ten precomputed loops of band
noise (2.7 s each, read forth and back so they repeat only after 5.5 s, longer than any render;
made once per sample rate in `prepare`: 24–33 ms in Node, 5.2 MB); each mode is one recurrence
step a sample until it falls 60 dB (or to −80 dBFS). A crash renders at the device's rate up to
48 kHz (above it Web Audio resamples: at 96 kHz every mode would cost twice as much). In Node on
this machine (busy, a load of 6), over 20 seeds: a Panda into a house at 14 m/s renders in 4.7 ms
(median; 6.7 worst), the heaviest reachable crashes (the Giulia into a rail or a house at 40 m/s,
a Panda into a tree at 40, a Giulia–truck head-on at 62, two trucks at 40) in 8–15 ms (18 worst);
in headless Chrome 3.5 ms and 7–13.5 ms (14.5 worst). In the game (headless Chrome, `?seed=3`,
90 s at Monzone station and the player's Panda driven into houses, a stone wall and a tree, 115
crash plays) a play took 2 ms (median; 4.6 for nine in ten, 8.8 at most) and no long task fell
within a second of one. ponytail: the render runs on the main thread; move it to a Worker if the
browser shows long tasks.

The bells are the tallest church or tower of each district, 27 in all. A tower of 10 m or less
rings an 800 Hz prime; taller towers ring lower, down to 400 Hz at 30 m.

### Explosions

A burning wreck's blast is rendered in pure TypeScript (`synth/explosion.ts`) with the crash's
band-noise engine and struck modes (`synth/crash/dsp.ts`), once per params object, so its echoes
replay the same render. What it is made of, in time:

- **The crack**, the blast wave: a Friedlander pulse (1 − t/T)·e^(−t/T), its positive phase T
  3–6 ms long (a jump, then a shallower suction, no net push), and a few ms of noise brightest at
  2–8 kHz.
- **The boom and the thump**, the fuel going up: broadband noise loudest at 125 Hz (14 dB down by
  2 kHz), up in 3–6 ms, its power falling with a time constant of 80–140 ms; a sine falling from
  60–75 to 28–34 Hz (the glide's time constant 60–120 ms), up in 3–6 ms and decaying with a time
  constant of 120–200 ms, through tanh(1.8·x), so its 3rd and 5th harmonics (90–375 Hz) carry the
  boom on a speaker with no 30–70 Hz; and a burst of brown noise lowpassed over 125 Hz.
- **The roar**, the fireball: band noise swelling as x^0.6·e^(0.6·(1 − x)) to its peak at
  0.18–0.28 s, billowing (Gaussian noise lowpassed at 8 Hz swings its level by 0.2 nepers, one
  sigma), its centre whooshing from 110–150 Hz up to 450–700 Hz at 0.12–0.2 s and back down, 1.1
  octaves wide. Over 0.3–1 s it plays a median 6.4 dB under the first 0.15 s, and 19.3 dB under
  by 1.2–1.6 s.
- **The debris**: 24–40 pieces landing from 0.3 to 2.5 s, most early, the later ones smaller, over
  20 dB (a power law): 60 % metal clinking at 1–5 kHz (two modes ringing 30–120 ms), the rest dull
  thuds at 125–250 Hz on an 80–200 Hz mode. They land on `surface` as a crash's debris does
  (`land` in `synth/crash/textures.ts`), bouncing on the road and the setts, muffled on grass:
  over 2 kHz, from 1.3 to 2.5 s, the loudest clinks stand a median 17.4 dB over the roar's tail
  on asphalt, 18.4 dB louder than on grass.

The whole blast is then driven into a soft clip, tanh(2·x / its peak), which presses its loudest
few dB together inside the buffer (with no release, nothing pumps), scaled to peak at the nominal
0.5, trimmed 60 dB under its peak and faded: 2.6–3.6 s long. Against the reference crash at the
same peak (the medians of twenty seeds): 7.1 dB louder over its first 300 ms (RMS −12.6 against
−19.7 dBFS), a crest of 6.6 dB against 13.2, 54 % of its energy under 200 Hz against 35 %, a
centroid of 1.5 kHz over 30–600 ms against 2.4. Its octaves over 30–150 ms, re the loudest
(63 Hz): 31.5 Hz −2.2, 125 Hz −3.9, 250 Hz −2.9, 500 Hz −4.2, 1 kHz −5.3, 2 kHz −9.9, 4 kHz
−16.7, 8 kHz −26.2 dB, where a crash is loudest at 250 Hz, 63 Hz −8.8 and 4 kHz −8.5. Its loudest
50 ms starts within 0.17 s in each of 120 renders. A render takes 10 ms in Node (the median of
twenty, 15.7 the worst, at a load of 9) and 7.9 ms in headless Chrome at 48 kHz (9.8 the worst);
in the game the blast's play took 12 ms.

### Rain

Rain is two voices in `synth/rain.ts`, both following the drops' kinetic energy: a bed all around
the listener outside (`rain`), and the drumming on the roof of the car the listener sits in
(`roof`).

- **The level law** (`rainQuiet`): both voices play under their nominal peak, a 60 mm/h downpour
  (`DOWNPOUR`), by the drops' kinetic energy against a downpour's, KE = R·(11.9 + 8.7·log10 R)
  J/m²/h with R held to 0.1–76 mm/h (Wischmeier and Smith; it saturates past 76): 21.4 dB under at
  1 mm/h, 13.8 at 4, 9.0 at 10 and 2.0 at 40, 12 dB a decade. `rainDb` and `roofDb` put that at
  the ears (the catalogue's levels).
- **Outside**: a bright pink hiss; the drops near the ears as ticks coloured by what they land on
  (leaves ring near 4 kHz, roofs and paving tock at 1.8 kHz and 600 Hz, open ground ticks above
  900 Hz), in the shares given and adding in power, so a forest's edge is as loud as either side; a
  low roar of runoff in heavy rain; bubbles where it falls on water (Medwin and Nystuen 1992); and
  a ±1 dB swell of wind-blown sheets. A shower is separate ticks over a faint hiss; as the rate
  grows they fuse into the roar. On water the plinks rise over a steady rain's drops (+1.7 to
  +2.4 dB at 8 kHz at 4–8 mm/h), the loudest never louder than a downpour's, and the roar takes
  them from 20 mm/h.
- **On the roof**: each drop rings the roof panel's and the windscreen's modes (a texture rendered
  in plain TypeScript on first use, 3.5–6.7 ms), so the cabin drums low and tonal, then roars: a
  centroid near 0.6 kHz and 97–99 % of the energy under 1 kHz, against 4.3–8.2 kHz and 20–44 %
  for the drops outside.
- Measured offline (Node with `node-web-audio-api`, four renders each): the outside voice keeps
  within 1.5 dB of its law on every ground at every rate, and the roof within 0.7 dB; a downpour
  peaks 0.46–0.60 outside and 0.45 on the roof; a shower's crest is 22.5 dB.

### Thunder

Thunder is rendered in plain TypeScript from Few's "string of pearls" (1969, `synth/thunder.ts`)
and held in the director until its sound reaches the listener (`director/thunder.ts`).

- **The render**: the lightning channel is a tortuous chain of straight segments (5–70 m long,
  turning about 16° at each: Hill 1968), and every 2 m of it sends one N-wave, heard after its own
  travel time, 1/r fainter. Segments across the line of sight add up into claps and the rest smears
  into rumble, so a near bolt cracks (its foot, a run of short N-waves) and booms, a far one only
  rumbles, low and slow to swell, and an in-cloud flash has no foot to crack. One lowpass for the
  air closes as the render goes on, and a Schroeder reverb rolls it round the valley. The loudest
  clap peaks at the nominal 0.5 before the air; `thunderQuiet`, 11.5·log10(range / 300 m) past
  300 m (3.5 dB per doubling), is how much quieter the air leaves it, within 2 dB of A-weighted
  renders past 2 km. A render lasts at most 20 s (`LONGEST`).
- **What it is rendered from**: `distance`, horizontal, to the strike point or to the point under
  an in-cloud flash; `ears`, the ears' height over the ground under the flash (1.6 m on level
  ground, hundreds on a ridge over a valley strike, where the trunk passing at the ears' height is
  heard first); `bolt`; and `seed`, the flash's, which draws the channel.
- **Rate and cost**: one render per params object (an echo replays it), at 16 kHz for a bolt within
  1 km, and at 8 kHz past it and for every in-cloud flash, whose channel starts 3 km up (the air
  leaves nothing above 700 Hz at the ground, 900 Hz on a summit 1.8 km over it). A 300 m bolt
  renders in 3.3 ms in Chrome (median; 4.4 for nine in ten, 10.4 at most) and 14.5 ms with the CPU
  throttled four times.
- **The queue**: on each `lightning` happening while the context runs, the director makes the
  sound, drops the flash if it would not be heard even now (masked, or too far), and queues it.
  From the next frame on it renders one queued thunder a frame, oldest first, so the flash's own
  frame, where the bolt is drawn, renders nothing: in Chrome the director's flash frame took at
  most 0.1 ms, the frame after it 3.2 ms (median; 14.7 at most).
- **Arrival**: its first sound is due at the flash's time + range / c − `lead` (the render's first
  sound leaves `lead` s before its strike point's), or at once within 40 m, and it is placed 0.1 s
  ahead of that from where the listener then is: get into the Panda meanwhile and it comes through
  the cabin; drive toward it and it comes sooner.
- **Placement**: a clear path, no obstacle walked; aloft, no ground or snow loss; quiet
  `thunderQuiet(range)`. It pans 0.6 of a point source's (the channel fills the sky), its lowpass
  is only the cabin's (its air is in the render), it sends no reverb, and its direct sound plays at
  most 2 dB over gain 1 (`MOST_DB.thunder`), so its crack peaks at −9 dBFS into the limiter
  centred, −6.0 at the widest pan.
- **At most two roll at once**: one playing over another plays 1/√2 (3 dB) under its own level; a
  third louder than the quieter of the two stops it (`Speaker.stop`) and takes its place, else it
  is dropped. In a real storm (three seeds × 240 s) no more than two ever sounded at once.
- **Echoes**: the rock faces in sight answer it, at least 10 dB under its capped direct sound, and
  stop with it; the render's roll holds the rest of the valley's returns.

Measured: in the game, bolts started within 0.03 s of range / c − `lead` at 332, 474 and 2,610 m,
and within 0.09 s at 2,515 m; with the geometry known exactly, within 0.001 s over 21 thunders from
300 m to 3 km. No thunder started late.

### Speech

People talk the way The Sims do: Italian-sounding gibberish with a real Italian word now and then,
and their cries in real Italian. `src/audio/speech` picks the line (`lineFor`), times it
(`lineSeconds`) and renders it in pure TypeScript into a buffer, like the crash, so it is tested
in Node and reproducible with a seeded random source. It is tuned by the numbers below and the
tests' measurements, not by ear.

- **What is said** (`lines.ts`), by situation: `greet`, `chat`, `reply`, `laugh` and `farewell`
  in a conversation; `fright`, `shock`, `anger` and `surprise` for a cry; `pity` (shock at a killed
  animal); `helpMan`, `helpWoman` and `helpKid` (a stranger asking after someone struck down);
  `grieve`; `mum`, `dad`, `nonna` and `nonno` (a child calling its parent or grandparent); `thief`
  (a robbed driver). Every line but chat, reply and laugh is a real phrase in its tune: "Aiuto!",
  "Attento!", "No!"; "Oddio!", "Madonna!", "Oh no!", "Chiamate un'ambulanza!"; "Vai piano!", "Ma
  sei matto?", "Rallenta!", "Ehi!", "Guarda dove vai!"; "Mamma mia!", "Ma che…"; "Tutto bene?",
  "Respira?", "Signore, mi sente?", "Signora, mi sente?", "Mi senti?" to a child; "Povera bestia!";
  "No, no, no!", "Ti prego!", "Svegliati!", "Amore!"; "Mamma!", "Papà!", "Nonna!", "Nonno!";
  "Ladro!", "Al ladro!", "Fermo!", "Ehi! La mia macchina!"; "Ciao!", "Buongiorno!", "Salve!",
  "Ehilà!"; "Ciao ciao!", "A dopo!", "Arrivederci!", "Ci vediamo!".
- **Chat** is 1–3 s of gibberish with real fillers ("allora", "boh", "magari", "eh già",
  "comunque", "figurati", "che ne so"…) for 15 % of the draws (10–25 % of the words measured); a
  pause follows half the fillers and 12 % of the gibberish words. A reply is 0.6–1.8 s, half of
  them opening on an answer ("Sì,", "Beh,", "Mah,"…); a laugh is 3–6 breathy calls on one vowel.
- **Gibberish follows Italian phonotactics** (Krämer 2009), so it sounds Italian without being it:
  open (C)CV syllables, onset clusters such as pr, st, kw, or a coda n, r, l or s before a stop;
  /n/ is [m] before /p b/; every word ends in a vowel; one stress at most, 80 % on the penultimate
  syllable and 15 % the antepenultimate; /ɛ ɔ/ only under stress; 20 % of the consonants between
  vowels doubled (estimate) and /ʃ ɲ ʎ ts dz/ always long there. Words are spelt the Italian way
  (ch, gh, gn, gli, sc, zz, a final stress accented). A word whose spelling, accents aside, holds
  the stem of an Italian profanity or slur (`PROFANE`) is drawn again: the tests find none in
  200,000 words.
- **Timing** (`plan.ts`) is deterministic, so `lineSeconds` is the rendered length: a stressed
  vowel ×1.7 in an open syllable and ×1.25 in a closed one (Bertinetto 1981; D'Imperio and
  Rosenthall 1999), a doubled closure ×2 (Esposito and Di Benedetto 1999), the last syllable of a
  phrase ×1.4 and a call's last vowel ×3 (estimates), a phrase break 0.18 s, 30 ms of silence at
  each end. The tempo is TUNED to Italian's 6.99 syllables a second (Pellegrino, Coupé and Marsico
  2011): chat lines run at 6.3–7.7 (tested). Kids speak ×1.15 and elders ×1.12 slower (estimates). Mean lengths
  for a man: chat 2.19 s, reply 1.34, greet 0.39, farewell 0.58, fright 0.41, shock 0.65, anger
  0.57, surprise 0.45, thief 0.69, laugh 0.82.
- **Voices.** F0 is 115 Hz for men, 210 for women, 125 for elder men, 190 for elder women and 270
  for kids (Titze 1994); the vocal tract is scaled ×1.15 for women and ×1.3 for kids (Peterson and
  Barney 1952). Each person's `voice` (from their id) moves the pitch ±10 %, the tract ±4 % and the
  rate ±5 %, from separate hashes, so one person keeps one voice and pitch and timbre vary apart.
  Elders are breathier, with 1.5 % jitter, 6 % shimmer and 2.5 % flutter against 0.5, 3 and 1 %
  (Klatt and Klatt 1990; Xue and Deliyski 2001). The tunes: `say` falls from a peak on the stress,
  `ask` rises at the end, `exclaim` is high and wide, `call` holds its last vowel, `laugh` is
  breathy calls falling in pitch. A yell lifts F0 ×1.6 and F1 ×1.1, holds its vowels ×1.25 and
  tenses and brightens the source (Schulman 1989).
- **The synth** (`render.ts`) is a Klatt 1980 cascade/parallel formant synthesiser: a KLGLOTT88
  glottal pulse with jitter, shimmer and flutter, tilted by effort, with aspiration on its open
  phase, through a nasal pole and zero and five formant resonators updated every 5 ms; frication
  and release bursts go through a parallel band-pass tuned to their own band, retuned within the
  sample the band changes; a trill dips the amplitude 25 times a second. The vowel formants are Ferrero 1972's male
  means as commonly quoted (an estimate: the original table was not checked), the consonants'
  transitions follow Delattre, Liberman and Cooper 1955, the bursts Stevens and Blumstein 1978, the
  fricatives Jongman, Wayland and Wong 2000, the nasals Fujimura 1962. A line peaks at 0.5, starts
  silent and rings out into its trailing pad with no click (the largest step where the speech ends
  is under 0.05 on the 0.5 peak).
- **Measured** (a man's voice at 48 kHz): against a stressed /a/, /s/ sits 12 dB under (centroid
  6.1 kHz), /ʃ/ 14 dB (3.75 kHz), /f/ 19 dB and a nasal murmur 4 dB; a /t/ burst's centroid is about
  5.2 kHz. His `ask` rises 116 → 138 Hz and his `say` falls 121 → 97 Hz; yelled, his vowels'
  centroid goes from 730 to 991 Hz.
- **Cost.** `speechShot` renders at the context's rate up to 48 kHz, once per speech object (an echo
  replays it), on the main thread: in Node a chat line takes 5.7–6.0 ms (2.9 ms per second of
  speech) and a shock yell 2.4 ms. Not lower than 48 kHz: at 24 kHz a line renders in half the time,
  but the formants near Nyquist brighten the 2.8–5.6 kHz octave by 2–3 dB.

### Conversations and cries

The director decides who says what, and when: `director/talk.ts` voices conversations,
`director/people.ts` cries and calls, `director/animals.ts` the animals.

- **Conversations.** Two pedestrians in mood `chat`, each facing a point within 1.5 m of the other,
  talk: a greeting each, then turns of chat (60 %), a reply (25 %) or a laugh (15 %), a question
  always answered with a reply (TUNED). A turn starts `lineSeconds` after the last one and a pause
  of 0.2–0.9 s (TUNED: real turn-taking is 0–0.3 s, Stivers et al. 2009, but gibberish never
  overlaps). A chat that ends with both walking on ends with a goodbye each; one broken off by
  something else has none. People out together (a couple, a parent and child: each the other's
  `with`) talk as they walk, in bursts of 1–4 lines 6–20 s apart (TUNED). Only the 3 nearest
  conversations talking or due to talk are voiced (`VOICED`); the rest keep their turns silently,
  and a couple in a lull holds no voice. No conversation starts or moves on before the sound starts
  (`Frame.live`), so a chat under way behind the title card opens with both greetings.
- **Cries.** Every person's `Cry` is voiced in their own voice: a fright is a scream from every
  child and from 35 % of grown-ups (by id, `SCREAMERS`, TUNED), a yelled fright line from the rest;
  shock, anger and surprise yell a line for the feeling. Shock at a killed animal is `pity`, so
  nobody calls an ambulance for a cat; shock by one of their own is `grieve`. The dead cry no more,
  and one person cues at most once every 4 s (`CUE_GAP`).
- **By a victim.** A gatherer speaks about once every 7 s (`HELP_RATE`, TUNED), yelled when the
  line is a call or an exclamation: a stranger asks after a man, a woman or a child as they are; one
  of their own grieves; a child calls "Mamma!" or "Papà!", or "Nonna!" or "Nonno!" by a
  grandparent, by the victim's age and sex (the sim sends no child to a stranger). The victim is
  the body lying nearest the gatherer's point, within 4 m (`BODY_NEAR`), and their own are the
  people they were last heard walking with. By no body (the victim got up and left), or by an
  animal's, they say nothing.
- **A robbed driver.** A pedestrian first heard already running away within 15 m of the listener
  (`THIEF_NEAR`) yells after the thief.
- **A frame's budget.** Lines render on the main thread, so at most 3 start in a frame
  (`LINES_PER_FRAME`, TUNED), the nearest first; one waiting over 0.5 s, or whose speaker is dead or
  gone, is dropped. A death draws a cry from every witness in one step: of 12 shocked witnesses the
  3 nearest are heard in the first frame and the other 9 within 3 frames, and the worst frame, 3
  yells, takes about 7 ms on a desktop (15 at once took 51 ms). Conversations' lines are not
  counted in it.
- **Hits.** A person or an animal hit thuds; a person who lives groans 0.25 s later.
- **Animals.** Cows moo on their own about every 40 s, pigs grunt every 6 s and cats meow every
  60 s (TUNED), none while it runs; dogs call only when they cry out (and the farm dogs of the world
  part bark on their own). An animal's `Cry` is its species' voice: a dog barks in anger and yelps
  in fright, a cat hisses or meows (half each) in fright, a pig squeals in fright and grunts
  otherwise, a cow moos. Struck and alive, it cries in pain: a yelp, a cat's yowl, a squeal, a moo;
  killed, it is silent. An animal calls at most once every 1.5 s (`CALL_GAP`), and at most 2 calls
  start in a frame (`CALLS_PER_FRAME`), the nearest first, one waiting over 0.5 s dropped: 8 moos
  rendered at once take about 49 ms.

### Animal calls

`synth/animals.ts` renders each call in pure TypeScript at its first play, like the crash, and
keeps it per params object, so an echo replays it. Each voiced call is a source-filter voice: a
Rosenberg glottal pulse train on an F0 contour, with jitter, shimmer, period doubling and breath
noise, through four cascaded formant resonators (Klatt 1980) gliding between targets, and a
closed-mouth murmur low-passed at 450 Hz. A species' tract is a uniform tube closed at the larynx
(its formants at (2n − 1)·c / 4L), and the animal's `size` lowers F0 and the formants together.

| Call | What it is | F0 | Tract |
|---|---|---|---|
| `moo` | 1–2 s, a hum through the nose opening into an "ooo" and back | 125–150 Hz (cattle calls are mostly 80–200 Hz, Padilla de la Torre et al. 2015) | 0.42 m (estimate, a 600 kg cow) |
| `grunt` | 1–3 low, rough, nasal grunts of 0.15–0.3 s | 75–110 Hz | 0.25 m (estimate) |
| `squeal` | 1–1.5 s, harsh (period doubling, jitter, noise), the mouth open | 850–1100 Hz | |
| `yelp` | 2–4 cries of 0.12–0.22 s, each lower than the last | 900–1100 Hz | 0.15 m (dogs' are 10–24 cm, Riede and Fitch 1999) |
| `meow` | 0.5–1 s, "mi-a-ou" | 500–560 Hz, rising × 1.45 and falling back (meows are mostly 500–800 Hz, Schötz 2013) | half a man's: formants twice his vowels' |
| `meow`, `yowl` | 1.2–2 s, long, wavering and rough | 380–460 Hz, rising × 1.7 | half a man's |
| `hiss` | 0.5–1 s of breath noise at 2.8–7.5 kHz, spat out at its start | | |

Every call peaks at 0.5, a plain meow 12 dB under its yowl (`MEOW_QUIET`, which `animalQuiet`
tells the masking). In Node at 48 kHz a moo renders in 3.9 ms, a squeal 4.1, a hiss 2.7, a meow
1.9, a yelp 1.5 and a grunt 1.4.

## Calibration and mix

`src/audio/director/levels.ts` is the mix's one calibration table:

- `ENGINE`, `OWN_ENGINE_DB`, `LEVELS`, `ROLLING` and `OWL`: each kind's level at 1 m and size, as
  in the catalogue (`LEVELS.thunder` also stands `aloft`: 154 dB(A), `rMin` 300 m, no ground
  effect; `ROLLING` is a train's wheels per metre of train, at 130 km/h).
  Every synth peaks near 0.5 (−6 dBFS) at the loudest params it is meant for and scales itself
  with its physical params: an engine idles 17–26 dB (RMS) under full load at the redline, tyres
  follow the rolling law, a crash its speed. The level in the table is the one at that peak.
  `talk` and `yell` are a man's: `speechLevel` puts a woman's or a child's 3 dB under talking and
  7 dB under yelling (`SOFTER`; Pearsons, Bennett and Fidell 1977 measured women and children at
  55 and 82 dB(A) against men's 58 and 89).
- `BEDS`: the wind and cricket beds at the ears at full strength and density (60 and 42 dB(A)),
  and the rain's in a 60 mm/h downpour (64); `GALE_DB` (65), the loudest the wind bed plays;
  `ROOF_DB` (66, behind `roofDb`), the roof's drumming in a downpour. `windDb`, `rainDb` and
  `roofDb` (here), `cricketsQuiet` (`synth/nature.ts`), `rainQuiet` (`synth/rain.ts`, the drops'
  kinetic energy), `thunderQuiet` (`synth/thunder.ts`, the air on its way), `WALK_DB`
  (`synth/steps.ts`), `engineQuiet` (`synth/engine.ts`, the engine's gain law: 11 dB under at
  idle, none at the redline under full load, 2 dB more at full damage), `clunkQuiet`
  (`synth/impacts.ts`), `crashQuiet` (`synth/crash/index.ts`, the crash's level law: 18 dB under
  at a 2 m/s bump, none at the 15 m/s reference, 6 dB over from about 30 m/s, 2 dB more for a
  ringing guard rail or sheet wall), `animalQuiet` (`synth/animals.ts`: a plain meow 12 dB
  under a yowl), `railsQuiet` and `brakesQuiet` (`synth/rail.ts`: a train's wheels 30 dB under per
  decade of speed under 130 km/h, its brakes by their squeal): how far the wind, rain, crickets,
  thunder, walking-step, engine, clunk, crash, meow, wheel and brake synths play under (or over)
  that, so masking counts the sound actually played. All but
  `windDb`, `rainDb` and `roofDb` live beside the synths they describe, derived from the same
  numbers.
- `MOST_DB`: the most a one-shot's direct sound plays over gain 1, its echoes keeping the way's
  own level. A crash at 8 dB, where the limiter takes a few dB of a 15 m/s crash's peak (nearer, at
  about 25 dB over, it took 20 dB off the hit and gave the sub-hits back as loud as the hit: an
  echo); an explosion at 10 dB, 2 dB over a crash, as its crest is 6–7 dB where a crash's is 13
  (below); thunder at 2 dB, because its loud part lasts seconds, so its crack stays under the
  limiter's −6 dBFS going in; a train's honk at 2 dB, as thunder: at 130 dB it would come 14.7 dB
  over gain 1 from 20 m in the open, and its loud part lasts 1.2–2 s, the alarm again every 2 s
  while a train is held. Rendered through the mixer with a 40 Hz pilot to read the limiter's gain:
  at 8 dB a long blast was ducked 2.1 dB centred and 3.1 dB at the widest pan, the alarm 3.3 and
  4.4 dB, for 1.3–1.6 s; at 2 dB, 0.6 and 0.1 dB, the alarm 0.8 and 0.3 dB, the output peaking at
  −8.8 to −4.7 dBFS.

**Engine trims.** Each model's `TRIM` (`synth/engine.ts`) is 1 / its own peak at the redline under
full load, measured on the audition page: "Render all" plays every model at {rpm: redline, load: 1}
and at idle, and flags a redline row whose peak falls outside 0.42–0.6 as "off nominal". With the
derived timbres and the old hand-set trims (0.538, 0.336, 0.435, 0.48) the redline rows peaked at
0.551, 0.531, 0.587 and 0.512 (three runs in headless Chrome within 0.001 of each other), so the
trims are 0.488 (Panda), 0.316 (Ape), 0.371 (truck) and 0.469 (Giulia), which peak at 0.499–0.501.
The ATR 220's power pack peaked at 0.485 on the truck's trim, so its trim is 0.382, which peaks at
0.499–0.500 (seven runs).
Idle plays under the redline by (RMS) 20.4 dB on the Panda, 25.8 on the Ape (its 250 Hz highpass
and its lowpass closing to 2.5 kHz), 17.0 on the truck (its clatter) and 22.1 on the Giulia.
Worn to damage 0.9 at the redline under full load they peak at 0.406–0.419 (Panda), 0.385 (Ape),
0.403 (truck) and 0.433–0.436 (Giulia) over two runs (the wobble is random), under the nominal; the
truck's loudest knock (at the redline off the throttle, damage 0.99) at 0.139. "Render all" flags
any engine row over 0.6 as "over nominal". The fire peaks at 0.33–0.38 (−22.5 to −22.9 dBFS RMS)
over two runs; every explosion at 0.5, scaled there by the renderer (−20.5 to −22 dBFS RMS over
its 2.9–3.6 s). The train's and the crossing's synths were fitted the same way, so their loudest
rows peak near 0.5: a train rolling on at 130 km/h at 0.49–0.69 over fifteen runs (RMS −19.5 to
−19.9 dBFS; the clacks' bursts are drawn at random, and "Render all" flagged none of its rows),
over six runs at 80 km/h 0.30–0.33 (−25.5 to −25.9) and crawling at 20 km/h 0.043–0.058 (−44.2 to
−44.5); over four runs the brakes braking hard at 2 m/s 0.46–0.57 (−19.2
to −19.9; the judder is random); the bell 0.50 (−28.8, its centroid 4.5 kHz); the player's horn
0.466 (−13.8) and an AI train's long blast 0.466, its alarm 0.569 (the low blast's attack over the
high one's release).
- `HEIGHT`, `MOUTH`, `WATER_R_MIN`: source heights (each species' mouth) and the water's 1 m
  clamp.
- `CAPS`, `KEEP_DB`, `TOWERS`: the voice caps and their hysteresis.
- `DELAY_FROM` (40 m), `REVERB` (with `snow`, the share of the send a full snow cover takes),
  `ECHO_MIN_DB` and `echoes(sound)`: delay, the reverb send and echoes.

`mixGain` (`acoustics.ts`) turns a level into a gain. Real levels span 54 dB from a running step
to a horn, too much for a game mix, so only the source levels are compressed, around 120 dB(A) by 0.6;
the losses on the way stay physical, so distance and occlusion cues keep their size:

gain = 10^((120 + 0.6·(L1m − 120) − losses − 85.2) / 20)

The 85.2 (`FULL_SCALE`) puts a running step on stone heard from 1 m (62 dB(A)) at gain 1: its
synth's nominal peak. After compression a horn is 32 dB above a running step at 1 m instead of 54.
A number in the table moves one kind against the others and nothing else.

The beds and water are known by their level at the ears, so that level is what is compressed:

- the wind at its strength, 60 + 40·log10(strength) dB(A). Its voice (body and leaves alike follow
  strength²) already plays that far under its nominal by itself, so the bed's gain gives back what
  the compression leaves of it; past strength 1 the voice stays at full and the bed's gain carries
  a gale up to `GALE_DB`;
- the rain at `rainDb`, its voice already `rainQuiet` under its nominal, likewise; the roof at
  `roofDb`, at the seat through no cabin;
- water at the line-source level `places` finds at the ears, with only the obstacles and the cabin
  as losses, so a river 200 m away is not compressed as if it were a louder source 1 m away.

The crickets' density moves their level by up to about 12 dB (fewer singers in a quieter chorus)
and is played as is.

What comes out, on the game's meter (`gta.audio.level()`, the master's RMS over 43 ms of the mono
downmix (L + R) / 2, which reads a centred voice at its per-channel level, 3 dB under the voice
before the pan, and a panned one lower):

- on foot in Monzone's street the valley sits near −40 dBFS (the wind bed at the 35 dB(A)
  background, the Lucido behind the houses), a meadow near −36, a windy ridge near −31;
- the player's own walking steps peak near −22 dBFS (−20 at the loudest);
- the Lucido 15 m away in the clear reads −25; behind the houses it plays 15 dB lower through a
  2.8 kHz lowpass;
- a car cruising past 10 m away at 14 m/s peaks near −20 dBFS, 71 cents sharp coming and 69 flat
  going;
- the player's cabin idles near −30.5 (Panda) and −28.7 (Giulia), and pulling away from a
  standstill at full throttle for 4 s (the revs the sim's drivetrain reports climbing from the
  clutch's launch through the gears, load 1) reads a median of −14.4 (Panda, peaks −13.2) and
  −13.4 to −13.7 (Giulia, peaks −10.2 to −10.6);
- the loudest near sounds go past gain 1 and the master limiter holds them near −2 dBFS: the
  player's own horn and siren (about 19 and 17.5 dB over, so the limiter takes up to 11 dB and the
  rest of the mix dips while they sound), a honk 10 m away, and the door slam and starter heard
  from the seat;
- crashes, as the sample peak of either channel. Within about 15 m in the open a crash's way
  would play it more than 8 dB over gain 1 (the player's own comes 21–26 dB over, no cabin, 2–3 m
  from the contact point), so its direct sound plays at that cap: in Chrome (single renders, the
  output captured) a Panda at 12 m/s into a house peaks −6.4 dBFS and into another Panda −7.2, an
  8 m/s roll onto the road −5.4 and a 7 m/s landing on it −3.6, each 11–21 dB under its peak
  300 ms later. Played at 25 dB over, the limiter took up to 20 dB off the same hits and, released,
  held the output within 1–3 dB of the peak 300 ms on, the crunch's sub-hits as loud as the hit.
  Further away (the game's own chain rendered offline, the median of six renders, before the cap,
  which does not reach them): a Panda into a house at 10 m/s peaks −15.5 dBFS 30 m away (−27 on
  the meter), at 5 m/s −23.5, at 15 and 20 m/s −12.6 and −9.7; a Panda–Panda, a tree, a bank, the
  guard rail and a stone wall at 10 m/s −12 to −20 at 30 m.
- the player's own clunk plays 10.3 dB over gain 1 (no cabin, from the seat) and peaks, into the
  limiter, at −8.1 dBFS bottoming out at 1.5 m/s, −5.6 at 2 m/s, −2.1 at 3 m/s and +2.1 just under
  a crash's 5 m/s (its buffer's 0.5 peak × the speed's gain × the director's × the master's 0.8),
  so from about 2 m/s the limiter takes it, and the rest of the mix dips for its 0.25 s release.
- explosions. Within about 20 m in the open a blast's way would play it more than 10 dB over gain
  1, so its direct sound plays at that cap, 2 dB over a crash's: the blast's crest is 6–7 dB where
  a crash's is 13, so it is louder at the same peak. Through the game's mixer offline in Chrome
  (four renders each, the output's sample peak of either channel): centred, a blast at its cap
  meters −7.3 to −8.6 dBFS and peaks −3.3 to −3.4, the limiter taking 2.3–2.5 dB; a 40 m/s Giulia
  wreck at the crash's cap −12.8 (peak −2.7, the limiter taking 5.3) and the reference crash −14.2.
  At 12 dB the limiter took 4.1–4.3 dB off the blast, at least 1 dB held into the roar for up to
  0.8 s. Panned 0.43 in a street (a reverb send of 0.8, as at `?seed=7`'s spawn), the blast meters
  −9.8 to −11.1 and peaks −2.9 to −3.0, the limiter taking 4.2–4.4 dB (at least 1 dB for
  0.5–0.8 s), against the wreck's −14.2 to −14.6 (7.1–7.3 dB) and a 12 m/s Panda's −15.5 to −17.3.
- a settled storm at the spawn (5 mm/h) reads a median of −29.5 dBFS (loudest −23.9), about
  10 dB over a dry day, as `rainDb` says it should.
- a train, from the spawn in Monzone (`?seed=1`, the director's gains recorded in the game): the
  ATR 220 idling at the station, its near power pack at −39 dB and the far one at −50.6; Via
  Riolo's bell, 81 m off, at −38.9 dB for the 19 s it rang (the warning and the arms coming down);
  then the train pulling away, its power packs rising to −26.5 dB and its wheels to −22.9 as it
  passed, under −60 dB 20 s later. The meter read −35 to −41 dBFS meanwhile, the street's traffic
  and the Lucido as loud.

The weather's sounds stay under the limiter. Below, the peaks per channel going into it (after the
0.8 master) and the most it took (`DynamicsCompressorNode.reduction`, sampled every 1,024 samples).
"Replayed" means the real director's plays and holds, recorded in the game, rendered offline
through the real voices, emitters, mixer and limiter:

| Scene | How | Peaks in, L / R | Limiter took at most |
|---|---|---|---|
| the spawn in a settled storm (5 mm/h), 60 s: 9 thunders, 9 echoes, 1 cut short (seed 1) | live | −8.0 / −7.9 dBFS | 0.00 dB |
| under the west flank's rock (782 m): 40 mm/h, a 12 m/s gale with gusts of 2.3, a bolt 150–390 m off every 5 s and in-cloud flashes | replayed | −3.5 / −5.4 dBFS | 0.67 dB (0.33 % of blocks over 0.5 dB, none over 1) |
| the same without thunder echoes | replayed | −5.3 / −6.2 dBFS | 0.06 dB |
| the same with a bolt every 2 s | replayed | | 0.54 dB |
| inside the Panda, 60 mm/h | replayed | | 0.35 dB |
| the weather and the valley alone (rain, roof, wind, thunder, crickets, water, birds, bells), 60 s of storm, seeds 2 and 3 | replayed | −7.0 and −8.7 dBFS | 0.00 dB |

The knee starts at −9 dBFS and the threshold is −6, so the rain's loudest ticks reach the knee and
are never limited. The larger takes in a storm come from traffic, as before the weather (see
[Known limits and tuning](#known-limits-and-tuning)).

## Controls

| Key | Where | Does |
|---|---|---|
| H | at the wheel | sounds the horn while held |
| H | at the wheel of the Carabinieri Giulia | each press turns the two-tone siren on or off |
| H | in a train's cab | sounds its horn's high tone (660 Hz) while held |

On foot H does nothing. The keyboard's title card lists it; in mobile mode the Horn button shows while
driving, a train too.

## Start, pause and hidden tabs

- **Autoplay.** Browsers allow audio only after a user gesture, so the AudioContext is made on the
  first trusted `keydown`, `pointerdown` or `touchend` with user activation once the speaker exists
  (made during the last loading steps): normally the key or tap that dismisses the title card (Esc
  does not count). Until then nothing plays and no sound time passes. The gesture's own task builds
  only the context, the noise kit and the mixer. The kit's samples take ≈ 17 ms in Node; ≈ 7 of
  them are the gust signal, which turns each sine by a rotation per sample instead of calling
  `Math.sin` (three times slower). Each one-shot then pre-renders its buffers in tasks of its own:
  the crash its noise loops, the footsteps their 56 variants one bake at a time (a bake builds its
  whole graph before it renders, so baking all at once built some 1,200 noise bursts in one task).
  A later gesture resumes a context the browser has left suspended or interrupted (Safari,
  Firefox).
- **Pause.** While the full map (M) or the settings (Esc) are open, `main.ts` calls
  `speaker.pause(true)` every frame, which suspends the context, and skips the frame, so the audio
  schedule does not run either. Closing them resumes both.
- **Hidden tab.** The context is suspended while the page is hidden and resumed when it shows
  again (unless the map or the settings are open).
- **Failures.** A non-finite placement or delay is never sent (it would mute its kind for the
  session); a synth that throws mutes only its own kind.

## The audition page

`pnpm dev` also serves the audition page at http://localhost:5173/lab.html (`lab.html`,
`src/audio/lab.ts`; the "Render all" rows in `lab-rows.ts`, rendered offline and measured by
`lab-render.ts`); the production build leaves it out. It plays every synth through the game's own
emitter and mixer:

- **Listener:** the distance (a logarithmic slider, 0.5 m to 2 km), the side of the screen, a cabin
  (none or a model, the ATR 220's cab too), how enclosed the street is (it sets the reverb send),
  and the master level meter.
- **One panel per kind:** each continuous kind has Hold / Release and each one-shot Play, with a
  control for every param (sliders, menus, checkboxes): the engine's `model` (the vehicles' and
  the ATR 220's), `rpm` (0–7000), `load`, `variant`, `damage` and `misfire`, the tyres' `speed`,
  `skid` and `slip`. The rolling voice's only control is its speed `v` (−40 to 40 m/s): an ATR 220
  rolls on along joints 36 m apart as the page plays it (`railsAt`), so its axles clack; the
  brakes' `speed` (0–8 m/s) and `brake`, a train's honk's `urgent`. The crash's are flat:
  speed and mass (0.1–30 t) sliders, the `model` and `zone` of the body that hits, `against` (a
  material for a wall or the ground, or a model for a car, struck on its `struck` zone) and the
  `surface`. Speech's are flat too: a `situation` and the speaker's `voice`, `age` and sex, each
  Play drawing a fresh line; an animal call's are its `size` (0.85–1.15) and a meow's `yowl`. Each
  panel shows how its sound is heard at that spot: the level at 1 m (at the ears for the beds) and
  at the listener (an engine `engineQuiet`, a clunk `clunkQuiet`, a crash `crashQuiet`, a meow
  `animalQuiet` under it; a woman's or a child's speech at its `speechLevel`), the gain, pan,
  lowpass, reverb send and delay. The weather's controls: the rain's and the roof's `rate`
  (0–60 mm/h) and the rain's ground shares, the wind's `gusts`, the crickets' `celsius` (−5 to
  30 °C), the owl among the birds, the step's `snow`, and the thunder's `distance` (30 m to 15 km),
  `ears` (−400 to 1,000 m), `bolt` and `seed` (1–1,000). Thunder is heard from its own distance
  (the slant range to its channel for an in-cloud flash), at once, aloft, with only the cabin's
  lowpass (its air is in its render). Every one-shot's direct gain is shown and played under its
  `MOST_DB` cap, as the game plays it. The first press starts the audio.
- **Render all** (also `window.lab.renderAll()`, which returns the rows) renders every voice and
  shot offline at 48 kHz at a few representative params (141 renders: 69 voices and 72 shots, each
  shot given 22 s, room for a 20 s thunder) and tabulates peak, RMS (dBFS), spectral centroid
  (`measure.ts`), NaNs and length. It flags silence (peak under 1e-4), clipping (over 0.95), an
  engine as new at the redline under full load peaking outside 0.42–0.6 ("off nominal": its trim
  needs measuring again), any engine peaking over 0.6 ("over nominal": damage must never lift it),
  NaNs, and any sound left after a voice's stop or a shot's end. Each engine plays at
  {rpm: redline, load: 1} as new and worn to damage 0.9, and idling, the Giulia's from its seat at
  3500 rpm and half load, a Panda idling at damage 0.5 and the truck at 0.8, the truck at the
  redline off the throttle at 0.99 (its loudest knock), a Panda at 3000 rpm and half load at damage
  0.9 misfiring in every other 0.25 s window (its params changed frame by frame, as the director
  holds them), and the fire; the tyres a full slide at the Giulia's top speed, rolling, a standing
  burnout, a locked wheel and an ABS stop at the limit. The crashes cover a matrix, each at the
  sim's mass (the car's, the reduced mass of two): a Panda into a house wall at 2 (a bump), 5, 14
  and 20 m/s, a Panda–Panda at 10, a Panda–truck at 12, an Ape into stone at 8, the Giulia into the
  guard rail at 12, a Panda into a tree at 10 and into earth at 8, a side hit at 12, the Giulia
  wrecked at 40, the laden truck into a house at 2 and 12 and a Panda landing hard on the road and
  rolling onto it at 8, each drawn anew on every run (a fresh params object, so the crash's
  per-object memo never replays an earlier run); the explosion with its debris on asphalt, setts
  and grass, drawn anew the same way; the scrape plays along every material at 12 m/s, along
  masonry at 4 and along the guard rail at 2.5, where it squeals. Speech is said by a man chatting,
  a woman replying, an elder greeting and a girl laughing, and yelled in fright, anger, shock and
  surprise by a man, a woman, an elder woman and a boy, a fresh line each run; the animals give a
  moo at 0.85 and at 1.15 of a cow's size, a grunt, a squeal, a yelp, a meow and a yowl, and a
  hiss. The weather's rows: the wind's squalls (strength 1, gusts 1); the crickets at 5 °C, their
  slowest chirp; the rain at 1 mm/h on open ground, 10 in the woods, 6 on a river (its plinks at
  their loudest), 60 on a village by the river and 60 on open ground; the roof at 1, 10 and
  60 mm/h; the owl; a step in snow; and thunder from bolts 300 m, 2 km and 8 km away and an
  in-cloud flash overhead. The trains' rows: the ATR 220's power pack at its rated 1800 rpm under
  full power and idling; an ATR 220 rolling on over the joints at 130, 80 and 20 km/h (its params
  changed frame by frame, `railsAt`); its brakes at 2 m/s braking at 0.6 and at 4 m/s at 0.3; the
  crossing's bell; the player's horn; an AI train's long blast and its alarm. An engine with
  `inside` ticked plays through no cabin, as the game plays the listener's own car's (the synth
  makes its cabin).
  Adding a kind fails to compile until the page has a panel and render rows for it. Three low
  peaks are by design: the wind swells with gusts over seconds, so at strength 1 a 2 s render peaks
  near 0.2–0.3 while its 64 s gust loop reaches 0.45–0.65; the blackbird's thin "seee" (30 % of its
  calls) peaks at 0.25 yet is 6 dB louder over 125 ms than its "chink" series at 0.5; and a plain
  meow peaks at 0.126, `MEOW_QUIET` (12 dB) under its yowl.

The page places every sound with the director's own facts: the levels from `levels.ts` through
`hear` in `hearing.ts`, the source at ear height over open, flat ground with nothing in the way, no
Doppler, masked against the day's 35 dB(A), and the wind and rain beds and the roof compressed at
their levels at the ears as `world.ts` does. A train's wheels are heard as its whole 55.6 m length
broadside at that distance, the line source's level there. Its controls' tables (the menus, the
sliders' ranges, each panel's first params) are in `lab-forms.ts`; the page loads no map.
Only water is a stand-in: a point source, the river (the Lucido) and the stream (a 4 m one) at their
2 m bank level + 6 dB and the fountain at its 1 m level, where the game takes each body's
line-source level at the listener.

## Tests

`pnpm test` runs them all in Node, which has no Web Audio: the synth modules make nodes only inside
functions (`synth/__tests__/world.test.ts` imports them to check).

| File | Checks |
|---|---|
| `src/sim/__tests__/index.test.ts`, `src/sim/__tests__/walls.test.ts`, `src/sim/__tests__/sky.test.ts`, `src/sim/__tests__/people.test.ts`, `src/sim/__tests__/reactions.test.ts`, `src/sim/__tests__/animals.test.ts` | the events: a car driven into a building is a `wall` Impact as fast as the car was, where its nose meets the wall; rolled into it 45° and 60° off square, on the wall itself (within 5 cm) at its front end; a car rolling into a parked one a `car` Impact at the closing speed, the reduced mass and where the bumpers meet; a knockdown or a killing one `person` Impact faster than `KNOCK_SPEED`, `fatal` when it killed; a car pinning the player a `person` Impact as fast as the car was; a car blocked by a parked one honks once per stuck episode, `HONK_STEPS` before each time it backs up; the cries: a car speeding past walkers draws angry ones from about half of them, a car aimed fast at a walker a fright, a death 12–25 m away a shock from each witness, a quiet Gragnola under 1 fright and 2 anger a minute; a free dog barks at the player at most every few seconds, and a cat by a dog a car strikes is scared in that step; a forced thunderstorm throws `Lightning`, its bolts on the map, even with the clock stopped, the same in the same game |
| `src/audio/__tests__/index.test.ts` | `Hear`: the listener on foot and at the wheel with the horn held, AI traffic running while standing, an untouched car heard only while it moves, rolls, pitches or bounces, a destroyed car dead (not running, no revs) with the player at its wheel and burning, heard however still it lies, a wreck burning until it blows up and its `Explosion` passed on once (its wreck, at its centre of mass), the charred shell heard only while it leaps and a still one not at all, a worn engine's misfires in the sim's windows for its seed with its load still the pedal's, impacts (with the struck vehicle's model and zone, the mass in tonnes as the sim gave it; none for a vehicle gone since) then honks each heard once, who each person is and what they do (age, sex, mood and its point, down, dead), who walks with whom (`with` both ways for a mother and child, not the dog on a lead), the animals, and the cries since the last frame, each heard once, a ground hit's zone from its face, the revs and load `engineRevs` gives for the vehicle's chassis, speed and pedal, each vehicle's skids since the last frame (the most past grip, the fastest, the surface of the wheel furthest past), wheels down on the springs and not in the air, on a side or on the roof, the body down on the ground sliding on its roof or side and not on its wheels or in the air, an Ape rolling into a parked Panda front on rear, an Ape T-boning a parked Panda's front door on its side, a Panda rolling 50° off square into a house wall on its front; the game clock's day, time and sun, a copy of the weather, and each `Lightning` since the last frame, once |
| `src/render/__tests__/index.test.ts` | every system of the render and audio schedules declares no writes |
| `src/audio/__tests__/acoustics.test.ts` | the laws: the line source against the exact table, the air cutoffs, Doppler, the pan, diffraction, ground, foliage, masking, the mix calibration |
| `src/audio/__tests__/occlusion.test.ts` | path differences on real map spots: a flat meadow, Monzone Alto's 30 m tower, a bell over its own walls, Monte San Giorgio between its flanks |
| `src/sim/map/__tests__/surface.test.ts` | the surfaces the tyres and the sounds share: carriageways by their OSM surface, the forest floor, a meadow; by level, the hillside over a tunnel and the deck only on the deck |
| `src/audio/__tests__/places.test.ts`, `src/audio/places/__tests__/water.test.ts` | wall materials (a trunk, buildings by kind and style, the guard rail, the stone wall, a cliff, bare ground, a quarry's bank; the nearer of a trunk and a house wall 1.2–2.5 m apart wins; a bank with trees 1.5–3 m off it is earth), ambience shares, streets, echoes off the rock at Equi Terme, none on an open meadow nor at any Monzone street with no slope as steep as bare rock (50°) in sight, bells, dogs and birds, the Torrente Lucido from Monzone station, the Fontana di Aiola |
| `src/audio/director/__tests__/index.test.ts` (its kit, the map spots, `rig` and `world`, in `director/testing.ts`) | the director on a recording speaker at real map spots: proximity (in the open and behind a ridge), a building's muffling, Doppler, step cadence, travel delay, crash merging and scrapes, a house wall's material and cobbles in the crash and scrape params, a car crash's bodies the same from either car, a zone's wear carried to the next crash, a wall crash's debris surface read under the car, a scrape's material held through a brief other contact, a wall crash on foot muffled by the house in the way, a bump culled nearer than a crash, the engine's revs, load, variant, damage and misfires passed on, engines ranked by their load, the tyres on the sim's skids (a standing burnout, the skid held over a frame with no step, silent in the air), a vehicle heard where its body is, a hard landing against the ground's material and not the nearest wall's and a body down on it grinding it (no hit needed), under a bridge the tyres and a landing on the riverbed's own surface and not the deck's, the own siren as loud in the air as on the ground (the ears ride in the car), cresting a hump as one clunk and a hard landing as a crash, echoes off a rock face and hidden in a street, the reverb dry in the open and wet in a walled street, nothing before the context, the cabin (the own crash open and at its cap, its tail and echoes through it, against a like crash outside: the same wall and ground), getting in and out, horn and siren, the bells on the game clock's hours (once a game day, not on the half hour, nor 22:00–06:00), water and its masking, the valley's never-silent bed and the river 15 m away against behind the houses, voice caps and their hysteresis |
| `src/audio/director/__tests__/wrecks.test.ts` | fires and blasts on the director's rig (`director/testing.ts`): a burning car's fire held with its engine, horn and siren dead (an intact one never burning, the own one through its cabin), at most two fires, the nearest; a wreck's blast played once at once from its centre of mass, 5.4 dB over a crash from the same point, its debris on the ground under it, and its fire out; the listener thrown out by their own car's blast hearing it and no door; a blast 300 m away after its travel time, one under a rock face echoing later and fainter, one 5 m away at its cap |
| `src/audio/director/__tests__/voices.test.ts` (on the shared rig of `director/testing.ts`) | conversations: a greeting each, alternating lines 0.2–0.9 s apart and a goodbye each as the pair walks on; a chat under way before the sound starts opening with both greetings once it does; none when something breaks it off; couples in a lull taking no voice from a chat nearby, and talking now and then as they walk; cries: a child screams in fright, a grown-up screams or yells, in their own voice, one cue every few seconds; shock, anger and surprise yell a line, the dead are silent; the thief line within 15 m, not at 40; gatherers' lines, fitting a man, a woman or a child, and grief, "Mamma!" or "Nonna!" by one of their own, nothing by an empty spot; pity, not an ambulance, for an animal; a crowd's cries a few a frame, the nearest first, every one said; a fatal hit with no groan; animals calling on their own (none while fleeing), each species' cry, at most two calls a frame, a struck animal's pain and a killed one's silence |
| `src/audio/synth/__tests__/animals.test.ts` | every call at its nominal 0.5 (a plain meow `MEOW_QUIET` under its yowl), finite, starting and ending silent; a moo 1–2 s at 100–160 Hz and lower for a bigger cow; a meow at 500–800 Hz, a grunt low and short, a squeal high and long; a hiss between 2 and 8 kHz, a dog's two to four high yelps; each call the same per seed, and an echo replaying its render |
| `src/audio/speech/__tests__/*.test.ts` | the lexicon spelt in known phonemes; every situation's lines valid and the same per seed; the cries real Italian in their tune; help fitting the victim, grief the bereaved, no ambulance for an animal; chat 1–3 s with ≈ 15 % fillers, replies shorter; gibberish following the phonotactics, spelt the Italian way, and never a profanity or a slur in 200,000 words; a laugh's 3–6 calls; the plan contiguous, padded with silence and as long as `lineSeconds`; geminates, stress and phrase-final lengthening; chat near 7 syllables a second; children, elders and yells slower; each tune's melody and each speaker's pitch; every line rendered at a 0.5 peak, finite, silent at both ends and ringing out with no step where the speech ends; the same seed the same samples; men lower than women, women lower than children; a question ending higher and a statement lower; a yell higher and brighter; /s/ brighter than /a/ and under it, /ʃ/ darker than /s/; a release burst in its own band |
| `src/audio/director/__tests__/hearing.test.ts`, `occluder.test.ts` | the reverb send: none in the open, in a street by distance (capped), gaps and the cabin, even for a sound of the own car that skips it; a source aloft (thunder's channel) takes no ground effect, and snow on the ground up to 12 dB more and half the street's reverb; the obstacle cache's refresh and forgetting |
| `src/audio/__tests__/speaker.test.ts`, `mixer.test.ts`, `buffers.test.ts`, `measure.test.ts` | the one-shot cap, the speaker inert until a trusted gesture, the level meter, seamless noise loops, the gust signal against its closed-form sine sum, the render measurements |
| `src/audio/director/__tests__/weather.test.ts` | the weather and the hour at the director: the rain bed at the rate falling at the ears (none dry or in snow), a downpour masking a far car, the roof's drumming in the Panda with the bed through the cabin; thunder waiting its travel time (a bolt 3.4 km away about 10 s after the flash), rendered on a frame after its flash's, timed from the ears' height on a ridge, at once and capped within 40 m, narrower than a point, placed on arrival (through the cabin if the listener got in meanwhile, sooner when driving toward it), echoing off rock and cut short with them, never before the context runs, at most two at once in an approaching storm, quieter for a weaker flash and masked by a downpour; the wind (the tuned voice in the usual wind, stiller, gustier and a gale as the weather blows, masking through the cabin in a car, rising with the ears' height over the map's floor so an Alpine floor stills a ridge, the usual wind a cloudy day's and over the weather's own October mean); the night floor; the dawn chorus, dusk and rain silencing birds; the owl at night, once in 30 s; the 08:00 ring waiting for the context; crickets in warm, dry air only (silent on the ridge in the meadow's 11 °C air, in still air); snow's hush and crunch |
| `src/audio/synth/__tests__/thunder.test.ts` | the thunder renderer, bounds checked on seeds 1–96: finite, held to 0.5, at most 20 s, faded, the same for the same flash; a near bolt's crack and boom against a far one's rumble (centroid, onset, crack energy above 2 kHz, low share, length); an in-cloud flash with no crack; a third or more of the energy at 100–400 Hz within 2 km (phone speakers); `thunderQuiet` within 2 dB of A-weighted renders past 2 km; `lead`; the trunk first from a ridge over a valley bolt; one render per params object at 16 kHz for a bolt within 1 km and 8 kHz past it or in the cloud; a flash at no finite distance thundering as one overhead |
| `src/audio/synth/__tests__/*.test.ts` | the vehicle, train and world synths' tables loading in Node; each engine's timbre from how it is built (pulses from cylinders and cycle, formants falling with displacement and the sub rising with each cylinder's size, a two-stroke brighter and rattling, a diesel's clatter, a turbo's whine only with a turbo, the Giulia's exhaust voiced darker than its size), the engine law (idle 11 dB under the redline, the cabin tone, every model at its trimmed peak, a variant's pitch and formants); an engine as new playing the law it played before damage, damage dulling, softening, roughening (from 0.2) and knocking (from the medium stage) it, a misfire closing its gate and nothing else, no damage lifting its output gain over its nominal and `engineQuiet` counting what it plays; the tyre law (a standing burnout and a locked wheel squeal, a creep barely past grip does not, the full slide at the Giulia's top speed); the scrape's surface loops (seamless, at their RMS, a stone every 0.3 m and a rail post every 2 m) and its speed law; step and cricket rates (a cricket voice held in the cold still chirps at the 10 °C rate, never an Infinity-long wait); the rain law (the drops' kinetic energy, 12 dB a decade, a downpour at the nominal) and its layers (a shower's drops fusing into the hiss and the roar, surfaces adding in power, plinks on water never louder than a downpour's), the roof's drumming (countable drops in a shower, a roar in a downpour, low and tonal under 1 kHz); bubbles at their Minnaert frequency; synth params clamped, NaN to silence |
| `src/audio/synth/__tests__/explosion.test.ts` | the blast renderer over twenty seeds (the bounds checked on seeds 1–80, twenty at a time): finite (from an 8 kHz device rate too), peaking at the nominal 0.5, at most 4 s, faded; deterministic per seed; against the reference crash at the same peak, 4 dB and more louder over its first 300 ms (median 7.1), a crest of at most 9 dB (6.6), at least 0.1 more of its energy under 200 Hz (0.54 against 0.35), its centroid over 30–600 ms at least 500 Hz lower (1.5 against 2.4 kHz); its loudest 50 ms starting within 0.2 s, 0.3–1 s within 10 dB of the first 0.15 s and 1.2–1.6 s 11 dB and more under it; over 2 kHz its debris 10 dB and more over the roar's tail on asphalt (17.4) and 6 dB and more louder than on grass (18.4) |
| `src/audio/synth/crash/__tests__/crash.test.ts` | the crash renderer over the design's matrix, each at the sim's mass (a Panda into a house at 2, 5, 12, 14 and 20 m/s, Panda–Panda 10, Panda–truck 12, an Ape into stone 8, the Giulia into the guard rail 12, a sheet wall 12, a tree 10, earth 8, a side hit 12, a 40 m/s wreck, the laden truck into a house at 2 and 12, a hard landing on the road at 6 and a roll onto it at 8, against a house wall at 6 and 10 and a side into it at 8), twenty seeds each (the bounds checked on seeds 1–80, twenty at a time), measured by `testing.ts` (the research's analysis tools, ported): finite, ≤ 1, ≤ 4 s, faded, finite from an 8 kHz device rate; noise that never repeats inside a render; deterministic per seed; the level law, its cap and the peaks following it within 2 dB (a bump, the rail, a sheet wall, Panda–Panda, the truck's nudge); the laden truck 7 dB over a Panda, its nudge like a Panda's 4 m/s bump, capped by 14 m/s, the barrier speeds of a Panda against it and of it; a landing breaking nothing; growth past the cap (tail, block, at most 3 sub-hits, 42 m/s against 60 audibly different); the critique's targets on the exterior crashes (medians: −10 dB at 150–450 ms, rise 8–25 ms, crest 9–15 dB, band flatness 0.35–0.6, 1–8 kHz kurtosis 2.8–4.5, 8 kHz −12…−25 dB, 16 kHz −22…−36, centroid 1.5–3.5 kHz through 600 ms; 97 % of renders with 63 Hz ≤ −5 dB and the loudest octave in 125 Hz–2 kHz); the tail's −20 dB at 0.25–2.5 s, later the harder the hit; a flat median spectrum (the truck within 8 dB); the long partials layer (each model's count at 0.6–4.3 kHz, η 0.001–0.01) and 1–3 of them clear in the render; the bump's 40–100 ms; the rail's tonal ring; the sheet wall's ring against masonry; the truck's bumper clang; the tree's faint rustle past 2 s and its tail under 3.5 kHz; earth the slowest, dullest; a car–car hit's clank against a house wall's dead mass; the road's thump on a landing and slap on a roll; sub-hits 13 dB and more under the hit; a greenhouse nudge's dull crack; a worn side breaking nothing again; the glass shower's 6–10 kHz centroid and grass swallowing it |
| `src/audio/__tests__/rail.test.ts` | the railway as `Hear` projects it: a train's power packs idling with the power off and at their rated revs at full power, either way; its cars from the active cab back, each on the track with its s and whether it is in a tunnel; a road crossing ringing in the warning and while its arms come down, not open, closed or rising, and a foot crossing never; a car meeting a train as its own hit on a steel wall, the train its `other`, two trains crashing both as steel bodies, a buffer stop by the train's front, a person struck with no vehicle body, a vanished car's hit dropped; on a real runtime, a staged ATR 220 car by car as `carsOf` places it, Via Riolo ringing once its cycle is set to the warning, a whistle at its cab car's rail head, a train–train hit as steel, and the player aboard as the listener in the cab |
| `src/audio/director/__tests__/rail.test.ts` (trains from `train` and `beside` in `director/testing.ts`) | the train part on the director's rig: two power packs heard from the end cars, the near one louder; the wheels a line source (abreast the rear car as loud as the middle, under a rail bridge 22 m up as far off as its height) given every axle and the joints; the brakes squealing to a stand, not at speed; in the cab the ears over the rails on a rail bridge, its own engines from under the end cars through the cab's 1.2 kHz, the cab idling within 3 dB of a car's seat and over the wind, louder under power, H holding its horn there (none on foot); an AI whistle 20 m away at its 2 dB cap, echoing; a crossing's bell while it rings, one per box, two at most, at the box's centre no louder than at its posts; riding through the long tunnel no wind, rain, roof or crickets and the own wheels as loud as in the open; the wheels' summed level stepping under 1 dB a frame as a train passes each portal of the short tunnels, 20–60 m off; a train deep in the long tunnel silent under 440 m of hill, one wholly in a short tunnel heard from its portals, its power pack quieter than through the rock; a crash into a train's steel, a car the player's own train strikes crashing open at the cap and grinding along it open, a person struck by one thudding and groaning |
| `src/audio/synth/__tests__/rail.test.ts`, `crossing.test.ts` | the wheels' law (30 dB per decade, the band at v / 2.5 cm), each axle clacking once over each joint at the time it gets there at any frame length, backing up and after a stall; the brakes squealing on every stop below 6 m/s, braking harder than a tenth of the emergency rate (the AI stops at about half of it), not coasting; the horn's tones within EN 15153-2's bands, a long blast 1–2 s, the alarm's more than three short ones in turn and over within 2 s; the bell's period 1.287 s with its stroke at the start, −20 dB a second on, and its loop sample for sample the steady ring of 40 strokes, wrapping with no seam |
| `src/audio/places/__tests__/track.test.ts` | a joint every 36 m along each line and a switch only where a piece of track off the line ends on it (the Gragnola loop's found); a tunnel's two portals with the depths that sum to its length, none out of a tunnel |

### In a browser

1. `pnpm dev`, open http://localhost:5173 and, once the title card says "Press any key", press a
   key: it dismisses the card and starts the sound.
2. In the console (dev builds only), `gta.audio.context()?.state` should read `"running"`, and
   `gta.audio.level()` returns the master's RMS in dBFS (−100 when silent). `gta.audio.speaker` is
   the speaker: wrap its `hold` and `play` to count requests or check placements.
3. The Ritmo monitor (backslash) lists the audio schedule beside `update` and `render`.
4. To hear the night or the weather, set them from the debug menu (P) or the console, after the
   card is gone (the clock is held behind it): `gta.sky.setTime(2 * 3600)` for 02:00,
   `gta.sky.force("storm"); gta.sky.settle()` for a thunderstorm at its height, and
   `gta.sky.force(null)` to hand the weather back to the day's plan.

Measured in headless Chrome (`?seed=3`, keys sent over CDP, `gta.audio.level()` every 100 ms):
standing at the spawn −40 to −42 dBFS, walking there with step peaks up to −20, 15 m from the
Lucido in the clear −25, in the Carabinieri Giulia driving with the siren on −10.5 (peaks −3.5),
in a stolen Panda honking −13 (peaks −3.5); no console errors and no non-finite placement or
param. With the engines on the sim's revs (the speaker's `hold` wrapped to read the own engine's
params): in the Giulia idling −28.7 (750 rpm, load 0), pulling away from a standstill at full
throttle for 4 s a median of −13.4 to −13.7 and peaks −10.2 to −10.6 over three runs (1800 rpm
at the launch to 5419–5498, load 1 between shifts, to 13.6–14.6 m/s); in a parked Panda idling
−30.5 (800 rpm), the same pull-away −14.4 and peaks −13.2 (1800 to 5714 rpm, to 13.8 m/s), a
handbrake turn onto grass −9.9 (its tyres played at skid 1, sliding 27.9 m/s). On the audition page
"Render all" gives 141 rows in 7.1–8.4 s, none of the train or crossing rows flagged over 13 runs
(the crickets at 5 °C, a row these changes left alone, came out silent in 2 of them: its slowest
chirp can fall outside the 2 s measured). Measured apart, the damage and the weather gave 116 in
6.0–6.1 s, none flagged (104 with the weather alone, in 5.3–5.5 s, and 100 with the damage), and the
speech and the animal calls 102 in 3.9 s, none flagged (the speech rows peak at 0.5, a plain meow at
0.126). At `?seed=7`, standing at the spawn
reads a median of −38.0 dBFS (−38.8 with crash damage in the game, nothing damaged yet); with
the nearer Carabinieri Giulia burning about 6 m away, −29.7, its crackle peaking at −18.6. With
that Giulia spawned burning in a playtest copy and blowing up at step 300 (5 s in; the meter at a
median of −32.6 over the 1.5 s before, `gta.audio.level()` and each channel's sample peak every
20 ms): its fire's voice is last held the frame before the blast, which plays once at its 10 dB
cap (pan 0.43, a reverb send of 0.8), its render and play taking 12 ms; the meter reads −10.5
within 60 ms, at most −10.8 over 0.1–0.3 s, −12.8 over 0.3–0.6 s and −15.4 over 0.6–1 s, falling
with no swell back up, while the louder channel's sample peak holds at −2.9 to −3.7 dBFS for
0.6 s, under full scale. An echo off a rock face follows 1.83 s later at −39.8 dB, the shell lands
0.73 and 1.03 s later (a clunk, then a 5.9 m/s crash on the road, at its cap), a fleeing
pedestrian cries out 2.65 s later; no console error, no non-finite placement.
Trains (`?seed=1` and `?seed=2`, 100 s and 75 s from the spawn, the speaker's `hold` wrapped): the
AI train idling at Monzone holds its two power packs; Via Riolo's bell rings for 19 s from about
30–35 s in; the train pulls away with its packs under power and its wheels held from 7 s later,
fading past 20 s after it went by; no console error ([Calibration and mix](#calibration-and-mix)
has the gains).
Crashes (a Panda driven by CDP keys into a house, a stone wall, a tree and a bank at 5–15 m/s and
into parked cars at 9–15 m/s, `gta.audio.level()` and each channel's sample peak every 20 ms): the
played speed is the car's at contact (wall hits within 0.3 m/s of it, an oblique tree hit 0.5 under;
before the sim reported it, a 15 m/s hit played as 2.9 then 9.9 m/s); from the seat each peaks −0.3 to
−1.9 dBFS (the meter −12 to −14 over a cabin at −15 to −20 under throttle; −1.3 to −2.2 and the
meter −12.2 to −13.2 with the cabin balance on the crunch); on foot 6.6 m from an
11.4 m/s hit −2.8 (the meter −10), 10.5 m from a 5.1 m/s one −9.8; a play's render 1–8 ms, no long
task, no console error, no non-finite placement.

## Known limits and tuning

- **The loudest near sounds touch the limiter.** The player's own horn and siren pass the whole
  cabin, yet still play over gain 1, so the limiter takes a few dB while they sound (peaks near
  −3.5 dBFS) and the rest of the mix dips that much with them. So do traffic passing close and
  honks, with or without the weather: by the spawn in a storm an Ape at full throttle 2.5 m away
  took 1.55 dB (1.19 dB on the same pass before the weather, revving less), a laden truck 3 m away
  3.75 dB (3.67 before), and a truck's and a Panda's honks 12–15 m away up to 5.8 dB. The
  weather's own sounds took none.
- **Beds against traffic.** Compressing the beds at their level lifts a quiet valley more than a
  car 10 m away (whose 20 dB of spreading stays physical): a car cruising past 10 m away stands
  some 10 dB over a village street's bed on the meter and 6 dB over a meadow's, not the physical
  20–30.
- **The own engine's range** is the voice's: idle to the redline under full load spans 17–26 dB
  (RMS), so with the cabin idling near −29 to −31 dBFS the Giulia peaks near −10.6 pulling away.
- **Engines mask and rank by their gain law only.** Masking and the voice caps count an idling
  engine 11 dB under full load at the redline (`engineQuiet`), but the synth plays it 17–26 dB
  quieter (the filters closing take the rest), so an idling car is culled a little later than
  it should be.
- **A clunk's level is estimated.** The suspension bottoming out plays at 85 dB(A) at 1 m at
  5 m/s, a guess with no recording measured; nor does it depend on the model beyond the truck's
  lower bump stops.
- **The tyres hear a car's skid, not each wheel's.** The sim reports every sliding wheel; the
  audio plays one voice per car, at the most any wheel went past grip, the fastest any slid, on
  the surface of the one furthest past, from the car's centre of mass.
- **One edge.** Only the worst edge on the path counts, capped at 15 dB: two rows of houses are no
  quieter than one. Trees cost foliage loss but do not diffract.
- **Echoes inherit the direct path's occlusion**, and only rock faces echo.
- **The woods play dry.** A forest's tail reaches 10–16 dB under the direct sound 100 m away
  (Huisman and Attenborough 1991), so a bark, a bell or a crash heard across the woods should
  carry a faint tail, but only streets send to the reverb.
- **The reverb is the listener's street.** A source in a street heard from outside it plays dry:
  its street's tail, escaping through the street's mouth, is left out. Every street shares one
  reverb time; only the send scales.
- **Bells at the dev menu's rates:** a new hour's ring cuts what is left of the last, and frames
  that skip minute 0 (the fast rates) miss a ring.
- **The air is fixed for sound:** its absorption and the speed of sound (340.4 m/s) stay at 15 °C
  and 70 % humidity whatever the weather's temperature, and the wind does not bend sound, so a
  sound carries as far upwind as downwind.
- **Crickets follow the temperature and the rain only**, not the night: *Oecanthus* is nocturnal,
  so in a warm valley they also sing by day above 10 °C.
- **The wind's weather factor** is the low-ground wind over 3 m/s; the sim's altitude factor
  (`windAt`) is left out, since the director's own altitude law already raises the wind on high
  ground.
- **The night floor shows only where the wind is stillest:** in sheltered streets and in calm,
  clear weather. An open ridge in the usual wind stays at its wind's level.
- **Owls are rare near villages**, masked there: none was heard at the spawn in 93 s, the two
  within 600 m being 388 and 491 m off behind the village with the Lucido raising the floor. They
  call in the woods (the director's tests); `OWL`, 90 dB(A), is an estimate.
- **Thunder through a cabin** loses its 15 dB and 1.4 kHz like any outside sound, though a car body
  passes its lows better.
- **A flash not heard when it strikes is never thundered**, even if the listener then closes in.
- **The snow cover at the ears stands for the whole path**: its loss and the halved reverb send
  (thunder, aloft, is spared both).
- **Rain falls under bridges and in road tunnels:** nothing checks for a deck overhead (riding a
  train through a tunnel, none falls). Snow falls
  silent, and there is no wet-tyre hiss and no tyre on snow.
- **Far thunder on phones:** in-cloud flashes keep 2.3–2.8 % of their energy above 180 Hz, an 8 km
  bolt 0.9 %, as the air leaves them, so a phone's speaker plays them faint or not at all; bolts
  within 2 km keep a third or more at 100–400 Hz. More upper partials would change the timbre on
  every speaker and need judging by ear on a phone.
- **Thunder renders on the main thread**, on the frame after its flash: in desktop Chrome that
  frame's director took 3.2 ms (median, 14.7 at most); with the CPU throttled four times, as a
  phone might be, 8.5 ms (median, 23.6 at most), every few seconds of a storm. ponytail: move the
  render to a Worker.
- **Estimated levels:** the rain bed's 64 dB(A) (noise charts: gentle rain under 40, heavy 60–70),
  the roof's 66 (no in-car measurement found), thunder's 154 (anchored only on 88 dB(A) at 1 km)
  and the owl's 90. The roof has no model, so the Ape's open cab drums like the Panda's (its 6 dB
  cab lets the bed outside in louder anyway), and rain on water was tuned by measurement, not by
  ear.
- **Water** loudness comes from width and grade, not discharge; the Cascata di Equi is hard-coded.
- **Stereo** is a pan along the screen's right axis, with no front or back. On foot it follows the
  view's quarter turns, not the camera's eased swing between them; driving it follows the car's
  heading, half a second ahead of the view in a steady turn; getting out, it jumps to the seat
  while the view settles there within 1.7 s. A one-shot or echo already on its way (a far bell
  stroke, a bark 200 m off) keeps the pan it was sent with.
- **The occluder is bounded:** at most 12 paths a frame are re-measured, each at most every
  150 ms, so a source moving fast behind houses can lag a few frames.
- **A car rubbing along a wall** keeps a faint scrape held while the sim reports the small hits.
- **Crashes are tuned by measurement, not by ear.** Their features match the research's real
  recordings (onset, block length, crest, noisiness, kurtosis, octave balance, centroid,
  partials), the medians over twenty seeds within the critique's ranges on any twenty; single
  renders still miss one now and then (a rise over 25 ms or a crest over 15 dB in about one
  render in five, 63 Hz over −5 dB in about one in eighty, as the recordings themselves vary). A
  parking bump's crest is about 15.3 dB (a bumper tap's 13.7–15.2) and its −10 dB about 90 ms,
  both near the edge of their targets. A tree's tail is still brighter than the one recorded tree
  crash's (3.3 kHz of centroid after 0.6 s against 1.4). Nobody has listened to them blind
  against the recordings yet.
- **Near crashes play alike loud.** Within about 15 m in the open every crash's direct sound plays
  at its 8 dB cap, so nearer no longer sounds louder there: only the pan, the reverb and the echoes
  move. Uncapped, the limiter held them near −2 dBFS anyway, and gave their tails back as loud as
  the hit.
- **Near train honks play alike loud.** A train's honk reaches its 2 dB cap within about 90 m in
  the open (130 dB at 1 m: 40.8 dB over gain 1 less 20·log10 of the distance, before the ground),
  so nearer it only pans and echoes differently.
- **The road and the shells' clank are tuned by measured features only:** no recording of a car
  landing or rolling onto the road, nor of two cars' shells, was measured; their levels (`ROAD`,
  `SHELL`) are set so each kind stands apart from a house wall in the features above.
- **Crashes and explosions render on the main thread** when they play: a crash 2–9 ms, the
  heaviest reachable (two trucks head-on at 40 m/s) about 15 ms in Node and 13.5 in Chrome; a
  blast 7.9 ms in Chrome (9.8 the worst).
- **An explosion's level is estimated.** 124 dB(A) at 1 m is a guess with no recording measured,
  set so a blast stands clear of the loudest crash; every blast sounds alike whatever blew up (the
  sim's blast is the same for every model) and whatever fuel was left. Within about 20 m in the
  open its direct sound plays at its 10 dB cap, so nearer no longer sounds louder.
- **Traffic brushes houses.** Near Monzone station (`?seed=3`) AI cars hit house walls 10–17
  times a minute (front corners and sides at 1.5–9 m/s where a lane passes close to a facade, the
  same cars again and again: in one 90 s run 16 of 26 crashes landed on a zone already worn), and
  each hit is a crash: distant bumps, now and then a loud one in a nearby street, its mirror and
  glass gone after the first.
- **What a crash leaves out:** a parked car's alarm, a stuck horn, the engine stalling (only a
  destroyed engine dies, fading out over 0.3 s, with no sputter of its own), tyre scrub after the
  hit, a hanging part swinging; the zone is front, side, rear or under (no corners: an oblique hit
  on a front corner is the front; the roof is a side, sharing its wear).
  The ground is the road or earth by its surface; a body sliding on the road grinds like a rendered
  wall (the scrape has no asphalt of its own). A part's threshold is drawn per render, so a harder
  later hit can break a part again when its draw lands between the two speeds; the Giulia's light
  bar and the Panda's hubcap are not remembered at all.
- **A scrape's level follows speed only.** The sim reports no contact force, so a car pressed hard
  along a wall grinds as loud as one brushing it.
- **Speech and the animal calls are tuned by numbers, not by ear.** Their formant targets,
  durations and levels come from the literature and the tests' measurements; the vowel formants
  are Ferrero 1972's as commonly quoted, not checked against the original table. A voiced
  fricative's noise does not pulse with the glottis, and a line's loudness does not fall along it.
- **Some animal levels are estimates:** no measurement at 1 m was found for a moo, a yelp, a yowl,
  a meow or a hiss.
- **An animal's thud plays at a person's height** (1 m), whatever its size.
- **Speech and calls render on the main thread** at their first play: a chat line about 6 ms, a
  yell 2.4 ms, a call 1.4–4.1 ms in Node, several times that on a phone. At most 3 lines and 2 calls
  start in a frame, but a conversation's lines are not counted in that budget.
- **Trains are estimated by numbers, not recordings.** A power pack's 97 dB(A) is TSI Noise's
  limit shared by two, the wheels' 99.9 dB per metre its pass-by limit less the engines, the
  brakes' 95 a guess, the cab's 24 dB a guess sized to TSI's 95 dB(A) under the horn, the own
  train's levels from its cab tuned to a car's seat (TSI lets a cab reach 78 dB(A)), the tunnel's
  0.1 dB a metre and its 400 m silence guesses. No ATR 220 recording was measured; only the bell
  was.
- **The track's joints are a guess.** A joint every 36 m along every line (`JOINT`): the
  Lucca–Aulla line's own rail (jointed or long welded) is unverified; a welded line would clack
  only at its switches and insulated joints.
- **A train does not raise the masking floor.** A passing train masks no birds or steps, as no
  vehicle does.
- **A train's power packs and horn change places at a portal**: each is heard where it is until
  its car's middle passes into a tunnel, then from that tunnel's best portal, so a pack can step
  several dB as its car crosses a portal (only the wheels are summed across it).
- **A moving source's occlusion steps** as its path is measured again, at most every 150 ms with
  no glide between measures (`occluder.ts`), and when a train's wheels are heard from another car
  (each car keys its own path), wherever a hill's or a building's edge crosses the path, as for
  any vehicle. Through the director at 80 km/h, 20–60 m off the track: past the 8 portals (96
  passes) a train's voices stepped over 6 dB from frame to frame in 71 passes, over 10 dB in 43
  and over 15 dB in 20 (at worst a 24.3 dB drop for one re-measure, then 38.9 dB back); on open
  track with no portal within 300 m (78 passes) a pass's largest step had a median of 6.7 dB, a
  90th percentile of 18.1 dB and a maximum of 46.2 dB; a Panda past the same portals, a 90th
  percentile of 27 dB and a maximum of 39.1 dB. Easing each path toward its new measure over the
  refresh, or a slower glide for a change of occlusion alone, would smooth it.
- **Only the player's train knows it is in a tunnel**: in a car in a road tunnel the wind and rain
  beds blow as outside.
- **The cab's horn plays louder than an AI train's beside it.** H plays from the roof through the
  cab at 8.3 dB over gain 1 in the game, uncapped, as a car's own horn from its seat is (held, it
  ducks the mix 2.0 dB on average, the car's 2.9 dB), while an AI train's horn is held to
  `MOST_DB.trainHonk`, 2 dB, at any distance under about 60 m: inside the sealed cab it is louder
  than beside the train. Holding it to that cap too would put the cab under the outside, as a
  real sealed cab is.
- **No tunnel reverb.** Riding through a tunnel, the mix stays as dry as the open: the street
  reverb counts facades only.
- **No train doors, no bridge boom, no flange squeal on curves, no air-brake hiss:** getting into a
  train's cab plays nothing, a steel or masonry bridge rings no differently, and curves are silent.
- **A train's crash is the truck's body on steel** (`TRAIN_BODY`, `STEEL` in `src/audio/rail.ts`)
  until a train's own is judged by ear; a crash's mass is held to 30 Panda masses, so 108 t plays
  as a laden truck.
- **H in a cab sounds only the high tone**; the low one plays only in an AI train's alarm.

Where to tune:

| Where | What |
|---|---|
| `src/audio/director/levels.ts` | every source level and size (the owl's `OWL`, thunder's, a train's power pack's in `ENGINE` and its wheels' `ROLLING`, the player's own train from its cab, `OWN_TRAIN_DB`), the beds (`BEDS`, `GALE_DB`, the roof's `ROOF_DB`), heights and the animals' `MOUTH`, how much softer a woman's or a child's speech is (`SOFTER`), caps and hysteresis, the one-shots' gain caps (`MOST_DB`: the crash's, the explosion's, thunder's and a train's honk's), the bell towers, delay, the reverb send (and the snow's share of it), the echo floor and which one-shots echo |
| `src/audio/acoustics.ts` | `AMBIENT_DB`, `NIGHT_DB`, `CABIN` (a train's cab too), the snow's loss (`snowLoss`), the mix rule (`L_REF`, `K`, `FULL_SCALE`), the air and diffraction tables |
| `src/audio/index.ts` | when a still vehicle is heard (`STILL`), when its wheels are off the ground (`AIRBORNE`), the zone of each face that strikes the ground |
| `src/audio/rail.ts` | a train's revs from its power (`trainRevs`), what a train struck sounds like (`STEEL`) and its own body in a crash (`TRAIN_BODY`) |
| `src/audio/director/rail.ts` | a train's source heights over its rail head (`OVER_RAIL`), the crossing bell's (`BELL_HEIGHT`), the tunnel's loss a metre (`TUNNEL_DB`) and the depth past which nothing is heard (`DEEP`) |
| `src/audio/places/track.ts`, `src/audio/synth/rail.ts` | how near a piece's end must lie to a line to be a switch (`ON`); the joints' spacing (`JOINT`), a bogie's wheelbase (`WHEELBASE`), the wheels' nominal speed (`RAILS_TOP`), the roughness the roar follows (`ROUGHNESS`), the clacks' lookahead and speed, the layers' gains (`ROAR`, `RUMBLE`, `CRACK`, `THUMP`), the squeal's bands and gain |
| `src/audio/synth/crossing.ts`, `src/audio/synth/horns.ts` | the bell's measured partials (`PARTIALS`), its stroke (`STROKE`) and click; the train horn's tones (`TRAIN_TONES`), voicing and attack (`TRAIN_HORN`), an AI train's blasts (`LONG_BLAST`, `ALARM`) |
| `src/audio/director/vehicles.ts` | when tyres roll and how long a skid holds, the beeper sounds, a hit crashes, clunks or scrapes, hits merge; the ground's materials; the groan and door timings; how much of the cabin the own horn and siren pass |
| `src/audio/director/people.ts` | jumps, running, the robbed driver's radius (`THIEF_NEAR`), the cue gap (`CUE_GAP`), who screams (`SCREAMERS`), how often gatherers speak (`HELP_RATE`), how near a victim lies (`BODY_NEAR`), the lines a frame (`LINES_PER_FRAME`, `STALE`) |
| `src/audio/director/talk.ts` | when two chat (`PAIRED`), the pause between turns (`GAP`), the turns' shares (`TURNS`), the conversations voiced (`VOICED`), a party's bursts and lulls (`BURST`, `LULL`) |
| `src/audio/director/animals.ts` | how often each species calls on its own, what each cries, the gap between calls (`CALL_GAP`), the calls a frame (`CALLS_PER_FRAME`, `STALE`), a big dog's size (`BIG_DOG`) |
| `src/audio/director/world.ts` | the wind law (`ALTITUDE`, m over the map's floor, `CALM`, `GALE`, `OPEN`, `STREETS`) and the snow's stilling of its leaves (`SNOW_LEAVES`), the beds and water compressed at their level, the rain's reach to water (`WATER_RAIN`), birds, owls (`OWL_MEAN`, `OWL_REST`), farm dogs, the bell hours (`BELL_HOURS`) and strokes, how often water, farm dogs and owls are looked up |
| `src/audio/director/sky.ts` | the day's and the weather's laws: the floor by the sun (`floorDb`), the songbirds' and the owls' activity, the usual wind (`USUAL_WIND`) and gusts, the faintest rain heard (`RAINING`) |
| `src/audio/director/thunder.ts` | how wide thunder pans (`WIDTH`), how many roll at once and how much quieter over another (`AT_ONCE`, `OVERLAP`), the power's law (`POWER_DB`, `WEAKEST`) |
| `src/audio/director/occluder.ts` | the obstacle refresh rate, per-frame budget and forgetting |
| `src/sim/map/surface.ts` | surfaces: the road surface names, the cover each surface is, the verge (shared with the tyres' grip) |
| `src/audio/places.ts`, `src/audio/places/water.ts` | wall materials and their reach, ambience, street probes, the echo search and the rock's reflection loss, bells, dogs, bird trees, owl territories; water power, fountains and the Cascata |
| `src/audio/synth/engine.ts` | how an engine's build sets its sound (`CYCLES`, the formant's size law, `timbreOf`), each model's measured `TRIM`, `KNOCK` and `EXHAUST` voicing, the variants' spread, the engine law, what damage does to it (`WORN`) |
| `src/audio/synth/fire.ts` | a burning wreck's roar and its flicker (`ROAR`), its crackle (`CRACKLE`: pops a second, bands, decays, peaks) |
| `src/audio/synth/explosion.ts` | the blast: each layer's top (`TOP`), the soft clip (`SATURATE`), the thump's saturation (`DRIVE`), the roar's swell, spread and billowing (`ROAR`), the crack, the boom, the thump's glide and the debris in their functions |
| `src/audio/synth/crash/` | the crash: its level law, the mass's 1/√ and timing (`hit.ts`), the crunch, partials, contact and the shells' clank (`render.ts`, with `SCALE`, the reference crash's output scale, and `SHELL`), each model (`bodies.ts`), each material and the road (`targets.ts`, with `ROAD`), what breaks and falls (`parts.ts`), grit, trains and landings by surface (`textures.ts`) |
| `src/audio/mixer.ts`, `src/audio/speaker.ts` | master gain, limiter, the street reverb and its return; the one-shot cap |
| `src/audio/synth/*.ts` | each synth's own table: horns, tyre grounds and the skid's fade-in, the clunk (`BOTTOMED`), the scrape's materials, treads (the snow's `SNOW` too), the scream and groan, calls (the owl's too), bubbles, the rain's layers and surfaces (`RAIN_LAYERS`, `SURFACES`, `WATER`), the thunder's channel and roll (`CHANNEL`, `PEARL`, `ROLL`); the animal calls' contours, tracts and `MEOW_QUIET` (`synth/animals.ts`) |
| `src/audio/speech/` | the lexicon, fillers, gibberish weights and `PROFANE` (`lines.ts`); timing, tempo, F0, tract and voice quality, the yell (`plan.ts`); the synth's bandwidths, glides and noise levels (`render.ts`) |

For trains and crossings: TSI Noise, Reg. 1304/2014 (a diesel unit's starting and pass-by
limits), TSI HS RST 2008/232 and EN 15153-2 (the horn's tones and level), UIC 644, RFI's
Regolamento Segnali art. 5 and 7 (when a driver whistles, the alarm), DPR 495/1992 art. 186 (the
bell heard from 100 m), the Wegh eLCSP data sheet (the bell's 90 dB at 1 m), a Commons recording
of an Italian crossing's bell (CC BY-SA 4.0, measured for its partials and stroke, not shipped),
MAN (the D2876's 1800 rpm) and pesa.pl (the ATR 220's length and layout).

Sources for the numbers: ISO 9613-1 (air absorption) and ISO 9613-2 (ground effect, foliage),
Maekawa's barrier chart (diffraction), Thomas et al. 2013 (reverb in streets and in the open),
Picaut et al. 2005 (a street's reverb time), Huisman and Attenborough 1991 (forest reverb), Pieren
and Wunderli 2011 (cliff echoes), Wunderli and Salomons 2009 (forest edges), ITU-R BT.1359 (audio
lag), D.M. 20/03/1979 (the siren), CNOSSOS-EU (tyre rolling noise), van den Doel 2005 (bubbles),
Farnell, *Designing Sound* (footsteps, wind, rain), Peterson and Barney 1952 (vowel formants), Arnal
et al. 2015 (the roughness of screams), Dolbear's law (cricket rate) and Friedlander's form of a
blast wave (the explosion's crack). For the weather: Few 1969 and Hill 1968 (thunder's string of
pearls and its channel), Wischmeier and Smith (rain's kinetic energy), Medwin and Nystuen 1992 (rain
on water), Albert, CRREL (sound over snow), Thomas et al. 2002 (the dawn chorus), and the BTO on the
tawny owl's calls. For crashes: crash-pulse durations (Locey et al. 2012, NHTSA fleet data),
restitution (Cipriani 2002), crumpling's power law (Houle and Sethna 1996), modal synthesis and
contact spectra (van den Doel and Pai; Chadwick, Zheng and James 2012), PhISEM grain streams (Cook,
STK), tempered glass (UN R43 Annex 5; Nielsen et al. 2009), the W-beam's bands (a highway guard
rail's contact-mic recording) and 16 crash recordings measured for the critique (Freesound CC0/CC
BY, BBC Sound Effects for analysis only). For speech: Pearsons, Bennett and Fidell 1977 (speech
levels), Klatt 1980 and Klatt and Klatt 1990 (the synthesiser and voice quality), Ferrero 1972
(Italian vowels), Delattre, Liberman and Cooper 1955 (consonant transitions), Stevens and Blumstein
1978 (bursts), Jongman, Wayland and Wong 2000 (fricatives), Fujimura 1962 (nasals), Ladefoged and
Maddieson 1996 (the trill), Esposito and Di Benedetto 1999, Bertinetto 1981 and D'Imperio and
Rosenthall 1999 (Italian durations), Krämer 2009 (Italian phonotactics), Pellegrino, Coupé and
Marsico 2011 (speech rate), Titze 1994 (F0), Xue and Deliyski 2001 (elders' voices), Schulman 1989
(shouting), Bachorowski, Smoski and Owren 2001 (laughter) and Stivers et al. 2009 (turn-taking). For
animals: Padilla de la Torre et al. 2015 (cattle calls), Riede and Fitch 1999 (dogs' vocal tracts),
Schötz 2013 (meows), Engenharia Agrícola 2018 (piglets' squeals) and Rosenberg's glottal pulse.
