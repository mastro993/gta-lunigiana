# Map standards

Checks for a change to the map pipeline (`src/tools`), the map code (`src/sim/map`) or its inputs
(`data/raw`), on top of the steps in [CODING_STANDARDS.md](../../CODING_STANDARDS.md). CI builds the
maps from the pinned inputs, checks that two builds match and runs `pnpm check` on them, but it
never compares a change's map with the map before it, so these runs are yours.

## Every map change

- Run `pnpm map` twice: the two print the same build hash, and the gunzipped files are
  byte-identical (`for f in src/sim/map/monzone.bin src/sim/map/monzone/*.bin; do gunzip -c $f;
  done | shasum`). Keep the build before (`cp -R src/sim/map/monzone.bin src/sim/map/monzone
  /tmp/before/`): `pnpm map-diff /tmp/before/monzone.bin src/sim/map/monzone.bin` says what a change
  moved. When a change may move only some categories, name them: `pnpm map-diff … --except trees`
  still prints the trees' differences but exits 0 only when nothing else differs (a reorder of the
  walls or the trees counts as a difference: the physics resolves contacts in wall order).
  Buildings that differ only in their id print as one `ids:` line under buildings, and a farm on
  one is no difference: a survey's ids encode its source and section (`survey-ids.ts`), so a change
  to that encoding shows as that line alone, which `--except buildings` accepts.
- Run `pnpm test:map` (or `pnpm check`) on the rebuilt map: the checks over every tile and feature
  of the map live there, not in `pnpm test`, and so do the L test region's (`pnpm maps` builds it
  into `test-maps/`; without it they are skipped, but fail in CI, which builds it).
- Draw the changed area with `node src/tools/preview-map.ts` (a top-down PNG in `.research/`) and
  look at it.
- A rebuilt map shifts pinned positions: test coordinates, bot waypoints and screenshot spots.
  Find them again by geometry.
- Place hand-made tables (`STONE_CORES`, `LANDMARKS`, stream widths, district discs) on
  orthophotos and OSM nodes, with a comment saying how.
- `data/raw` is pinned by `data/raw.lock.json`; `pnpm fetch-raw` restores it. Fetch again
  (`pnpm fetch-osm <part>`, `pnpm fetch-rt <part>`, `pnpm fetch-lig <part>`) only to change the
  inputs on purpose: OSM returns current edits, so the map moves. Then run `pnpm pin-raw` and
  commit the lock, or CI's `pnpm fetch-raw` fails. Ask the user before each `pnpm pin-raw`: it
  publishes the files as release assets of the public repository.

## Data sources and requests

