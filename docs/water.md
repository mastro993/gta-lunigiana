# Water

The rivers and streams carry what the weather's rain leaves them: they rise in a storm and fall back
over the following days, and their depth and current follow from each reach's catchment, width and
grade. Where OSM draws a river's water as a polygon, the river spreads over it; the lakes and ponds
stand still at their level, and the sea at 0 m, which holds a river up where it meets it. The
player wades through them and swims once they lift him off his feet or the current takes them from
under him; people, animals and vehicles meet the same water. Nobody drowns.

The code is in `src/sim/water/` (`flow.ts`, `channel.ts`, `rivers.ts`, `swim.ts`), the `Wade`
system in `src/sim/systems/water.ts`, a swimmer's footing in `FindFooting`
(`src/sim/systems/footing.ts`), the catchment areas and the lakes' levels in the map build
(`src/tools/catchment.ts`, `src/tools/water-areas.ts`) and the drawn water in
`src/render/lines.ts`, `src/render/water.ts` and `src/render/sky/water-shader.ts`.

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

- **Catchments** (`src/tools/catchment.ts`): the map build burns the water's profiles 100 m into the
  4 m terrain grid, fills it (priority-flood with an epsilon, Barnes et al. 2014), routes each node
  to its steepest lower neighbour (D8) and accumulates the 4 m cells downstream. Each piece starts
  with what the pieces ending where it begins bring (a confluence adds them up, a fork shares them
  among its arms, so a braid's rejoin adds back to the whole), and each vertex keeps the most its
  own burned nodes gather within a node of it, never less than upstream (`Water.area`, km²). Nodes
  within two of another water's are left out, and a piece's last vertex keeps what came down to it:
  D8 may route the water it joins through a tail running beside it. The grid's edge is the outlet,
  and so is every node no listed map tile holds (an L-shaped region's notch, which the build reads
  no terrain in: [map.md](map.md#pipeline)), so no ground beyond either counts. The water past the
  play area's outline but inside the box is burned too, owning no node, so a river the outline cuts
  short of the box's edge or a notch drains on down its own water. Before, its trench ended 100 m
  under the ground past the cut, the fill made it a lake as high as its lowest way out, and D8
  crossed the lake down a side stream: Fosdinovo's north edge cut the Torrente Bardine 100 m short
  of the notch, before Aulla's part made it a seam, and its 58.1 km² drained out up the Canale del
  Torchio to the box's west edge. Water coming in from beyond the grid keeps its ground at its first
  nodes, so it is no outlet for the water it joins
  ([map.md](map.md#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)). The Torrente
  Lucido drains 46.4 km² where it meets the Aulella at Gragnola; the Aulella brings 59.6 km² there,
  all of them on the map, and drains 106 below the mouth. The bounds hold the whole basin above the
  Soliera gauge but the heads of the streams that come down from north of y 13000 under the Cerreto
  pass: 14.7 km², by a D8 on Massa-Carrara's 10 m DTM, all of which reach the Torrente Rosaro above
  Fivizzano, 13.1 of them down its own head and 1.6 down rivulets west of it. The Rosaro brings them
  all in at its entry node, 12 m inside the edge (`OFF_MAP` in `src/tools/build-terrain.ts`), so it
  reaches the Aulella at Soliera with 81.6 km², the Aulella reads 196.5 just below its mouth (181.8
  of the map's own ground and the 14.7), 196.8 by the gauge, crosses Fivizzano's west edge (x −5300)
  with 199.4 (199.0 while that was the box's edge, before the 0.4 km² of the Canale di Moncigoli's
  head west of it came into the box) and meets the Magra at Aulla with 313.1. A D8 on the 10 m DTM
  gives it 319.3 km² 100 m above its mouth and 200.7 at Soliera: the map reads 1.9% under it at both
  (313.1 and 196.8), so the gap is the 4 m grid's divides, not a part of the basin left out. ARPAL
  gives the gauge 208 km², more than the DTMs' basins there (the 10 m DTM's is 200.7 km², 186.1 of
  them inside the box, where the map's 4 m D8 gathers 181.8), so the flows per km² come from the
  gauge's 208 and the map's Aulella at Soliera carries 196.8/208 of the gauge's flow. The Torrente
  Bardinello rises in lucido's part and crosses Fosdinovo's to meet the Torrente Bardine by Bardine
  di San Terenzo with 33.7 km²; the Bardine crosses Fosdinovo's north edge at (−10572, 3900) with
  59.03 (59.04 by a D8 on the ground alone) and joins the Aulella with 65.31, below the gauge, so
  neither changes the gauge's flow.
- **The Magra's and the Taverone's heads** (issue #19) come in as the Rosaro's do: of the 522.0 km²
  north of y 13000 that drain into the box, by a D8 on the 10 m DTM, the Fiume Magra brings 420.9 of
  its upper valley and the Torrente Taverone 69.1, each at its own crossing of the north edge; the
  Torrente Civiglia 4.5, the Canale Torchio di Bacco and the Canale della Ghiaia, which join the
  Civiglia, 3.8 and 3.0, and the Canale Cravareccia 1.1; the rivulets' 4.9 km² are left out
  (`OFF_MAP`). The Magra crosses y 3900 with 918.0 km², where it left the play area with 915.0
  before Sarzana's part (issue #20; the 10 m DTM's D8 930.5;
  412.55 while the heads came in with nothing), the Taverone meets it with 115.4 (82.49 at the end
  of its way 700556145, 1.3 km above its mouth, where the 10 m DTM reads 86.7; 33.9 while the heads
  came in with nothing) and the Civiglia, which joins the Taverone 84 m above its mouth, with 32.15
  (20.85 before its heads came in). The map's 4 m D8 drains 6.8 km² of land by the north edge out
  across it, land which on the 10 m DTM comes back in with the rivers (3.4 km² by the Taverone, 1.5
  by the Magra, 1.35 by the Rosaro): the Taverone's 3.4 is what separates its 82.5 from the DTM's
  86.7. Their flows per km² are the Aulella's at Soliera: the Magra has no gauge the calibration
  reads, and the gauge at Calamazza is quoted at 932 km², not verified
  ([map.md](map.md#known-data-limitations)).
- **The Vara** (issue #20) comes in over the box's west edge with 552.4 km² (`OFF_MAP`, a D8 on
  Liguria's DTM) and reads 553.4 where the play area's outline cuts it, inside the box; it meets the
  Magra at Fornola with 603.3 (the Autorità di bacino del Magra's PGRA gives it about 600 there, the
  D8 605.6), the Magra reading 945.8 above it and 1,549.4 below. The Magra leaves the play area at
  y −8500, 4.8 km above its mouth, with 1,618.8 of the about 1,700 km² the Autorità di bacino gives
  its basin at the mouth. Their flows per km² are the Aulella's at Soliera too.
- **The channel** (`channelOf`, `channel.ts`): as wide as the water (`Water.w`), its bed the terrain
  drawn under the centreline (except under an at-grade road, where it stays `depth`/2 under the
  culvert's dip, so the road stays dry until a flood overtops it; under ground standing more than
  `depth`/2 over the water's own surface (the build's carve leaves its gravel at most `depth`/4 over
  it), where it runs in a culvert `depth`/2 under its surface: a road's fill over the channel, or
  the bank the 4 m grid reads under a narrow stream's line. Beside a road on the plain below Arcola
  a stream (373093516) had the road's fill for its bed, 1.2–2.5 m over its surface, and a spate
  stood on the verge of the 6 m bridge 373320292 over it. 1,164 of Lunigiana's vertices on 580
  pieces lie so (9 of them 13–506 m from any road or track, up to 1.67 m under the ground), 37 of
  the L's on 17, 4 of the coast's and none of Cesena's, and their floors lie `depth`/2 under the
  surface; and near the track, on the ground or a bridge, where it is no higher than that nor
  `depth` under the rail bed: the map build lays the rail bed across a stream at grade, banks it up
  beside it and leaves the ground under a low CTR bridge at the track's level, and the stream runs
  through the culvert or under the deck. Near is within the water's own reach (`reachOf`, its gravel
  bed's half-width: 3 m on a narrow stream) of the rail bed's 4 m, since a vertex holds water that
  far across it: the vertices within 2 m of the centreline alone left 0.06 m on the bed's edge
  beside two of the culverts at the mean flow and 0.24–0.31 m in a 0.6 m³/s per km² spate. The whole
  rail bed stays dry where the three streams cross it at every flow up to the gauge's record flood
  (688 m³/s at Soliera, 3.3 m³/s per km²)), and its grade the surface's fall over ±40 m. The bed
  reads the terrain along the whole water, which the game holds only near the player, so the build
  works it out (`bedOf`) and every tile holding the piece keeps it per vertex (`Water.floor`), which
  `channelOf` reads. Depth and mean speed follow Manning's equation with Jarrett's (1984) roughness
  for high-gradient streams, n = 0.39 S^0.38 R^−0.16, fitted on Colorado mountain streams of
  0.2–5.2 % grade (flatter and steeper reaches are held to that range); for a wide channel Q = w
  h^1.83 S^0.12 / 0.39, so the depth goes as q^0.547 and the speed as q^0.453.
- **At a point** (`waterAt`, `rivers.ts`): the nearest reach within its gravel bed's half-width
  (`Water.bed`; a narrow stream's 3 m). Across the reach the surface is level, so the depth is the
  level less the floor a body stands on; the water spreads over the gravel as it rises. The current
  runs down the reach at the mean speed × (depth / mean depth)^0.83 (Manning's speed with depth,
  at most 1.5 times the mean depth's), so it slows to nothing at the water's edge.
- **From the point's tile** (`placeAt` in `src/sim/map/tiles.ts`): every river and stream lies
  whole in each tile it comes within 32 m of (`HALO`; the widest bed's half-width is the Magra's
  13.5 m), so the
  tile under a point holds every reach whose bed reaches it, every lake and river polygon over it,
  and each such polygon's waterways (the cut puts them in every tile the polygon lies in). A tile's reaches go into 32 m buckets
  on its first use, each built from the whole piece the tile holds (`channelOf` over the whole
  polyline and its baked floor), and go with the tile when it is dropped. Of equally near reaches
  the first in (piece, vertex) order wins, as in the one grid over the whole map's water the game
  had before the tiles, so `waterAt`, `waterUnder` and `walkDry` answer the same whichever tiles
  are in memory.
- **In a river polygon** (`Area.waters`,
  [map.md](map.md#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)): the nearest
  reach of its own waterways where they run in it, however far across it, so the river's level and
  current hold out to the polygon's outline over the bed the map build carves flat to the river's
  floor; its gravel bars stand dry 0.3 m over the build's surface until a spate tops them. Its
  waterways are every piece with a sample inside it, a tributary running in too, which `settle`
  brings to the river's level where they meet: 4 m from the Fosso di Tufo's mouth in the Aulella's
  polygon by Argigliano the water is the Fosso's, whose 0.86 km² lift it 0.18 m from the mean flow
  to a spate, while the Tassonaro's 17.7 km² at the mouth lift theirs 0.92 m, so there it stands
  0.80 m under the Tassonaro's in a spate. Each reach is cut where it crosses the polygon's edges
  and only its parts inside, 1 m long at least (`IN_POLYGON`), hold the polygon's water (`insideOf`,
  as the map build carves it, issue #20): read on a waterway's whole course, a ditch on the terrace
  beside the Magra's polygon on the plain (1070845492), 259 m off outside it, held the polygon's
  water at (−15744, −4608) at 8.6 m, 7.3 m over the Magra's and 2.6 m deep, and two streams mapped
  to end on its outline, which rounding left 0.1 m inside it, held the floodplain round them at
  3.2 m, 1.9 m over the river. On a 16 m lattice of the Magra's and the Vara's polygons on the plain
  below 15 m, 5,173 points hold water at the mean flow, 8 of them more than 1 m over the rivers
  (2.24 m at most): the Calcandola's, 375205186's and 238380857's own water falling into the Magra's
  polygon. The way to the bank is square to the reach, as on a line: an edge of the polygon may be
  another polygon's of the same river (the Savio is 12 of them in Cesena).
- **In a lake** (`Area.level`): still water at its level, whatever the rivers carry, with no
  current; the way to the bank is toward its nearest shore. A lake wins over a stream through it.
  Its bed shelves 0.1 m a metre from the shore, 3 m deep at most: the lake by the Solco di Equi is
  1.5 m deep in its middle, the Bozzetti pond 0.5 m, Lago Fario 2.98 m.
- **In the sea** (`Area.level` 0, `SEA_LEVEL` in `channel.ts`): still water at 0 m, as a lake is,
  over the sea floor the map build carves from Regione Liguria's survey of it, 9.60 m deep at the
  median of the coast test region's sea cells and 16.0 m at most
  ([map.md](map.md#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)), its edge
  OSM's coastline ([map.md](map.md#3-features-featurests)). The build cuts it into a piece per
  tile, each the tile's square cut to the map's bounds, so a piece's ring runs along tile lines and
  bounds where the sea goes on: those edges are cuts, not shore (an edge along x or y = k × 2000 m,
  or along the bounds; `isCut` in `rivers.ts`, for any still water: the L test region's bounds cut
  the lake by the Solco di Equi at x 2400, and a swimmer there heads for its shore, not the cut).
  The way to the bank is toward the nearest coast of any sea piece the point's tile holds
  (every piece within 32 m of the tile, whole), islets included; where none holds any coast, the
  nearest edge of the point's own piece. An edge that closes a river or a lake of the tile across
  its mouth is no coast either (`coastOf`: the water's area lies 0.5 m off the edge's middle on its
  land side, as the build's shore line has it,
  [map.md](map.md#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)), as the water
  goes on into the river there: 20, 60 and 120 m out from the middle of the Magra's closure a
  swimmer headed north across it into the river, whose bank sent it back out to sea, and slid
  along the mouth between the two; it now heads west, for the shore and the jetty west of the
  mouth (banks (−0.92, −0.40), (−0.99, −0.13) and (−0.97, 0.24)). On the coast test region, of the
  17,919 points of a 25 m lattice (on the multiples of 25 m) over its sea, every one heads for the
  whole map's nearest coast, its closures left out (within 0.5°), the 207 more than 2 km out too;
  92 of them had the Magra's closure nearest (2026-11-17). Before the cuts were told from the
  shore, 3,823 of the 17,749 points of a like lattice (21.5 %) headed for the nearest coast, and
  some swam straight away from it, for a cut 12.5 m off. A tile that holds a sea piece but not the
  river polygon past its mouth keeps the closure as coast: the coast test region's 3 southern
  tiles and −5_−7 keep the Magra's 2 edges, the nearest coast of no point of the lattice there.
- **Where a river meets the sea** no river stands under the sea's level: its level is the larger of
  its bed plus its depth (stage × q^0.353) and 0 m, so at its mouth the sea holds it up at 0 m at
  low flow and a spate lifts it over. Where the sea holds it up the same flow runs through the
  deeper water slower, at the mean speed × (its depth at that flow / the water's depth over the
  bed). Inland every bed lies above 18 m and nothing changes: the lookups at every vertex of
  Lunigiana's water and at points up to 6.1 m either side of it, and on a 2 m lattice over its lakes
  and river polygons, at five flows (0 to 3.3 m³/s per km²) and both floors, 36,998,350 of them,
  answer to the bit as before, as do Cesena's 1,743,660 (2026-11-17). On the coast test region the
  Magra's bed lies 3.2 m under the sea's level at its mouth (its last vertex's baked bed, the sea
  floor there, −3.225 m), and the canals of the coastal plain, beds under 0 m too, stand at 0 m.

| Where | at 1 m³/s (Soliera) | 9 m³/s, the mean | 21 m³/s | 125 m³/s, a spate |
|---|---|---|---|---|
| Torrente Lucido below Monzone station (34.8 km², 14 m, 1.9 %) | 0.07 m, 0.18 m/s | 0.22 m, 0.46 m/s | 0.36 m, 0.69 m/s | 0.96 m, 1.55 m/s |
| Torrente Aulella at Gragnola, above the Lucido's mouth (59.6 km², 12 m, 1.1 %) | 0.10 m, 0.23 m/s | 0.35 m, 0.62 m/s | 0.55 m, 0.91 m/s | 1.46 m, 2.04 m/s |
| Torrente Caldanella at Equi (10.9 km², 8 m, 2.3 %) | 0.05 m, 0.14 m/s | 0.16 m, 0.35 m/s | 0.26 m, 0.53 m/s | 0.69 m, 1.19 m/s |

At the mean flow 95 % of the 2 m streams' 464 km and 99 % of the 4 m streams' 420 km carry water
(a catchment over 0 km², 2026-11-07; 425 km until the Torrente Pesciola's 5.3 km became a 6 m
wooded torrent; 95 % of 320 km and 99 % of 297 km before Fosdinovo's part, 93 % and 98 % on
lucido alone); the rest are headwater gullies, dry as real ones are.

## People and animals in the water

`Wade` (before the movement systems) gives every person on foot and every animal standing in a
river, a stream, a lake or the sea the saved `InWater` component, `swimming` once it is off its
feet, and takes it away on dry ground.

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
- **Afloat** (`feetAfloat`, `swim.ts`): a swimmer's footing, the level it meets cars and others at
  and the camera stands at, is where its feet hang, 0.7 of its height under the surface (the depth
  that lifts it off them), never under the bed; wading, it is the bed (`FindFooting`). So in deep
  water it meets a car afloat beside it: in Lago Fario's 2.94 m the player's feet hang 1.25 m under
  the surface, 1.69 m over the bed, and a Panda afloat beside him, its wheels' ground 2.38 m over
  the bed, is 0.69 m from them. While a swimmer's level was the bed, a car afloat in water deeper
  than about 2.4 m stood more than 2 m over it, out of reach, and drifted through every swimmer
  there, and the camera, which stands at the player's footing, looked at the bed under him: 2 km
  off Marinella's beach, 9.9 m under the surface, with the swimmer 215 px up the 720 px screen.
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
  stamina. Put in the sea south of Marinella's beach on the coast test region, at (−9072, −14600),
  1,349 m from the coastline over 9.4 m of water, and heading north, the player swims 1,626 m in
  1,807 s (0.9 m/s), finds his feet 1.06 m deep, wades the last 39 m in 99 s and walks out at
  1,906 s, 32 minutes of play (2026-11-17, the map 4c1568c7a21b5b71; the build since,
  2a653db1f28d317e, moved only the walk graph by the Magra's mouth, which the player's swim does
  not read).
- **Keeping out by choice** (`walkDry`). People and animals keep to the walk walls they meet on
  their footing's level like the player, but one still dry takes no step into the water unless it
  flees: it stops at the water's edge where the level stands now, so a rising river pushes it back
  and it can walk off a river's dry gravel bed. In the water, they carry on as they were where it is
  slack and below their knees (under 0.3 of their height deep and 0.25 of their hold), so a cow
  wades a trickle to its pasture; deeper or faster, they head square across for the nearer bank. A
  witness in the water never stays by a body: it runs
  ([gameplay.md](gameplay.md#witnesses-and-the-dead)).

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

- **Getting in** keeps to the player's level ([gameplay.md](gameplay.md#entering-stealing-carjacking-exiting)):
  the ground under the car's wheels within 2 m of his `Footing`, which wading is the bed and
  swimming where his feet hang (0.7 of his height under the surface). A
  car standing on the bed is in reach from the water beside it, and from the bank where that stands
  within 2 m of the bed under it: 0.6 m off the side of a Panda at the water's edge, every 4 m along
  both banks of Lunigiana's water where no walk wall lies between, at 98.8% of 32,186 places by the
  rivers 6 m wide or more and 99.9% of 478,539 by the streams (2 m off, 96.1% and 97.9%; on
  2026-11-06, before Fosdinovo's part). From a
  steeper bank the player wades down to it. Afloat, its wheels' ground rises with the water, 1.98 m
  over the bed for a Panda in 2.5 m of still water and 2.11 m for an Ape (the truck stays down in
  3.5 m), so a swimmer gets into a car afloat in water of any depth, a car on the bed only while
  his feet hang within 2 m of its wheels' ground.
- **Touching** keeps to the same level ([gameplay.md](gameplay.md#knockdowns-deaths-and-score)): a
  car afloat strikes or shoves a wader or a swimmer where its wheels' ground stands within 2 m of
  their footing, in water of any depth.

AI drivers keep to their lanes; a car shoved into a river is carried off like any other.

## Walls

Water stops neither feet nor wheels. The map build traces the water's cells (within max(w/2, 2) m
of a centreline, and the lakes', river polygons' and the sea's cells, not on a road, but a sea
cell whose ground at its centre stands over 0 m: a breakwater's rock raised in it, a shore cell's
dry half) as their own walls, the shore, and `wallsNear` answers four kinds:

| Kind | Walls | Who keeps to them |
|---|---|---|
| `walk` | buildings, slopes over 35°, cliffs, walls, the play area's outline, trunks, the low space under a road deck (on the ground's level, under 1.8 m of headroom) | everyone on foot and every animal |
| `land` | `walk` and the shore | where people and animals spawn; a follower's way to its leader |
| `drive` | `walk`'s but those under the decks, slopes over 25° off the roads, guard rails, the breakwaters' and groynes' outlines, parapets (on their deck's level), the low space under a road deck (on the ground's level, under 2.65 m of headroom), road-exit caps | every vehicle's physics |
| `traffic` | `drive` and the shore | AI drivers' lanes (`fitLanes`), where vehicles spawn |

Traffic's dead ends and the spawns are worked out against the water's edge, as before, so the road
graph, the parked spots and the player's spawn are the same; a parked car's box and the player's
spawn also keep out of the lakes, the river polygons and the sea, whose shore opens where a road
runs beside them, and a parked car off a beach's sand.

## How it looks

- **The level**: each river and stream is drawn as a ribbon over its whole bed (twice
  `Water.bed`), with a darker channel 0.45 of the water's width down the middle of the 8 m ones and
  wider, laid on its bed. Each vertex carries its `stage` and its `flow` (the way down and the mean
  speed per unit); the water shader lifts it by `stage` × q^0.547, the uniform `uRiverStage`, so the
  surface stands where the sim's is, and the terrain above it hides it: in a spate the water spreads
  over the gravel. Each vertex also carries how far its bed lies under the sea's level (`held`,
  `heldBySea`), and it rises at least that far, so a river meets the sea at 0 m as the sim has it,
  its streaks slower by the same share.
- **Lakes, the sea and river polygons** (`render/water.ts`): a quad over each cell of the area (its
  centre inside, as the land cover paints it), its corners on the cell's nodes. A river polygon's
  lie on the bed of its nearest waterway with that reach's `stage`, `flow` and `held`, so the shader
  lifts them as it lifts the ribbon, to where `waterAt` has the level (0.05 m over the bed, over the
  ribbon and a wide river's deep channel, so where the area's water half covers a quad of them it
  stays under); a lake's lie at its level and the sea's 0.05 m over it, as a river polygon's lies
  over its bed, each carrying how deep the water stands over its node (`still`), which lifts
  nothing. So the Magra's polygon, held up to the sea at its mouth, meets the sea flush at the 98
  nodes they share: drawn at 0 m, the sea stood 0.05 m under it, and from the sea's side the view
  saw the floor through the step, a line of light and dark dashes along the mouth. A river's
  ribbon leaves out each quad their water covers whole, and one reaching the sea runs on under its
  edge. The terrain above the level hides the water, so the shore is where they meet. Past the
  map's edge the edge cells' water goes on over the apron at their nodes' depth, so the sea runs on
  192 m beyond the play area over the edge's sea floor (10.0 m deep at x −9072 on the coast test
  region's south edge); past the apron the screen shows the clear colour, dark forest green, and
  the minimap and the full map their background, the same green, where the sea would go on (the
  user's choice, 2026-11-17).
- **The colour**: the water's own colour (and the darker channel's) shows from 0.05 m of mean depth
  and fully from 0.7 m; shallower, it is the limestone pebbles seen through it, tinted 0.6 of the
  way to the water's green (TUNED by eye), so an ankle-deep torrent reads as wet gravel with the
  current on it and a spate as a river. A lake darkens to the deep water's colour from 0.7 m deep
  to 2.5 m (TUNED by eye). The sea, in its shallows' colour (`PALETTE.seaShallow`, measured a few
  metres out), darkens to the deep sea's (`seaDeep`, measured 7–8 m deep) from 0 to 6 m deep, and
  foams (`foam`) wherever it is under 0.3 m deep and nowhere deeper: a crisp band along the
  waterline, stair-stepped as the game's pixels are, within the cells it crosses (the user's
  choice, 2026-11-17, over a soft edge fading from 0.15 m).
- **The estuary**: river water the sea holds up takes the sea's colours by its depth, as far as the
  sea holds it (each vertex's `sea`, the sea's own 1: `seaShare` in `render/sky/water-shader.ts`),
  so the Magra's mouth reads as one water with the sea (the user's choice, 2026-11-17). The share
  grows smoothly with how far the bed lies under the sea, none to 0.5 m and whole from 1.2 m (TUNED
  by eye and to the coast test region's beds): it follows the bed down a reach, so no seam crosses
  the river where its bed sinks under the sea, and the plain's ditches, their beds 0.07–0.50 m under
  the sea for kilometres inland (the Fossa Maestra, the Fosso Acque Medie and the Fosso della Casina
  among them), keep the river's look whole down to the sea; the Parmignola, its bed 0.2–1.2 m under
  the sea for its last 1.4 km, takes up to 0.98 of it, 0.93 at its mouth. A river polygon takes it
  as its own waterway does there (the reach of its piece whose bed lies deepest, the one that runs
  on to the sea), not by the nearest reach as its level does: a stream joining it would split its
  water where its reach comes nearest, as the Fosso Acque Medie's did the Magra's by Fiumaretta, a
  straight edge across the estuary. The Magra's polygon takes the whole of it but within 128 m of
  the coast test region's north edge, where its bed rises to 1.0 m under the sea (0.80 there). Held
  river water never foams: the foam is the surf on the sea's own shore.
- **The current**: streaks 1.6 m long and 0.3 m wide carried downstream at the water's speed
  (`uRiverSpeed` = q^0.453), two phases 2 s apart dissolving into each other cell by cell; 2 % of
  them show on still water, up to 30 % at 3 m/s and over (TUNED by eye).
- **Swimmers**: a person swimming crawls (two frames, a stroke every 1.25 s), floating with its
  feet 0.66 of its height under the surface, so the water reaches its shoulders; an animal paddles
  with its trunk half under; the down and the dead float (a person 0.15 m under the surface, an
  animal by half its flank). Nothing floats under the bed, the ground at grade the water lies on
  (`atGradeY`): a swimmer's footing hangs in the water, and where the water under a deck is deep
  the deck is the level nearest it, so floating over the ground on its footing's level drew a cat
  swimming under the pier off Bocca di Magra on the deck. Wading, a body stands on the bed and
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
| `src/sim/water/__tests__/channel.test.ts` | the rail bed within 4 km of Monzone station dry where a stream crosses it, at the mean, in a spate and in the 30 years' highest flood; streams within 1 km of it set 2 m under the ground (a road's fill over the channel) running in a culvert under it, the ground dry in a spate (red with the bed read on the fill) |
| `src/sim/water/__tests__/channel.map-test.ts` (`pnpm test:map`) | the whole rail bed of the map dry where a stream crosses it, at the same three flows |
| `src/sim/water/__tests__/swim.test.ts` | the hold (an adult's 1.2 m²/s, a child's 0.4), off the feet and back on, a swimmer's feet 0.7 of its height under the surface and never under the bed, wading's slowing, a sprint slowed to a wade by knee depth |
| `src/sim/__tests__/water.test.ts` | the Lucido's depth and current at the mean and in a spate; the player wading across, swept, swimming and out, and dry once he gets into a car in the water; people and animals swimming out and the dead drifting; a calm dog stopping at a spate's edge; a Panda holding in the Lucido and floating off in a spate; buoyancy at 0.3 and 0.7 m; a Panda ploughing to a third slower in a second of ankle-deep water, the truck hardly; stalling; a bridge keeping a walker dry, on its centreline and on every verge over the water of the bridges within 2 km of Monzone; the rivers rising under rain and falling back; determinism and a save mid-swim (determinism in `water.long-test.ts`) |
| `src/tools/__tests__/catchment.test.ts` | a braid's arms sharing the river's area at the fork and adding back to it at the rejoin; an unlisted tile's nodes (an L's notch) never read, outlets as the grid's edge is, so the ground beside them drains out and they bring no area; a river cut short of the grid's edge draining on down the water beyond the cut, not down a stream beside it; water coming in at the grid's edge no outlet for the water it joins; an inflow from beyond the grid carried down its stream from its node, and only there |
| `src/sim/water/__tests__/rivers.test.ts` | over a synthetic river polygon with an island and a lake a stream runs through (`waterIndex`): the river's level and current across the polygon, the island dry, the river's own bed beyond it; the bank square to the reach either side of the seam between two polygons of one river; the lake still at its level, its bank the nearest shore, winning over the stream; a water area's surface as the render draws it; a river polygon holding the river's water 14 m from a ditch's course outside it, and the ditch's own on its course inside (red with the nearest reach read on the whole course); over a sea cut into pieces along a tile line and the map's bound, the bank toward the coast across the cuts, from a piece with no coast of its own too, an islet's shore a shore, and the nearest edge from a piece alone; an edge closing a river polygon across its mouth no coast, a swimmer off the mouth heading for the beach beside it (red with the closure a coast); a stream with its bed under the sea's level standing at 0 m, slower by the depth the sea holds it at, and running as any river once a spate lifts it over |
| `src/sim/__tests__/water.test.ts` (the lakes) | the player swimming in the lake by the Solco di Equi and out; a Panda afloat there, drifting under 1 m with no current; in Lago Fario's 2.94 m, the swimming player's feet 0.7 of his height under the surface and his getting into a Panda afloat beside him, its wheels' ground more than 2 m over the bed |
| `src/render/__tests__/water.test.ts`, `water-cesena.test.ts` | the Bozzetti pond one quad a cell at its level with its `still` depth; neighbouring chunks sharing their nodes (over the smallest lake by it across two chunks, found by its cells, and the Aulella's polygon); on Cesena, the Savio's polygon carried on over the apron north of the map (Lunigiana's only lake or river polygon at its bounds, a river's north of Fosdinovo's part, meets them in the north-west notch, x −11500 at y 4192–4222, where no tile is listed); `inPool` by cell; a ribbon's quad left out only under the water on all four corners, the Aulella's ribbons stopping over its polygon; a river's ribbon over a bed falling from 0.5 m over the sea to 1.5 m under it, each vertex carrying `heldBySea` of its bed and `seaShare` of that, never drawn under 0 m at the mean flow (red with the two left off the ribbon, or `held` taken from the drawn height rather than the bed) |
| `src/render/__tests__/water-coast.map-test.ts` (`pnpm test:map`, on the coast test region) | off Marinella, the sea one quad a cell 0.05 m over 0 m in its shallows' colour, the sea's whole, as deep as it stands over each node; the sea carried on over the apron south of the map at the edge nodes' depth; the Magra's polygon at its mouth drawn where `waterAt` has its level at the mean flow and in a spate, the sea holding it up; the polygon meeting the sea flush at every node they share, wholly the sea's look there (red on the sea drawn at 0 m); the polygon's share of the sea's look at least 0.75, never stepping 0.2 between two neighbouring nodes (red with the share taken from the nearest reach: 0 where the Fosso Acque Medie's comes nearest); the ribbons of the 27 pieces whose bed dips under 0 m, 41,160 vertices, 24,975 of them on 26 pieces held up by the sea, none drawn under 0 m at the mean flow or in a spate, each in `seaShare` of its hold (red with the hold left off the ribbons); a cat swimming under the pier off Bocca di Magra, 1.66 m deep, floating in the water under its deck (red with the node floated over the ground on its footing's level: on the deck, 0.91 m) |
| `src/render/sky/__tests__/water-shader.test.ts` | the water variant's lift (the flow's, at least the sea's hold, the streaks slower in the held water); the sea's colour ramp and its crisp foam under 0.3 m, on the sea's own water alone; the river's and the lake's look under each vertex's share of the sea's, the lakes' as before; `seaShare` none to 0.5 m, whole from 1.2 m, growing with no step between |
| `src/tools/__tests__/water-areas.test.ts`, `water-areas.map-test.ts` (`pnpm test:map`) | the lakes and river polygons carved ([map.md](map.md#checks-and-tools)); on both maps, the lakes' beds, levels and shores (the sea left out: its floor is its own), the dry ones, a pool all of whose nodes are its edge at its spill as the tile pass carves the lines past it (red with the lines carved once), a ring holding a cell where a cell's centre lies in it (`holdsCell`), a river polygon carved to its waterways where they run in it, not a ditch's course on the terrace beside it (red with the whole course read), a river polygon's surface falling through it and its outer edge left over its waterways' bed inside it but where a road under that bed claims it, no tree, parked car or spawn in the water; Lunigiana's sea beyond the play area under 0 m but at its coastline and where the shore raises it, with no isobath of the survey in it (`sea-checks.ts`, the coast's checks) |
| `src/sim/__tests__/water.map-test.ts` (`pnpm test:map`) | every verge over the water of every bridge of the map on the deck in a spate |
| `src/sim/map/__tests__/ground.test.ts`, `ground.map-test.ts` (`pnpm test:map`) | `waterAt` and `waterUnder`, with the ground and surface lookups, read from the tiles: round Monzone station and over the x = 0 and y = 0 seams, the same answers whichever of the 4 tiles there came in whichever order, with nothing else read; over the whole of Lunigiana, at 1,142,302 points (seeded ones, half of them by the seams, and every road and river vertex) dry, at the mean, in a spate and in a great flood, to the bit what one grid over the whole map's water answered (`water-oracle.ts`, with the sea's rules: still water's cuts no shore, the sea pieces' coast shared, its closures across a river's or a lake's mouth no coast, no river under the sea, and a river polygon's water read on its waterways where they run in it) |
| `src/sim/map/__tests__/water.map-test.ts` (`pnpm test:map`) | the rivers' widths by reach (the Lucido's, the Aulella's, the Rosaro's, the Mommio's, the Bardine's, the Bardinello's, the Pesciola's, the Taverone's, the Osca's, the Penolo's and the Magra's, from `water-sizes.ts`); catchments growing downstream with no jump at a tributary's mouth the water it joins could have given (812989995's 1.47 km² over its last segment, where the ditch it joins reads 0, may), the Lucido's 47 ± 2 km², the Rosaro's 14.7 ± 0.5 at its entry, the Aulella's 199 ± 3 at x −5300 and 313 ± 3 at its mouth, the Bardine's 65.3 ± 2; the Magra's and the Taverone's heads (420.9 and 69.1 ± 0.5), the Taverone's 82 km² 1.3 km above its mouth and the Magra's 915 at y 3900; the Vara's 552.4 ± 2 over the west edge and 605.6 ± 5 at Fornola, adding to the Magra, which leaves the play area at y −8500 with 1,618.8 ± 5 of its 1,700; the Vara–Magra confluence monotone, each water within 3 km of Fornola and every piece of the Vara meeting the water it joins at its level, none perched over its bed on the plain (red with a way ponded at its mouth left lower at its start); on the plain, the Magra's and the Vara's polygons holding their waterways' water from inside them, over the rivers by more than 1 m only a tributary's that meets them (red with the whole courses read: 213 points of a 16 m lattice); none of the outline's cuts draining a river down a side stream (the stream by Soliera, way 140780331, under 1 km², Il Canalaccio under 6, the Canale del Torchio under 5); no walk or drive wall a body in a wide river meets (a parapet on its deck's level meets none), shore walls by it, read by the outline of the lake or river polygon it runs in, points within 30 m of the play area's outline left out |
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
  deep enough to swim in but in the lakes.
- **Still lakes.** A lake keeps its level whatever the weather (no storage in the flow model), so an
  intermittent pond is always full and a stream through a lake steps to the lake's level at its
  shore. Lakes make no sound.
- **A river polygon's depth** comes from its river's channel (`Water.w`), not the polygon's width:
  where the polygon is wider than the river, the water runs deeper over it than a spate spreading
  over the gravel would. The Tassonaro's 4 m channel, draining 16.9–19.1 km² there, holds
  0.29–0.34 m at the mean flow across the Aulella's polygon by Argigliano and 1.21–1.45 m in a
  spate, and Cesena's Savio, whose catchment the map holds only 4.7 km² of (2.95 until the Cesuola
  stopped draining out of the box's south edge,
  [map.md](map.md#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)), a few
  centimetres over its polygons: of the 5,114 cells of 4 m whose centre lies in them, 60.1 %
  hold water at the mean flow and 68.0 % in a spate (`waterUnder`, 2026-11-07; 59.5 % and 67.8 %
  with the 2.95 km²).
- **Snow at one height.** The snowpack lies at 667 m; the high Apuan snow and its spring melt are
  not modelled.
- **Silent floods.** The rivers sound as they do at their usual flow ([audio.md](audio.md)),
  whatever they carry.
- **Under a bridge.** A body that walks under a bridge on the bank (not yet in the water) is taken
  to be on its deck there.
- **Engines.** An engine that stalled in the water runs again once out of it: nothing hydrolocks.
- **A still sea.** The sea stands at 0 m: no tides, waves or currents, and a river stands no lower
  than it wherever its bed lies under 0 m, up a canal too, not only at its mouth.
- **The estuary's depth.** A river polygon held up by the sea is coloured by its waterway's depth
  over its bed, the sea by its own over the ground, so where they meet the colour steps a little:
  along the Magra's mouth the polygon reads 2.56–3.23 m deep, the sea 1.3–3.5 m (its nodes on the
  closure stand on the polygon's ground, 1.3 m under the sea), a few lighter triangles along the
  closure. The full map and the minimap draw the estuary in the rivers' colour still.
- **Far out to sea.** A swimmer heads for the nearest coast of the sea pieces its tile holds
  (those within 32 m of it); more than a tile's width out, where none of them has any coast, it
  heads for the nearest edge of its own piece, a cut, and finds the coast from the next tile. The
  coast test region has no such water.
