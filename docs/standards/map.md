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
  (`pnpm fetch-osm`, `pnpm fetch-rt`) only to change the inputs on purpose: OSM returns current
  edits, so the map moves. Then run `pnpm pin-raw` and commit the lock, or CI's `pnpm fetch-raw`
  fails. Ask the user before each `pnpm pin-raw`: it publishes the files as release assets of the
  public repository.

## Data sources and requests

- **Licences**: accept CC BY and the ODbL (OpenStreetMap's). Ask the user before any other
  share-alike source (CC BY-SA and the like), and leave out non-commercial or unlicensed data.
- **Records and credits**: record each accepted and rejected source, with the reason, in
  [docs/map.md](../map.md). Credit each accepted one in the README, in both credit lines of
  `index.html` (the HUD's and the title card's) and in the release notes `pin-raw` writes (`NOTES`
  in `src/tools/pin-raw.ts`), keeping Regione Toscana's wording verbatim.
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
  mask comes with the part's own issue (#17 on), and `fetch-lig` with #12. When one is missing,
  name the issue that adds it and ask the user before building it.
- The pick tools only print by default: run `--write` to change a manifest on purpose, then
  `pnpm fetch-rt`, `pnpm map`, and `pnpm map-diff` against the map before; `pnpm pin-raw` then pins
  the part's new inputs.
- A failed scale check (tile size, build memory, first frame, heap) is engine work first.
- Adding a part, or growing the built terrain's box (`BOUNDS`) with it, moves no lattice tree and
  changes no tree's id (its look's seed): the lattice starts at the region's fixed `anchor`
  (`region.ts`), never at the box, and a tree's id is its lattice cell's number. Never move an
  anchor: every tree would move and look different. A bank tree keeps its 9 m step along its OSM
  way, but stands off its piece's bed, so it moves where the outline newly cuts a way sized by its
  piece (the Lucido, the Caldanella, Cesena's measured rivers: [Trees in
  map.md](../map.md#12-trees-spawns-districts-treests-spawnsts-districtsts)). Trees cover the
  region's tiles, beyond the play area too, 1 m inside the box; `pnpm map-diff` names a tree that
  keeps its spot but not its id (`ids:` under trees). Each tile stores its trees in whole metres
  from a point 100 m south-west of its corner. Nor does it move a bit of the terrain, the land
  cover or the baked tables of the parts already built: the DTM's projection lattice and every
  terrain and cover lookup count from the anchor too. What it does change there (the place, the
  catchments, the walls and buildings along the old edge) is in [What growing a region
  changes](../map.md#what-growing-a-region-changes); keep that list true when a part shows more.
- A tile is at most 0.7 MB gzipped (issue #3's scale checks; today's largest is 0.31 MB, the build
  prints it, and `src/__tests__/maps.map-test.ts` fails past it).
- A change to the code that bakes the global file's tables (lanes, parking, water beds, farms,
  lamps) needs both `pnpm map` and `pnpm map --region cesena`: `bake.map-test.ts` and
  `cesena-bake.map-test.ts` (`pnpm test:map`) fail until each is baked again, and `bake.test.ts`
  and `cesena-bake.test.ts` (`pnpm test`) already for the parked spots, water beds and farms
  within 1 km of Monzone station and of Cesena's start.