- **Licences**: accept CC BY and the ODbL (OpenStreetMap's). Ask the user before any other
  share-alike source (CC BY-SA and the like), and leave out non-commercial or unlicensed data.
- **Records and credits**: record each accepted and rejected source, with the reason, in
  [docs/map.md](../map.md). Credit each accepted one in the README, in the three credit blocks of
  `index.html` (the HUD's, the settings dialog's and the title card's) and in the release notes
  `pin-raw` writes (`NOTES` in `src/tools/pin-raw.ts`), keeping Regione Toscana's wording verbatim.
  Where two of a source's own statements name different licences (the CTR 1:2000's archive says CC
  BY 4.0, the cartoteca's GetFeatureInfo CC BY 3.0 IT), record both and credit the one its archive
  ships: the dataset's own licence file is what it is released under.
- **Overpass** is often overloaded: the pipeline uses the OSM API's `/map` tiles, and the
  kumi.systems mirror serves one-off queries.

## New map part or biome

Follow issue #3 (the extent, the order of parts and the runbook), plus the checklist and
acceptance criteria in the part's issue (#17–#26) or the biome's (#13–#16).

- The runbook's tools are in `src/tools` and `package.json` ([Adding a
  part](../map.md#adding-a-part)): `footprint-check`, `rt-index`, `pick-sheets`, `pick-lidar`,
  `coverage`, `ortho`, `playtest.ts` and `map-diff`. `region.ts` holds the regions (Lunigiana,
  Cesena), their parts' rectangles and masks (`checkMask` throws on a bad one), and `play-area.ts`
  the outline of their union, which the map is clipped to and walled along (issue #7). A part's
  mask comes with the part's own issue (#17 on); a part in Liguria runs `fetch-lig` (#12) before
  `fetch-rt`. When one is missing, name the issue that adds it and ask the user before building it.
- The pick tools only print by default: run `--write` to change a manifest on purpose, then
  `pnpm fetch-rt <part>`, `pnpm map`, and `pnpm map-diff` against the map before; `pnpm pin-raw`
  then pins the part's new inputs. A part's older surveys (`ctr2009`, `ctr10k`, `dbt2k`) go into
  its manifest by hand from `rt-index`'s lists ([Adding a part](../map.md#adding-a-part)); list a
  CTR 1:10 000 section only where no finer survey maps the part's buildings, since its mapped area
  drops every OSM building in it.
- A part's OSM extract (`pnpm fetch-osm <part>`) holds the ground of its tiles and the ground its
  box adds to the earlier parts' tiles (`partGround`), as `fetch-rt` completes their terrain tiles:
  the trees cover every listed tile in the box, and keep off OSM's roads, buildings, water and rail
  only where some extract holds them. The earlier parts' extracts stay as pinned, since fetching
  one again brings OSM's current edits into its play area; `fetch-osm.test.ts` checks that the
  lock's extracts hold every listed tile's ground in the box.
- A failed scale check (tile size, build memory, first frame, heap) is engine work first.
- Every bridge's deck keeps the ground out of it: `deck-ground.map-test.ts` reads every road and
  rail deck of Lunigiana, Cesena and the L, and fails where the terrain stands within the 0.9 m slab
  under a deck's top more than 4 m in from its outer ends (a joint with the next piece of the bridge
  is none), or more than 0.05 m over its profile nearer them, but at its abutments ([Ground under the
  decks](../map.md#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)).
  The build lowers the ground (`deck-ground.ts`) for every deck from the shipped lines alone, so a
  failure on a new part is the data's (a bridge's ends or profile, two decks at odds) or the pass's:
  fix that for every deck alike, never with an exception for one bridge or one part.
- Every bridge's parapets hold on its deck's level and only there: `parapets.map-test.ts` reads
  every drivable bridge of Lunigiana, Cesena and the L, and fails where a car on the deck meets no
  wall and no road on the deck's level (within 2 m of its top) reaches the parapet, where a car on a
  drivable road reaching it meets a parapet (a junction on the deck closed, a road under it walled
  off by a parapet's wrong level), or where a wall with no level stands on the parapet over a road
  under or over the deck ([Collision
  walls](../map.md#10-collision-walls-wallsts-parapetsts-deck-wallsts)). The build (`parapets.ts`)
  opens and levels every parapet from the shipped roads alone, so a failure on a new part is the
  data's (a bridge's or a road's profile, a junction's roads at odds by 2 m or more, a barrier drawn
  along a deck's edge) or the build's: fix that for every bridge alike, never with an exception for
  one bridge or one part.
- Nobody comes up onto a bridge's deck from under it: `under-decks.map-test.ts` and its Cesena and L
  twins walk the game's own walker (`footZ`, `walkBy`) under every road deck, from where there is
  room to stand (2.7 m under its top) toward the ground near its top, drive a Panda (`groundZ`,
  `moveCar`) the same way under every drivable one, from where there is room for the tallest vehicle,
  and walk every road meeting its ends onto it, on its centreline and its verges, and drive it, and
  fail where the walker or the car comes up onto the deck or where a wall with a level shuts an end
  that led onto it ([Walls under the
  decks](../map.md#walls-under-the-decks)). The build (`deck-walls.ts`) walls every road deck from
  the shipped roads and the ground as lowered under the decks alone, so a failure on a new part is
  the data's (a road at grade meeting a deck's level with no junction between them, a deck's or an
  approach's profile at odds with the ground at its end, ground left near a deck's top) or the
  pass's: fix that for every deck alike, never with an exception for one bridge or one part.
- What stands on a bridge stays apart from what runs under it:
  `src/sim/map/__tests__/levels.map-test.ts` reads every crossing of two ways on two levels with no
  node in common on Lunigiana, Cesena and the L (a road, path or rail bridge over a road, a path,
  steps or the rail; a road, a path or the rail over a tunnel; rail over rail left out), and fails
  where the way above stands 2.5 m or less (the level rule's 2 m, `LEVEL`, and a 0.5 m margin) over
  the one below between points of the two within 3.99 m of each other and of the crossing, but at
  the Cesena crossings it lists by OSM id, each of which must still fall short ([Checks and
  tools](../map.md#checks-and-tools)). The level rule (`onLevel`) is code, so a failure on a new
  part is the data's (a deck too low over what it crosses, a footbridge or an underpass between its
  ends at the terrain's level) or the profiles' pass's: fix that for every crossing alike, never by
  listing a new part's crossing.
- A driver reads its way on its level onto and off every bridge and tunnel:
  `src/sim/map/__tests__/joints.map-test.ts`, `joints-cesena.map-test.ts` and `joints-l.map-test.ts`
  stand a driver on its lane up to 40 m before every joint where a Panda drives from a road onto or
  off a bridge or a tunnel, or from one bridge way onto the next, with no junction and no turn of
  30° or more, and fail where it reads a Panda standing in its lane past the joint off its level
  (`onPathLevel`, `joint-checks.ts`), but at the mouth of Pieve San Lorenzo's underpass the
  Lunigiana test lists, which must still fail ([Checks and tools](../map.md#checks-and-tools)).
  The reading follows the map's surfaces, so a failure on a new part is the data's or the profiles'
  (a joint whose two profiles meet a step apart, a deck whose start stands off its approach): fix
  that for every joint alike, never by listing a new part's joint.
- Every road tunnel is drawn at its floor under the hill, and no road runs into a bank:
  `src/render/__tests__/tunnels.map-test.ts` and its Cesena and L twins check every road in a
  tunnel drawn at its floor along its whole line, its bore's dark walls under the hill along both
  its sides (none in a building passage), its mouths baked as `mouthsOf` finds them, each portal
  facing out of the hill and each underpass's head wall facing out of its bank at the bore's width
  and clear height with its top under that bank, either clear of every other road and the track,
  an open mouth with none and a reason for it found again by geometry (`whyOpen`: a house at the
  way's level over it by the mouth, the ground over it lower than a head wall, or another road or
  the track in the wall's room; any other open mouth fails), and the chunks round it as a whole-map
  build cuts them, and pin each region's counts (roads in tunnels, passages, metres, wall triangles,
  mouths, portals, head walls and open mouths by reason) ([Road and rail
  profiles](../map.md#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)).
  A new part changes the counts: look at its tunnels drawn (its new head walls and open mouths
  in the browser too), then pin the new counts. A failure of the checks themselves is the data's (a
  tunnel's profile over the hill, a mouth's road, a ramp the ground does not hold) or the build's
  (the mouths' bake, `portals.ts`, `tunnel-lines.ts`, `bores.ts`): fix that for every tunnel
  alike, never with an exception for one tunnel or one part.
- The shadow box holds its size through a turn over the region's ground:
  `src/render/__tests__/shadow-box.map-test.ts` and `shadow-box-cesena.map-test.ts` turn the view
  a whole turn each way at 8 and 6 texels a metre at Lunigiana's and Cesena's steepest fall,
  deepest gully and flattest ground (found by the terrain's shape on the coarse lattice, so a new
  part may move them), and fail where the box changes size more than 20 times a turn, on two frames
  in a row more than once or where the view did not force it, back to the size it held two frames
  before (a strobe), or below what the fit asks or more than a step over it
  ([Rendering](../architecture.md#rendering)). The box's steps are render code
  (`src/render/shadow-box.ts`), so a failure on a new part's ground is fixed there for every spot
  alike, never by loosening the bounds for one region or one part.
- A car's wheels and a walker crossing a bridge stay on its deck:
  `src/render/__tests__/ground.map-test.ts` crosses every drivable bridge of Lunigiana both ways
  from 12 m before it, each wheel keeping to the level of its last contact as the drive physics
  does and the walker to its footing as `FindFooting` does, drawn where the renderer draws it, and
  fails where the wheels or the walker stand 0.5 m or more off the deck's top, but on a bridge
  starting at a tunnel's mouth or the play area's edge ([Footing](../gameplay.md#footing)). A
  failure on a new part is the data's (a bridge's ends or profile off its approach, two spans at
  odds where they join) or the ground's (`groundZ`, `footZ`, the decks' verges): fix that for every
  bridge alike, never by skipping one.
- Adding a part, or growing the built terrain's box (`BOUNDS`) with it, moves no lattice tree and
  changes no tree's id (its look's seed): the lattice starts at the region's fixed `anchor`
  (`region.ts`), never at the box, and a tree's id is its lattice cell's number. Never move an
  anchor: every tree would move and look different. A bank tree keeps its 9 m step along its OSM
  way, but stands off its piece's bed, so it moves where the outline newly cuts a way sized by its
  piece (the Lucido, the Caldanella, Cesena's measured rivers: [Trees in
  map.md](../map.md#12-trees-spawns-districts-treests-spawnsts-districtsts)). Trees cover the
  region's tiles, beyond the play area too, 1 m inside the box; `pnpm map-diff` names a tree that
  keeps its spot but not its id (`ids:` under trees). Each tile stores its trees in whole metres
  from a point 100 m south-west of its corner. A survey's building keeps its id too: the id is its
  source, its section's name and its record's own number (`survey-ids.ts`), never an index over the
  map or a cut of the box, so `ids:` under buildings stays empty.
- Growing the box alone, with no new part beside the earlier ones, moves no bit of their terrain,
  nor of their land cover more than 50 m in from their old edge, nor of a baked table farther in
  than a count over the buildings across that edge reaches: the box no longer clips them, so it
  keeps each whole or drops it (they reach up to 19.2 m in on the 3x), and the walkers' residents
  count the homes within 60 m of a walk edge's midpoint (`EDGE_REACH`), a farm's rural flag those
  within 140 m (`RURAL_REACH`). The DTM's projection lattice, every terrain and cover lookup, the
  terrain's colour patches, the owls' squares and the ambience blocks count from the anchor too.
  `x3-region.map-test.ts` checks the terrain, the land cover, and the lamps, water beds and parked
  spots' rests on the 3x test region against lucido alone (`lunigiana-lucido`, as the shipped map
  is no longer lucido). What the grown box alone does change (the place, the catchments, the
  tiles' `zmin` and `zmax`, the walls near the old edge, the buildings, areas and farms across it,
  and the residents of the walk edges near it: on the 3x, 13 of lucido's, their midpoints up to
  54.5 m in, 7 of them crossing `PEOPLED`) is in [What growing a region
  changes](../map.md#what-growing-a-region-changes).
- A part's own data moves more, near it, since roads, rail and rivers are carved and fitted whole:
  the place and the catchments; terrain nodes within a few hundred metres of the seams and along
  the lines the seams no longer cut; land-cover cells, parked spots, their flags and the lanes by
  the seams; walls and buildings along the old edge; the tiles' `zmin` and `zmax`; the railway; and
  trees in the strip along the old box edges. [What growing a region
  changes](../map.md#what-growing-a-region-changes) counts each for each part (Fivizzano moved
  9,422 of lucido's 4,879,451 terrain nodes, up to 12.3 m, all north of y 0). Keep that list true
  when a part shows more, and treat a move far from every seam and from every line the part makes
  whole as a bug.
- A tile is at most 0.7 MB gzipped (issue #3's scale checks; today's largest is 0.61 MB, Lunigiana's
  2_1 by Pieve San Lorenzo with the vectors round it, 608,135 B, the build prints it, and
  `src/__tests__/maps.map-test.ts` fails past it).
- A change to the code that bakes the global file's tables (lanes, parking, water beds, farms,
  lamps, and in `derived` the bells, the walkers' residents, the farms' centres and the road
  tunnels' mouths) needs both `pnpm map` and `pnpm map --region cesena`: `bake.map-test.ts` and
  `cesena-bake.map-test.ts` (`pnpm test:map`) fail until each is baked again, and `bake.test.ts`
  and `cesena-bake.test.ts` (`pnpm test`) already for the parked spots, water beds and farms within
  1 km of Monzone station and of Cesena's start. Some of that code is render code: the mouths'
  portals and head walls take their shape and room from `src/render/portals.ts`,
  `src/render/portal-clear.ts`, the tunnels' lines and the houses over them from
  `src/render/tunnel-lines.ts` and the bore's size from `src/render/bores.ts` (`tunnels.test.ts`
  bakes four tunnels' mouths again in `pnpm test`). A change to the full map's look
  (`src/render/map-style.ts`, the palette, `src/tools/overview.ts`) likewise needs the maps built
  again: `overview.map-test.ts` fails on a stale overview.
