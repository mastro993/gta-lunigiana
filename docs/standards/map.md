# Map standards

Checks for a change to the map pipeline (`src/tools`), the map code (`src/sim/map`) or its inputs
(`data/raw`), on top of the steps in [CODING_STANDARDS.md](../../CODING_STANDARDS.md). CI runs only
`pnpm check` and never builds the map, so these runs are yours.

## Every map change

- Run `pnpm map` twice: the two print the same build hash, and the gunzipped files are
  byte-identical (`for f in src/sim/map/monzone.bin src/sim/map/monzone/*.bin; do gunzip -c $f;
  done | shasum`). Keep the build before (`cp -R src/sim/map/monzone.bin src/sim/map/monzone
  /tmp/before/`): `pnpm map-diff /tmp/before/monzone.bin src/sim/map/monzone.bin` says what a change
  moved.
- Draw the changed area with `node src/tools/preview-map.ts` (a top-down PNG in `.research/`) and
  look at it.
- A rebuilt map shifts pinned positions: test coordinates, bot waypoints and screenshot spots.
  Find them again by geometry.
- Place hand-made tables (`STONE_CORES`, `LANDMARKS`, stream widths, district discs) on
  orthophotos and OSM nodes, with a comment saying how.
- `data/raw` is pinned. Fetch again (`pnpm fetch-osm`, `pnpm fetch-rt`) only to change the inputs
  on purpose: OSM returns current edits, so the map moves.

## Data sources and requests

- **Licences**: accept CC BY and the ODbL (OpenStreetMap's). Ask the user before any other
  share-alike source (CC BY-SA and the like), and leave out non-commercial or unlicensed data.
- **Records and credits**: record each accepted and rejected source, with the reason, in
  [docs/map.md](../map.md). Credit each accepted one in the README and in both credit lines of
  `index.html` (the HUD's and the title card's), keeping Regione Toscana's wording verbatim.
- **Overpass** is often overloaded: the pipeline uses the OSM API's `/map` tiles, and the
  kumi.systems mirror serves one-off queries.

## New map part or biome

Follow issue #3 (the extent, the order of parts and the runbook), plus the checklist and
acceptance criteria in the part's issue (#17–#26) or the biome's (#13–#16).

- The runbook's tools are in `src/tools` and `package.json` ([Adding a
  part](../map.md#adding-a-part)): `footprint-check`, `rt-index`, `pick-sheets`, `pick-lidar`,
  `coverage`, `ortho`, `playtest.ts` and `map-diff`. `region.ts` holds the regions (Lunigiana,
  Cesena) and the Lunigiana parts' rectangles; their masks and outline walls arrive with issue #7,
  `pin-raw` with #6 and `fetch-lig` with #12. When one is missing, name the issue that adds it and
  ask the user before building it.
- The pick tools only print by default: run `--write` to change a manifest on purpose, then
  `pnpm fetch-rt`, `pnpm map`, and `pnpm map-diff` against the map before.
- A failed scale check (tile size, build memory, first frame, heap) is engine work first.
- Moving `BOUNDS` moves every tree: the lattice they are planted on starts at its corner. Each tile
  stores its trees in whole metres from a point 100 m south-west of the tile's corner.
- A tile is at most 0.7 MB gzipped (issue #3's scale checks; today's largest is 0.31 MB, the build
  prints it, and `src/__tests__/maps.test.ts` fails past it).
- A change to the code that bakes the global file's tables (lanes, parking, water beds, farms,
  lamps) needs both `pnpm map` and `pnpm map --region cesena`: `bake.test.ts` and
  `cesena-bake.test.ts` fail until each is baked again.
