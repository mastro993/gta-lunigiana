# Water

The rivers and streams carry what the weather's rain leaves them: they rise in a storm and fall
back over the following days, and their depth and current follow from each reach's catchment,
width and grade. The player wades through them and swims once they lift him off his feet or the
current takes them from under him; people, animals and vehicles meet the same water. Nobody
drowns.

The code is in `src/sim/water/` (`flow.ts`, `channel.ts`, `rivers.ts`, `swim.ts`), the `Wade`
system in `src/sim/systems/water.ts`, the catchment areas in the map build
(`src/tools/catchment.ts`) and the drawn water in `src/render/lines.ts` and
`src/render/sky/surface.ts`.

## The rivers' flow

One catchment model serves every river and stream: it gives the discharge per km² of catchment, and
each reach carries that times the area upstream of it (the drainage-area ratio).

`riversAfter` (`flow.ts`) moves the saved `Rivers` resource on by each step's game seconds
(`AdvanceRivers`, after `AdvanceWeather`; nothing moves at rate 0). Its four stores are mm of
water over the catchment:

- **Snow**: the precipitation's snow share at the catchments' mean height (`snowShare` of the air
  there) lies as snow and melts by 3 mm a day for each °C above 0 (a common degree-day factor).
- **Soil** (HBV's routine): rain and melt wet it, and the share (soil / 78 mm)^1.9 of them runs
  off; it dries at the potential evapotranspiration down to 71 % of its capacity, slower below.
- **Quick runoff** and **groundwater**: half the runoff each, draining as linear reservoirs with
  time constants of 7.4 game hours and 49.5 game days. The discharge per km² is their outflow.

The input is the weather's precipitation at sea level × `orographic` at 667 m, the mean height of
the catchment the model is fitted to, × 1.27: that catchment receives 1668 mm a year (the Annali's
mean "afflusso"), the game's weather 1312 mm at that height. The air there is the day's normal
(`dailyMean`) plus the weather's anomaly. The potential evapotranspiration is Thornthwaite's (1948)
from the climate's monthly normals at 667 m: 685 mm a year on the shipped map, 8 mm in January to
129 mm in July.

### The calibration

The model is fitted to the Torrente Aulella at Soliera, the gauge 4 km below Gragnola (ARPAL,
Annali Idrologici 2017, part II: 208 km², gauged 1956–58, 1962, 1964–77, 1993–96 and 2009–12).
`flow.test.ts` runs 30 years of the game's weather an hour at a time and holds the model to it.
Six of its eight parameters (the soil's capacity, shape and evapotranspiration share, the split
and the two time constants) were fitted to the gauge's monthly means and duration curve; the
gain and the melt are set as above.

| Month | J | F | M | A | M | J | J | A | S | O | N | D | Year |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Soliera, m³/s | 15.49 | 11.81 | 9.00 | 10.99 | 7.69 | 4.74 | 2.53 | 2.94 | 4.39 | 7.02 | 12.01 | 13.86 | 8.51 |
| the model | 8.93 | 11.12 | 9.01 | 9.58 | 8.33 | 5.26 | 2.91 | 2.54 | 5.55 | 8.10 | 11.64 | 10.89 | 7.80 |

| Exceeded on, days a year | 10 | 30 | 60 | 91 | 135 | 182 | 274 | 355 |
|---|---|---|---|---|---|---|---|---|
| Soliera, m³/s | 44.2 | 20.25 | 12.49 | 8.95 | 6.56 | 4.78 | 2.47 | 1.07 |
| the model | 38.62 | 17.37 | 9.53 | 7.14 | 5.60 | 4.52 | 2.63 | 0.93 |

The test holds the year's mean within 10 %, each month within 1.5 times above and 1.75 times below
(December and January run 21 % and 42 % low: the gauge's winters carry the autumn's water over,
January's runoff 1.45 times its rain), November to February above three times July and August,
and the duration curve within 25 %. Its highest hourly flow in the 30 years is 357 m³/s, its
median year's highest 219 m³/s; the gauge's highest daily mean over its years is 242 m³/s and its
record flood 688 m³/s (16 November 1968).

Six game hours of settled rain on a new game (seed 3, 22 October) raise the flow at Soliera from
6.3 m³/s to 55.7; a clear day brings it back to 16.3 in 12 game hours and 8.5 in 24.

### A new game's rivers

A new game's rivers come from the year before its start, run an hour at a time under the weather
those days' plans bring (`initialRivers`): each day's plan comes from the weather seed and the day
alone, so the rivers carry what the season and the last weeks' rain left. It takes about 28 ms in
Node, and is kept for the same start and seed. On 22 October 2026 the flow at Soliera starts at
23.9, 3.9, 6.3, 1.9, 2.6 and 8.8 m³/s for seeds 1 to 6 (the month's mean is 7.02). A new game
still starts on dry roads under a clear sky ([weather.md](weather.md)); a jump of the clock from
the debug menu moves the rivers on from where they are.

## Depth and current

Every vertex of a river or stream knows the catchment upstream of it, so its depth and current
follow from the discharge per km², q.

- **Catchments** (`src/tools/catchment.ts`): the map build burns the water's profiles 100 m into
  the 4 m terrain grid, fills it (priority-flood with an epsilon, Barnes et al. 2014), routes each
  node to its steepest lower neighbour (D8) and accumulates the 4 m cells downstream. Each piece
  starts with what the pieces ending where it begins bring (a confluence adds them up, a fork
  shares them among its arms, so a braid's rejoin adds back to the whole), and each
  vertex keeps the most its own burned nodes gather within a node of it, never less than upstream
  (`Water.area`, km²). Nodes within two of another water's are left out, and a piece's last vertex
  keeps what came down to it: D8 may route the water it joins through a tail running beside it. The Torrente Lucido drains 47 km² where it meets the Aulella. The bounds
  hold only the Aulella's left bank, so it takes 161 km² from beyond them (the Soliera gauge's
  208 km² less the Lucido's), and leaves the map with 208.
- **The channel** (`channelOf`, `channel.ts`): as wide as the water (`Water.w`), its bed the terrain
  drawn under the centreline (except under an at-grade road, where it stays `depth`/2 under the
  culvert's dip, so the road stays dry until a flood overtops it; and near the track, on the ground
  or a bridge, where it is no higher than that nor `depth` under the rail bed: the map build lays
  the rail bed across a stream at grade, banks it up beside it and leaves the ground under a low CTR
  bridge at the track's level, and the stream runs through the culvert or under the deck. Near is
  within the water's own reach (`reachOf`, its gravel bed's half-width: 3 m on a narrow stream) of
  the rail bed's 4 m, since a vertex holds water that far across it: the vertices within 2 m of the
  centreline alone left 0.06 m on the bed's edge beside two of the culverts at the mean flow and
  0.24–0.31 m in a 0.6 m³/s per km² spate. The whole rail bed stays dry where the three streams
  cross it at every flow up to the gauge's record flood (688 m³/s at Soliera, 3.3 m³/s per km²)),
  and its grade the surface's fall over ±40 m. The bed reads the terrain along the whole water,
  which the game holds only near the player, so the build works it out (`bedOf`) and the map file
  keeps it per vertex (`Water.floor`), which `channelOf` reads. Depth and mean speed follow
  Manning's equation with Jarrett's (1984) roughness for high-gradient streams, n = 0.39 S^0.38
  R^−0.16, fitted on Colorado mountain streams of 0.2–5.2 % grade (flatter and steeper reaches are
  held to that range); for a wide channel Q = w h^1.83 S^0.12 / 0.39, so the depth goes as q^0.547
  and the speed as q^0.453.
- **At a point** (`waterAt`, `rivers.ts`): the nearest reach within its gravel bed's half-width
  (`Water.bed`; a narrow stream's 3 m). Across the reach the surface is level, so the depth is the
  level less the floor a body stands on; the water spreads over the gravel as it rises. The current
  runs down the reach at the mean speed × (depth / mean depth)^0.83 (Manning's speed with depth,
  at most 1.5 times the mean depth's), so it slows to nothing at the water's edge.

| Where | at 1 m³/s (Soliera) | 9 m³/s, the mean | 21 m³/s | 125 m³/s, a spate |
|---|---|---|---|---|
| Torrente Lucido below Monzone station (34.8 km², 14 m, 1.9 %) | 0.07 m, 0.18 m/s | 0.22 m, 0.46 m/s | 0.36 m, 0.69 m/s | 0.96 m, 1.55 m/s |
| Torrente Aulella at Gragnola (161.5 km², 12 m, 1.1 %) | 0.18 m, 0.37 m/s | 0.58 m, 0.95 m/s | 0.94 m, 1.43 m/s | 2.52 m, 3.21 m/s |
| Torrente Caldanella at Equi (10.9 km², 8 m, 2.3 %) | 0.05 m, 0.14 m/s | 0.16 m, 0.35 m/s | 0.26 m, 0.53 m/s | 0.69 m, 1.19 m/s |

At the mean flow 93 % of the 2 m streams' length and 97 % of the 4 m streams' carry water; the
rest are headwater gullies, dry as real ones are.

## People and animals in the water

`Wade` (before the movement systems) gives every person on foot and every animal standing in a
river or stream the saved `InWater` component, `swimming` once it is off its feet, and takes it
away on dry ground.

- **On a bridge or under it.** A body not yet in the water stands on the highest ground at its
  point, a bridge's deck when it is within 1 m of the deck's edge (a walker keeps to the verge, half
  a metre past the carriageway), so a bridge keeps it dry; one already in the water stands on the
  terrain under any bridge and swims under it.
- **Off its feet** (`swept`, `swim.ts`): when the water reaches 0.7 of its height (an adult's
  chest, Cox et al.'s 1.2 m for adults) or the depth × speed passes its hold (`holdOf`). Cox, Shand
  and Blacka (2010, Australian Rainfall and Runoff Revision Project 10, as WRL Technical Report
  2014/07 reports them) find most adults lose their footing at 1.2 m²/s; the hold scales with
  height × mass (a person's mass at a BMI of 24.5), so a 1.2 m child keeps it to 0.39 m²/s, their
  0.4 for children. An animal's height is its shoulder's (`FAUNA`: a dog 0.55 m, a cat 0.25, a cow
  1.4, a pig 0.7) and its mass its species' × size³; none stands more than an adult. Back on its
  feet only under 0.85 of either.
- **Wading** (`waterVelocity`): toward where it wants to go at its walking speed × (1 − 1.15 ×
  depth × 1.75 / height), at least a quarter (knee-deep water, 0.35 m, slows an adult by about
  two fifths: trials of 188 people in "Impacts of water depth on pedestrian speed, gait, and
  stability", Acta Polytechnica CTU Proceedings, found 39 % for men and 45 % for women), plus the
  current × (depth × speed / hold)², so the push grows toward the footing's loss. Running is
  slowed more (`wadingSpeed`): the legs' drag grows with the square of their speed, so whatever a
  body wants past a walk (1.4 m/s) fades out by the time the water reaches its knees (0.28 of its
  height; estimates). In 0.15 m of water the player walks at 1.62 m/s (2.2 dry) and sprints at
  3.5 (5.5 dry); by the knees a sprint is a wade.
- **Swimming**: the velocity closes on the current plus a stroke along the keys (time constant
  0.5 s): an adult 0.9 m/s, a child 0.6, an elder 0.7, the player sprinting 1.6 times that
  (estimates: an unhurried breaststroke near 2 minutes per 100 m). An animal paddles at its
  species' speed (a dog 0.9, a cat 0.4, a cow 0.6, a pig 0.5 m/s, estimates). The down and the
  dead float where the current takes them.
- **Never drowning.** Swept far, the player swims out wherever he heads; there is no breath or
  stamina.
- **Keeping out by choice** (`walkDry`). People and animals keep to the walk walls like the
  player, but one still dry takes no step into the water unless it flees: it stops at the water's
  edge where the level stands now, so a rising river pushes it back and it can walk off a river's
  dry gravel bed. In the water, they carry on as they were where it is slack and below their knees
  (under 0.3 of their height deep and 0.25 of their hold), so a cow wades a trickle to its
  pasture; deeper or faster, they head square across for the nearer bank.

## Vehicles in the water

A vehicle standing in a river (`waterAround`, the water over the ground its wheels stand on) is
buoyed and dragged by it in its body's own physics (`integrate`, `src/sim/dynamics.ts`), each
quarter of its underbody by the water over that quarter:

- **Buoyancy**: half the body box under the water buoys it (`SEALED`, the air its cabin holds).
  WRL Technical Report 2017/07 (UNSW Water Research Laboratory) floated a 1.0 t Toyota Yaris in
  0.6 m of still water and a 2.4 t Nissan Patrol in 0.95 m; their wheels come off the ground once
  the body has risen by its springs' sag (about 0.1 m), and half the box over the floor then
  floats both (the Yaris's 0.3 m of a 3.9 × 1.7 m box, 1.0 t; the Patrol's 0.55 m of a 4.97 ×
  1.94 m box, 2.65 t). A Panda keeps its four wheels down in 0.3 m of still water and floats in
  0.7 m. As the water lifts the body the springs unload, and the tyres lose their grip with them.
- **Drag**: the current against the side and end the submerged body shows it, drag coefficient
  1.1 (a bluff box), and the water damps the body's rise and fall.
- **Ploughing**: each wheel drags through the water over the ground under it, its tread end-on
  and the wetted segment of its side sideways (drag coefficient 1, an estimate), so shallow water
  the body never touches still slows a car hard: tread widths are each model's stock tyre's (a
  Panda's 175/65 R14, an Ape's 4.00-10, the truck's 315/80 R22.5, a Giulia's 225/55 R17). Coasting
  in at 10 m/s, a Panda is down to 6.5 m/s after a second in 0.15 m of still water and 3.6 in
  0.3 m (9.8 dry); the laden truck to 9.5 and 9.2.
- **Stalling**: water over the engine's air intake cuts its drive (`stalled`): a Panda's at 0.6 m,
  an Ape's at 0.45, a Giulia's at 0.55, the truck's stack at 2.4 (estimates from each model's
  layout). Out of the water the engine runs again.
- **No sleeping**: a vehicle at rest in a river within 500 m of the player along both axes is never
  put to sleep, so a rising flood floats a parked car off. In the Lucido below Monzone a parked
  Panda holds at the mean flow and is carried off downstream in a spate. Farther off a vehicle
  stands frozen, so a
  flood does not move it until the player comes near
  ([gameplay.md](gameplay.md#vehicles-far-from-the-player)).

AI drivers keep to their lanes; a car shoved into a river is carried off like any other.

## Walls

Water stops neither feet nor wheels. The map build traces the water's cells (within max(w/2, 2) m
of a centreline, not on a road) as their own walls, the shore, and `wallsNear` answers four kinds:

| Kind | Walls | Who keeps to them |
|---|---|---|
| `walk` | buildings, slopes over 35°, cliffs, walls, the bounds, trunks | everyone on foot and every animal |
| `land` | `walk` and the shore | where people and animals spawn; a follower's way to its leader |
| `drive` | `walk`'s, slopes over 25° off the roads, guard rails, parapets, road-exit caps | every vehicle's physics |
| `traffic` | `drive` and the shore | AI drivers' lanes (`lanesFor`), where vehicles spawn |

Traffic's dead ends and the spawns are worked out against the water's edge, as before, so the road
graph, the parked spots and the player's spawn are the same.

## How it looks

- **The level**: each river and stream is drawn as a ribbon over its whole bed (twice
  `Water.bed`), with a darker channel 0.45 of the water's width down the middle of the 8 m ones and
  wider, laid on its bed. Each vertex carries its `stage` and its `flow` (the way down and the mean
  speed per unit); the water shader lifts it by `stage` × q^0.547, the uniform `uRiverStage`, so the
  surface stands where the sim's is, and the terrain above it hides it: in a spate the water spreads
  over the gravel.
- **The colour**: the water's own colour (and the darker channel's) shows from 0.05 m of mean depth
  and fully from 0.7 m; shallower, it is the limestone pebbles seen through it, tinted 0.6 of the
  way to the water's green (TUNED by eye), so an ankle-deep torrent reads as wet gravel with the
  current on it and a spate as a river.
- **The current**: streaks 1.6 m long and 0.3 m wide carried downstream at the water's speed
  (`uRiverSpeed` = q^0.453), two phases 2 s apart dissolving into each other cell by cell; 2 % of
  them show on still water, up to 30 % at 3 m/s and over (TUNED by eye).
- **Swimmers**: a person swimming crawls (two frames, a stroke every 1.25 s), floating with its
  feet 0.66 of its height under the surface, so the water reaches its shoulders; an animal paddles
  with its trunk half under; the down and the dead float (a person 0.15 m under the surface, an
  animal by half its flank). Nothing floats under the bed. Wading, a body stands on the bed and
  the surface hides its legs. The player's x-ray shows no silhouette while he is in the water.

## Sources

The model takes a handful of published figures as facts, the way the climate model takes its
papers' ([weather.md](weather.md#the-climate-sources-record)); none of their data is shipped.

- ARPAL (Agenzia Regionale per la Protezione dell'Ambiente Ligure), *Annali Idrologici 2017*, part
  II: the Aulella at Soliera's catchment (208 km², mean height 667 m), its monthly mean flows, rain
  and runoff and its flow-duration curve over the years it was gauged, its 2017 daily flows (whose
  recessions halve in about a day), and its record flood (688 m³/s, 16 November 1968).
- Cox, Shand and Blacka (2010), *Australian Rainfall and Runoff Revision Project 10: Appropriate
  Safety Criteria for People*, as UNSW Water Research Laboratory Technical Report 2014/07 quotes
  it: the depth × speed people keep their footing to.
- UNSW Water Research Laboratory Technical Report 2017/07, *Vehicle Stability Testing for Flood
  Flows*: the depths a Toyota Yaris and a Nissan Patrol float at.
- Jarrett (1984), "Hydraulics of high-gradient streams", Journal of Hydraulic Engineering 110(11):
  the roughness of mountain streams.
- Thornthwaite (1948), "An approach toward a rational classification of climate", Geographical
  Review 38(1): the potential evapotranspiration.
- Barnes, Lehman and Mulla (2014), "Priority-flood: an optimal depression-filling and
  watershed-labeling algorithm", Computers & Geosciences 62: the map build's fill.
- "Impacts of water depth on pedestrian speed, gait, and stability: results from an experimental
  study", Acta Polytechnica CTU Proceedings: walking pace in knee-deep water.

## Tests

| File | Covers |
|---|---|
| `src/sim/water/__tests__/flow.test.ts` | the calibration against Soliera (mean, months, seasons, duration curve), Thornthwaite's 685 mm, a new game's rivers alike for a start and seed and spread across seeds |
| `src/sim/water/__tests__/channel.test.ts` | the whole rail bed dry where a stream crosses it, at the mean, in a spate and in the 30 years' highest flood |
| `src/sim/water/__tests__/swim.test.ts` | the hold (an adult's 1.2 m²/s, a child's 0.4), off the feet and back on, wading's slowing, a sprint slowed to a wade by knee depth |
| `src/sim/__tests__/water.test.ts` | the Lucido's depth and current at the mean and in a spate; the player wading across, swept, swimming and out, and dry once he gets into a car in the water; people and animals swimming out and the dead drifting; a calm dog stopping at a spate's edge; a Panda holding in the Lucido and floating off in a spate; buoyancy at 0.3 and 0.7 m; a Panda ploughing to a third slower in a second of ankle-deep water, the truck hardly; stalling; a bridge keeping a walker dry, on its centreline and on every verge over the water; the rivers rising under rain and falling back; determinism and a save mid-swim |
| `src/tools/__tests__/catchment.test.ts` | a braid's arms sharing the river's area at the fork and adding back to it at the rejoin |
| `src/sim/map/__tests__/map.test.ts` | catchments growing downstream with no jump at a tributary's mouth, the Lucido's 47 km² and the Aulella's 208; no walk or drive wall in a wide river, shore walls by it |
| `src/render/__tests__/index.test.ts`, `figures.test.ts` | no x-ray in the water, a swimmer floating at its shoulders and never under the bed; the swim frames |

## Known limits

- **One catchment model.** Every reach runs at the same discharge per km², so a 1 km² stream
  rises and falls as slowly as the 208 km² Aulella, and the Lucido's higher, wetter catchment
  runs as the Aulella's mean one does.
- **The weather's floods are small.** The weather's heaviest day drops 109 mm at 667 m (138 with
  the gain), so the model's floods peak near 360 m³/s at Soliera, half its record.
- **Wide channels.** The depth comes from a rectangular channel as wide as the water; a spate
  spreading over the gravel would run lower than that.
- **No pools.** The rivers have no deeper pools or weirs: in a dry summer the water is nowhere
  deep enough to swim in, and there are no lakes or ponds.
- **Snow at one height.** The snowpack lies at 667 m; the high Apuan snow and its spring melt are
  not modelled.
- **Silent floods.** The rivers sound as they do at their usual flow ([audio.md](audio.md)),
  whatever they carry.
- **Under a bridge.** A body that walks under a bridge on the bank (not yet in the water) is taken
  to be on its deck there.
- **Engines.** An engine that stalled in the water runs again once out of it: nothing hydrolocks.
