# The map

`pnpm map` runs `src/tools/build-map.ts`. It turns the pinned inputs in `data/raw` into the default
Lunigiana map of its three parts, lucido, fivizzano and fosdinovo ([section
2](#2-projection-and-play-area-geometryts-play-areats)): the global file `src/sim/map/monzone.bin`
(1.25 MB), 102 tiles of 2 km in `src/sim/map/monzone/` (42.4 MB in all, the largest 0.63 MB; see
[Map files](#map-files)) and, beside the tiles, the full map's picture `overview.png` (5.56 MB; [The
overview](#the-overview)). The build is deterministic (gunzipped, its files are the same bytes on
every machine, arm64 and x64 alike, and it prints the same build hash; gzipped, they are
byte-identical with the same Node build, while another zlib or OS writes other compressed bytes; the
overview's pixels are the same everywhere, its compressed bytes likewise with the same zlib), takes
about 125 s and peaks at 2.68 GB resident ([Pipeline](#pipeline)). V8's `Math.sin`, `cos`, `tan`,
their inverses, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `atanh`, `exp`, `expm1`, `log`, `log1p`,
`log10` and `**` (but squaring) return other last bits on arm64 than on x64 (Node 24.14.1, 200,000
arguments each; `sqrt`, `hypot`, `cbrt`, `log2` and `x ** 2` agree), and before #68 the two builds
of Lunigiana differed by one parked car's spot at (−1306, 2480). So the build calls Ritmo's `Ops`
(`@typeonce/ritmo-math`, a port of fdlibm built from `+ − × ÷` and `Math.sqrt`, which every CPU
rounds the same) for those, as the sim does, and keeps V8's `Math.hypot`, which V8 computes from the
same operations (`Ops.hypot` would move 38 % of its results by a last bit). `map-key.test.ts` fails
on a `Math` call or `**` of that list in any file the build imports. It prints the end of each stage
(seconds from the start and the process's resident memory then), the rail's fit to the CTR per piece
([section 4](#4-the-rail-on-the-ctr)), each platform ([section
9](#9-the-railway-railwayts-platformsts-rail-clearts)), and a summary: the build hash, the tile
count, the bytes written and the largest tile, the overview's size, the play area's terrain by
source (`terrain`: Lunigiana's 303.22 km² of LiDAR, 0.25 of surface model, 3.09 of 10 m DTM and
2.23 of Liguria's DTM, `sourceAreas` on 10 m cells; lucido's alone 77.35, 0.02 and 0.63, and no
Liguria), counts, the rail on the CTR
(OSM's offset from it, the shipped residual, the level crossings' slides, the bridge ends slid, the
culverts, the at-grade track cut into the CTR's bridges and the rail bed), the railway (its lines,
stations, level-crossing boxes and the verges pulled in off the track), the steepest grade per road
class, and the size of each part of the files before gzip (each layer of the tiles' vectors summed
over the tiles). Inputs and attribution are in the [README](../README.md).

`src/sim/map/kinds.ts` holds the vocabulary that the build and the game share: road classes and
their default widths, where people walk and cars drive across them (`vergeOf`, `laneOffset`), how
far each class's surface floats over its profile (`ROAD_LIFT`) and reaches past its carriageway
(`ROAD_PAD`), how far off a bridge's or a tunnel's centreline someone on foot is on it
(`footReach`), a bridge's deck as drawn (`DECK_SLAB`, `DECK_BALLAST`), how near a deck a body's
level must be for the deck to take it (`ON_DECK`) and two grounds to be one level (`ONE_LEVEL`),
building styles, area kinds, rail kinds (`RAIL_KINDS`), the rail head
over the bed (`RAIL_LIFT`) the tree-trunk size, the tile grid (`TILE`, `tileKey`, `tileRange`) and
how far round its square a tile holds the vectors (`HALO`). It imports no data, so the build can use
it before the map exists.

## Cesena

Cesena is a separate experimental city-centre map; it loads instead of Lunigiana, not alongside it.
The pipeline below describes Lunigiana unless a Cesena difference is noted here.

- **Selection**: the title card links to `?map=cesena`; an omitted `map` selects Lunigiana.
  `src/maps.ts` validates the name before download, and the boot host updates the title and credits.
  Switching maps reloads the page and starts a fresh world. The links preserve an explicit seed.
- **Extent**: `region.ts` centres Cesena at latitude 44.1391, longitude 12.2429, with one part,
  `cesena`: the local square −2000 to 2000 m on both axes, played whole. This covers a 4 by 4 km
  city-centre area, not the whole comune.
- **Accepted sources**: OpenStreetMap (ODbL) supplies roads, buildings, water, land use and names.
  `pnpm fetch-osm --region cesena` pins its one part's extract, `data/raw/osm/cesena.osm.gz`, with
  the same API fetcher, which splits a box the API refuses as too large. Regione Emilia-Romagna's
  [DTM 5x5 - ultima edizione](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/altimetria/layer-2)
  is accepted under the catalogue's CC BY 4.0 licence. `pnpm fetch-rer --region cesena` checks that
  licence and requests WCS coverage `DTM5X5_RDN32_RMD` as an EPSG:4326 GeoTIFF. The pinned
  `data/raw/cesena/source.json` records the request and raster SHA-256. `loadGeoDtm` rejects
  incorrect CRS, incomplete coverage and invalid or missing heights instead of inventing terrain.
- **Excluded sources**: the Tuscany CTR, LiDAR and UCS inputs do not cover Cesena and are not
  reused there. No other terrain, building or imagery source is included for Cesena.
- **Build**: `pnpm map --region cesena` writes only `src/sim/map/cesena.bin` and its 4 tiles and
  overview in `src/sim/map/cesena/` (bounds on the seams: tiles −1…0 both ways), using the same
  profiles, collision, road graph, parking and packed format as Lunigiana. The source terrain has
  5 m cells; resampling onto the game's 4 m grid does not make it a finer survey.
- **Rail**: the shared railway pipeline uses Cesena's OSM tracks and platforms, with no Tuscany
  survey tracks or Gragnola-specific layout corrections. The bundled Cesena map is rebuilt when
  the shared packed format changes, so both regional maps use the same decoder.
- **Features**: the roads take the classes Lunigiana's do ([section 3](#3-features-featurests)): the
  SS726 Secante (Via Ugo La Malfa) is the region's trunk road, its 27 slip roads primary, and the
  secondary roads keep their class. Its 80 roundabout ways, which carry no `oneway` tag, are oneway
  as OSM implies. Cycleways are walkable paths. OSM building height tags are used where present,
  otherwise existing default heights apply. Road widths use class defaults, or on the main roads
  their `lanes` width: the Secante's `lanes=2` makes it 7 m, not trunk's 8.5 m, and 58 of the 148
  secondary pieces take 3.5, 7 or 10.5 m. The Savio's width is the median of perpendicular
  cross-sections through its OSM bank polygons (each piece the play area's outline keeps of a way on
  its own: way 1029104404's two are 13.8 and 14 m), not the mountain-stream fallback. Neighbourhood
  labels come from OSM place nodes, without Monzone's hand-placed districts or stone cores.
- **Start**: the player starts beside a central street in the connected traffic network, outside
  buildings with an open walk-clear route to the street. Police and station parking use Cesena's
  mapped Carabinieri headquarters (the Compagnia, POI 806564311, which the map names as
  `spawns.police`: the game parked them by the first police POI, the Commissariato 1.9 km away,
  until the build named it) and railway station.
- **Checks**: `src/tools/__tests__/cesena.test.ts` checks landmarks, connected networks, the outdoor
  spawn, nearby cars and deterministic simulation startup. It reads its buildings and road lines
  from the tiles round the start, all four (the start, (17.3, −41.5), is by the corner they share),
  and fails when it reads none, so its checks cannot pass on nothing. `cesena.map-test.ts`
  (`pnpm test:map`) reads Cesena whole (`wholeMap("cesena")`, the vectors joined from the tiles) and
  checks that every road has its line (2 vertices or more, a z per vertex), that every piece of the
  Savio is over 8 m and at most 120 m wide (its two are 13.8 and 14 m), the clearance under every
  road bridge (of its 50; it fails with none to check), and the Secante and its slip roads: trunk
  and ramps, in the traffic graph but no Ape's lanes, off the walk graph and with no parked car by
  them. Run `pnpm check` after a build. Preview the map with
  `node src/tools/preview-map.ts 0.3 -2000,-2000,2000,2000 .research/cesena-preview.png --region cesena`.
  Repeat builds must have identical decompressed hashes, as for Lunigiana.

## Test regions

Test regions build the Lunigiana map in other shapes and sizes, to check the build where the shipped
map cannot: `region.ts` defines them beside the regions, and `node src/tools/build-map.ts --region
<key>` (or `pnpm map --region <key>`) writes them to `test-maps/<key>.bin`, its tiles and its
overview, gitignored; the game never loads them and nothing ships them. Each reads Lunigiana's
inputs on its origin and tree anchor (a tree stands where it does on the shipped map, with the same
id), its OSM every Lunigiana part's extract (`osmFiles`), and `fetch-osm` refuses its part
(`partToFetch`: no build would read the file) but one with buildings of its own, whose own part's
extract (`osmFile`) is what it reads. `loadBuiltMap` in `src/tools/map-file.ts` hands one to the sim
in a process of its own;
`preview-map.ts` draws one with `--region <key>`.

- **`lunigiana-l`**: two rectangles of lucido in an L, x −2400…0 by y 0…3900 (Monzone, its station,
  the Carabinieri and the start, Gragnola's rail layout to lucido's north edge) and x 0…2400 by y
  0…1400 (Equi Terme and its station), 6 tiles; the notch, x 0…2400 by y 1400…3900 round Fazzano,
  Casciana and Codiponte, is real land, its two tiles unlisted, and the build reads no terrain
  there: the grid's tile pass works the 6 listed tiles alone, the catchments end at the notch's
  sides and the place leaves it out ([Pipeline](#pipeline), [What growing a region
  changes](#what-growing-a-region-changes)). It builds in 5.5–6.0 s and peaks at 0.79–0.80 GB,
  2.2 s of it the overview and 0.25–0.26 s the grid's tile pass (arm64, three runs on 2026-11-04 at
  a load average of 5–6 from other work, beside 5.6–6.2 s, 0.79–0.81 GB and 0.31–0.32 s when the
  pass worked the notch's 2 tiles too; 5.3–5.5 s and 0.77–0.78 GB on 2026-10-31, and 3.1–3.2 s and
  0.64–0.68 GB before the overview and the vectors in the tiles, #63). `pnpm maps` builds it after
  the two maps, and CI caches it with them (it reads their inputs and code, so it shares their key,
  and the reproducible job's hash covers it, its overview included). As a test region built from
  Lunigiana's inputs it reads every part's extract, Fosdinovo's too, but an address names only the
  road it stands by (`nameFromAddresses` in `addresses.ts`, [section 3](#3-features-featurests)), so
  the addresses past its edges name none of its roads: before that rule (#18's review), 6 of its
  ways (12 pieces) took names voted from 3.3–8 km away, 80377895 "Via Strada Statale 63 del Valico
  del Cerreto" from the 2 of that street by Soliera and 80377931 "Via Vallecchia" from one in
  Castelnuovo Magra among them, and 11 ways took a name from addresses, where 5 do now.
  `src/tools/__tests__/l-region.map-test.ts` (`pnpm test:map`; without the build every check is
  skipped, saying how to build it, but in CI, which builds it, the file fails instead, so a broken
  `maps` script or cache path cannot pass with nothing checked) loads it and checks, through the
  game's own lookups:
  - the outline walls, walk and drive, run end to end along every edge of the L, and `wallsNear`
    answers them every 4 m along it, the notch's sides included (the cut keeps their walls in the
    listed tiles beside the notch: [Map files](#map-files));
  - every drivable road leaving it (52 cut ends, 15 on the notch's two sides) is crossed by a drive
    wall off the outline within 8 m of its end (the build's cap, 4 m in);
  - a flood on foot from the start, over 2 m cells, stops at the walk walls (`wallsNear`: walls and
    trunks) and never leaves the play area, while it reaches every edge and 10.2 km² of the 12.72;
    with the walls on the notch's west side left out of its lookups it gets out at (1, 3009);
  - every graph node, spawn, POI and platform lies in the play area, and every building's centroid;
  - no road, water, rail or barrier line repeats a vertex in a row where the notch's sides cut it:
    before a cut on a vertex's 0.1 m point took its place, road 1002673816 repeated (0, 1912.5), a
    segment of no length ([section 2](#2-projection-and-play-area-geometryts-play-areats));
  - no tree beyond the outline stands on a road, in a stream or in a building of lucido's map;
  - no wall lies wholly more than 5 m outside the play area: the walls stage blocks no cell whose
    centre lies outside it, so the notch's slopes and banks are walled by the outline alone;
  - its place is the one fitted over its listed tiles' nodes (`placeFrom` over `listedNodes`):
    over every node of the joined heightmap, whose notch holds 0, its floor would be 0 m, and an L
    built when the place was fitted over the notch's terrain fails it (floor 179.4 m against 173.1).

  It reads the L's roads, platform areas and buildings joined from its tiles (`readWholeMap`).
  Beside it, `src/sim/map/__tests__/ground-l.map-test.ts` checks that the ground, surface and water
  lookups answer on the L as the whole map's broad phases did, over the notch too, where a lookup
  reads the vectors of the listed tiles round it, merged ([Map files](#map-files)), and
  `overview.map-test.ts` checks its overview ([The overview](#the-overview)); both skip without the
  build and fail in CI without it, as `l-region.map-test.ts` does.
- **`lunigiana-lucido`**: part lucido alone, x −2900…4900 by y −6100…3900, 30 tiles: the shipped
  map's first part on its own, which the 3x is checked against, as the shipped map is no longer
  lucido alone (issue #17; `x3-region.map-test.ts`, [What growing a region
  changes](#what-growing-a-region-changes)). Its part is Lunigiana's own `lucido`, so `regionOfPart`
  gives Lunigiana for it and the part tools work on lucido as before. It holds 6,388 buildings,
  2,545 areas, 1,079,138 trees and 805 parked spots (2026-11-07). As a test region built from
  Lunigiana's inputs it reads every Lunigiana part's extract (`inputParts`), Fivizzano's and
  Fosdinovo's too, but an address votes only for its own OSM road way, within 100 m of it
  (`nameFromAddresses` in `addresses.ts`, [section 3](#3-features-featurests)), so the addresses
  past its edges name none of its roads. Before that rule (#18's review), the unnamed road nearest
  an address took its street however far it was: 6 of its roads by its north edge (10 pieces in
  x −2699…4900, y 3248…3900: "Via Montenero", "Via Roma" and four more) by addresses in
  Fivizzano's extract up to 5.1 km past that edge, and 8 by its west edge (12 pieces in
  x −2900…−2073, y −5611…3688: "Via Canepari", "Via Martiri della Libertà" and six more) by
  addresses in Fosdinovo's extract up to 8.6 km past it (Via Canepari's, at x −11498); with the rule
  those 14 ways lose them, as lucido built from its own extract alone left them unnamed. On #18's
  code before the review's fixes it built in 23.5 s and peaked at 1.27 GB resident
  (`/usr/bin/time`, 2026-11-07; 15.0 s and up to 1.37 GB at a stage's end on #17's, 2026-11-04);
  on #18's final code it reaches the end of its overview at 14.7 s, 971 MB resident then (the
  build's own print). It is built by hand (`node src/tools/build-map.ts --region
  lunigiana-lucido`); CI never builds it.
- **`lunigiana-3x`**: lucido between two rectangles of terrain only as wide as it, x −10700…12700 by
  y −6100…3900, three times its built terrain and 78 tiles; a mask on lucido's rectangle keeps the
  play area lucido's. Past lucido its terrain is the DTM's tile files' where Lunigiana's grown box
  (#17, #18) filled them, and their edge drawn on elsewhere (`loadDtm`, `drawEdgesOn`): west of
  lucido all of it, as Fosdinovo's tiles reach x −11500, and east of it along lucido's side,
  x 4900…≈ 6050, whose tiles the grown box fills to their edges, and north of y ≈ 1950 to x 10650,
  the tile row Fivizzano shares. On 10 m cells (`sourceAreas`, 2026-11-07) the west block's 78 km²
  are the LiDAR's on 73.64, Liguria's DTM's on 2.23 and the 10 m DTM's on 2.13 (before Fosdinovo's
  tiles the LiDAR's on 13.98 and the edge drawn on the rest), and of the east block's the LiDAR
  covers 20.42 km² and the edge drawn on the other 57.58. Where the tiles end the ground steps, by
  up to 242.6 m east of lucido: 604.7 m at (7228, 1948), 847.3 m at (7228, 1952). Past lucido it
  has no roads or buildings, only the land cover that reaches there: 87 areas run on whole past
  lucido's edge (64 of them forest) and 4,703 more lie beyond it, 800 of them paved, and 2,076,214
  trees more stand while 2 of lucido's go (7,248 areas and 3,155,350 trees against lucido alone's
  2,545 and 1,079,138 on 2026-11-07; 180 fewer than before #18's review, as the Torrente Pesciola
  beyond lucido, drawn 6 m wide since, keeps 183 off its banks). It serves the build's memory and
  time and the cars round
  Monzone. It is built by hand after `lunigiana-lucido` (`node src/tools/build-map.ts --region
  lunigiana-3x`); CI never builds it. On #18's code before the review's fixes (2026-11-07) it built
  in 23.7 s and peaked at 1.84 GB resident (`/usr/bin/time`); on its final code it reaches the end
  of its overview at 22.6 s, 1,440 MB resident then. Alone it built in 21.3 and 21.8 s and peaked at
  1.86 and 1.85 GB on #17's code at bd9c29c, before the fixes to Fivizzano's inputs that followed
  (2026-11-04); on #17's final code, built beside `pnpm test`, it reached its overview at 27.1 s,
  its resident memory up to 1.76 GB at a stage's end. `x3-region.map-test.ts`'s 5 checks pass on
  the 2026-11-07 builds of both.
- **`bagnone-ridge`**: 4 × 4 km of the Apennine ridge round Monte Sillara, x −8000…−4000 by
  y 20000…24000 (part `sillara`), with terrain of its own (`ownTerrain`) and nothing else: no OSM,
  CTR or land cover reaches it, so no map is built for it (`build-map.ts` refuses it, as no road
  leaves a place to start). It checks the terrain chain (issue #10) before part 6 (#22) exists: the
  LiDAR stops 1–2 km below the crest, and the surface model, Massa-Carrara's 10 m DTM and, past the
  regional border on the crest, Emilia-Romagna's DTM 5x5 fill the rest. `pnpm fetch-rt --region
  bagnone-ridge` writes it into `data/raw/rt/bagnone-ridge/` from `data/parts/sillara.json` (8 LiDAR
  tiles of 2010, 5 surface-model elements, the 10 m DTM), pinned with the rest. Of its 16 km²,
  `pnpm coverage sillara` counts LiDAR on 4.11 km², the surface model on 0.83, the 10 m DTM on 7.79
  and the DTM 5x5 on 3.27 (fetched again on 2026-11-04 with the canopy filter's second pass, the
  sources counted on the same 10 m cells by `sourceAreas`; 1.00 and 7.62 with one pass), over
  Bagnone (11.46 km²), Monchio delle Corti (3.12), Licciana Nardi (0.87) and Corniglio (0.54). Of
  its 2.62 km² of open ground without LiDAR, the canopy filter clears 1.80 km², so the surface model
  fills 0.81 km²: on the mosaic's 2 m cells it keeps 45% of the pastures (0.52 of 1.17 km²) and 22%
  of the bare rock (0.32 of 1.44 km²), whose relief of 1–3 m it takes as it takes a tree (one pass
  cleared 1.64 km² and kept 52% and 28%).
  `src/tools/__tests__/terrain-seams.map-test.ts` reads it through the build's own sampler and 4 m
  grid (`loadDtm`, `dtmDem`), as it reads Lunigiana's: the highest node within 100 m of Monte
  Sillara's summit (−5336, 22825) stands at 1859.4 m, within 5 m of its 1861 m, on the bent 10 m
  DTM (the surface model holds 17 of the 1,960 nodes within 100 m of it), and no seam
  between two sources steps more than 1 m beyond the terrain's own steps round it ([Checks and
  tools](#checks-and-tools)).
- **`pontremoli-town`**: 1.6 × 1.6 km round Pontremoli's town, x −20700…−19100 by y 23100…24700
  (part `pontremoli-town`: lat 44.370–44.384, lon 9.872–9.890 rounded out to 100 m), with buildings
  of its own (`ownBuildings`) and nothing else, so no map is built for it (`build-map.ts` refuses
  it). It checks the DBT 1:2000's adapter (issue #11) before part 8 (#24) exists: the 2019 CTR maps
  1% of the comune and none of the town, the DBT of 2010 all of it. `pnpm fetch-rt --region
  pontremoli-town` writes the DBT's layers into `data/raw/rt/pontremoli-town/dbt2k/` from
  `data/parts/pontremoli-town.json` (Pontremoli's archive of 2010, 52,357,541 B; 11.99 s with the
  download and a 308 MB peak, 0.21 s from the cache, 2026-11-03), cut to the records whose box meets
  the region's EPSG:3003 box + 500 m (1568924,4912816,1571536,4915434): 2,719 of the comune's 11,614
  units, 29 of 153 artefacts, 167 of 703 road areas, 599 of 1,991 carriageways, 99 of 653 dirt
  tracks and 2 of 45 zones, 12 files of 554,741 B. Over the rectangle, `readDbt` reads the same from
  the cut as from the whole comune: 2,020 buildings, all with a surveyed eave (house 1,357, shed
  312, garage 229, church 39, industrial 37, tower 14, barn 9, substation 9, station 6, ruins 5,
  silo 3), 518 road surfaces (439 carriageways, the road areas of 25 roads with none and 54 dirt
  tracks; 458 paved, 367 named) and 2 mapped zones. `pnpm fetch-osm pontremoli-town` writes OSM's
  buildings over the region's part plus 100 m into
  `data/raw/osm/pontremoli-town.osm.gz`: one `/map` call and the 40 building multipolygons'
  `/relation/<id>/full`, 41 requests in 5.3 s, of which it keeps what the check reads
  (`buildingsOnly`: the ways tagged `building`, the building multipolygons, their member ways and
  the nodes those ways use; 14,161 nodes, 2,320 ways and 40 relations of the answer's 22,180 nodes
  and 3,066 ways), in the API's own XML, 272,337 B. `src/tools/__tests__/pontremoli.map-test.ts`
  (`pnpm test:map`, 0.3 s) reads both through the build's own readers (`readDbt`, `readOsms`) and
  checks issue #11's targets and the ids:
  - at least 90% of OSM's building centroids in the rectangle lie in a DBT building, outside its
    holes (OSM's outlines as `osmBuildings` builds them, `building=no` and `building=roof` none:
    `isBuilding`): 1,883 of 2,044, 92.1% (1,884 of 2,049 with those). OSM's outlines lie about 1 m
    west of the DBT's: moved 1 m east 93.2% of the 2,049 centroids fall in, 2 m 88.9%;
  - at least 90% of the units standing on the ground, by their centroid in it, are 1.5–45 m tall
    (`un_vol_av`): 2,002 of 2,002;
  - every building's id is its own, a safe integer, in Pontremoli's DBT slot (`SOURCES.dbt2k` ×
    2¹⁶ + `comune("045014")`, [section 3](#3-features-featurests));
  - every building's kind and style is one a CTR building code gives, and the town holds a church,
    a tower and a station.

  Without the files it fails at load, saying that `pnpm fetch-raw` restores them, as
  `terrain-seams.map-test.ts` does without the ridge's terrain: CI restores `data/raw` for the map
  tests ([Pinned inputs and CI](#pinned-inputs-and-ci)).
- **`sarzana-town`**: 1.6 × 4.4 km of Sarzana, x −14400…−12800 by y −8000…−3600 (part
  `sarzana-town`, 6 tiles), from the Magra plain's quarries in the south through the old town, its
  cathedral and the Cittadella to the hills below Sarzanello, with terrain of its own (`ownTerrain`)
  and Regione Liguria's sources (`fetch-lig`), no OSM, so no map is built for it (`build-map.ts`
  refuses it). It checks issue #12's sources before part 4 (#20) exists: the Ligurian comuni have no
  CTR or land cover of Regione Toscana's, and its LiDAR (lot 004) reaches only the hills at its
  north-east corner. `pnpm fetch-lig sarzana-town` writes its NC5, DTM crops and land use into
  `data/raw/lig/sarzana-town/` ([section 1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)),
  and then `pnpm fetch-rt --region sarzana-town` its terrain into `data/raw/rt/sarzana-town/` from
  `data/parts/sarzana-town.json` (the LiDAR tile 23c60 of 2010, which `pick-lidar` picked; its
  surface-model elements are not listed, as no land cover of Tuscany's says where its ground is
  open): over its mosaic's 7.70 km² (the play area plus 32 m, in EPSG:3003), the LiDAR on 0.34 km²
  and Liguria's DTM on the other 7.36 km², bent onto the LiDAR near it (3.8 s; 2026-11-03).
  `src/tools/__tests__/sarzana.map-test.ts` (`pnpm test:map`, 2.8 s) reads both through the build's
  own readers (`readNc5`, `readUcs`, `loadDtm`, `ligRaster`) and checks issue #12's targets:
  - every NC5 building and minor building whose outline's centroid lies in the play area is one
    building, by its id, and no id is two: 2,927 polygons of the file's 3,032 buildings and 1,290 of
    its 1,352 minor ones (the rest lie beyond the rectangle; one 0.3 m² sliver of `L6871` is dropped,
    as every survey's reader drops a ring under 0.5 m², `flatRing`), and each layer's file holds the
    server's count (`numberMatched`);
  - at least 90% of the buildings (`L6871`) whose outline meets the rectangle, clipped to it, stand
    1.5–45 m over the lowest ground at their outline, as the build measures a building's height
    (`build-output.ts`): 2,872 of 2,959, 97.1%. Of the minor buildings 506 of 1,299 do: their eaves
    stand 1.11 m over Liguria's DTM at the median, where over the LiDAR's ground they stand 2.23 m,
    and the build gives the rest their default 2.5 m ([Known data
    limitations](#known-data-limitations));
  - the building under the cathedral's point (OSM's relation 14443127, the Basilica Cattedrale di
    Santa Maria Assunta, at 44.1121353, 9.9623806: the nave, 946 m², its eave at 39.04 m) is a
    church, the station's passenger building, at (−13564, −5850), a station, and every id is in the
    NC5's slot. Of the 4,258 buildings and minor buildings clipped to the rectangle: house 2,735, shed
    1,299, industrial 162, church 36 (the cathedral's bell tower among them, coded a church), ruins
    12, construction 6, station 6, barn 2;
  - the land use's kept polygons in the rectangle are the Magra plain's 8 natural basins (5121) and
    2 quarries (131), all south of y −6800;
  - south of y −6000, 2 km and more from the LiDAR, the terrain is Liguria's own DTM (`ligRaster`)
    within 0.1 m at the median of its nodes (0.00 m), as the bend fades (`LIG_FADE`);
  - `unround` settles on a crop of the DTM, and on the same raised 1,500 m, under `MAX_SWEEPS`
    (relaxed in 32 bits, the raised one ran all 2,000 sweeps).

  `terrain-seams.map-test.ts` checks its seam: the LiDAR's 0.34 km² meet Liguria's DTM at 298
  nodes, and no step there passes the terrain's own steps round it (the worst is 0.06 m under them).

Issue #3's scale checks on the 3x, measured on 2026-10-31 (arm64, Node 24.14.1, `/usr/bin/time -l`,
three runs each, a load average of 5–6 from other work), before and after the build's per-tile
stages were sped up (lucido's files the same, byte for byte), and that evening, at a load average of
6–7.5, with the vectors in the tiles and the overview (#63; main's 3x build then took 16.08 s and
1,462 MB in one run, much as in the sped-up row, so the load moves these little):

| Build | Tiles | Wall clock | Peak resident |
|---|---|---|---|
| lucido (`pnpm map`), before | 30 | 12.41, 12.81, 12.71 s | 1,117, 1,096, 1,109 MB |
| `lunigiana-3x`, before | 78 | 28.52, 28.27, 28.17 s | 1,594, 1,592, 1,598 MB |
| lucido (`pnpm map`), sped up | 30 | 8.29, 8.27, 8.30 s | 1,057, 1,040, 1,051 MB |
| `lunigiana-3x`, sped up | 78 | 15.43, 15.71, 15.29 s | 1,476, 1,459, 1,473 MB |
| lucido (`pnpm map`), #63 | 30 | 11.78, 11.57, 11.86 s | 1,218, 1,203, 1,206 MB |
| `lunigiana-3x`, #63 | 78 | 17.93, 17.06, 17.12 s | 1,671, 1,650, 1,549 MB |

- **Memory**: 1.55–1.67 GB (1.46–1.48 GB before #63; 1.85–1.86 GB on #17's code at bd9c29c and
  1.84 GB on #18's, with the real terrain past lucido), under the 3 GB issue #3 asks of a 3× region,
  and 9 MB more a tile: the grid (twice, carved and uncarved, 8 bytes a node), the catchments'
  arrays (15 bytes a node), the walls' bit sets and the cut tiles still grow with the area
  ([Pipeline](#pipeline)). It was 1.6 GB and 10 MB a tile before the catchments' D8 went to a byte a
  node.
- **Time**: sped up, (15.48 − 8.29) s over 48 more tiles is 0.150 s a tile, against the 0.3 s
  issue #3 asks (0.33 s before), plus a fixed 3.8 s (lucido's 8.29 s less its 30 tiles at that
  rate). The 7.2 s more, stage by stage: the catchments 1.5 s, the grid 1.3 s (2.1 s rather than
  0.85 s), the walls 1.1 s, the write 1.1 s, the cut 1.0 s and the trees 0.85 s; the rest holds
  lucido's features whatever the size. Before, the 15.7 s more were the grid 5.7 s (each of a
  node's 25 DTM samples ran the projection lattice's bilinear twice), the write 4.3 s (gzip on the
  main thread), the catchments 2.1 s, the cut 1.4 s, the walls 1.1 s and the trees 0.9 s
  ([Pipeline](#pipeline) says what changed). Gzip at level 9 takes 78 ms on a synthetic tile
  against 43 ms on a lucido one (the edge drawn on repeats, which lengthens its match chains), so a
  real part's tiles write faster but bring roads, walls and trees the synthetic ones lack. With #63,
  (15.83 − 8.91) s up to the end of the write over 48 more tiles is 0.144 s a tile (the median
  runs). The overview's long side is 4096 px whatever the map's size, so it costs nothing a tile:
  1.2 s on the 3x, whose overview is 4096 × 1750 px, against 2.7 s on lucido's 3195 × 4096.
- **Live vehicles round Monzone** (`x3-region.map-test.ts`, which runs `stand.ts` on lucido alone,
  `lunigiana-lucido`, and on the 3x, seeds 1–6, each in a process of its own, and is skipped without
  both builds): after the player stands 60 s at the start, the parked cars on either map are exactly
  those the dice (`carOn`, a hash of a spot's place and the seed) park on the 42 spots within 300 m
  of the start, which stand where they do on lucido alone, beside 10 traffic and the Carabinieri's
  2, within the 200 parked and 10 traffic `PARKED` and `TRAFFIC.max` allow: 9, 13, 11, 10, 11 and
  11 parked on seeds 1–6 (2026-11-04), the same cars on the same spots in the same paint on both
  maps. So the count does not grow with the map. 9 buildings across lucido's edge, clipped to its
  box on lucido (their centroid inside), are kept whole and dropped by their centroid on the 3x (OSM
  building 700764389 among them, at (−2892.7, 3095.5)), yet both maps keep the same 805 parked
  spots in the same order (807 on 2026-11-04, 808 before #18's review dropped the buildings two
  sources both map). Before #17 the kerbside spots were one per 8
  buildings, cut where the whole map's candidates in hash order reached that count: lucido's 6,399
  buildings took 800 of them, and the 3x's 6,390 took 799, lucido's 800 without spot 367 by that
  building, so every later spot moved one index down, which dice keyed on the place did not see.
  Since #17 a spot is kept by the hash of its own place and those near it, a share of the candidates
  (`KERB_SHARE` in `spawns.ts`, [section
  12](#12-trees-spawns-districts-treests-spawnsts-districtsts)), so a grown box drops at most a spot
  by a building it drops across the edge, and `x3-region.map-test.ts` checks that every spot the 3x
  keeps is lucido's and every other it leaves lies within 50 m of the edge.
  `src/sim/__tests__/parked-far.long-test.ts` (`pnpm test:long`) gives Lunigiana three times its
  spots, copies 30 and 60 km east after its own: the cars round the start are still the dice's on
  its own spots; `parked-place.test.ts` lists each spot twice, once with a spot dropped before it
  and once with all the others added before it, and both listings of a spot round the start hold the
  same car on seeds 1–6.
- **What else moves**: in lucido's rectangle the 3x's terrain, its land cover more than 50 m in
  from the edge and the lamps, water beds and parked spots' rests it bakes are those of lucido alone
  (`lunigiana-lucido`) to the bit (`x3-region.map-test.ts`); the place, the catchments, what
  lucido's edge cuts and the walkers' residents near it differ ([What growing a region
  changes](#what-growing-a-region-changes)).

The build's Lunigiana-only constants hold in a test region: the station and Carabinieri POIs may be
out of play (`regionPoi` in `spawns.ts`; a shipped map without them throws), and then no spots are
kept for them, no car park by the station gets spots (`parkedSpots`), `spawns.police` is left out
and the player starts as on Cesena, at the traffic node nearest the origin (`startNear`), each
checked in `spawns.test.ts`; Gragnola's layout swaps no node the play area leaves out
(`conflate.ts`, `conflate.test.ts`). The Rosaro's 14.7 km² from beyond the map (`OFF_MAP` in
`build-terrain.ts`) come in only where a region holds the Rosaro's water, and the stone cores are
Lunigiana's places: a test region's river flows are not calibrated (the L's Aulella carries its own
D8 area alone). Scratch regions without Gragnola, without Monzone and without the rail (x −1000…4900
by y 0…2600, x −2900…0 by y 2000…3900, x 500…4900 by y −6100…−1000) built on 2026-10-31, and so did
three on lucido's box whose play area leaves level crossings and stations out: a mask on its south
half (y −6100…−1100), a slanted mask with a reflex corner, and four rectangles round a hole at
Monzone (x −1000…1500 by y −1000…2000). Before the build kept only the level crossings and platforms
in play, each threw on a level crossing beyond the outline (CTR 23D11 AGE#166, 23D36 AGE#76).

## Pipeline

The build runs in five phases, each a function whose intermediates go out of scope when it returns,
so its peak is one phase's working set plus what that phase hands on:

| Phase | Module | Sections | Let go when it returns |
|---|---|---|---|
| sources | `build-sources.ts` | 1–4, and the districts (12) | the OSM, the surveys |
| terrain | `build-terrain.ts`, `build-grid.ts` | 5–8, the rail bed and the ground under the decks | the DTM, the profiles, the catchments' grid |
| world | `build-world.ts` | 9–12 | the clearance indexes the spawns and the graph's dead ends are checked against |
| output | `build-output.ts`, `tile-map.ts`, `tile-vectors.ts`, `bake.ts` | the map put together, its land cover, the cut, the bake, the files | |
| overview | `overview.ts`, `paint-raster.ts`, `png.ts` | the full map's picture, from the built map's vectors ([The overview](#the-overview)) | its pixels |

The DTM is the one input two phases read (the sources take the water's widths from it), so
`build-map.ts` hands it from one to the other in a function of its own that returns with the grid:
a value a running function holds is never collected, and held in the build's own function it
stayed through the world phase and the cut (lucido alone, after the terrain phase and two full
collections: 121 MB of array buffers, 39 MB, the grid alone, once it goes).

The output cuts the map into its tiles once ([Map files](#map-files)), one at a time, each packed
with an empty hash as soon as it is cut: its nodes from the grid (whole decimetres, an `Int16Array`),
its land cover rasterised for its cells alone (`coverBlocks` in `raster.ts`, with the whole
raster's arithmetic, so no raster of the whole map is ever made; the areas are sorted and boxed
once, and a tile fills only those whose box comes within a cell of it: the cut took 1.9 s rather
than 2.4 s on the 3x test region, whose tiles in a row each scanned every area of the row), and
its walls and trees in the whole map's order (sorted by tile once). The walls' blocked cells are
worked out tile by tile too: the slope test and the 3 × 3 majority filter of a tile's cells read one
cell past it, from the grid, into one bit set per kind over the whole map, which is traced as one
(the loops in the order of their lowest crossing, each simplified and split as it is traced, so only
the loop at hand is held). The cut also places the vectors: each road line, river, barrier,
building and area goes, whole, into every listed tile one of its segments' boxes (a building's or an
area's outer ring's box) comes within `HALO` (32 m) of, the tile indices clamped to the list as a
lookup's are (`vectorMembers` in `tile-vectors.ts`; [Map files](#map-files)). It throws where a
road's carriageway or verge, or a river's bed, reaches past the halo off its line (the most today
is 13 m, the Aulella's bed), since a lookup at a point reads that point's tile alone, and on a water
piece of more than `WATER_VERTICES` (65,536) vertices, since the rivers' sound keys a reach by its
piece and vertex. The global file keeps the roads' attributes and, for readers far from the
player, copies of what the railway points at: each level crossing's road line, each platform's
rings and each station's building (`derived`).

The bake (`bake` in `src/tools/bake.ts`) runs the game's own code on the map cut so far, which it
reads through a store that keeps 16 tiles decoded and drops the first one read past that, as a host
drops tiles: on lucido alone the cut and the bake took 10.5 s with 4 kept, 4.9 s with 9, 2.0 s with
16 and 1.4 s with all 30 (one build each on 2026-10-31; 7.6, 3.7, 1.5 and 1.2 s before the vectors
moved into the tiles). It is handed the whole map's roads, buildings and water (`cut.whole`), which
the game holds only near the player, for the tables that read them all: the farms (`bakeFarms`,
given the buildings as one layer with their indices) and each farm's building centre, the lamps
(`bakeLamps`, the roads), the water's floors (`bedOf`, each piece) and the bells (`bellsOf` in
`src/tools/bells.ts`: the tallest church or tower of every district that has one). The walkers'
residents (`bakeResidents`) read the buildings through the tiles, as the game would: the walk edges
are worked out in the order of their midpoints' tiles, so the store holds the tiles a run of them
reads (the bake took about 1.2 s, against about 3 s in the edges' own order). Then each tile's file
is made again with its water's baked floors, the hash is taken over the global file and each tile,
all unstamped, and each file is stamped (a tile's JSON line rewritten with the hash), gzipped at
level 9 and written, 8 at a time on libuv's 4 threads (`writeGzipped`): the same bytes as one at a
time, in 0.5 s rather than 1.6 s on lucido and 1.6 s rather than 6 s on the 3x test region, whose 78
tiles gzip at 74 ms each (before the vectors moved into the tiles; lucido's write takes 0.6 s with
them, Lunigiana's 102 tiles 2.9 s, 2.0 s for its 79 before Fosdinovo's part). Last, `build-map.ts`
paints the overview from the built map's vectors and writes it beside the tiles, after them, since
writing the tiles empties their directory first: 2.7 s on lucido, 4.2 s on Lunigiana (3.7 s before
Fosdinovo's part) and 2.1 s on the L test region ([The overview](#the-overview)).

The terrain phase works out the vectors first: the water's surfaces, the road and rail profiles,
whose writes into the grid are recorded in order as claims, and the water capped under the decks.
Then `build-grid.ts` builds the grid one listed 2 km tile at a time (`gridTiles` in `grid-tiles.ts`,
the region's tiles, south to north then west to east): on the window of the tile's 501 × 501 nodes,
cut to the grid, it averages the LiDAR, carves the lakes and river polygons and the beds under the
water as first settled, writes the claims in their order (never on the water), carves the river
polygons and the beds again under the capped water outside the road cores, reads the terrain under
the water samples whose cells are the tile's own (for the perched check, section 8), rounds to
0.1 m and lays the rail bed. A window keeps the whole grid's lattice (`Grid.span` in `terrain.ts`):
positions, index ranges and clamps are worked out as on the whole grid, so its nodes are the same
doubles. Each of those stages writes a node from that node alone (its own value, position and owner,
and the vectors), so a window needs no halo. The perched check reads the 4 nodes of one cell, all in
the tile that owns the cell, and the walls' slope test, which reads 3 nodes around a cell, reads the
grid the tiles put together. A node two tiles share is worked out in both, and the pass fails the
build if the two differ. The catchments then run on the uncarved grid the tiles put together. Once
every tile is written, the ground under the decks is lowered on the whole grid (`deck-ground.ts`,
[section 7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)):
where a deck stands clear of the ground is read along it, across the tiles' seams, so it is no
window's work. It takes about 30 ms on Lunigiana's 219 decks and Cesena's 56 (2026-11-06).

A tile of the box the region's parts leave out (an L's notch, [Map files](#map-files)) is never
worked, so the build reads no terrain there and needs none there (Lunigiana's box holds 30 such
tiles, in the two notches #17's and #18's parts leave: [section
2](#2-projection-and-play-area-geometryts-play-areats)). A node only such tiles hold stays 0 in the
uncarved grid, as `joinTiles` leaves it in a map read whole, and the catchments take it for an
outlet (section 6); the place is fitted without it ([The global file](#the-global-file)). In the
finished grid it then takes the listed node the game reads there (`extendEdges`: the nearest one in
the listed tiles round its own, as `nodeAt` in `src/sim/map/tiles.ts` and the coarse grid's `readAt`
read it), so what reads the grid past the play area's inner edge reads the edge extended, as the
grid's clamp gives past the bounds: the walls' slope test and majority filter beside the notch, a
building's floor and a road's height there, and a water sample on the notch's side, whose cell is
the one past it (4 on the L test region, at x 0, which read the finished grid after the pass). Left
at 0, the cliff down to it blocked the leg's cells along the notch's west side: on the L test region
296 walk and 259 drive walls more, and 68 and 164 others gone (2026-11-04).

Pairings that would grow with the square of the region are indexed: the level crossings, the
water's mouths and the catchments' inflows by node id, the chains' growth order (section 7) by the
node ids already set, the road–rail and line–water crossings gated by their boxes, and the
parapets' openings read from one index of the roads.

On 2026-10-31 (arm64, Node 24.14.1, `/usr/bin/time -l node src/tools/build-map.ts`, three runs at
a load average of 6–7.5 from other work, each beside a build of main) the build of lucido alone
peaked at 1.20–1.22 GB resident and took 11.6–11.9 s, against main's 1.04–1.06 GB and 8.4–8.7 s: the
overview adds 2.7 s and its pixels, and the bake 0.5 s (1.2 s against 0.8 s), now that the residents
read the buildings through the tiles. Before the vectors moved into the tiles (#63) the build took
8.3 s and 1.04–1.06 GB that afternoon, 1.10–1.12 GB and 12.4–12.8 s that morning, before the grid's
nodes, the catchments, the land cover's fills and the write were sped up (the same files), and
1.30–1.46 GB and 13.6–13.9 s on 2026-10-30 with every stage at the top level of `build-map.ts` and
the map cut twice. The grid's tile pass takes 0.88 s (0.029 s a tile) and the cut 0.82 s (main's
0.81 s: placing the vectors costs little). The stages ended at (s from the start, and the resident
MB the build prints then, the median of the three runs):

| | rail | features | roads | decks | grid | water | railway | walls | trees | spawns | map | cut | bake | write | overview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s | 0.65 | 1.26 | 1.34 | 1.36 | 2.24 | 3.07 | 3.66 | 5.22 | 5.95 | 6.22 | 6.24 | 7.06 | 8.31 | 8.91 | 11.65 |
| MB | 522 | 553 | 566 | 570 | 656 | 665 | 698 | 831 | 778 | 886 | 886 | 871 | 1,059 | 1,097 | 1,205 |

With Fivizzano, 79 tiles over a box of 99, the build reached the end of its overview at 74.6 s and
peaked at 2.04 GB resident (2026-11-04, `/usr/bin/time` over `pnpm maps`, whose largest process is
Lunigiana's build; a second build of the same hash reached the end of its overview at 74.3 s). Its
stages ended at (s from the start, and the resident MB the build prints then):

| | rail | features | roads | decks | grid | water | railway | walls | trees | spawns | map | cut | bake | write | overview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s | 3.48 | 6.35 | 7.71 | 7.82 | 11.90 | 15.04 | 15.93 | 23.09 | 25.84 | 26.85 | 26.92 | 29.83 | 68.89 | 70.92 | 74.59 |
| MB | 1,553 | 1,302 | 1,353 | 1,367 | 1,669 | 2,012 | 894 | 1,241 | 1,199 | 1,771 | 1,705 | 1,752 | 1,779 | 1,875 | 1,747 |

The bake takes 39.1 s of it, against 1.2 s on lucido alone (its store keeps 16 of the 79 tiles
decoded; how much of that is tiles read again is not measured), and the build peaks at the end of
the water stage, at 2,012 MB, with the grid alone 152 MB (3976 × 4776 nodes at 8 bytes).

With Fosdinovo, 102 tiles over a box of 132, the build reached the end of its overview at 123.9 s
and peaked at 2.68 GB resident (2026-11-07, `/usr/bin/time` over `pnpm maps`, as above; a second
build of the same hash, `pnpm map` alone, at 124.3 s and 2.68 GB, and the same code without
Fosdinovo's part at 76.7 s). Its stages ended at (s from the start, and the resident MB the build
prints then):

| | rail | features | roads | decks | grid | water | railway | walls | trees | spawns | map | cut | bake | write | overview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s | 3.86 | 7.90 | 10.33 | 10.49 | 16.40 | 20.20 | 21.02 | 31.84 | 35.99 | 37.31 | 37.40 | 41.27 | 116.87 | 119.75 | 123.91 |
| MB | 1,518 | 1,677 | 1,748 | 1,769 | 2,168 | 2,680 | 1,162 | 1,496 | 1,665 | 2,488 | 2,348 | 2,372 | 1,619 | 1,843 | 1,941 |

The bake takes 75.6 s of it, near twice Fivizzano's 39.1 s for 23 tiles more (its store still keeps
16 tiles decoded), and the build peaks at the end of the water stage, at 2,680 MB, with the grid
alone 211 MB (5526 × 4776 nodes at 8 bytes). The review's fixes that followed (each road piece
cored at its own width, the rail's run-outs, the graph, the lanes and the residents in packed
sections) leave that much as it was: on #18's final code `pnpm map` alone reached the end of its
overview at 124.8 s, the grid stage's end at 2,176 MB, the water stage's at 2,689 MB, and the bake
took 75.7 s (the build's own prints, 2026-11-07).

On lucido alone, resident memory climbs most in the spawns, by 108 MB (the clearance indexes of
every wall and trunk), in the bake, by 188 MB (the game decoding the global file and the tiles it
reads, while the build still holds the cut tiles without their vectors, 38.5 MB unstamped, the files
the bake reads, 46.5 MB with their vectors, and the whole map's vectors), and in the overview, by
108 MB (its pixels, 3195 × 4096 × 4 bytes, 52 MB a copy, painted, made straight and filtered for the
PNG); it peaks in the overview. The grid stays whole (8 bytes a node, 39 MB there) for the walls'
slope test, the railway's platforms, the paths' and buildings' heights and the cut, and so do the
catchments (15 bytes a node of arrays the size of the grid, 73 MB there, beside the uncarved grid
they fill, for a moment), the walls' bit sets (1 byte a cell each) and their trace, which are the
parts that still grow with the area: 9 MB a tile on the 3x test region ([Test
regions](#test-regions)).

### 1. Sources (`osm.ts`, `ctr.ts`, `dbt.ts`, `nc5.ts`, `ctr-rail.ts`, `shp.ts`, `ucs.ts`, `crs.ts`)

- **OSM**: one extract a part, `data/raw/osm/<part>.osm.gz` (`osmFile`; Lunigiana's `lucido.osm.gz`,
  `fivizzano.osm.gz` and `fosdinovo.osm.gz`, and Cesena's `cesena.osm.gz`), written by `pnpm
  fetch-osm <part>` (`--region cesena` for Cesena's one part; `src/tools/fetch-osm.ts`). It covers
  the ground of the region's listed tiles in its box that the parts before it leave to it
  (`partGround`): its own tiles, those no earlier part's are, cut to the box round it and the
  earlier parts, and the ground that box adds to the earlier parts' tiles, as rectangles of whole
  tiles (`tileRects`: a row's run of tiles, joined with the same columns' runs in the rows after
  it), never an unlisted tile (an L's notch). The trees cover every listed tile's ground in the box,
  beyond the play area too, and keep off OSM's roads, buildings, water and rail there ([section
  12](#12-trees-spawns-districts-treests-spawnsts-districtsts)): with the extracts over the parts'
  rectangles alone, 27.9 km² of that ground lay in none, and trees stood on the roads there: within
  3.5 m of their lines, 89 on the SP10 di Tenerano (way 260987308, 900 m past lucido's west side),
  100 on Via Bardine (190044753) and 215 on the track 128491205 by (8886, 3277), and 0, 0 and 9
  since. Lucido's ground is its rectangle, the box its pinned extract was fetched over; Fivizzano's
  is 6 rectangles, 177.90 km²: its own tiles cut to the box (3) and the strips the grown box adds to
  lucido's tiles, x −4000…−2900 and 4900…6000 by y −6100…4000 and x −2900…4900 by y 3900…4000; and
  Fosdinovo's is 3, 79.45 km²: its own tiles cut to the box (x −11500…−4000 by y −6100…2000 and x
  −11500…−6000 by y 2000…4000, as tile −3_1 is Fivizzano's) and the strip its box adds to
  Fivizzano's tiles, x −6000…−5300 by y 2000…13000. Each rectangle plus 100 m is asked for in turn,
  not the box round them (an L's notch would come too), whole and split in four wherever the `/map`
  call answers HTTP 400 (over 50 000 nodes in a box), each quarter in turn, then every multipolygon
  relation with a land-use, natural, building, leisure or amenity tag fetched whole
  (`/relation/<id>/full`), because most of a forest's member ways lie outside the play area.
  Elements are merged by id and written sorted: nodes, ways, then relations, each by numeric id. The
  build reads every part's extract of its region (`osmFiles`, in `PARTS` order) and merges them by
  id the same way (`readOsms`, `mergeOsm`): the earlier part's element wins where two hold one
  (neighbouring parts overlap by the margin at least, and one fetched on another day may differ),
  and each kind is ordered by numeric id, so the merge is what one fetch over every part would have
  written, and a region of one part reads exactly as its file does (the maps built from the moved
  `osm/lucido.osm.gz` and `osm/cesena.osm.gz` gunzip to the same bytes as from the single files
  before, and `pnpm map-diff` finds no differences, 2026-11-04). A regex reader parses the XML into
  nodes, ways and relations, and assembles multipolygon rings from member ways (unclosed chains are
  dropped). It copies each tag's value out of the XML text: a match is a slice of the text, and one
  kept name held it all (lucido's 37 MB, Cesena's 60 MB) until the map was written. OSM gives the
  road network and its names, water, rail, land use, barriers, POIs and place names. `pnpm fetch-osm
  pontremoli-town` writes OSM's buildings alone over that test region's part ([Test
  regions](#test-regions)).
- **The surveys of the ground**: Regione Toscana's large-scale surveys, and Regione Liguria's NC5
  past Tuscany's border, give the buildings with their surveyed eave elevations, the road surfaces
  (Tuscany's with their street names), and the area each survey maps. Each source has an adapter
  that reads it into one record (`Survey` in `ctr.ts`, [section 3](#3-features-featurests)), so the
  rest of the build reads every source alike; all five are CC BY 4.0 and credited in the README,
  `index.html` and the release notes. `shp.ts` reads Tuscany's shapefiles (latin-1 tables, or the
  DBT's UTF-8, with the NULs some pad a number with dropped), and a part's manifest lists what
  `fetch-rt` downloads of each ([Adding a part](#adding-a-part)); `fetch-lig` writes the NC5's
  layers as JSON.
  - **The CTR 1:2000 of 2019** (Carta Tecnica Regionale, adapter (a), `readCtr`): the sheets that
    map ground in a part's play area, listed in its manifest (`ctr`): lucido's 25 in
    `data/parts/lucido.json` (23D11–15, 23D18–21, 23D26–31, 23D34–37, 23D43, 23D46, 23D47, 23D53–55)
    and Fivizzano's 52 in `data/parts/fivizzano.json` (23D01–07, 23D11–15, 24D09, 24D17, 24D19–21,
    24D25–28, 24D30, 24D31, 24D33–39, 24D41–46, 24D49–54, 24D56–64 and 24E41; the two parts'
    23D11–15 are the same files, read once), and Fosdinovo's 31 in `data/parts/fosdinovo.json`
    (22C05–07, 22C13, 22C14, 23C13, 23C15, 23C16, 23C22, 23C23, 23C31, 23C32, 23C37–40, 23C45,
    23C53–56, 23C61–63, 23D17, 23D18, 23D25, 23D33, 23D41, 23D42 and 23D49, the issue's candidates,
    every one with mapped area in play; 23D18 is lucido's too). `crs.ts` converts their EPSG:6707
    (RDN2008 / UTM 32N) coordinates. Its layers: `AED` (the volumetric units, `Qt_grmax` the highest
    eave), `AGE` (garages and ruins, beside the rail's areas), `AVI` (road surfaces, 0101 asphalt
    and 0102 dirt, named by `Toponimo`) and `AZR` (the area each sheet maps). The 2019 sheets map
    the villages and the settled valley floors (Vinca, Tenerano, Ugliancaldo and the Solco quarries
    included): 11.1% of lucido's play area, 11.3% of Fivizzano's (16.42 of its 145.82 km², none of
    Sillano Giuncugnano's) and 8.4% of Fosdinovo's (7.10 of its 84.98 km²: 11.2% of the comune of
    Fosdinovo's, where the issue counted 14%, and none of Carrara's or Luni's); the mountains
    between them are unmapped. A sheet with no garages or road
    surfaces has no `AGE` or `AVI` layer, and one that maps no building has no `AED`: 24E41, whose
    mapped area is a 0.16 km² square of Fivizzano's mountains (x 7751…8158, y 8612…9018), where the
    map holds no building of any source.
  - **The CTR 1:2000 of 2009** (adapter (b), `readOldCtr`), flown in August 2009 for the Carrara and
    Massa side: the old schema, `AE_a` (buildings, `Codice` the same codes as 2019's, `Quota_gr` the
    eave), `ML_l` (man-made lines, among them the ruins, code 0205), `AV_a` (road surfaces: 0101
    asphalt and 0102 dirt; not 0114, a track in a tunnel, nor any surface in a tunnel, `Sede` 054:
    22D13's one, 444 m long and 1,724 m², would pave the hillside over the bore) and `AC_a` (code
    0906, the area the sheet maps), in EPSG:6707, read through the same `utm32ToLatLon` as 2019's
    (that way their corners land within 0.21 m east and 0.11 m north of round 100 m Gauss-Boaga
    corners). Lucido's manifest lists the 12 sheets whose `AC_a` meets it (`ctr2009`: 22D02–07 and
    22D10–15, 993.39 ha of it); no 2019 sheet's mapped area meets a 2009 sheet's. Over lucido they
    give 175 buildings: 140 units, all with an eave (house 65, shed 58, substation 10, industrial 5,
    silo 1, church 1), and 35 ruins of 4–263 m²; 88 road surfaces (12 named) and 14 mapped rings.
    Fosdinovo's manifest lists the issue's 9 (22C08, 22C16, 22D01, 22D02, 22D09, 22D10, 23C64, 23D57
    and 23D58; 22D02 and 22D10 are lucido's too), which give its part 661 buildings in its
    south-east, round Castelpoggio (x −6432…−3097, y −6067…−4185; house 436, shed 207, ruins 9,
    church 4, industrial 3, greenhouse 1, substation 1). The old schema has no garage code (no 0244
    in any layer of the 8 sheets read) and draws a ruin as a line: of the 115 lines of code 0205
    over the 12 sheets, the 61 that close on themselves outline a ruin's walls and are read as ruins
    (2.5 m, no eave), and the 54 open ones are wall stubs, which make no footprint (below). A ring
    that shares half its area with an `AE_a` unit of its own sheet is that unit's outline drawn
    again, and is left out (`readOldCtr`, `apartFrom` in `overlap.ts`): three of Castelpoggio's
    houses stood each in a ruin ring of its own, two buildings, roofs at two heights, in one
    footprint. Its
    licence: the archive's own `licenza_ccby_ver_4_2.pdf` says "Il dataset è rilasciato con licenza
    CC BY 4.0", while the cartoteca's GetFeatureInfo labels every CTR 1:2000 year, 2019's included,
    "Creative Commons Attribuzione 3.0 Italia". Both are CC BY; the credits follow the licence the
    dataset ships with, 4.0, as for 2019.
  - **The CTR 1:10 000 of 2010** (adapter (b) too): the same old schema and layers, one archive per
    section (`249020`), whose `AC_a` is the whole section; CC BY 4.0, as the 2010 edition's
    GetFeatureInfo and its `licenza_ccby_40.pdf` state. It maps all of Tuscany, so it is read only
    where a manifest lists a section (`ctr10k`), and lucido lists none: its outlines are coarser
    (inside the 2019 sheets' area 63.1% of the 2019 buildings' centroids fall in one, as it merges a
    terrace into one unit, and the matched centroids lie 1.88 m apart at the median), and its
    mapped area would drop every OSM building of a section, the huts the map keeps. Its road
    surfaces carry road numbers ("S.P. DI VINCA (N.59)"), never a street name, on lucido's four
    sections.
  - **The DBT 1:2000** (Database Topografico scala 1:2000, adapter (c), `readDbt` in `dbt.ts`): one
    `.7z` per comune and survey, in the national schema of DM 10/11/2011, EPSG:3003, CC BY 4.0 (its
    GetFeatureInfo and the archive's `licenza_ccby_PORCREO.pdf`). Pontremoli's of 2010 maps the town
    the 2019 CTR leaves out (#24), Zeri's of 2010 9.1 km² of its comune (#26); a part's manifest
    lists them (`dbt2k`): Fivizzano's Minucciano (046019) and Giuncugnano (046016, since 2015 in the
    comune of Sillano Giuncugnano), both surveyed in 2011 and listed at the user's choice
    (Minucciano's rather than its survey of 1988–2000), and the Pontremoli test region's ([Test
    regions](#test-regions)). They map 4.21 km² of Fivizzano's play area, 3.29 of it where no 2019
    sheet does (counted on 20 m cells), and give 1,467 buildings (house 948, shed 349, barn 74,
    garage 33, ruins 19, church 17, greenhouse 10, industrial 5, substation 4, tower 3, construction
    3, silo 2), 991 of them by Giuncugnano's archive and 476 by Minucciano's; the map keeps 1,464 of
    them, as 3 share half their area or more with a 2019 CTR unit, which comes first ([section
    3](#3-features-featurests)). The two archives are
    one survey's and both hold the 982 units of the land between the two comuni under the same RT
    numbers, each copy cut at its own archive's edge, so `readDbt` reads a record two archives hold
    once (`layer` in `dbt.ts`): of the units, the artefacts, the carriageways and the dirt tracks,
    the copy by its RT number (`RECORD_ID`) that covers the most ground, the first comune's by ISTAT
    code on a tie (Giuncugnano's, 046016, so most shared units carry its ids); of the road areas,
    whose `ar_str_id` names a road several of an archive's records share, every record but an
    identical copy (the same road, the same rings); and every zone, as the mapped area is their
    union, which a cut copy only shrinks. A road area's carriageway check reads every archive's
    carriageways, its own copy read or not. Read from both archives, 528 buildings stood twice; read
    from the first copy alone, Giuncugnano's cut copy of the zone RT0002010200010033 (30,445 m²,
    against Minucciano's 60,031) left 3 ha by the Carpinelli road unmapped, where 7 OSM buildings
    stood on the DBT's own units, and the unit RT0201010201051763 kept 17.4 of its 79.9 m². Its
    layers: `020101_un_vol` (the volumetric units), `020201_mn_ind` (industrial artefacts),
    `010101_ac_vei` (the carriageways, its road surfaces: paved unless `ac_vei_fon` is 02, named
    from their own copy of `ar_str_uff`, none in a tunnel, `ac_vei_sed` 06), `010104_ar_str` (road
    areas, read only for a road, by `ar_str_id`, with no carriageway: 161 of Pontremoli's 703, its
    old town's vicoli among them; paved and named), `010105_ar_vms` (dirt tracks) and
    `000201_zona_r` (the zones it maps). `crs.ts` gives it a residual of its own, `DBT_RESIDUAL`
    (−0.82, +0.70) m, fitted at Pontremoli on the 560 units the DBT and the 2019 sheets 25B24, 25B39
    and 25C33 both map (those sheets carry the same 2010 survey, its elevations equal to the
    centimetre): with it the two outlines lie within 0.01 m of each other, with the LiDAR's
    `GB_RESIDUAL` 0.47 m apart and with none 1.08 m. The LiDAR's own residual at Pontremoli is not
    known.
  - **Liguria's NC5** (DB Geotopografico National Core 1:5000, III edizione 3D, Regione Liguria's
    Geoportale id 2052; adapter (c) too, `readNc5` in `nc5.ts`): its La Spezia lot, valid from
    2018-11-19 (`inizio_val`), in the DBT's national schema, from the Geoportale's WFS in EPSG:25832
    (ETRS89 / UTM 32N, through `utm32ToLatLon` with no residual: Liguria's own transformer gives the
    same UTM point within 1 mm at Sarzana and at Bolano), 3D, CC BY 4.0 in its ISO metadata.
    `fetch-lig` writes a part's layers to `data/raw/lig/<part>/nc5/`. Its layers: `L6871`
    (buildings, "Edificio (ingombro al suolo)"), each its kind from `edifc_ty`, `edifc_uso` and
    `edifc_stat` through the DBT's `kindOf` (`edifc_ty` 11 a church, 07 a bell tower, `edifc_uso`
    08… industrial, 0603 and 060301 a station, `edifc_stat` 01 and 02 under construction and
    ruined, `edifc_uso` 09, the NC5's farm buildings, a barn, as 0902 and 0903 already were: 1,331
    of the 1,467 agricultural buildings over La Spezia's province); `L6870` (minor buildings,
    `edi_min_ty` and `edi_min_st` through the same rules: sheds);
    `L6858` (carriageways, "Area di circolazione veicolare"), its road surfaces: paved, as no field
    of it gives the surface, unnamed, and none in a tunnel (`ac_vei_sed` 03; 02, on a bridge, is
    kept, as the CTR's road surfaces keep their bridges); and `L6945`, the area the lot restitutes
    ("Porzione di territorio restituito"), one polygon of 942.57 km² over La Spezia's province, which
    `fetch-lig` clips to the part's box. A footprint's Z is its eave, and no field gives a height:
    2,092 of the 2,098 footprints round Sarzana's old town are flat, the five multipolygons step from
    part to part (`L6871.55788`'s three at 32.05, 34.47 and 25.98 m), so each polygon is a building
    with the highest Z of its rings. The minor buildings' Z is their eave too: over the LiDAR at the
    Sarzana test region's north edge the sheds stand 2.23 m over the ground at the median (10 of 15
    within 1.5–45 m) and the buildings 5.00 m (25 of 26). An id's section is the 1:5000 element of
    the feature's own reference (`classref`, `248082_1707522`: element 248082) and its local number
    the reference's serial and the polygon's place in the feature, the minor buildings' from 10⁹
    ([section 3](#3-features-featurests)); `ogr_fid` and the server's key (`id1`, its feature id
    `L6871.<id1>`) are serials of the database's load. A building or a carriageway on two parts'
    boxes is in both their files and read once, by its reference (`subregid` for a carriageway); the
    mapped area, one feature that `fetch-lig` clips to each part's box, is read from every part's.
    Fosdinovo's files (`fetch-lig fosdinovo`, 2026-11-07) hold 372 buildings, 287 minor buildings
    and 150 carriageways, which give the map 561 buildings in Castelnuovo Magra, Sarzana and Luni
    (house 298, one of them ruined, shed 251, barn 7, ruins 4, church 1); 2 more of its houses at
    the border copy 2019 CTR units outside the CTR's mapped area (the NC5's −1475896793484707 all
    of the CTR's −283940288538918), and go ([section 3](#3-features-featurests)).

  Left out, with the reason:
  - **The WFS sheet frame as the old schema's mapped area** (the issue's design): on 22D05 and 22D13
    the frame is a plain rectangle of 53.75 and 191.94 ha where the sheet's `AC_a` maps 5.62 and
    134.19 ha, so it would drop 14 OSM buildings in lucido with no CTR building to stand for them,
    and the server's EPSG:3003 frames moved 0.58–0.85 m between 2026-10-20 and 2026-11-03. On the
    1:10 000 the `AC_a` is the frame itself, densified (within 0.55–0.82 m of it), and the build
    could not read `rt-index`'s index anyway (`.research/` is gitignored).
  - **The CTR 1:10 000 of 2021**: the 2019 schema (`AED`, `AZR`) in EPSG:7791, but `Qt_grmax` is 0
    on all 1,155 units of section 249030 (only `Qt_grmin` is filled), so adapter (a) would read no
    eave; the 2010 edition is read.
  - **The old schema's open ruin lines**: 54 of the 115 `ML_l` lines of code 0205 over the 12
    sheets of 2009 are wall stubs, not rings, and a wall stub makes no footprint (of the 17 OSM
    ruins the 2009 sheets replace that no 2009 ring holds, 13 lie within 10 m of a stub: [Known data
    limitations](#known-data-limitations)). The rest of `ML_l`, other man-made lines, is not read.
  - **The DBT's road areas as its road surfaces** (the issue's `010104_ar_str`): RT's catalogue
    (v21) defines a road area as "il piano formato dalla carreggiata e dalle fasce di pertinenza,
    cioè banchine, marciapiedi e piste", and leaves the sidewalks out of a carriageway at 1:2000
    ("Nel caso del 2K vanno anche esclusi i marciapiedi"), as the CTR's road surfaces leave them out
    ("I marciapiedi non fanno parte della sede stradale", the CTR's codebook). Over Pontremoli's
    town rectangle the 116 road areas of roads with carriageways cover 242,669 m², their 440
    carriageways 209,972 m² (the SS62's 1,675 m² in a tunnel among them), and of the 146 OSM streets
    `fitRoads` fits on both, 47 came out 1 m or more wider on the road areas, 35 of them 2 m or
    more, at most 7.4 m (a 49 m piece of the SS62, 12 m against its carriageways' 4.6 m; Via
    Monsignior G. Sismondo, 471 m long, 12 m against 7.4 m).
  - **Porticoes, canopies and semi-basements**: the CTR codes 0240 and 0241, 0208 and 0235, and the
    DBT's units over porticoes (`un_vol_por` 03), underpasses (04), covered passages (09) and its
    semi-basements (08): open at ground level or under it ([section 3](#3-features-featurests)).
  - **The 2000 edition of the 22D sheets** (flown in May 2000): the 2009 edition of the same sheets
    is newer.
  - **The NC5's other layers**: its road elements (`L6864`, whose `el_str_fon` gives a surface, but
    as lines to be matched to the carriageways), its administrative roads' names (`L6939`, `L6940`:
    round Sarzana the A12, the SS1 and the SS62; no layer names a street, so the NC5's road surfaces
    stay unnamed and the build's name vote reads OSM's), its sidewalks (`L6859`, left out of the
    road surfaces as the CTR's leave them) and its spot heights (`L6911`).
- **CTR rail** (`ctr-rail.ts`): the same CTR's railway layers, in the 12 sheets the line crosses
  (23D01–03, 23D11, 23D15, 23D19, 23D27–30, 23D35, 23D36). The rail the map draws stands on these
  track centrelines, and the tracks only the CTR has come from them ([section
  4](#4-the-rail-on-the-ctr)).
  - `VLI` code `0117`: one centreline per track, switches not drawn (a diverging track ends
    beside the through track), none inside tunnels; 35 records, 39 lines. `ctr-rail.ts` chains them
    into tracks: two ends within 1.0 m whose headings run on within 10° join, nearest first, at
    their midpoint. Of the 14 joints, 13 match exactly (sheet edges, and splits within a sheet); the
    Monzone siding's ends at the 23D35/23D36 edge lie 0.465 m apart. Three collinear gaps stay open:
    3.5 m between the two parts of one 23D27 line at (−1355, 1436), 3.3 m between the two parts of
    23D02's at (−2701, 4671), and 8.3 m under the road bridge at (2350, 982). The lines are cut out
    of the `AFE` tunnel polygons (the 23D30 line runs 52 m into the Ugliancaldo tunnel) and clipped
    to the play area: 24 tracks, 11 276 m. No 2019 sheet maps the line from y 3725 north of Gragnola
    to 23D03 by Gassano, nor from Gassano to 23D01 by Rometta ([section 4](#4-the-rail-on-the-ctr)).

    | Where | Tracks, m |
    |---|---|
    | Gragnola, y 2930–3380 (1 035 m) | the east through track (447 of a 2 486 m track from (−1355, 1438) to y 3725, where the sheets stop mapping), the west loop (404), the stub to the south beside the loop (184) |
    | Monzone, x −830 to −380 (887 m) | the line (610 of 1 888 m from the Aiola tunnel to the Terma tunnel), the siding west of the station (278) |
    | Equi Terme, x 1700–2100 (1 001 m) | the line (398 of 1 625 m from the Onda tunnel to the road bridge), the second track in two pieces (142 and 163, apart at x 1868–1901 in front of the building), two yard sidings (124, 174) |
    | Pieve San Lorenzo, x 4664–5391 (1 900 m) | the line (791, from the Ugliancaldo tunnel's east portal to the Galleria del Lupacino's west portal), five station and yard tracks (393, 245, 224, 99, 54) and the siding only the CTR has (94) |
    | Gassano, x −3322 to −2083 (1 172 m) | the line by Fivizzano-Gassano's station (278 and 649, the two parts of 23D02's one record), and 245 east of the 169 m tunnel |
    | Rometta, x −5300 to −5008 (300 m) | the line to the west edge |
    | open line (4 980 m) | the rest of the first three stations' tracks (2 038, 1 279 and 1 228 m), 52 m at y 1383–1434 north of the Terma tunnel, 182 m between the Aiola and Onda tunnels, 201 m from the road bridge to the Ugliancaldo tunnel |

  - `AFE` code `0140`, the ballast bed (codebook: "sede di trasporto su ferro"), by `Sede`: 060
    at grade (52 polygons in the 12 sheets, 50 of them in the play area), 063 on bridges (`Livello`
    102; 31, 30 of them in the play area; the track on them is a bridge, [section
    4](#4-the-rail-on-the-ctr)), 054 in tunnels (9, all in the play area), 061 at the level
    crossings (6, 5 in the play area).
  - `AGE` code `0141`, station platforms (codebook: "marciapiede di stazione ferroviaria"): 9, all
    in the play area, 2 each at Gragnola and Monzone, one at Equi Terme, 3 at Pieve San Lorenzo and
    one at Gassano. The map's platforms and walkways are cut from them ([section
    9](#9-the-railway-railwayts-platformsts-rail-clearts)).
  - `AGE` code `0122`, the level-crossing areas: 6, 5 of them in the play area, one on each road
    crossing (Via Riolo, Viale 20 Settembre, Via Castel dell'Aquila over both tracks, Via Nuova, and
    the old SS445 by Gassano, road 689527853). No platform reaches into one, and the build checks
    that each holds a level-crossing node and that no node near one lies outside it ([section
    4](#4-the-rail-on-the-ctr)).

  The build keeps the platforms and level-crossing areas whose centroid lies in the play area,
  whole, as it keeps buildings (`heldInPlay` in `play-area.ts`, OSM's platforms too): the rail and
  roads are cut at the outline, so a level crossing beyond it would hold no level-crossing node
  (the build threw) and a platform would stand by the stub of rail the outline leaves.

  The codebook ("Tavola dei contenuti … 1:2000, livello 4.2", November 2011) gives `0140` and
  `0141` in its text; its code table for `0117` and `0122` is in fonts that do not extract, so
  those two are read from the geometry (the `0117` lines follow OSM's rail within 0.7 m at the
  median; the `0122` polygons sit on OSM's level-crossing nodes).
- **LiDAR**: Regione Toscana's 1 m digital terrain model, in EPSG:3003 (Monte Mario / Gauss-Boaga
  west), in the order each part's manifest lists it, the parts in `PARTS` order. Lucido's
  (`data/parts/lucido.json`) lists the 2010 flight (lot 004, 47 tiles) first, then the 2012 flight
  (lot 005, 19 tiles) for the Carrara side of the ridge and Monte Sagro, which 2010 flew only in
  part, then 19 more (17 of 2010, then 2 of 2012) for the cells of its tiles past its rectangle,
  which the box Fivizzano grew holds: 85 in all. Fivizzano's lists 102 of 2010 (the last 11 for the
  strip x −6000…−5300 that Fosdinovo's box adds to its tiles), as lots 003 (2011), 005 and 010
  (2006) give none of its cells first, and Fosdinovo's 32 of 2010, as lots 003 and 005 give none of
  its cells first either (lucido's 2012 tiles already hold 1.77 km² of Carrara in its play area).
  `crs.ts` converts with the EPSG:1660 datum shift
  plus a residual of (−0.4, +0.5) m, fitted by matching the 2010 surface model to the 2019 CTR
  building outlines. The MATTM 2008 flight (lot 006) adds nothing here and is CC BY-SA, so it is not
  used.
- **Terrain beyond the LiDAR** (issue #10): the cells no flight covers are filled by a fallback
  chain (`fill-chain.ts`; the sources as `terrain-sources.ts` reads them). Each source in turn fills
  the 1 m cells still empty that it has data for and may fill, and is bent onto every source before
  it (below), in this order:
  1. Regione Toscana's 2021 surface model (`DSM_autocorrelazione_2021`, 1 m in EPSG:7791, CC BY
     4.0, image matching of the 2021 flight), the elements the manifest lists (`dsm2021`), on open
     ground alone: the UCS 2019 classes without canopy (211 arable land, 231 meadows, 321 pastures,
     322 heath, 331 sand and gravel, 332 bare rock, 333 sparse vegetation, from the same WFS answer
     as the land cover), less what stands on it or sinks into it (`clearCanopy`). Its height over
     the 10 m DTM is opened and closed by a 9 m square; a cell 0.7 m over its opening or under its
     closing is a tree, a shrub or a failure of the image matching (pits up to 25 m deep), and so is
     every cell within 2 m of one (a crown's edge); the ground left is opened by the same square, so
     no scrap or strip of it narrower than 9 m stays among the fill. The pastures in the Apennine
     woods carry scattered trees, UCS's 1:10 000 polygons take in the woods' edge, and before this
     filter the seams round them stood up to 15 m high. It runs twice (`PASSES`), the second time
     over the ground the first left: a wood the pasture's polygon takes in is wider than the square,
     so the first clears it by its rough crowns alone, and the smooth canopy along its edge, as high
     as the lowest of a square on the wood, stayed as ground, its flank 3–12 m over the clearing.
     Under Fivizzano's ridge, at (10196, 10796), the 10 m DTM bent onto such a flank stepped 1.86 m
     at the seam, 1.70 m more than the terrain round it; measured on the clearing beside it alone, the
     second pass takes it. A third would take ground: where the surface model's ground and the 10 m
     DTM part by more than 0.7 m across a square, the edge of what the pass before cleared stands
     over its opening too, and each pass eats a few metres more (in the 300 m square round that
     pasture, 29,513 m² of open ground, the first pass clears 8,683 m², the second 1,820 with the
     wood's edge, the next four 627, 362, 377 and 273, at 1.4–2.7 m over the 10 m DTM like the
     clearing beside them). On Fivizzano the second pass clears 29,596 m² more of the 557,884 m² of
     open ground without LiDAR (236,469 m² in all), and the surface model fills 321,415 m² rather
     than 351,011; on the Bagnone ridge 0.16 km² more ([Test regions](#test-regions)). On bare
     rock the filter clears the rock's own relief too, and is meant to: there the model stands
     metres over the survey. Monte Sillara's
     summit, 1861 m on the maps and 1861.4 m on the 10 m DTM, tops out at 1863.8 m in the surface model; with
     the rock let off the canopy test it stood at 1866.2 m on the game's grid, more than 5 m too
     high, and the ridge's seams passed the terrain's own steps by 3.2 m.
  2. The 10 m DTM of each province the manifest lists (`dtm10`, in its order: Massa-Carrara's,
     `MS_dtm10x10_…_f691fc7f…`, and on Fivizzano then Lucca's, `LU_dtm10x10_…_da6bf64d…`, first used
     there for Minucciano and Sillano Giuncugnano), Regione Toscana's, derived from the CTR 1:10 000
     (CC BY 3.0 IT), whose data stop at about the province's border: on the Bagnone ridge
     Massa-Carrara's run 0.4 km² past the crest into Emilia (Monchio delle Corti, Corniglio), where
     it is taken before the DTM 5x5, and on Fosdinovo's part they run 0.04 km² into Castelnuovo
     Magra and 0.17 km² into Luni, where they are taken before Liguria's DTM. The canopy filter
     reads the 10 m DTMs together, the first with data at a cell.
  3. Regione Liguria's DTM ed. 2023 (Modello Digitale del Terreno, Geoportale id 2056, CC BY 4.0 in
     its ISO metadata), from the crops `fetch-lig` wrote for the part
     (`data/raw/lig/<part>/dtm/<i>_<j>.tif`: each 2 km tile round the chain's crop and 10 m round it,
     `dtmTiles`, the WCS's native cells as one deflated GeoTIFF; `fetch-rt` reads those tiles' crops
     alone): 5 m cells of whole metres in EPSG:3003, interpolated in La Spezia's
     province from the NC5's own heights (not a LiDAR), clipped at Liguria's border (under 1% of the
     Tuscan comuni beside it have data, the sea none). `ligRaster` pastes the crops onto the DTM's
     lattice and smooths the whole metres (`unround`): the smoothest surface (a membrane, each cell
     its neighbours' mean) within 0.5 m of each cell, by over-relaxed sweeps clamped to that band, in
     64 bits (in 32 the stored heights' rounding kept cells over 1024 m moving for ever: a crop raised
     1,500 m ran all 2,000 sweeps of `MAX_SWEEPS`, which `fetch-rt` reports reaching), 120 sweeps and
     2.0 s for the 1.29 million cells of the Sarzana test region's eight crops, sampled bilinearly in
     the crop's own EPSG:3003 (Liguria's transformer, on the IGM's
     grids, puts Sarzana 0.33 m from ours, a fifteenth of a cell). Rounded to whole metres, a plain
     that rises less than a metre a cell steps by a metre every few cells, which drew terraces across
     Sarzana's plain on the hillshade of the 2 m mosaic; a 5-cell binomial left them, and a blur wide
     enough to hide them would flatten the relief too. Over the 0.34 km² of LiDAR (2010, lot 004) in
     the Sarzana test region's mosaic the LiDAR stands 0.54 m over it on average and 3.00 m RMS apart
     at 342,976 points (0.51 m and 1.33 m at the 11,750 where the ground is under 3% steep), and the
     residual at the rim runs from −9.2 to +9.7 m. Its bend fades over 500 m (`LIG_FADE`, the
     filler's `fade`: the lattice pulls each node toward 0 by MU × (50 / 500)², so its membrane
     decays over that distance), as the NC5's eaves stand in the DTM's own frame: unfaded, the
     lattice carried the rim's residual on as a constant and lifted all of the test region's Liguria
     1.10 m, 4 km from its LiDAR, and the buildings' eaves stood that much lower over it (93.5% of
     them 1.5–45 m tall, against 97.1% faded). Faded, the terrain is Liguria's DTM within 0.04 m at
     the median 1–2 km from the LiDAR and 0.00 m past 2 km, 0.87–0.94 m within 250 m of it ([Test
     regions](#test-regions)). On Lunigiana it fills 2.38 km² of Fosdinovo's tiles' cells in
     Castelnuovo Magra and Luni, past the LiDAR and the 10 m DTM, 2.23 km² of them in play.
  4. Past Tuscany, Regione Emilia-Romagna's DTM 5x5 (CC BY 4.0), its WCS's native 5 m grid in
     EPSG:7791 over the box round the cells left. Issue #10 named TINITALY 1.1 (INGV, 10 m, CC BY
     4.0) here; Emilia-Romagna's survey is finer, under the same licence and already fetched for
     Cesena, and PR #2 had found TINITALY's valley floors 16–37 m off, so TINITALY is not used. On
     Lunigiana it fills only the cells of Fivizzano's tiles past the regional border by Cima
     Belfiore (754,707 m²), which the part's mask leaves out of play.

  The bend: the residual (better − filler) on the better cells within 2 m of what the filler
  filled is fitted by a membrane on a 50 m lattice (least squares on its bilinear, harmonic where no
  residual is, solved by conjugate gradients) and read bilinearly per cell: the residual's long
  waves, tens of metres across a big hole. What the lattice leaves at the cells beside the fill (the
  better source's relief finer than 50 m, which a 10 m DTM lacks) is carried 50 m in by a membrane
  on the 1 m cells (over-relaxed sweeps, held at that leftover beside the rim and at 0 past 50 m).
  Both cost a bounded amount per cell: a 5 km square hole in a tilted LiDAR fills in 1.7 s, 62 ns a
  cell (71 ns for a 1 km one), with no step over 0.1 m at its rim (`fill-chain.long-test.ts`); the
  inverse-squared-distance spread before cost the cells times the rim. Within 2 m, not only beside
  it: a pocket of surface model a cell or two off the LiDAR is bent onto it too, so the 10 m DTM
  between them finds them agreeing. Wider, the fit reads relief the hole does not share: with the
  better cells of the lattice cells round the hole it moved lucido's patches 1.6–3.7 m RMS from the
  fill before; with those beside it alone, 0.5–0.7 m.

  On lucido the chain fills the 0.65 km² of three patches: two on the slopes south of Tenerano,
  under the Rocca di Tenerano (0.360 km² round (−2000, −2942) and 0.269 km² round (−1058, −2725)),
  and one at the Cava Bardiglio by the Catino del Sagro (0.023 km² round (1666, −4468)). The surface
  model fills 0.018 km², all but 112 m² of it at the Cava Bardiglio (its elements 249062 and
  249064; the filter clears 0.014 km² of the 0.032 km² of open ground without LiDAR), within 1.1 m
  of the LiDAR at its rim, and Massa-Carrara's 10 m DTM the rest, its residual on the rim from −46.7 to +19.9 m. Against
  the inverse-squared-distance fill before, the 10 m DTM's cells moved 0.89 m RMS at the Cava
  Bardiglio and 0.72 and 0.93 m under the Rocca di Tenerano, the surface model's 1.03 m: the ground
  of 2021 in place of the 10 m map's. The cells of lucido's tiles past its rectangle, which
  Fivizzano's box adds (21.8 km²), take the 19 tiles its manifest gained but for a 7,893 m² hole the
  10 m DTM fills, and the manifest gained the surface model's element 249063 with them.

  On Fivizzano's tiles' cells (`fetch-rt fivizzano`, 2026-11-04, with the canopy filter's second
  pass) the surface model fills 321,415 m² (elements 234123, 234124 and 234164), the 10 m DTMs
  1,475,901 m² and Emilia-Romagna's DTM 5x5 754,707 m², round the one hole `pick-lidar` leaves: 2.55
  km² along the border with Emilia, centred at (10242, 11415), 872 × 3,307 m. Of the play area, 0.56
  km² has no LiDAR (0.21 in the comune of Fivizzano, 0.35 in Sillano Giuncugnano's), the surface
  model's on 0.23 km² of it and the 10 m DTM's on 0.33 km² (`pnpm coverage fivizzano`, [Adding a
  part](#adding-a-part)).

  On Fosdinovo's tiles' cells (`fetch-rt fosdinovo`, 2026-11-07) the chain fills the one hole
  `pick-lidar` leaves, 4.548 km² centred at (−6629, −5574), 4,201 × 1,674 m, in Carrara, Castelnuovo
  Magra and Luni: the surface model none of it, as the canopy filter clears all 8,017 m² of its open
  ground without LiDAR (elements 249052 and 249053), Massa-Carrara's 10 m DTM 2,170,939 m², its
  residual on the rim from −23.7 to +7.1 m and the bend's lattice within 9.2 m, and Liguria's DTM
  2,377,032 m², its residual from −14.3 to +18.4 m and the lattice within 9.5 m. Of the play area,
  4.42 km² has no LiDAR (1.93 in Carrara, 1.83 in Castelnuovo Magra, 0.65 in Luni; the comune of
  Fosdinovo is flown whole), the 10 m DTM's on 2.13 km² of it and Liguria's DTM's on 2.23 km²
  (`pnpm coverage fosdinovo`). Each of the 70,855,349 cells the tile files held before keeps its
  height to the bit, and where Fosdinovo's cells meet them the terrain steps only as the
  ground does (the most, 1.97 m at (−4040, 1552), is a bank).
- **Land cover**: Regione Toscana's "Uso e copertura del suolo" 1:10 000, 2019 (UCS, CC BY 4.0,
  0.5 ha minimum unit), from its WFS. OSM maps the woods and the quarries well but only about a
  fifth of the Apuans' bare rock and half their pastures, so `ucs.ts` adds the open covers: quarries
  (UCS 131), natural pastures (321), heath and scrub (322), bare rock and cliffs (332) and sparse
  vegetation (333). It also adds the rivers' gravel ("spiagge, dune e sabbie", 331: inland, the bars
  of the beds, 64 polygons and 17.9 ha on the Aulella and the lower Lucido, where OSM draws the
  woods the 2011–2014 floods scoured; the 2023 orthophoto shows open gravel there) and the water
  bodies ("corpi d'acqua", 512), but not one OSM already draws ([section
  3](#3-features-featurests): the one in the bounds is OSM's lake by the Solco di Equi). And it adds
  the woods by type, the trees' species' first clue (`src/render/trees.ts`): broadleaf woods (311)
  as `forest`, conifer woods (312) as `conifer` and mixed woods (313) as `mixed`. Inside OSM's
  forest the conifer and mixed woods refine it, and elsewhere a UCS wood holds only ground no OSM
  area claims ([section 3](#3-features-featurests)): in lucido's box the UCS's 51.5 km² of broadleaf
  woods lie 48.2 km² in OSM's forest and 2.19 km² on ground OSM leaves bare (the 2023 orthophoto
  shows the woods round the sound tests' meadow on Monte dei Bianchi, (−329, 1078), where OSM maps
  none), its 0.45 km² of
  conifer woods (all at 800–1400 m, the plantations) and 0.74 km² of mixed ones (600–1200 m) 82% and
  94% in OSM's forest. OSM's own `leaf_type` tags one wood in the box, so it is not read. And it
  adds the olive groves (oliveti, 223) as `olive` and the vineyards (vigneti, 221) as `vineyard`,
  which OSM maps little on the hills: in Lunigiana's box before Fosdinovo's part the UCS draws 452
  olive groves, 719 ha at 143–693 m (half below 376 m), and 393 vineyards, 155 ha, where the OSM
  extracts hold 9 orchards, none tagged with its trees, and 6 vineyards (2026-11-07); Fosdinovo's
  land cover adds 453 olive groves and 483 vineyards of the UCS's over its terrain, and 21 olive
  groves and 7 vineyards of Liguria's (below). They draw over OSM's woods, its open
  covers, grassland, farmland and residential land, and under its farmyards, parks, squares and the
  like ([section 3](#3-features-featurests)), as the 2023 orthophoto bears out where they overlap
  the woods, grassland and fields (2026-11-07, 22 olive and 23 vineyard patches checked by eye, the
  overlaps counted in patches of 0.1 ha or more): under OSM's farmland (11 ha) the olive groves are
  kept rows, under its grassland (10 ha) two thirds olives, and under its forest (115 ha) 28% kept
  olives, 26% olives the woods are taking back and 44% closed wood; the vineyards under its forest
  (9 ha) 44% vines and 33% wood, under its farmland (20 ha) 57% vines, and of 7 UCS vineyards no
  OSM area overlaps, about half the area is still worked, the rest gone back to grass, scrub or
  young wood since 2019. Past Tuscany's border, Regione Liguria's land use 1:10 000, ed. 2025 (Uso
  del Suolo, Geoportale id 2660, CC BY 4.0; its woods surveyed again to 2024, the rest of La
  Spezia's province of 2019) takes the same place: Corine's classes, to the fourth level (5121
  natural basins, 2211 vineyards mixed with olives, 3111 holm oak and maquis), in EPSG:25832, read
  by their first three digits through the same `UCS_CODES`, so its broadleaf woods (3111–3115) are
  `forest` and its abandoned olive groves (2231) `olive`, but where the fourth names another kind
  (`kindOfCode`): its vines mixed with olives (2211) are olive groves, and its vines and other
  permanent crops left untended (2212) no kept class. `fetch-lig` writes the polygons of the kept
  classes (the query asks by the third digit, and `kindOfCode` drops a 2212) to
  `data/raw/lig/<part>/uds.json.gz` as `ucs.json.gz` holds Tuscany's (each polygon's `ID_RLIG`, its
  whole code, its rings on the decimetre), and `readUcs` reads each file by its `crs`, a polygon two
  parts' files hold once. On the Sarzana test region, fetched before the woods, the olive groves and
  the vineyards were kept, it holds 8 natural basins (5121) and 2 of the Magra plain's quarries
  (131); `pnpm fetch-lig sarzana-town` brings the rest (a 2.6 km² box of the town held 4 olive
  groves, 2 vineyards and 2 vines mixed with olives on 2026-11-03). In the lower Val di Magra its
  sand (331) is the coast's beaches, and the Magra's bed is a river bed (5111, with its channel),
  which no kept class takes.
- **Forest inventory, for constants only**: Regione Toscana's Inventario Forestale (IFT, WFS
  `ms:rt_ucs.idift.rt.all` on `map=wmsucs`, 400 m cells with each sample point's species
  `SPECFOR_1`, `QUOTA` and `ESPOSIZ`) has no licence record (its capabilities say only
  "AccessConstraints none"), so none of it is shipped. Issue #14 tabled its beech shares by band
  over the 14 Lunigiana comuni, which `BEECH` in `src/render/trees.ts` follows and
  `trees.map-test.ts` checks; on 2026-11-03 its 2,876 forest points round Fivizzano, Casola and
  Comano (lon 10.0–10.3, lat 44.1–44.35) gave the oaks' shares of the broadleaf on south and north
  faces by band (`OAKS`; the Massa-Carrara points alone give the same below 400 m to 0.1 point) and
  the conifers' at 800–1400 m and elsewhere (`CONIFERS`). A logistic fit to its forest points
  (maximum likelihood, flat ones out) puts the beech's belt at 1115 ± 15 m, 96 ± 6 m wide and 58 ±
  21 m lower on north faces over the 2,141 in Massa-Carrara, and 1134, 87 and 52 m over all 2,833.
- **The Aulella's catchment**: one published figure, the 208 km² ARPAL's Annali Idrologici 2017
  (part II) give the Soliera gauge, taken as a fact: the rivers' discharge per km² is fitted to the
  gauge's flows over it ([water.md](water.md#sources)); no ARPAL data is shipped. The map's
  catchments are the DTMs' own: the gauge's delineation is 3.6% larger than the basin a D8 on
  Massa-Carrara's 10 m DTM gives above Soliera (200.73 km²), and the map's reads 196.8 there
  ([section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)).

- **Verification only, never data**: the AGEA 2022 orthophoto (Regione Toscana's OFC WMS, "©
  AGEA, licenza d'uso concessa a Regione Toscana"; Regione Liguria's copy, Geoportale id 2555, WMS
  `M2555` layer `L10401`, 0.20 m, names AGEA its owner and no licence, only "Nessuna condizione
  applicabile", so it is looked at, never traced), read by eye to settle Gragnola's track layout
  ([section 4](#4-the-rail-on-the-ctr)); RFI's station pages (rfi.it/it/stazioni: Gragnola,
  Monzone-Monte dei Bianchi-Isolano, Equi Terme), read for the tracks in use and that no platform
  on the line is raised to 55 cm (the platforms' height,
  [section 9](#9-the-railway-railwayts-platformsts-rail-clearts)).

`pnpm fetch-rt <part>` (`src/tools/fetch-rt.ts`) downloads the surveys (the CTR sheets of 2019 and
2009, the CTR 1:10 000 sections, the DBT's comuni), the LiDAR tiles, the terrain chain's sources and
the land cover. What it downloads is listed in the part's manifest, `data/parts/<part>.json`
(`manifest.ts`: `ctr`, `ctr2009`, `ctr10k`, `dbt2k`, `lidar`, `dtm10`, `dsm2021`); a cell of the
mosaic keeps the first tile's value, every Lunigiana part's manifest in `PARTS` order and each in
its own, so the order of the `lidar` lists is the priority, and Emilia-Romagna's DTM is asked for
only when cells are left past the Tuscan sources. It copies the 2019 sheets' layers the build reads
(`AED`, `AGE`, `AVI`, `AZR`, `AFE`) to `data/raw/rt/ctr`, and of `VLI` (42 MB over lucido's 25
sheets, mostly contour lines) only the `0117` track centrelines (29 KB, 9 KB gzipped), through
`subsetShp` in `shp.ts`, which renumbers the records and rewrites the file length, bounding box, z
range and record count. Of each 2009 sheet it copies `AE_a`, `AV_a`, `AC_a` and, cut by `subsetShp`
to the ruins (code 0205), `ML_l` to `data/raw/rt/ctr2009/<sheet>_<layer>` (the archive names them
`<sheet><layer>`, with no underscore; a sheet that maps no building or road lacks the first two:
lucido's 22D02, 22D06 and 22D07 have no `AE_a`, the last two no `AV_a`, and a sheet that draws no
ruin gets no `ML_l`: 22D06 and 22D07 again), and of each 1:10 000 section the same to
`rt/ctr10k/<section>_<layer>`, with the four fields of `AC_a` that name the people who led the work
and did its survey, photography and drawing blanked (`SURVEYORS` in `cartoteca.ts`: `Dir_lav`,
`Coll_top`, `Coll_fot`, `Coll_inf`; the firm, `Ditta_es`, stays), since a pinned file is published:
the archives fill 56 such fields, the pinned copies none (`ML_l` has no such field). Of a comune's
DBT it pins the six layers to `rt/dbt2k/<ISTAT>_<layer>` (`045014_un_vol`), only the records whose
box meets the part's EPSG:3003 box + 500 m on whole metres outwards (`meetingBox`), since the
archive holds the whole comune, and throws when no mapped zone meets it; no field of the six names a
person (`zona_r_dt` names the survey firms). As the files go by the comune's ISTAT code alone, a
manifest lists one survey a comune: `readManifest` refuses two ("dbt2k lists one comune twice"),
whose files would overwrite each other. The DBT comes as `.7z`, which `rt-cache.ts` extracts with
`bsdtar` (libarchive's: on macOS by default, `libarchive-tools` on Debian and Ubuntu), every layer
named in one call, since a call decodes the archive's whole solid stream (1.7 s for a comune's,
whatever it extracts); a cached folder missing one is extracted again. CI never runs `fetch-rt`, so
it needs neither `unzip` nor `bsdtar`. On 2026-11-03 the 12 sheets of 2009 (57,039,469 B) downloaded
in 66.5 s one at a time and `pnpm fetch-rt ctr` wrote their 82 files (328,329 B; 20 of them the
`ML_l` of the 10 sheets that draw a ruin, 12,580 B), the 2019 sheets' 234 unchanged. It mosaics the
LiDAR and the chain past it into one file a 2 km map tile, `data/raw/rt/dtm/<i>_<j>.bin`
(`dtm-tiles.ts`, `fetch-dtm.ts`): the tiles the part's rectangles meet, each over its square cut to
the region's box and `HALO` (32 m) round it, on one lattice of 2 m cells in EPSG:3003 (`LATTICE`,
the first cell of lucido's mosaic of `raw-20261101`, so its cells are that mosaic's to the bit). A
file is the deflate of a JSON line (its first cell, its size, its sources' names), then the heights,
int16 decimetres, each row delta-coded, and a byte a cell for its source (the most of its four 1 m
cells', ties to the earlier), or none where no fetch computed one. A cell a tile's file holds stays
as it is: the crop is seeded with them (`tileCrop`), the LiDAR and the chain fill only the cells
none holds, and the chain's bend meets the held ones, so a part's fetch never moves another's cell
and joins it without a step; to fetch a part's terrain again, delete its tiles' files first. The
build reads the region's listed tiles' files (`loadDtm`), and throws, naming the tile, when one is
missing or leaves a cell empty that the region's box needs: a part grew the box, and the fetch of
the part that tile belongs to has not run since. A test region builds on the files there are
instead, a cell none holds drawn on from the edge (`drawEdgesOn`; `dtm.test.ts` checks both).
Lunigiana's 102 files hold 63.6 MB (2026-11-07; its 79 held 48.9 MB before Fosdinovo's part). It
holds the mosaic in 1 m cells of float decimetres, so a LiDAR cell keeps its whole decimetre and a
2 m mean of four LiDAR cells is what it was before the chain. A test region with terrain of its own
writes one mosaic over its rectangles plus 32 m instead: `dtm.bin` (the heights, int16 decimetres,
each row delta-coded, deflated), `dtm-src.bin` (each cell's source, deflated) and `dtm.json` (the
cells and the sources' names). With `--region bagnone-ridge` it writes that test region's terrain
alone ([Test regions](#test-regions)) from `data/parts/sillara.json` into
`data/raw/rt/bagnone-ridge/`, and with `--region pontremoli-town` that test region's surveys alone,
from its manifest into `data/raw/rt/pontremoli-town/` (`surveyDir` in `region.ts`), then stops with
no terrain or land cover; it refuses a test region with nothing of its own and a stage for one with
something of its own (`fetch-rt.test.ts`). From the archive cache lucido took 22.7 s and peaked at
1.80 GB resident (the LiDAR's text grids) on its own mosaic, and the ridge 13.5 s and 1.31 GB
(2026-11-01); on 2026-11-04 lucido's completion (its tiles' cells the grown box added) took 69 s and
1.77 GB and added 5,683,663 cells to 15 of lucido's 30 files (15,675 in −1_1 to 574,694 in −2_1),
and Fivizzano's first fetch, with its downloads, 232 s and 3.51 GB, again from the cache 85 s. On
2026-11-07, with their downloads, Fivizzano's again, for the strip x −6000…−5300 that Fosdinovo's
box adds to its tiles i −3, took 235 s and 2.38 GB and added 2,035,920 cells to those 6 files
(192,953 in −3_6 to 369,220 in −3_2 and −3_4), and Fosdinovo's first 115 s and 2.02 GB, writing
its 23 tiles' files (71,253 cells in −6_−4 to 1,093,070 in −3_−3; −3_1 is Fivizzano's, already
whole). It writes the kept land-cover polygons, in EPSG:3003 to the decimetre, to
`data/raw/rt/ucs/<part>.json.gz` (`crs.ts` has the inverse transform; lucido's 1,671 polygons,
Fivizzano's 3,709, Fosdinovo's 2,381), over the part's terrain, keeping by id the polygons the file
already holds, so a later fetch only adds; the WFS box is padded by 500 m, because the server's box
filter sometimes drops features near its edge. `pnpm fetch-rt ctr` fetches the surveys alone (the
2019 sheets took 28 s with their downloads; 2.23 s and 128 MB from the cache with the 2009 sheets
and their ruins, 2026-11-03), leaving the LiDAR and the land cover, which comes from a live service
and would move the map, as they are; `pnpm fetch-rt ucs` fetches the land cover alone (on 2026-10-31
the service gave the 425 pinned polygons of the five open covers back byte for byte, and 83 of codes
331 and 512 besides; on 2026-11-03 the 508 pinned then, and 540 woods besides: 478 broadleaf, 24
conifer and 38 mixed, which took the file from 208 KB to 649 KB; on 2026-11-07, with the olive
groves and vineyards kept, `pnpm fetch-rt lucido ucs` added lucido's 192 olive groves and 183
vineyards in 4.3 s, taking its file from 773 KB to 840 KB, and `pnpm fetch-rt fivizzano ucs`
Fivizzano's 490 and 441 in 8.0 s, 1.74 MB to 1.90 MB, every polygon of the other classes as pinned;
and Fivizzano's fetch for Fosdinovo's grown box added 300 polygons, all of them in the strip, taking
its file to 2.04 MB). A file whose unpacked bytes equal the new ones is not rewritten, so another
zlib never churns a pinned file, and a cached `.zip`'s folder that lacks a file the archive lists is
extracted again, the archive downloaded again if it went too (`fetchZip` in `rt-cache.ts`): macOS
purges the temporary directory's files one by one and keeps its folders, and a 10 m DTM's folder
kept its licence and lost its grid, which `fetch-rt` then did not find. Requests name only the
project in their `User-Agent`.

`pnpm fetch-lig <part>` (`src/tools/fetch-lig.ts`, the services in `liguria.ts`) downloads Regione
Liguria's sources over a part's rectangles from the Geoportale's GeoServer into
`data/raw/lig/<part>/` (`ligDir` in `region.ts`): the NC5's four layers, the DTM's crops and the land
use, above. Its conversions are `liguria.ts`'s (`nc5File`, `clippedRings`, `udsPolygons`), and its
files go through `writeRaw` in `raw-lock.ts`, as `fetch-rt`'s do. The WFS's box filter matches a feature's bounding box (a superset of the features that
meet the box), a page holds at most 5,000 features whatever count is asked, and a page asked without
a `startIndex` comes back unsorted, in an order that changes from call to call: so `fetchWfs` asks
the count first (`resultType=hits`), then each page from its `startIndex`, sorted by a unique field
(`ogr_fid`, or the land use's `ID_RLIG`), and refuses unless the pages hold that many features, each
once, in order. The issue's pages repeating without `sortBy` did not reproduce: round Sarzana on
2026-11-03, 25,513 buildings came back 25,513 unique either way while every page named its
`startIndex`. The box is the part's EPSG:25832 box, on whole metres outward; the land use's is a CQL
filter with the kept classes (`COD_USO LIKE '131%' OR …`), as the server takes a `bbox` or a filter,
not both, and its sea, one polygon of 1,071 km² and 1.4 MB, would come with every box on the coast.
Each feature's attributes are written as served (codes, their labels, ids and dates: no field names
a person) and its coordinates on whole centimetres, without the answer's `timeStamp` and page links,
which change on every call, so two runs write the same bytes. The DTM's crops are WCS 2.0.1
`GetCoverage`s with their edges on the lattice's own (`X` and `Y` subsets at 1379054.19189 + 5i and
4947084.40548 − 5j, `dtmCropUrl`): 1.0.0 resamples onto the box asked, moving the cells up to half a
cell, and the server deflates a crop only when it fits one TIFF tile, so a crop is asked as one of
512 cells a side. The tiles are those round `fetch-rt`'s crop of the part (`dtmTiles`: the local box
round its EPSG:3003 corners, a notch between rectangles and the crop's margin included, as the
chain fills the whole crop and nothing past Liguria's DTM has data there), each crop its tile's
EPSG:3003 box plus 10 m. A tile wholly beyond the coverage (the server's 404 "Empty intersection
after subsetting", `beyondCoverage`) or without a cell of data is left out, any other error stops
the run, and a crop an earlier run wrote that this one does not (the part shrank) is deleted with
its lock entry (`staleCrops`, `dropRaw`; a dotfile such as Finder's `.DS_Store` is no input and
stays). `fetch-rt` reads the crops of those tiles as its chain's third step, so
`fetch-lig` runs first. On 2026-11-03 two runs for `sarzana-town`, its folder moved away between
them, wrote the same 13 files in 3.5 s (890,274 B: the NC5's four 539,768 B, the eight crops
348,116 B, the land use 2,390 B). For `fosdinovo` on 2026-11-07 it wrote 15 files in 18.5 s
(553,704 B): the NC5's four (109,225 B), 10 DTM crops (406,823 B: the tiles i −6…−3 of j −4 and −3,
and −6_−2 and −6_−1; the other tiles round its crop lie past the coverage or hold no data) and the
land use's 61 polygons (37,656 B).

### 2. Projection and play area (`geometry.ts`, `play-area.ts`)

The map is projected onto a plane, and everything in it is clipped either to the play area, the
union of the region's parts, or to the built terrain, the box round them.

Equirectangular around `ORIGIN` (lat 44.16175, lon 10.13; defined in `src/sim/map/kinds.ts` and
written into the map file as `MAP.origin`, which the sky reads through `place()`), with
`M_PER_DEG` = 111115.37 m per degree of latitude and 79987.94 m per degree of longitude. x = east,
y = north, in metres, rounded to 0.1 m. Lunigiana's play area is three parts (`PARTS` in
`region.ts`, for `fetch-rt` and the part tools: [Adding a part](#adding-a-part)), 308.8 km²:

- **`lucido`**, the rectangle x −2900…4900 m, y −6100…3900 m (7.8 × 10 km; lat 44.1069–44.1968, lon
  10.0937–10.1913): the whole catchment of the Lucido, ridge to ridge, from its mouth in the Aulella
  below Gragnola up both branches. Up the Vinca branch: the SP59, Vinca and its valley to Foce di
  Vinca, the Garnerone and Foce di Giovo, with Monte Sagro, Monte Borla and their quarries on the
  ridge. Up the Equi branch: Equi Terme, the Solco di Equi and its quarries, Pizzo d'Uccello and
  Ugliancaldo. West of the Lucido: Tenerano and the SP10, Viano, Pieve di Viano, Colognola,
  Campiglione and Vezzanello; Monzone, Aiola, Codiponte and Casciana in the middle. Being a
  rectangle, it also takes in some of the Aulella side (Argigliano), the Bardine side and the
  Carrara side of the ridge (Campocecina).
- **`fivizzano`** ("Fivizzano, Casola and the upper Aulella", issue #17), north and east of it,
  145.82 km² (lat 44.1537–44.2787, lon 10.0637–10.2625): issue #17's L, the rectangle x −5300…10100,
  y 3900…13000 (15.4 × 9.1 km: the Aulella from Soliera, where it leaves the play area at x −5300,
  up past Casola in Lunigiana to its heads; the Rosaro with Fivizzano, Gassano, Moncigoli and
  Verrucola, and the SS63 up to Passo del Romito; Mommio, Cima Belfiore and Monte Tondo on the
  Apennine ridge) and its leg x 4900…5700, y −900…3900 along lucido's east side (Pieve San Lorenzo
  in Minucciano, the station and the rail to the Galleria del Lupacino), and two rectangles of
  Lucca's land the runbook's footprint critic added (issue #3, step 1) so that no permanent edge
  cuts a village, the user's choice: x 5700…6700, y 2900…3900, so Pieve San Lorenzo, Novella and
  Renzano stand whole, and x 10100…10600, y 4600…7800, so Magliano, Varliano and Montale do. Its
  mask, a ring of 42 vertices on 0.1 m, is the rectangles less Emilia-Romagna, which lies 0.76 km²
  into them north-east of Cima Belfiore: the regional border as OSM maps it (ways 783897858,
  866778403 and 443598856, `admin_level` 4, fetched 2026-11-04) from (10100, 11909.4) on the east
  side to (8939.6, 13000) on the north. Round the summit, whose peak node (577763720, at (9705.5,
  12014.0)) OSM puts 3.6 m beyond the border, in Ventasso (the landmark point (9706, 12014), the
  node to the metre, 4.1 m), the mask bends out to (9726, 12014), so the summit plays. The
  rectangles hold 146.6 km², the play area 145.82.
- **`fosdinovo`** ("Fosdinovo, the Bardine valley and the Apuan foothills", issue #18), west of
  lucido and south of Fivizzano's part, 84.98 km² (lat 44.1069–44.1968, lon 9.9862–10.0937): the
  rectangle x −11500…−2900, y −6100…3900 (8.6 × 10 km: Fosdinovo and its Castello Malaspina on
  their crag; the Bardine valley with Tendola, Ponzanello, San Terenzo Monti, Bardine and Ceserano,
  down to where the Bardine leaves at y 3900; Marciaso, Pulica and Gignago; the SP72 from
  Caniparola on the Magra plain over Foce del Cucco toward Aulla; and on the Apuan foothills La
  Pizza, Monte La Pianaccia and Carrara's Castelpoggio) less Carrara's corner. Its mask, a ring of
  17 vertices on 0.1 m, runs from the south-west corner along y −6100 to (−4000, −6100), up x −4000
  to (−4000, −5025.3), then east along the line 1 km beyond the extent's comuni to (−2900,
  −5324.9): their OSM boundaries (`admin_level` 8 relations Carrara 42819, Fosdinovo 42880,
  Castelnuovo Magra 42852, Luni 42833, Sarzana 42821, Fivizzano 42886, Aulla 42922 and Massa 42813,
  fetched from the OSM API on 2026-11-07), buffered 1 km and simplified to 2 m. On that line alone,
  the issue's mask, the runbook's footprint critic (issue #3, step 1) found Castelpoggio 89 m past
  the edge and the SP73 out 1,985 m and back, so the mask bends out east of x −4000, the user's
  choice: Castelpoggio (node 579493397, 1.29 km into Carrara) plays whole and the SP73 leaves the
  play area once, toward Gragnana. Castelnuovo Magra, Sarzana and Luni, in Liguria, play, as #12 has
  landed (the user's choice). Of its 84.98 km² Fosdinovo holds 44.68, Fivizzano 20.02, Aulla 8.84,
  Carrara 6.31, Castelnuovo Magra 3.48, Sarzana 1.00 and Luni 0.65; the rectangle holds 86.0, and
  the issue's mask would have played 83.98.

- **The play area** is the union of the region's parts, each its mask or else its rectangles.
  `play-area.ts` works out its outline (`OUTLINE`, written into the global file as `outline`):
  every piece edge is cut where another piece's edge crosses or ends on it, a cut piece is outline
  where the union holds the point just left of its middle and not the point just right, and the
  pieces, rounded to 0.1 m, chain into rings (outer counter-clockwise, holes clockwise, collinear
  runs merged, each from its lowest (y, x) vertex). A chain turns as far left as it can, so no ring
  crosses itself, and is cut at every vertex it passes twice, so two outer rings touching at a
  corner, or a hole touching the outer ring or another hole, stay separate rings. Lunigiana's
  outline is one ring of 59 vertices from Fosdinovo's south-west corner (−11500, −6100), its seams
  inside it: lucido's with Fivizzano (y 3900 for x −2900…4900, x 4900 for y −900…3900) and with
  Fosdinovo (x −2900 for y −5324.9…3900), and Fosdinovo's with Fivizzano (y 3900 for x
  −5300…−2900); south of y −5324.9 lucido's west side is outline, along Carrara's cut. Cesena's is
  its square, south, east, north, west. Only + − × ÷ and square roots go into it, so every
  architecture builds the same.
- **The built terrain** is the box round every part's rectangles, `BOUNDS` (`REGION.bounds`,
  written as `bounds`): the heightmap's extent. On Cesena it is the play area; on Lunigiana it is x
  −11500…10600 by y −6100…13000 (22.1 × 19.1 km, 132 tiles), and the play area leaves out the land
  north-west of Fosdinovo's part (x −11500…−5300 north of y 3900), the land east of lucido south of
  y 3900 (but Fivizzano's leg and its rectangle by Pieve San Lorenzo), Carrara's corner south of
  Fosdinovo's mask, the strips past x 10100 (but Magliano's rectangle) and Emilia's corner; 30 of
  the tiles hold none of it and are unlisted, in two notches: i −6…−4 for j 2…6, and i 3…5 for
  j −4…0 ([Map files](#map-files)).
- **Lines** (roads, water, rail, barriers and the CTR's tracks) are clipped to the play area
  (`clipToPlay`): each segment is cut where it crosses the outline and each stretch kept by its
  middle. Original vertices keep their OSM ids and cut points have none, which is how the
  road-exit caps, the graph's exits and the rail's terminals find where a line leaves; a water
  piece also keeps how far along its way it starts (`clipPieces`, `WaterF.from`), which its bank
  trees count from. On a
  vertical or horizontal edge the cut is Liang–Barsky's to the bit (t = (X − a.x) / dx). A cut on
  the same 0.1 m point (the grid the map is written on) as the vertex beside it takes that vertex's
  place, the vertex's id dropped from that line (the cut keeps none, which is how those stages find
  where it leaves; no such vertex is a junction today), and a piece left on one point is
  dropped, so no piece ships a segment of no length: Fosdinovo's west edge passes 4.6 cm from node
  14103781003 of driveway 1550647991, which repeated (−11500, −3933.8), a road-graph edge of 0 m
  that broke the traffic graph's and the rail's checks, and the L test region's road 1002673816
  repeated (0, 1912.5) at its notch's side; their road-exit caps moved 0.90 and 0.77 m, and Cesena's
  map is unchanged. A stretch
  shorter than 10 µm between two crossings is a corner passed, too short for its middle to tell:
  past a convex corner it is left out, as Liang–Barsky takes the later of two entries, and past a
  reflex one (both stretches beside it in play) it is kept, so a road round an L's inner corner is
  not cut in two. The roads, water and rail are also cut to what lies beyond the outline in the
  box (`clipBeyond`), for the trees there to keep off ([section
  12](#12-trees-spawns-districts-treests-spawnsts-districtsts)), and the water for the catchments
  to burn, so a river the outline cuts drains on down it ([section
  6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)); the map never carries
  those.
- **Rings** (OSM and UCS areas, the surveys' road surfaces and mapped areas, the CTR's rail
  polygons) are clipped to the built terrain's box with Sutherland–Hodgman, which only a convex
  window clips right. **Buildings** are clipped to it too, then kept only where the centre of the
  clipped outline (its vertices' mean) is in the play area: a house an outline edge inside the box
  cuts (an L's notch, a mask) stands whole or not at all, while one across the box's edge is clipped
  to it and kept by the centre of what is left (33 of Lunigiana's 24,331 and 66 of Cesena's 9,688
  end on its edge). So are the level crossings and platforms (`heldInPlay`), which belong to the
  rail and roads the outline cuts.
- **Points**: POIs, OSM place nodes, the player's spawn (1.3 m from the outline) and the parked
  spots (5 m) must lie in the play area (`inPlay`, an edge counting as in it). Trees cover the
  region's tiles, beyond the play area too, 1 m inside the built terrain's box ([section
  12](#12-trees-spawns-districts-treests-spawnsts-districtsts)), so the tiles an L leaves unlisted
  have none.

### 3. Features (`features.ts`)

- **Roads**: OSM highway classes `motorway`, `trunk`, `primary`, `secondary`, `tertiary`,
  `unclassified`, `residential`, `service`, `track`, `path` and `steps` (`ROAD_CLASSES` in
  `kinds.ts`, widest first), plus the values folded into them. Each link folds into the class below
  and keeps its `oneway`: `motorway_link` and `trunk_link` are `primary`, `primary_link`
  `secondary`, `secondary_link` and `tertiary_link` `tertiary`. `living_street` is `residential`,
  `footway` and `pedestrian` are `path` (and in Cesena `cycleway`). The Lucido valley holds one main
  road, the SR445 della Garfagnana through Gragnola and Codiponte (OSM `primary`, 12 pieces on
  lucido); its SP10 and SP59 are OSM `tertiary`. Fivizzano adds the SS63 del Valico del Cerreto from
  Soliera through Fivizzano to Passo del Romito and the y 13000 edge (`primary`, 70 pieces), the
  SR445 on through Casola and Pieve San Lorenzo (72 pieces in all, 6 of them `secondary`) and the
  secondary SP52 di Magliano and SP67. Fosdinovo adds the SP72 from Caniparola up through Fosdinovo
  and over Foce del Cucco toward Aulla (`primary`, 43 pieces, 17.7 km), the SP73 from Fosdinovo
  down to Castelpoggio and out toward Gragnana (14 `primary` pieces, then 7 `secondary`), the SP57
  by Ponzanello (14, `secondary`) and the SP9 west from Foce del Cucco (11, `secondary`):
  Lunigiana holds 193 primary and 55 secondary pieces. A
  highway way tagged `area=yes` is a square, not a road (a pedestrian square becomes a `paved`
  area). A highway way tagged `railway=platform` is a platform OSM drew as a line (Pieve San
  Lorenzo's two footways along its edge, ways 1442184593 and 1442184594), not a path beside the
  track: it is skipped, and the platforms come from the CTR's outlines or OSM's platform areas
  ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)). Other highway values are
  skipped. The ways keep `oneway`, `bridge`, `tunnel`, `layer`, `maxheight` and private access, and
  a tunnel through a house (`tunnel=building_passage`) is a `passage` too, which the game draws on
  under the house with no bore or portal (30 on Lunigiana, 22 on Cesena). A motorway, a
  `motorway_link` and a roundabout are oneway unless tagged otherwise, as OSM implies
  (they are drawn in their direction of travel): a one-lane roundabout untagged was a two-way road
  3.5 m wide. A `motorway_link` or `trunk_link` is a `ramp`: primary by class, but a motor road
  (`isMotorRoad` in `kinds.ts`) with its motorway or trunk road, where nobody walks or parks and no
  Ape drives.
  - A carriageway's width defaults by class (`ROADS` in `kinds.ts`). For the classes the valley
    lacks, the defaults are per carriageway, for the first part that maps each to measure on the
    orthophoto: motorway 11 m, trunk 8.5 m, primary 7 m, secondary 6.5 m. On these four a `lanes`
    tag gives the width instead: 3.5 m a lane, plus a 3 m hard shoulder on a motorway (the SR445's
    `lanes=2`: 7 m).
  - Width, surface and name come from the surveys' road surfaces (`fitRoads` in `ctr.ts`, given
    every source's road surfaces and mapped areas as `readSurveys` merged them: the 2019 CTR's
    `AVI`, the old schema's `AV_a`, the DBT's carriageways, the road areas of its roads with no
    carriageway and its dirt tracks). Every 4 m along a drivable road (skipping 6 m at each end), a
    station on a surface measures the surface across the centreline. Stations with more than 10 m on
    either side (squares, car parks) are skipped. A road with at least half its stations, and three
    or more, on a surface takes the median width (clamped to 3–12 m) and asphalt or dirt by most
    stations. It takes the street name most stations share (the survey's upper-case toponym when it
    begins VIA, VIALE, PIAZZA, PIAZZALE, PIAZZETTA, VICOLO, LARGO or SALITA, cased like
    "Via Castel dell'Aquila", "Via XX Settembre", "Via Sant'Antonio", "Via del Prà" and
    "Via G.B. Natali": an article lower-case, elided or not, both sides of any other apostrophe
    title-cased, a final vowel and apostrophe the vowel with a grave accent, as the surveys' ASCII
    writes it, and dotted initials upper-case) when the same holds for its stations inside the area
    the surveys map, so a road that runs on into the unmapped mountains keeps the name of its
    village stretch (Via di Ugliancaldo). OSM names stay, and so do specific OSM surfaces
    (cobblestone, gravel). Roads no survey covers keep their class width (tertiary to steps: 6.5, 5,
    4.5, 3.5, 3, 1.5 and 2 m) or their `lanes` width: 6 of the SR445's 12 pieces on lucido, 7 m. On
    lucido the 2009 sheets' 88 road surfaces give 30 roads their width, 4 of them their surface too,
    and none a name (the "Strada comunale per Campo Cecina" 6.5 → 5.6 m, tracks 3 m → 3.2–9.4 m),
    and where a road widens its profile's bench moves the terrain: 11,683 of 4,879,451 nodes, up to
    16.1 m and 1.33 m RMS, on the Carrara side (x −2268…1316, y −6100…−4252; measured when the
    2009 sheets came in, while each road chain was cored at its widest piece's width: [section
    7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)).
  - Roads still unnamed take a street name from addresses (`nameFromAddresses` in `addresses.ts`).
    An address stands by its own road: each `addr:street` votes for the OSM road way whose vertex
    is nearest it within 100 m (`REACH`), over every part's extract with the ways whole, and the
    vote counts only where that way has a piece in play and none of its pieces is named, so an
    address by a road beyond the play area names nothing in it. The farthest right vote on
    Lunigiana is 32 m off; given to the nearest play-area road however far, a farm shop with
    `addr:street=SS63` (node 7013677166) in the north-west notch, 48 m from the SS63, named the
    tertiary 693993316 "Via SS63" 604 m off, and a Via Canepari address 14 m from a road beyond
    Fosdinovo's west edge named the service road 698929404, while OSM names the real Via Canepari
    90 m north. Each street goes to the way most of its addresses vote for, whose unnamed pieces
    take it, and the streets with more votes for their way name first, so a way two streets
    contest goes to the one with more: Cesena's 23562742 to Via Fiorenzuola's 19 votes, not to the
    4 of Via Emilia Levante's addresses past the east edge, and its 22950290 to Viale Guglielmo
    Marconi's 25, not Via Galileo Galilei's 4. Addresses name 24 ways on Lunigiana (26 before the
    rule) and 244 on Cesena (248).
- **Water**: every `waterway` except culverts (a stream crossing a road at grade dips under it,
  [section 8](#8-water-under-decks-waterts)), but for a culvert under a CTR rail bridge (`AFE`
  `Sede` 063), which runs in the open under its span (`openCulvert` in `build-sources.ts`): OSM
  maps the Canale di Campiglia's pass under the line by Gassano as a culvert (way 865496237), under
  the CTR's 6.7 m bridge, its channel open under the span on the 2010 and 2023 orthophotos; dropped,
  its two ends dug the bank beside the bridge and left 1.0 m of track over the ground. Two more stay
  on lucido: the Canale della Selva's under the 22 m bridge south of Gragnola and a stream's under
  the 114 m bridge by Equi Terme. Each water way has a water width, a gravel-bed half-width and a
  depth, measured on the 2010 orthophoto:

  | Water | Width | Bed half-width | Depth |
  |---|---|---|---|
  | Torrente Aulella, ways averaging under 288 m of ground (`AULELLA_VALLEY_BELOW`), from the west edge at Soliera up to Casola (x −5300…3402): a 25–35 m gravel bed at Gragnola, a wooded 10 m channel at Codiponte; Torrente Bardine, ways averaging under 85 m (`BARDINE_VALLEY_BELOW`), from the Fosso del Lombardello's mouth by Bardine to Fosdinovo's north edge (x −9482…−10572): an 18–47 m gravel bed, median 27 m, its water 4–18 m, median 10 | 12 m | 13 m | 2.5 m |
  | Torrente Lucido, river part (Monzone to Gragnola) | 14 m | 11 m | 2.5 m |
  | Torrente Rosaro, river part (Fivizzano to its mouth in the Aulella at Soliera): a 10–28 m gravel bed, median 13–15 m, its water 2–8 m; Torrente Bardine from the Bardinello's mouth to the Lombardello's (ways averaging 85–145 m, `BARDINE_BED_BELOW`, x −5366…−9482) and Torrente Bardinello below the Pesciola's mouth (under 154 m, `BARDINELLO_BED_BELOW`): a 6–32 m gravel bed, median 15 m, its water 2.5–12 m, median 5, upper quartile 7 | 7 m | 7 m | 2.5 m |
  | Torrente Lucido (Vinca branch) and Torrente Caldanella (from Equi), ways averaging under 500 m of ground | 8 m | 5 m | 1.5 m |
  | the wooded torrents of 9–49 km²: the Aulella's gorge above the Tassonaro's mouth (ways averaging 288–350 m, `AULELLA_GORGE_BELOW`, x 3402…4099), the Rosaro's streams above Fivizzano, the Torrente Mommio below 775 m (`MOMMIO_GORGE_BELOW`, from the Rosaro to x 6786), the Torrente Bardinello from the Canale Caldia's mouth to the Pesciola's (154–267 m, `BARDINELLO_GORGE_BELOW`, x −3655…−5402) and the Torrente Pesciola for its whole course (its 21 ways, 797860953 down to 797861233 at the Bardinello's mouth, x −6598…−5402, draining 8.9–18.0 km²) | 6 m | 4 m | 1.5 m |
  | other named streams, the Lucido above Vinca, the Aulella and the Mommio above their gorges, the Bardine above the Bardinello's mouth and the Bardinello above the Canale Caldia's | 4 m | 3 m | 1 m |
  | unnamed streams | 2 m | 3 m | 1 m |

  A way's class comes from its mean LiDAR ground over its vertices (over each piece's, where the
  play area's outline cuts it: of the ways sized by their ground, only the Aulella's last,
  172808472, which leaves the play area at Fivizzano's west edge, and the Bardine's, 790365369,
  which leaves it at Fosdinovo's north edge, both in the 12 m class either way), so water is
  extracted once the terrain is loaded. The Vinca branch shows 6–11 m of open marble gravel below
  250 m and 4–6 m up to 400 m; from 500 m its bed is under closed canopy. Its way from the source
  under the Garnerone down to Vinca (mean 826 m) is a beech-wood gully with 3–6 m windows of bed,
  so it gets 4 m. The Caldanella runs 15–16 m between walls at Equi and 5–9 m of boulders down to
  Monzone. The Solco di Equi (dry, 5–7 m of gravel in the gorge) and the other named streams keep
  4 m. The wooded torrents' canopy gaps show 3–10 m of bed over a LiDAR floor of 7–7.5 m (issue
  #17). The Pesciola, the larger branch where it meets the Bardinello (its last way 797861233 ends
  with 17.98 km² against the Bardinello's 14.96, which is drawn 6 m), runs under closed canopy all
  its course, and the 2010 orthophoto's gaps show 7 m of bed at 797860993 (−6064, −1211), 8 m at
  797861030 (−6281, −698) and 797861109 (−6485, −9), 10 m at 797861231 (−5916, 1052) and 7 m at
  797861233 (−5550, 1172), over a LiDAR floor of a median 8–9 m (issue #18): a wooded torrent's,
  which it joins by its name, as the Rosaro's streams do, since a rule by catchment alone would
  widen the Aulella above 350 m and the Mommio above 775 m, measured narrow. The Aulella's 288 m
  lies halfway between way 788514356 (282.2 m), its last under the Tassonaro's mouth, and 788514364
  (294.3 m), the first of the gorge above it; past its first big
  tributary over Casola, at 350 m, its floor narrows to a headwater's (LiDAR 4–6.5 m against 6–8 m),
  and the Mommio's between 766 m (way 788514696) and 782 m (788514702). The Bardine's classes part
  at its tributaries' mouths (issue #18): its 85 m lies halfway between way 790365291 (87.8 m), its
  last above the Fosso del Lombardello's mouth, and 790365292 (81.8 m), the first below it, where
  its gravel bed widens to the Aulella valley's (a median 27 m against 15 m above; its LiDAR floor
  17.5 m, the Aulella valley's 15.5); its 145 m between 797861302 (141.0 m), its first below the
  Bardinello's mouth, and 797861301 (149.5 m), its 3.6 km² head; the Bardinello's 154 m between
  797861257 (150.4 m), its first below the Torrente Pesciola's mouth (33 km² there), and 797861254
  (156.9 m, 15 km²); and its 267 m between 797860930 (265.7 m), where the Canale Caldia brings it
  to 9.3 km² and its LiDAR floor widens from a headwater's 6 m to the wooded torrents' 7–7.5 m, and
  797860907 (268.9 m, 7.0 km²). On the 2010 flight the Bardinello's wooded reach is under closed
  canopy at 9 of 14 sections, its gaps showing 3–9 m of bed over a LiDAR floor of 7 m. The 2023
  orthophoto shows the Bardine narrower than the 2010 one, its bars grown over: 6–10 m of water in
  a 6–25 m bed below Bardine, 3–8 m in a 5–12 m one above. Other rivers would be 2.5 m deep with
  the stream widths.
- **Rail**: `railway=rail` (the Lucca–Aulla line), with bridges and tunnels, moved onto the
  CTR's tracks next ([section 4](#4-the-rail-on-the-ctr)).
- **A line's vertices** (roads, water, rail, barriers; `lineVertices`): of two nodes in a row that
  round to one 0.1 m point (the grid the map is written on), the one another way shares stays,
  else the first, so no shipped line repeats a vertex and a junction keeps the id the road graph,
  the catchments and the culverts join by. An edit glued four streams' junctions 0.008–0.073 m
  from their next node in fivizzano (the Torrente Mommio's twice).
- **Buildings**: the surveys' wherever they map the ground, OSM's elsewhere (an OSM building is
  dropped when its centroid lies in any survey's mapped area, or where it shares half the smaller
  one's area with a surveyed building, below), each building once. An OSM outline tagged
  `building=no` (it says the outline is none) or `building=roof` (a canopy open at ground level,
  which the surveys leave out too) is no building (`isBuilding` in `features.ts`, as `bridge=no`
  is no bridge), and an area tagged with one keeps its kind: Lunigiana's extracts hold 2 of the one
  and 15 of the other, and the map drew 4 as closed 6 m blocks, among them the restaurant
  compound by Canepari (way 1496142522, `amenity=restaurant`), 2,060 m² over its house, garden,
  sheds and drive, whose house's top it buried by 1.3 m; Cesena loses its 2 roofs (124108196,
  185186329).
  - **One record**: each adapter reads its source into `Survey` (`ctr.ts`): its buildings
    (`SurveyBuilding`: id, kind, a fixed style where the code gives one, the surveyed eave
    elevation where there is one, a default height, the outer ring and its holes), its road
    surfaces (`RoadArea`: rings, asphalt or dirt, a street name) and the outer rings of the area
    it maps. The build reads that record alone (`readSurveys` in `surveys.ts`), so a new source is
    an adapter, not a change through the pipeline.
  - **The priority**: `readSurveys` merges the surveys in the order of their precision and age, the
    CTR 1:2000 of 2019, then the DBT 1:2000 (2010), then the CTR 1:2000 of 2009, then Liguria's NC5
    1:5000 (2018), then the CTR 1:10 000 of 2010 (`bySourcePriority`), and OSM stands where none maps
    the ground; Tuscany's surveys stop at its border and the NC5 at Liguria's. A source's
    building or road surface is kept where no source before it maps the ground, by the centroid of
    its outline or outer ring, and a building only where it also shares less than half the
    smaller one's area with every building an earlier source keeps (`apartFrom` in `overlap.ts`,
    for OSM's buildings too); every source's mapped area is kept: the newer, finer survey wins
    wherever two overlap, and a building is kept whole or left out, never cut at another survey's
    edge. The overlap is counted on a 0.25 m raster from (0, 0) (`fillPolygon`), holes excluded:
    the mapped areas alone kept an earlier source's building outside its own area twice, each copy
    at its own height, as along the 2019 CTR's edge, where OSM drew a building over a CTR unit
    beside the `AZR`, or at the Liguria border, where a 2019 house kept its NC5 copy (main's map
    held 46 such pairs, 42 of them an OSM building over a 2019 unit and 4 a 2019 unit and a DBT
    one, and Fosdinovo's part brought 28 more). A centroid test would miss a later building over
    smaller kept ones (OSM's 700763305, 646 m², over 10 CTR units) and drop a ring wrapped round a
    house's
    corner it shares no ground with (the 2009 ruin −846894537277171, which stays). Two buildings of
    one source may still stand on each other, as the 2019 CTR's volumetric units do. The platforms
    alone go by the 2019 sheets' mapped area: theirs is the only rail the build reads
    (`ctr-rail.ts`), so OSM's platforms stand wherever those sheets do not map. On lucido alone the
    2019 and 2009 areas do not meet, and the map holds 6,388 buildings: 5,765 of the 2019 CTR, 175
    of the 2009 sheets (140 units and 35 ruins), where OSM drew the Carrara side before (they
    replace 155 of OSM's 614, OSM's church 700633221 at (−442, −4844) among them, a 2009 unit at
    (−441, −4844) in its place), and 448 of OSM. Lunigiana holds 24,331: 18,702 of the 2019 CTR,
    1,464 of the DBT, 836 of the 2009 sheets, 561 of the NC5 and 2,768 of OSM; by their centres,
    10,693 stand in Fivizzano's part (8,435 of the CTR, the DBT's 1,464 and 794 of OSM) and 7,263 in
    Fosdinovo's (4,513 of the CTR, 661 of the 2009 sheets, the NC5's 561 and 1,528 of OSM; 17,101
    on Lunigiana before it, when two sources' copies still stood).
  - **The ids**: a survey's building has a negative id, so it never meets an OSM id, unique over
    every source and section (`survey-ids.ts`): −(local + 2³² × slot). The slot is the source
    (`SOURCES`: the 2019 CTR 1, the DBT 2, the 2009 CTR 3, the 1:10 000 4, the NC5 5) × 2¹⁶ plus
    its section's code, fixed by the section's name alone, so adding a part never renumbers a
    building another part holds: a 1:2000 sheet's section, 23D, is 23 × 26 + 3 (`sheet2k`), a
    1:10 000 section, 249020, 249 × 16 + 2 − 1 (`section10k`), an NC5 1:5000 element, 248082,
    its section's code × 4 + 2 − 1 (`element5k`), and a DBT comune's ISTAT number, 045014,
    45 × 512 + 14 (`comune`, provinces under 128). Sheets 23D11, 22D11 and 24C11, whose ids would collide without
    the section, differ. The local number, under 2³¹, numbers the record within its sheet or
    section: on a 1:2000 sheet, its number × 10⁵ plus the layer's base (`AED` and `AE_a` 0, `AGE`
    and `ML_l` 5 × 10⁴) plus the record's index; in a 1:10 000 section, the layer's base (`AE_a` 0,
    `ML_l` 5 × 10⁶) plus the record's index; in the DBT, RT's own serial (the last 8 digits of
    `un_vol_id`, or of `suolo_id` for an artefact, from 10⁹), not the record's place in the file,
    which moves with the box a part cuts the comune's layers to; in the NC5, the serial of the
    feature's `classref` (a minor building's from 10⁹). A record's further polygons step by
    10⁷ (10⁸ in the DBT). The largest slot, 2²¹ − 1, keeps every id a safe integer
    (2²¹ × 2³² = 2⁵³). So 23D11's `AED` record 0 is −(11 × 10⁵ + 2³² × 66,137) =
    −284,056,253,155,552.
  - **The looks kept**: the low 32 bits of a survey's id are its local number (`id | 0` is
    −local), which for the 2019 sheets is the whole id their buildings had before the sources and
    sections were added. Every look seeded from the id reads those bits alone: the tint
    (`hash01(-(id | 0), 7)`) and the renderer's roof shade, shutters and windows (`hash01` truncates
    a seed to int32), so the 2019 buildings look as they did, where an offset of 10⁸ would have
    flipped the tint of 4,275 of the 5,765.
  - The 2019 CTR's buildings are the `AED` volumetric units plus garages and ruins from `AGE`; the
    old schema's, its `AE_a` units plus the ruins `ML_l` draws as closed lines (code 0205; an open
    one, a wall stub, makes no footprint; a ring sharing half its area with a unit of its sheet,
    the unit's outline again, none), with no garages. Each unit is one building: a terrace
    of houses becomes one building per house, each with its own height and roof. Not buildings here:
    overhangs, canopies, tents, porticoes, loggias and semi-basements. The CTR code gives a kind
    and, for churches, towers, the station and industrial buildings, a fixed style.
  - The DBT's buildings are its units standing on the ground (`un_vol_por` 01; not those over
    porticoes 03, underpasses 04 or covered passages 09, open at ground level, nor the
    semi-basements 08, under it), with the CTR code their building's state, type and use or their
    minor building's type gives (`kindOf` in `dbt.ts`, the first rule that holds): under
    construction 0204, disused or ruined 0205, a bell tower, tower or gate 0217 (a bell tower is a
    tower though its use is worship), a baptistery, church, chapel or other place of worship 0203, a
    passenger station or halt 0211, a transformer station 0212, a shed, an industrial building or a
    rail depot 0202, a rural building 0216, a garage 0244, the other minor buildings sheds 0207 and
    the rest houses 0201; loggias and pressurised tents are no buildings. The greenhouses, silos and
    transformer cabins of `020201_mn_ind`, which no unit holds, are buildings too.
  - Height: the surveyed eave elevation (the 2019 CTR's `Qt_grmax`, the old schema's `Quota_gr`, the
    DBT's `un_vol_qe`, an artefact's top `mn_ind_qe`) minus the lowest ground under the footprint
    (see `z0` below), when that comes to 1.5–45 m. Otherwise the DBT's own height of the unit over
    its foot (`un_vol_av`) where that is 1.5–45 m, else a default by kind (house 6 m, shed 2.5 m,
    garage 2.6 m, ruin 2.5 m...), as for the 2019 CTR's garages and ruins and the old schema's
    ruins, which carry no elevations. The surveys' ground elevations are not used: the 2019 CTR's
    disagrees with the LiDAR on a quarter of the units, and the LiDAR decides where the walls start.
  - A surveyed building inside an OSM footprint takes that building's name, and its style when the
    survey only says "building" (the bell tower of San Prospero is an OSM tower) and surveyed no
    fixed-style unit inside the same footprint: where the CTR maps the church itself, the other
    units in an OSM church outline are the houses around it (Tenerano, Vinca, Viano).
  - OSM buildings (outside the surveys' areas and off their buildings: 448 of lucido alone's
    6,388, mountain huts and quarry sheds among them; no `building=no` or `building=roof`): height
    is the `height` tag clamped to 2.5–22 m, otherwise 6 m (ruins 2.5 m). Style comes from the tags:
    `ruin`, `church`, `tower`, `station`, `industrial`.
  - Generic buildings are `stone` inside the historic cores (`STONE_CORES` in `stone-cores.ts`,
    moved out of `features.ts` as it passed 700 lines; discs traced on the 2010 orthophoto: the
    dense blocks around the church or castle) and `plaster` elsewhere. The cores are Monzone Alto,
    Aiola, the Castellaccio, Gragnola's borgo by the Lucido and the Castello dell'Aquila, Equi
    Terme's old village under the church, Viano, Pieve di Viano, Campiglione, Vezzanello, Colognola,
    Terma, Isolano, La Rocca di Monzone, Monte dei Bianchi, Mezzana, Fazzano, La Giunca-Mozzano,
    Folegnano, the borgo west of Pian del Molino, Cortila, La Traggiara, Codiponte's borgo south of
    the Aulella, Casciana, Vinca's borgo around Sant'Andrea and its upper street, Tenerano's ring,
    Ugliancaldo's castle ring and its borgo down the ridge to Sant'Andrea, and Argigliano's borgo
    below Santa Maria. Fivizzano's 18, each traced as an outline on the 2010 orthophoto's crops
    (checked on 2023's) with the built buildings over it and each disc the smallest, to 5 m, that
    holds the outline's buildings: Fivizzano's walled town in four discs (OSM maps no city walls:
    they are traced), Verrucola's fortress with the church below it and its borgo, Casola's borgo
    round Santa Felicita in two, Soliera's castle borgo and its borgo along Via del Convento,
    Gassano's and Moncigoli's borghi round their churches, Mommio's in three, Pugliano's round its
    two churches and Pieve San Lorenzo's by the station and round the pieve. Mommio's third disc,
    its eastern lane's row, is untraced, and Pieve San Lorenzo's two are grown past their outlines
    (55 and 65 m to 70 and 75 m), so that each borgo carries its hamlet's one style (below).
    Fosdinovo's 29, traced as Fivizzano's (Castelpoggio's on the 2023 orthophoto and checked on
    2009's, as the 2010 flight has no image there): Fosdinovo's borgo in five discs, from Piazza
    Cairoli up to the Castello Malaspina on its crag and the houses at its gate (OSM's castle,
    relation 16127043, is 13 CTR house units and 3 towers there, which the disc makes stone),
    Ponzanello's in three (its castle, a ruined ring in the woods with no building, gets none),
    Tendola's in three, Marciaso's ring on its knoll, Pulica's in two, Bardine's old houses north of
    its node (its outline's 45 m grown to 65 m to carry the hamlet, 11 newer houses along the road
    with it), Bardine di San Terenzo's borgo on both sides of Via Verdi, San Terenzo Monti's in
    four, Ceserano's in five (the western borgo round San Bartolommeo, the old houses above the road
    and the eastern borgo's three), Gignago's along Via Gignago and Castelpoggio's in three. The
    newer houses along the main roads (Molina di Equi, Pian del Molino, the SR445 in Gragnola) are
    plaster.
  - Plaster and stone buildings within 25 m of each other form a hamlet; a hamlet of up to 200
    buildings takes its majority style, so it never splits at a core radius. Bigger clusters
    (Gragnola, Codiponte, Mezzana, Equi Terme) keep the core split, but each terrace block
    (buildings within 6 m) takes its own majority style. `tint` 0–3 comes from a hash of the id: of
    a survey's, its low 32 bits (above); of an OSM id, its last 9 digits.
- **Areas**: landuse, leisure, amenity, railway platform, historic ruins, grassland and wood
  polygons, mapped to `AREA_KINDS`, plus pedestrian squares as `paved`. OSM's platforms only stand
  where the 2019 CTR's sheets map no ground; elsewhere the CTR's replace them
  ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)): all three of OSM's here.
  An orchard of olive trees (`landuse=orchard` with `trees=olive_trees`) is an `olive` grove, and
  on Lunigiana one with no `trees` tag too, where its outer ring's mean ground lies below 600 m
  (`UNTYPED_OLIVES_BELOW`; higher up a chestnut grove is likelier): its 9 such orchards lie at
  225–546 m, and on the 2023 orthophoto 6 are olive groves, 2 olives with vines and 1 a young fruit
  or nut orchard (2026-11-07). Cesena's 62 untyped orchards are Romagna's fruit, so its build passes
  no ground and they stay no area; an orchard of other trees is no area either.
  Mountain covers: `landuse=quarry` is `quarry`, `natural=bare_rock`/`rock` is `rock`,
  `natural=scree` is `scree` (mostly ravaneti, the quarries' marble waste), `natural=scrub`/`heath`
  is `scrub`, and `natural=fell`, `landuse=meadow`/`grass` are `grassland`. Water: `natural=water`
  with `water=river` (or `waterway=riverbank`) is a `river` polygon, the bed its river spreads over;
  with `water=lake`, `reservoir`, `pond` or `basin`, or no `water` tag, a `lake`, its level its
  `ele` when it has one (none does here); other `water` values are left out, and a `water` tag
  without `natural=water` is not water (the ruins of a reservoir by the south edge stay `ruins`).
  `natural=shingle`, a river's gravel, is `pebble` (none here). On lucido OSM draws 8 such polygons:
  7 lakes and ponds of 18 to 2,026 m² (the Bozzetti pond at Equi, the quarry ponds by Cave Crespina)
  and a river polygon by the Tassonaro's mouth, 21,386 m², which lucido's north edge cut; Lunigiana
  holds 39 lakes and ponds (Lago Fario by Soliera, Lago Restì, the Arlia power station's forebay and
  the UCS's water bodies among them) and 3 river polygons: that one whole, whose waterways are the
  Tassonaro's and its tributaries' (the Aulella runs 122 m west of it), the Rosaro's at Fivizzano
  (17,702 m²) and, in the notch north-west of Fosdinovo's part, one of 0.32 km² (x −11500…−8164,
  y 3934…5141) that no water of the map runs through, so the file holds it as still water at
  64.4 m over ground no tile holds; Cesena's, 12 river polygons along the Savio, a basin and a
  reservoir. The UCS land cover adds its quarries, rock (`rock`), sparse vegetation (`sparse`),
  pastures (`grassland`), heath (`scrub`), the rivers' gravel (`pebble`), its water bodies (`lake`),
  its woods (`forest`, `conifer`, `mixed`: `WOODS` in `kinds.ts`), its olive groves (`olive`) and
  its vineyards (`vineyard`). The land cover's raster fills the woods first, broadleaf then conifer
  and mixed over it, and every other area over them by kind (`FILL` in `src/sim/map/raster.ts`;
  the minimap, the full map and `preview-map` paint in that order too, `fillRank`, grassland and
  residential land in the play area's grass, so a park over residential land shows as on the
  ground), so a UCS conifer wood inside OSM's forest makes it conifer, and a UCS wood holds only
  ground no OSM area claims. The vineyards and the olive groves come after the open covers (scrub,
  sparse ground, scree, rock, quarries), grassland, farmland and residential land, and a farmyard
  after them (a farm's yard, smaller than the land cover's half hectare), so both draw over the
  woods and those and under a farmyard, a park, a school, a cemetery, a pitch, a car park,
  industrial land, a square, a platform or a ruin ([section
  1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts) has what the orthophoto shows
  where they overlap). They turn 5.58 km² of meadow, 1.27 km² of forest, 0.11 km² of farmland and
  0.10 km² of grassland into olive groves (7.09 km² in all, 0.005 km² of OSM's scrub among it), and
  1.12 km² of meadow, 0.20 km² of farmland and 0.13 km² of forest into vineyards (1.50 km²,
  0.012 km² before), on Lunigiana before Fosdinovo's part. The
  paving between a house and a road keeps to meadow and residential grass, as on the fields: 0.003
  km² of it is olive grove now. The woods come cut on a 500 m grid
  on the local origin, each piece 4 m past its square so the maps paint no seam (`piecesOf` in
  `ucs.ts`): an area lies whole in every tile its outer ring's box comes within the halo of, and one
  wood across the valley, 10,254 vertices, lay in 19; whole, they took the tiles' areas from 0.69 to
  8.0 MB before gzip and the largest tile to 0.64 MB, cut 5.2 MB and 0.56 MB, with the same land
  cover to 5 cells and the same trees. With the woods the raster turns 2.26 km² of meadow into woods
  and 1.06 km² of OSM's forest into conifer and mixed; 94 buildings now stand in a UCS wood (90 on
  ground that was meadow, most of them sheds and huts on a hamlet's edge or in the chestnut woods),
  and 44 of them, 30 sheds and 14 houses, are no longer farms. The surveys' asphalt road surfaces
  are added as `paved` areas: squares, lay-bys and station forecourts (578 of lucido's 581 `paved`
  areas, 30 of them the 2009 sheets').
- **Barriers**: `barrier=wall`, `barrier=guard_rail` and `natural=cliff` lines. Walls and cliffs
  are opened wherever a road (not a tunnel) comes within w/2 of them (`openBarriers` in
  `walls.ts`): OSM draws cliffs across the paths that climb through them and garden walls up to
  the centreline. A guard rail runs along its road, often inside its w/2 as OSM draws it (1,679 of
  the 2,980 points 0.25 m apart along Lunigiana's 11 rails, on 9 of them), so it opens only where
  a drivable road's middle min(w/2, 1.2) m reaches it: by Tendola OSM's rail along the SP72 (way
  697624968) stops 0.7 m from the centreline of the track leaving the road there (833551261),
  through the 8.7 m OSM leaves between it and the next rail (697624966), and stood in its
  carriageway; it now ends 1.2 m from it, and no other rail changed.
- **POIs**: tagged nodes (minus guideposts, level crossings, benches and most highway nodes),
  plus named polygons as centroid POIs with kind `area:<kind>`.

### 4. The rail on the CTR

Right after the rail is extracted, before anything reads the roads, `conflate.ts` moves OSM's
running line onto the CTR's surveyed track centrelines (`rail-match.ts`, `rail-smooth.ts`,
`rail-crossings.ts`, `rail-spans.ts`), adds the tracks only the CTR has (`rail-extra.ts`) and cuts
the pieces where tracks meet (`rail-graph.ts`).

- **Gragnola from the CTR.** OSM draws the station's loop on the east track and the line crossing
  over to the west one, its south switch 233 m north of the CTR's. The CTR (two tracks 4.3–5.0 m
  apart through the station, joined at y 2957 and 3353), the AGEA 2022 orthophoto (two tracks side
  by side down to y ≈ 2965, a maintenance vehicle on the stub) and RFI's working (every train that
  crosses no other uses track 2) agree instead: the straight east track is the through track 2,
  the west track by the building is loop track 1, leaving the line at both ends, and the stub
  joins the loop. `LAYOUT` in `conflate.ts` takes the CTR's layout: it drops OSM's loop ways
  1156620650 and 1156620651, keeps the west track (`23D19 VLI#0.0`) out of the line's matching,
  and swaps node ids between the tracks: the stop with `railway:track_ref=1` (13949046317) and the
  Via Castel dell'Aquila crossing node of track 1 (1541571998) go to the loop, their track-2
  partners on OSM's loop (10756127162, 10756127166) to the line.
- **Matching.** Each OSM chain is sampled every 2 m. A CTR track is a candidate for a sample
  within 8 m whose heading agrees within 20°, beside it (at most 0.5 m past one of its ends:
  where the survey stops, OSM's track runs on alone); samples inside tunnels match nothing. A
  Viterbi pass picks the cheapest sequence: a match costs its distance, a sample with no match 6,
  a change of CTR track 30 (across a gap too), ties going to the earlier track in sheet, record
  and part order. OSM lies 0.68 m from the CTR at the median, 3.11 m at p90 and 5.27 m at most (way
  140780332, between Monzone and the Terma tunnel).
- **Matched runs** take the CTR's own vertices, simplified to 0.05 m. Every OSM vertex with an id
  gets one position, which the roads, the water and the stops sharing that id take too: its foot
  on the CTR track, or for a level-crossing node the point where the rail crosses its road,
  slid along the road by less than half the road segment (the build throws otherwise).

  | Level crossing | Slide along the road |
  |---|---|
  | Via Riolo (1541570328) | 0.51 m |
  | Viale 20 Settembre (1541571929) | 2.86 m |
  | Via Castel dell'Aquila, track 2 (10756127166) | 1.60 m, of a 3.26 m segment |
  | Via Castel dell'Aquila, track 1 (1541571998, on the loop) | 0.44 m |
  | Via Nuova (1541572026) | 2.63 m |
  | Equi Terme's foot crossing (10566120588) | 0.45 m |
  | the old SS445 by Gassano (2670631443, road 689527853) | 2.45 m |
  | Pieve San Lorenzo's foot crossing, on the loop (13233189406) | 0.47 m |

- **Unmatched runs** between two matched ones (five of the six tunnels, the 190 m north of the Terma
  tunnel the CTR leaves out, the 912 m from where the sheets stop north of Gragnola, at y 3727, to
  23D03's track by Gassano, s 12513–13425, and the 1,780 m from Gassano's 23D02 track to 23D01's by
  Rometta, s 14774–16554, which no 2019 sheet maps): OSM's vertices move by the displacement
  interpolated between the matched ends, then a smoothing spline replaces them. Resampled every 5 m,
  it keeps the run's ends and, through anchor points 5 and 10 m into the CTR tracks, their headings;
  where it bends tighter than 320 m it is solved again with those bends weighted up (30 rounds at
  most). OSM draws the curved tunnels with few vertices: a 16° bend at the Terma tunnel's north
  portal, and the Aiola tunnel straight though the CTR enters it at 26° and leaves it at 51°.
  Smoothed, the Terma tunnel is 225.0 m long (OSM 219.2 m, FLA 227.1 m) and lies inside the CTR's
  tunnel bed (`AFE` `Sede` 054) for 71% of the length the bed maps (OSM's 0%), the Aiola tunnel for
  45% (OSM's 16%); they stray up to 18 and 17 m from OSM's lines, the open track north of the Terma
  tunnel 4.2 m, and the open line north of Gragnola and west of Gassano 3.4 and 3.6 m from OSM's
  vertices (ways 261445428 and 83729761). Towards a chain end (the Galleria del Lupacino's 1,325 m
  from its west portal by Pieve San Lorenzo to the outline at x 6700, inside the bore) no survey
  says where the track bends, so OSM's line keeps its shape, moved as its last matched sample
  (1.6–1.7 m), its end on the outline: a spline there bent a 20° kink 6 m off OSM in a test with no
  CTR at all.
- **Bridges keep what they span** (`rail-spans.ts`): moving a bridge sideways by d slides each
  crossing along it by d·cot θ. A river or road that was under a bridge stays under it, and the
  bridge reaches past it as far as the cells the at-grade track beyond cannot take: a wide stream's
  protected bed (w ≥ 4 m: w/2 + 1 m) and a main road's core (motorway to tertiary, whose rank beats
  the rail's, [section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts): w/2 + 2.3 m), each
  plus a cell's diagonal (5.7 m, the farthest a corner of a cell the track runs through lies off
  it). A bridge end that falls short slides along the track: 9 ends, among them the Aulella bridge
  261445433's north end by 13.9 m (OSM ended it 3.1 m inside the river, and the track beyond hung
  8.2 m over the river's carve) and both ends of the Via Provinciale bridge 83729869 by 5.7 and 11.0
  m (the tertiary under it left 4.5 m of track 5.1 m over its carved core).
- **The CTR's bridges**: where the CTR maps the ballast on a bridge (`AFE` `Sede`
  063) and OSM draws the track at grade, the piece is cut at the polygon's edges (vertices
  `afe:<way>:<n>`; a stretch under 2 m joins its neighbour) and the stretch inside is a bridge: 31
  stretches, 410.5 m with the underpasses' below, among them 41.8 m over the Fosso di Rubiana,
  which hung 12 m over the stream at grade, the whole 38.4 m of way 700698462 by Equi Terme and
  25.8 m south of Gragnola at (−1223, 2130). A stream under one runs under the bridge: only
  797861191 and 797865913 still cross at-grade track, each sharing a culvert vertex with it
  (797865758 keeps OSM's own, now on a CTR bridge). A level crossing inside such a polygon stops
  the build (none is). A bridge reaches past what it spans as OSM's do (`spanned` in
  `rail-spans.ts`): where the track crosses a wide stream or a main road under a CTR bridge, a
  square about the crossing joins the polygons, reaching the line's half width and its margin
  across it either way. The CTR's 6.7 m bridge over the Canale di Campiglia by Gassano, its stream
  crossing 1.3 m from the east end, left the track past that end 1.2 m over the stream's protected
  bed; it grows to 17.5 m. South of Gragnola the 22.0 m bridge over the Canale della Selva grows to
  25.8 m, its south end 3.7 m on.
- **Over an underpass's mouth** (`underpasses` in `rail-spans.ts`): where the track crosses a
  drivable road's tunnel within reach of one of its mouths, a square about the crossing joins the
  CTR's bridge polygons, reaching the road's core half width plus a cell's diagonal (w/2 + 2.3 m +
  5.7 m) across its centreline either way, so the track is a bridge there: at grade, the track's own
  cells (rank 2 beats a residential road's 3) and its bed held the mouth's grid nodes at the rail's
  level. Over the residential underpass 698940836 at s 6324.6 the CTR's track runs 1.8 m south of
  OSM's: OSM's had buried both its mouths 5.1–5.5 m under the bank, the CTR's only the south one,
  5.4 m, so a car drove in at the open north mouth, met the bank and was thrown about 80 m up. Its
  3.5 m CTR bridge piece, east of the road, grows to 20.7 m, and the track underpass 696231810 at s
  4777.6 (one mouth 5.0 m under) gets 19.4 m; both tunnels now open at both mouths at their floors'
  level (`map/__tests__/rail.map-test.ts`). A path's tunnel gets none: the build cuts no path's
  mouth.
- **No short segments**: a vertex no other line or piece shares (OSM's other
  vertices only carried its drawing) is dropped where it lies under 2 m from a kept neighbour,
  unless that moves the line more than 0.25 m. On the 0.1 m grid a short segment's heading is
  noise: a 9.4° turn on a 0.54 m segment at (−1055.4, 917.8), ±6–7° zig-zags on 1.1 m segments at
  the Ugliancaldo tunnel's west portal. The line's sharpest vertex turn is now 5.5°, the CTR's own
  at (−1253.1, 2271.8); 3 rail segments under 2 m are left, each between two shared vertices.
- **A way's end at another's switch**: a way that leaves another at a switch node, which the other
  way's chain placed on its own CTR track first, ends at that node, not at the foot of its end on
  its own CTR track, where the two lie under 1 m apart (the residual the build allows): the CTR
  draws Pieve San Lorenzo's yard siding 621942965 from 0.9 m beside the loop's switch, and the foot
  hung a 0.9 m stub past it. Farther apart (2.0 m at the yard's east end, where the CTR draws the
  tracks parallel to the switch) the line keeps to its CTR track and joins the node.
- **The build checks** that every shared id survives and that the shipped (rounded) line keeps to
  the surveyed track on the matched at-grade and bridge samples: median 0.02 m, p90 0.04 m, at
  most 0.85 m, on Pieve San Lorenzo's yard siding 621942965, whose end the build takes to the loop's
  switch 0.9 m off its CTR track (below); on the running line at most 0.15 m, where it cuts the
  corner of the CTR's 7° kink at the Via Castel dell'Aquila crossing (its two vertices stood within
  2 m of the crossing node), and on Pieve's loop 0.27 m. It throws over 0.2, 0.5 and 1 m. It prints
  both figures per piece. It also checks the CTR's level-crossing polygons (`AGE` `0122`): each
  holds a crossing node, and no node within 10 m of one lies outside it (the six road nodes lie
  1.4–3.0 m inside). The running line is 16 854.7 m long.
- **The tracks only the CTR has** are drawn and driven by no train: an end within 1 m of another
  track, heading along it within 20°, joins it at a switch vertex both share (`ctr:<line>:<end>`;
  where the track already has a vertex there, that one: Gragnola's stub ends on one of the loop's
  own, and a second vertex beside it drew the loop at double width). Bridges come from the `AFE`
  bridge polygons (`Sede` 063); the tunnel polygons already cut the CTR's lines. A road a track
  crosses at grade shares a vertex with it: the road's own (not its end, on no other rail) within
  3 m, as Gragnola's track-1 node 0.44 m off, or a new one. Their ids are negative, from the sheet,
  record and part of their first line (−(sheet × 10⁵ + 9 × 10⁴ + 10 × record + part)). Which are
  loops and which sidings follows from the topology
  ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)):

  | Track | Kind | Length | From the CTR |
  |---|---|---|---|
  | Gragnola, track 1 by the building, crossing Via Castel dell'Aquila | loop | 404.4 m | 23D19 VLI#0, 23D11 VLI#1 |
  | Gragnola, the stub south of it, its north end on the loop | siding | 183.6 m | 23D11 VLI#2, 23D19 VLI#1 |
  | Monzone, the old yard siding west of the station, its east end 3.9 m short of the line | siding | 277.7 m (49.3 m on the Lucido bridge) | 23D36 VLI#0, 23D35 VLI#0 |
  | Equi Terme, the disused second track, west of the walkway to the island platform | siding | 142.3 m | 23D29 VLI#3 |
  | Equi Terme, the second track east of the walkway | siding | 162.6 m | 23D29 VLI#2 |
  | Equi Terme, the yard sidings, one joined to the other | siding | 173.7 m, 124.5 m | 23D29 VLI#0, #1 |
  | Pieve San Lorenzo, the yard's southernmost track, both ends free | siding | 93.8 m | 23D15 VLI#6 |

- **Tracks meet only at piece ends** (`splitAtJunctions` in `rail-graph.ts`):
  last, every piece is cut at each inner vertex another track shares by id (a switch, two tracks
  crossing), keeping its way's id, so `Rail.id` is not unique. The running track, already cut at the
  CTR's bridges and over the underpasses, is cut at the switches of Gragnola's and Pieve San
  Lorenzo's loops into the line's 102 pieces; the loops hold 15 and the sidings 19, Gragnola's loop
  cut in two at the stub's switch.

### 5. Heightmap (`dtm.ts`, `terrain.ts`)

The LiDAR terrain is sampled through the projection (computed exactly on a 50 m lattice, bilinear in
between). Each node of the 4 m grid over the bounds (5526 × 4776 nodes) is the mean of a 5 × 5 m
square of samples, worked out tile by tile over the listed tiles ([Pipeline](#pipeline): an L's
notch reads none). A tile's nodes (`grid` of
`dtmDem` in `dtm.ts`) read each sample's projection from the two terms of the lattice's
bilinear that one lattice row shares, worked out once per row and sample column, so the 25 samples
of a node cost about one DTM read each: the same operations on the same doubles as the sampler
(`makeGrid` on it, which Cesena's GeoTIFF still uses, gives the same bits:
`dtm.test.ts`), and the grid's tile pass took 0.85 s rather than 3.6 s on lucido and 2.1 s rather
than 9.2 s on the 3x test region. The DTM read has a function of its own (`dtmHeight`), apart from
the lattice's bilinear with its anchor's offsets: through that one V8 did not inline it into the 25
samples, and the pass took 2.0 s on lucido and 5.6 s on the 3x. The lattice's nodes lie every 50 m
from 100 m south-west of the region's anchor (`anchor` in `region.ts`), and a sample's fraction of a
lattice cell is measured from there, not from the box's corner; the build's grid lookups
(`sampleGrid`, `cellTile`, the catchments' and the rail bed's) measure a point's 4 m cell from the
anchor the same way. A part that grows the box west or south so changes no bit of the terrain under
the others (`dtm.test.ts` and `terrain.test.ts`; before, 19,023 of 19,026 nodes of a synthetic DTM
differed in their last bits). Lunigiana's anchor is lucido's south-west corner (−2900, −6100), which
was its box's corner until Fivizzano grew the box 2,400 m west (Fosdinovo 6,200 m more), and
Cesena's is its box's corner, so neither map moved when the anchor came in. This grid is carved and
flattened by the next steps; profiles and water sample the untouched terrain (the "ground").
Elevations run from 18.1 m (the Magra plain by Sarzana at (−11500, −5920), tile −6_−3) to 1856.4 m
(by Cima Belfiore, tile 4_6); lucido's from 147 m (the Aulella below Gragnola) to 1799 m (the
north-west ridge of Monte Grondilice).

### 6. River carving and catchments (`water.ts`, `water-areas.ts`, `catchment.ts`)

- The water surface is sampled every 2 m at ground − depth/2. It is made monotone downstream and
  continuous at confluences: a tributary's tail is lowered (by at most 0.25 extra slope) or ponded
  up to the level of the water it joins. The Lucido meets the Aulella below Gragnola, the Rosaro at
  Soliera.
- Before the carving, the catchment upstream of every water sample is measured (`catchment.ts`):
  the samples are burned 100 m under their own surface into a copy of the grid, which is filled so
  every node drains (priority-flood with an epsilon, Barnes et al. 2014; the grid's edge is the
  outlet), each node routed to its steepest lower neighbour (D8), and the 4 m cells accumulated
  downstream. A node no listed tile holds (an L's notch, never built: [Pipeline](#pipeline)) is
  an outlet too, below any ground and never read: the flood starts from it, so the listed nodes
  beside it are an edge, D8 drains them out of the grid into it, and it brings no area of its own,
  as no ground beyond the edge does (`catchment.test.ts` checks that a notch's ground, however high,
  changes nothing, and that it gives the fill and areas of a pit there the box's edge drains). Each
  piece starts with what the pieces ending where it begins bring (shared among the arms of a
  fork), and a sample
  keeps the most its own burned nodes gather within a node of it (D8 cuts a bend's corner past a
  node), never less than upstream; nodes within two of another water's are left out, and a piece's
  last sample keeps what came down to it (D8 may route the water a tail joins through it). The
  box holds the Aulella's catchment down to the Soliera gauge, 4 km below Gragnola and below the
  Torrente Rosaro's mouth, all but the heads of the streams that come down from north of y 13000
  under the Cerreto pass: D8 gives 181.8 km² just below the Rosaro's mouth. Those heads are
  14.7 km², by a D8 on Massa-Carrara's 10 m DTM: 14.68 km² of its basin above Soliera lie north of
  y 13000, all of them reaching the Rosaro above Fivizzano, 13.08 down its own head and 1.6 down
  rivulets at x 250…3750. So the Rosaro, their main stem, brings them in (`OFF_MAP` in
  `build-terrain.ts`), added at the sample of its water nearest its point on the edge (3528,
  13000), at least 12 m inside the box, as D8 drains no edge node: 14.7 km² at its entry, 15.8 at
  (3434, 12596), 76.8 at Fivizzano and 81.6 at its mouth. The Aulella reads 196.5 km² just below the
  Rosaro's mouth and 196.8 at the gauge's sample (−5119, 4715), not ARPAL's 208: the gauge's own
  delineation is larger than the DTMs' (the 10 m DTM's D8 gives 200.73 km² there, 3.5% under it),
  and the flows per km² still come from the gauge's flows over its 208 ([water.md](water.md)).
  Taken as the gauge's 208 less the map's 181.8, the heads were 26.2 km², near twice their ground,
  and the Rosaro reached its mouth with 93.1. The Aulella leaves the play area at Fivizzano's west
  edge (x −5300) with 199.4: it was 199.0 while that was the box's edge, and the Canale di
  Moncigoli's 0.4 km² of head west of it now lie in the box. The Bardine leaves Fosdinovo's north
  edge with 59.0 km² (its own 58.1 and the Canale del Torchio's 0.8) and joins the Aulella below the
  gauge, in the north-west notch. From Codiponte down to the Lucido's mouth below Gragnola the
  Aulella drains 41–60 km², and 106 below the mouth.
  It takes about 0.8 s on lucido alone: the flood's heap keeps each open node's height beside it in
  typed arrays, the D8 stores a direction (1 byte) and an inflow count (1 byte) a node, and the
  accumulation walks down from each node with nothing above it, last first, with no stack (the order
  a stack of them gave, so the same sums).
- **The water beyond the play area** (issue #18), in the box (`beyond` in `build-sources.ts`, which
  the trees keep off too), is burned with the play area's, owning no node and never read: each 2 m
  sample at its ground less depth/2, the lowest so far along each stretch on listed nodes. It is not
  `settle`d, as the running minimum would carry a notch's drawn-on edge into listed ground: at the
  Fosso della Lama Vecchia's (7152, 2028) that put the trench 360 m under the LiDAR's 830 m ground.
  So a river the outline cuts short of the box's edge or a notch drains on down its own water, to
  its outlet or back into the play area: the Fossi del Caresciale and della Tignosa leave
  Fivizzano's part at y 3900 and come back down the Fosso della Maulina at x 6700, and the Canal
  Grosso leaves at x 10100 and comes back at y 7800. And where water comes in from beyond the grid,
  on its edge or beside a notch, its first nodes keep their ground: a trench 100 m under it there
  would be an outlet for every water it joins. Burned alone, the play area's water held while every
  edge a river left by was the box's own, its trench ending on an outlet; where the outline cut a
  trench short of one, it ended 100 m under the ground past the cut, and the fill made it a lake as
  high as its lowest way out. In 2 m samples, 67.4 km of the play area's water lay in such lakes
  behind outline cuts, and 0.75 km does with the water beyond:
  - Fosdinovo's north edge cuts the Torrente Bardine at (−10572, 3900), 100 m short of the notch.
    Its 58.1 km² drained out up the Canale del Torchio and the Fosso Acqua Chiara, whose trenches
    came in at the box's west edge at about 21 m, against the 69 m of ground past the cut: the
    Torchio read 59.2 km² and the Bardine below its mouth 117.3, its basin twice.
  - Fivizzano's west edge cuts the Aulella at x −5300, 700 m short of the notch. Its lake stood at
    107.8 m for 10 km, up the Lucido's and the Rosaro's tails, and D8 crossed it by the shortest
    trench: a 2 m side stream by Soliera (way 140780331) read 108.5 km² and, by Gragnola, the
    unnamed tail 797871813 and Il Canalaccio below it 50.4 and 55.4; they read 0.18, 0.01 and 5.06.
  - Cesena's Cesuola (69271394) had the same false exit at its south edge: 1.74 km² of the town now
    drains to the Savio, whose area goes from 2.95 to 4.69 km² (way 1029104404).

  Each change alone fails one of these: with the entries kept but no water beyond, the side stream
  still read 108.5 km² and Il Canalaccio 55.4; with the water beyond but no entries kept, the
  Carpineto lost 0.45 km² and the Fosso dei Panni's entry from the notch at x 6004 was a false exit.
  `catchment.test.ts` checks both: a river cut short of the grid's edge drains on down the water
  beyond the cut, not down a side stream across the lake, and water coming in at the grid's edge is
  no outlet for the water it joins. With both, 65 km of the play area's water (in 2 m samples,
  155 km without them) still lies in fill lakes more than 1 m deep, all but those 0.75 km behind
  places where its mapped water stops (culverts the build drops, [section
  3](#3-features-featurests)).
- The bed is carved into the grid: depth/2 below the surface inside w/2, a gravel slope out to the
  bed width, then a one-cell bank back to the terrain.
- **Water areas** (`water-areas.ts`): a lake, and a river polygon its river does not run through,
  holds still water at its level: OSM's `ele`, else the median of the uncarved grid's nodes inside
  it (the LiDAR flies over a lake and reads its surface flat; the vertices' DTM when no node falls
  inside), but no higher than its spill, the lowest uncarved node of its edge, in whole decimetres.
  On the bare median the 4 m grid read an edge node up to 3.1 m under the level, where an outline
  runs up a slope or a cascade, and the water drew over the ground beside it. Capped, the lake by the
  Solco di Equi stands at 272.0 m (median 272.2) and Bozzetti at 261.5 m (262.0). A lake holds no
  water at all where the LiDAR reads no hollow under it: lucido's intermittent pond at Prati di
  Campocecina, on a 24 % slope; Fivizzano's Arlia power station forebay, 300 m along a hillside,
  whose outline's foot reaches 3–5 m under the basin, and a 24 × 29 m pond on a slope 320 m past
  the play area's east edge (x 10420…10444, y 8145…8174), its foot 1.6 m under it. Nor does one
  every node of whose cells is its edge (no node all four of whose cells are water), since the carve
  lowers only the nodes inside a lake's edge, and its level is its spill: lucido's 18 m² pool on the
  Canale Doglio's cascade, whose water is the stream's (1 cell); a 7 × 9 m pond 200 m east of Pieve
  San Lorenzo's rectangle (x 6898…6905, y 3593…3602, 2 cells); and two pools on the Torrente
  Arcinasso in Fivizzano's strip beyond the play area's west edge, which Fosdinovo's box builds: OSM
  ways 1473224065 (17.5 m², 1 cell), where the Fosso di Paretola joins it, and 1473224067 (28.7 m²,
  3 cells), 52 m upstream. A river polygon follows its waterways: every water piece with a 2 m
  sample inside it, a tributary running in too (by the Tassonaro's mouth, cut at lucido's north
  edge, the Tassonaro's two pieces and the Fosso di Tufo, which joins it; whole on Lunigiana, the
  Tassonaro's four, the Fosso di Tufo, the Canale della Trosella and two unnamed streams; at
  Fivizzano the Rosaro and the Fosso del Tufo; the Savio's in Cesena), which the game's water takes
  its level and current from ([water.md](water.md#depth-and-current)). The map file keeps a lake's
  `level` and a river polygon's `waters`.
- They are carved node by node, each node from its own position and the vectors alone, so a tile's
  window needs no halo. A node is the area's when one of its four cells is (the cell's centre inside,
  filled from the anchor as the land cover is), and on the water's edge when one of its cells is in
  no water area (the seam between two polygons of one river is no edge). A lake's nodes are carved
  to its level less 0.1 m for each metre from its shore, 3 m deep at most, and its edge raised to
  the level (by a rounding at most, the level being no higher than the spill), so the shore holds
  the water drawn up to it. A river polygon's inner nodes are carved to the floor of its waterways
  at their nearest point (their surface less depth/2, as the line itself is carved within w/2, and
  0.05 m more, so no node rounds above the floor the game's water stands on), and its outer edge is
  left, so the bank starts on its outline (riverside paths keep their ground) and the terrain hides
  the water's edge; where it lies under that floor it is raised to it (and 0.05 m over, so it does
  not round below), before the claims, so a road on it keeps its own level: OSM maps the Tassonaro
  6 m off the LiDAR's channel above its mouth, and the water drawn to the outline stood 0.7 m over
  the channel's gravel there. Its gravel bars (`pebble` cells inside it) are raised to 0.3 m over the
  surface, dry until a spate tops them: in the pass under the water kept below the decks, so a bar
  never stands over a capped surface. Ground more than 1 m over the water's top (a lake's level,
  the ground a river was sampled on) is left: an island, a quarry face a pond's outline climbs. The
  lakes and river polygons are carved before the lines, whose own beds then cut their channels
  through a lake's edge and a river's bars, both before the claims, which may not write on them but
  for a river polygon's outer edge, and the river polygons again after them, under the water kept
  below the decks.

### 7. Road and rail profiles (`profiles.ts`, `grid-claims.ts`, `terrain.ts`, `rail-levels.ts`, `road-levels.ts`, `junction-reach.ts`)

- Pieces are chained through nodes where exactly two ends meet. Each chain is resampled every 4 m
  from the ground and smoothed with a moving average. Bridges and tunnels are straight between
  their ends, and each end takes the ground 4 m out of it when that is nearer the line's level (a
  tunnel's the lower, a bridge's the higher): at the Ugliancaldo tunnel's west portal the terrain
  model climbs 3.6 m up the hill's face, and the rail's 2.5% grade limit carried 1.2–1.6 m of it
  600 m along the line past Equi Terme; a bridge end on the slope of the Lucido's bank pulled
  Monzone's line 0.7 m under the ground. A tunnel that OSM splits into pieces in a row (where its
  tags change) is one bore, straight from portal to portal, and so is a road's bridge: taken piece
  by piece, the joint of the SS63's two-piece bridge over the Rosaro at Soliera fell toward the
  ground 12 m under it, and the deck sagged 4.9 m there (12% and 6%), so a walker crossing it stayed
  0.5 m under the deck; and the joint inside the Galleria del Lupacino, at its 140 km/h limit, took
  the hill's 391 m. The rail keeps a bridge a piece: its 2.5% grade and 100 m smoothing hold a
  joint to the line between its deck's ends, and its platforms and crossings are fitted on that
  profile. An end the play area's outline cuts (a chain's end with no id) takes its other end's
  level: the ground there is the hill over the bore or the valley under the deck. The Lupacino, cut
  1,325 m in at x 6700, took the hill's 528 m at the cut and fell 3.7% to its portal at 357 m; it
  now runs level from it. The SS63's bridge cut at y 13000 fell 17.9 m (15%) to the valley floor;
  it now runs level at 971.3 m.
- Within each pass, the next chain profiled is the longest one that touches a node an earlier
  chain already set, else the longest left. Elevations spread along the network from where it is
  pinned, so a short link is not pinned at both ends by chains fitted apart (a lane in Codiponte
  between two levels got a 93% straight line that way).
- A junction a road's fit sets stays within reach of each junction already set that a road not
  yet fitted leads it to (`junction-reach.ts`): that road's steepest grade (1.5× its class limit)
  over the way there, along it and on through joints no other road meets, or the ground's own
  climb between the two where that is steeper. A link fitted after both its ends were set is the
  straight line between them, however steep: east of Collegnago the fit of a road round a hill,
  one end pinned, left its free junction 3.3 m over the ground, and the 12 m unclassified link
  from there to the junction an earlier fit set climbed 53% where the ground climbs 18%; it now
  climbs 22%. A 55 m residential link at Giuncugnano went from 24.7% to its ground's 23.0%, and
  Sercognano's Via Vittorio Emanuele from 32–34% to its ground's 28–29%. The rail keeps its own
  grade: the roads meet it at level crossings.
- The profile is then fitted to a grade limit through hard pins: elevations already set at
  shared nodes by earlier chains, and the rail's, the overpasses' and the junctions' bounds. The fit
  is the midpoint of the two grade envelopes, so cut and fill split evenly.
- Where the fit strays more than 4 m from the smoothed ground, the grade limit within 60 m is
  raised in 10% steps, up to 1.5× the class limit.

| Pass (in order, `RAIL_PASS` and `ROAD_PASSES` in `profiles.ts`) | Grade limit | Smoothing half-window | Rank |
|---|---|---|---|
| rail | 2.5% | 100 m | 2 |
| motorway, trunk | 6% | 100 m | 0 |
| primary, secondary, tertiary (the SR445 is primary) | 10% | 20 m | 1 |
| unclassified, residential | 15% | 20 m | 3 |
| service, track | 20% | 20 m | 4 |
| tracks only the CTR has (written after every road) | the nearest running track's level | – | 5 |

- Motorways and trunk roads take the rail's long smoothing and a gentle grade, and their rank keeps
  their cells against every road and the rail. Primary and secondary roads share tertiary's pass
  and rank, so the SR445 keeps the profile it had as a tertiary road.

- Each profile is written into the grid (recorded as a claim, then written in each tile's window in
  the order of the passes, as [Pipeline](#pipeline) says): the core (max(w/2 + 0.3 + 2, 3) m, half a
  4 m cell past the carriageway's edge, `coreHalf` in `grid-claims.ts`) takes the road elevation,
  and the next 8 m blend back to the terrain. Each piece is cored at its own width: a claim holds a
  core half-width per segment, and `flatten` (`terrain.ts`) writes each node by the core of its
  nearest segment. `Spec.w` in `profiles.ts` is one width for every piece (the rail's and the CTR
  tracks' 4 m) or each piece's own (a road's `w`). Cored at its widest piece's width, as before
  #18's review, a chain widened its core all along wherever a wider piece joined it: Fosdinovo's
  8.4 m 519669896, joined at (−4469, −4510) onto the chain of the Strada comunale per Campo Cecina,
  grew its core from 5.55 to 6.5 m either side as far east as x −592, moving 4,878 of lucido's
  nodes 4–16 m off a road whose line and z were unchanged; and the 5.6 m SP59 di Vinca (303224617)
  was cored as its chain's 12 m road, cutting the bank 12.6 m above it at (52, −292) 17.5 m under
  the LiDAR (2.3 m now), where five houses at (45…54, −297…−275) stood on 9.4–14.4 m less base (a
  floor of 260.1 m, now 274.5). Where every piece of a chain has one width, its claim's box and
  writes are as before. The figures that follow were measured on PR #35's map (7ae0719), with each
  chain cored at its widest piece's width, and no tool in the tree measures them again. A core
  that stopped at w/2 + 0.5 left the outer node of most cells the carriageway's edge
  crossed on the hillside, so the drawn road leaned across with it: under a Panda in its lane more
  than 10% at 3.5% of 40,000 sampled positions and more than 20% at 1.2%, enough to roll an Ape
  over. With the wider core those shares are 1.1% and 0.5%, mostly at junctions and road ends. A
  core a whole cell wider (0.9%, 0.4%) cut road banks steep enough to paint as rock 2.5% more often
  (0.9% with this one), and a bank steeper than bare rock (50°) echoes: 17 of the 23 asphalt points
  of a 25 m grid over Monzone hear one (the spawn an echo 312 m away, 1.8 s, off a bank beside a
  road). The wider core also buries more of the narrow streams (under 4 m wide, which roads may
  write over): with a core a cell wider, 664 m of stream ran more than 1 m under the terrain against
  474 m before, and houses on a bank above a road lost up to 8 m of base (those above the SP59 by
  (50, −290)). At junctions the lower rank keeps the cell, so the main roads (motorway to
  tertiary) beat the rail and the rail beats the rest.
- The tracks only the CTR has take, point by point, the elevation of the nearest running track
  (the old yards lie level with the line; Equi's sidings are 17 m from it), set right after the
  rail pass so a road crossing one is pinned to it there. They are written last (rank 5), into
  cells no road took.
- Grid nodes inside the wider streams (w ≥ 4 m) are protected: no road writes them; so are a
  narrower stream's (within w/2 + 1 m of its line) under a road bridge's deck (its carriageway and
  1 m either side, between the deck's ends), where no road stands on the ground: an approach road's
  core reaches its full width past its end, and under the SP41's 12 m bridge at Pognana it filled a
  2 m stream's bed to the deck, where its spate then stood. At grade the stream runs in the road's
  culvert, and under the rail its channel dips under the bed ([section
  8](#8-water-under-decks-waterts)), so neither is protected. Bridges and tunnels write nothing;
  the ground under the decks is lowered once the grid is built (below).
  Paths and steps are not profiled.
- A road tunnel's mouth opens at its approaches' level: each approach's first 5.7 m out of the
  mouth (a cell's diagonal, the farthest a corner of the cell holding the mouth lies), within its
  approach piece's own core (an end no piece leads out of has none) and ahead of the mouth (the
  road over the tunnel keeps its cells over it), is
  written before every other claim and kept against all of them (`mouths` in `profiles.ts`,
  `mouthClaim` in `grid-claims.ts`). A
  road over the tunnel or beside the mouth took that cell at its own level otherwise: at Pieve San
  Lorenzo's underpass under the station (756577583) Via della Stazione, a tertiary road over it
  4.5 m from its south mouth, held that mouth 5.8 m over the floor, and Via Bugliatico, at a
  junction 4.2 m beyond the north one, 1.6 m over (its level there smoothed 1.6 m over the
  LiDAR's dip). Both now open 0.7 and 0.9 m over the floor; Gragnola's 52 m tunnel under Via Nuova,
  1.2 m before, at its floor, two nodes beside its west mouth 5.1–5.3 m lower (163.4–163.6 to
  158.3 m, the LiDAR 159.1–160.8 m), and the other road tunnels' approaches own their cells,
  0.1–0.6 m from what a road beside them wrote.
- What a road tunnel's mouth holds for the game is baked (`bakeMouths` in
  `src/render/portals.ts`, the global file's `derived.mouths`), since its tunnel, and the roads
  and the houses round it, reach past the tiles round it: a mouth is an end of a road in a tunnel,
  not a building passage, that no other road in a tunnel goes on from, more than 0.5 m inside the
  play area. It holds its road, where its portal or head wall stands (the road's end, or `back` m
  into the tunnel along its line where a portal at the end would stand on another road), the road's
  surface there (the profile and `ROAD_LIFT`) and the heading out of the hill over 5 m, and either a
  portal (its arch's crown and how far its throat runs in:
  [architecture.md](architecture.md#road-tunnels)), an underpass's head wall (`head`, how far its
  box runs in, `back` 0) or `open`. Its end of the tunnel is its road's line from the mouth, run on
  along the roads of its tunnel that go on from it (each way a fork takes, so a way split inside a
  tunnel reads as one), 40 m in, short of the tunnel's middle (`src/render/tunnel-lines.ts`, every
  0.5 m). The mouth is open where a building stands over the way there at its level, the ground
  under its lowest corner (`z0`) less than the bore's clear height over the road (a covered way,
  which its house hides; a house on the hill over a bore hides nothing); else a portal stands where
  the ground over the tunnel (the roads in a tunnel joined end to end with it, every 2 m) rises as
  high over the road as a portal's springing and face wall (`leastCover`: 6.2 m where the way has no
  `maxheight`) and a spot within 40 m of the end, short of the tunnel's middle, leaves it clear of
  the other roads and the track; else a head wall stands at the end where the ground over its end of
  the tunnel rises as high over the road's surface as its coping and 0.25 m (`leastWall`: 5.05 m
  untagged) and its box,
  clear of them, reaches that bank; else the mouth is open. On Lunigiana 56 mouths, 12 with a
  portal: both of the SR445's 172 m tunnel by Groppoli, of the 196 m track south-east of Equi Terme
  (OSM 214324514), of the 147 m quarry track (424169576), of the 87 m path under the line at Equi
  Terme (1133296350, stood back 7 and 1 m) and of the 33 m track (1181149122), and the east mouths
  of Via Gioco di Sopra's 52 m under Via Nuova and the line in Gragnola and of a 16 m unclassified
  road under the SS63 (145347886); 2 with a head wall: the south mouth of Pieve San Lorenzo's 29 m
  underpass under the station (756577583), under Via della Stazione, and the west mouth of the 16 m
  road under the SS63, where the SS63 passes over lower than a portal's top; 42 open: four roads
  under rail bridges (the SR445's 7.7 m by Gassano among them), Pieve San Lorenzo's north mouth (the
  ground over its end 4.83 m at most), Via S. Nicola's 19 m in Gragnola and an 11 m path
  (757045013), whose cover the map's ground does not hold, and Via Gioco di Sopra's west mouth, a
  garage standing over the tunnel 1.5 m in, and Fosdinovo's 28, the mouths of its 24 roads in
  tunnels, all covered alleys and lanes in its villages (Giucano, Pulica, Fosdinovo, Bardine,
  Castelpoggio, Caniparola, Ponzanello, Canova and Ceserano): 13 under houses and 15 under too low a
  bank, so it adds no portal or head wall. Cesena has 77 mouths, 9 with a portal (the Secante's
  four, Via del Tunnel's two, the Sottopasso Cervese's two and the Sottopasso del Mare's one, stood
  back 2 m, its other end on the outline), 6 with a head wall (Via Spadolini's two, beside its cycle
  path's own tunnel, and both of the Sottopasso Ravennate and of the path 43076054 under the
  station, whose ramps the map's ground does not hold), 62 open: 47 under houses (the centre's
  arcades and covered ways), 13 under too low a bank and the cycle path's 2, for want of room. The L
  has 12, 3 with a portal, 9 open (1 under a house). A part's road tunnels need nothing more: the
  build finds and bakes their mouths in any region, and `src/render/__tests__/tunnels.map-test.ts`
  (with its Cesena and L twins) checks every one drawn, finds again by geometry why each open one is
  open, and pins each region's counts of roads in tunnels, passages, metres, wall triangles, mouths,
  portals, head walls and open mouths by reason, so it fails until a new part's are looked at and
  pinned. A bore's wall triangles are cut where the ground over its sides crosses its springing or
  foot, so they follow the ground beside its mouths: with each approach cored at its own width, 13
  of Lunigiana's 59 tunnels changed theirs, 3,459 → 3,574 in all, and the L's 633 → 650.
- Rail (`rail-levels.ts`): at a level crossing the rail keeps its own grade and the road meets it
  (the road's profile, after the rail's, is pinned to it at the shared node): a rail pinned to the
  road's natural level made a V of 3.8–5.1% in its grade within ±5 m (an 82 m vertical curve at
  Via Nuova). A road under a rail bridge (or in a tunnel under the rail) keeps at least
  `maxheight` (4 m when untagged) plus a 1.5 m deck below it, and a tagged underpass keeps the
  rail at least that far over the road's natural level: a sign gives the least clearance, and an
  exact pin at Via delle Cave (`maxheight` 3.20, the deck 1.1–3.3 m higher on the LiDAR) held the
  line 2.5–3.0 m under its bed for 1.9 km, from Equi Terme to the Aiola tunnel. A road bridge over
  the rail keeps its surface at least 5.5 m over the rail's bed (the rail head 0.12 m, the ATR
  220's 4.185 m, 0.3 m clear and the render's 0.9 m deck), the rail held under the line between
  the uncarved ground at the bridge's ends less 5.5 m: at the Equi Terme overpass the roof
  stood 0.46 m in the deck, and now clears it by 1.14 m. That deck stands at least 5.5 m over the
  uncarved ground at the crossing, where the track runs (the bare-earth model has no deck), so the
  rail is never held under its ground there and the road, profiled after it, rises instead: the
  line between the ends' ground of the SR445's 396 m viaduct north of Gragnola (152.6 and 144.9 m,
  its ends down in the valley; the track's ground 157.3 m) held the line 12 m under the ground, and
  a 22 m residential bridge by Gassano, 4.7 m over the track's ground, dipped it 0.8 m in a V whose
  grade changed 4.2% over 20 m. Both now run at grade, the viaduct level at 162.8 m over them: its
  ends' ground is the valley's as the LiDAR flew it before the road's 2017 variant was built (the
  2010 orthophoto shows no road there, the 2023 one the deck's shadow cast far off it over the
  Aulella and the line), so the line between them is no guess of its deck. In Cesena the line ran
  2.9 m under its ground below the Viadotto Pontescolle and 4.1 m below the Viadotto John
  Fitzgerald Kennedy, and now runs at grade under both. The rail stays at least 3 m above a river
  it bridges (wider than 4 m); over the rest, under the CTR's short bridges, it keeps its level and
  the water dips under the deck ([section 8](#8-water-under-decks-waterts)). The named streams' 4 m
  is the build's guess where it measured none ([section 3](#3-features-featurests)): under the
  CTR's 6.7 m bridge by Gassano the Canale di Campiglia runs 1.5 m under the line, and held 3 m
  under it the line rose 1.9 m, its grade changing 4.1% over 20 m. A rail tunnel
  passes under everything: the 3.2 km of the line's tunnel from Equi Terme to Argigliano run under
  the streams on the hillside. The rail's output keeps the profile samples where its elevation
  bends by more than 0.03 m (roads: 0.25 m), so the line drawn and driven follows the grid it was
  written into: 823 vertices, 19.0 KB of the JSON line (223 vertices before the CTR).
- Overpasses (`road-levels.ts`): the rail bridge's rule holds under every road bridge too, so local
  roads pass under a motorway's overpasses. A drivable road under a profiled road's bridge, or in a
  tunnel under a road, keeps its `maxheight` (4 m when untagged) plus a 1.5 m deck under it. Of the
  two roads, the one profiled second takes the bound: it dips under the road above, or, a bridge,
  rises over the road below. A bridge or a tunnel in an earlier pass than the other road takes it
  too, from that road's natural level (its mean uncarved ground within 35 m) and 0.3 m more, as the
  rail does over a tagged underpass: a junction pinned under a Cesena slip road's bridge held a
  service road 1.6 m under its deck (0.18 m over its natural level, which without the 0.3 m left it
  5.32 m), and the Secante's tunnels ran 2.8 m under Cesena's streets. A road at grade never rises
  over a tunnel: a car park's ramp under a Cesena square lifted the square 5.6 m. One chain that
  crosses itself (the SR445's loop at Gassano, built in 2017, runs under its own bridge 13.6 m from
  where it leaves it) takes both bounds from one natural level, as one fit sets both roads: the road
  below stays at most 0.3 m over its own, and a bridge keeps the clearance over that (over its own
  tunnel, a road at grade stays at least 0.3 m under its natural level, and the tunnel the clearance
  under that). The bridge stood 0.85 m over the loop; it now stands 5.86 m over it, its deck 5 m
  higher (143.0 m falling to 139.2), and the loop leaves it there and falls round to pass under it
  at the ground. Each bound holds on its own road's samples (`on` in `profiles.ts`): where a chain
  crosses itself, the chain's nearest sample may lie on the other level, and the bridge's bound
  lifted the loop to it. And it holds at the profile samples on both sides of the crossing (2 m
  either way), as one at the nearest sample left 0.1–0.2 m short between samples. Inside a bridge
  or tunnel it holds at both ends along the deck's slope (`tilt` in `profiles.ts`), so a climbing
  tunnel's far portal keeps its level, and bounds on one sample keep the strictest (several
  crossings under one deck). In the Lucido valley the rule dropped the residential 328463362 1.2 m
  under the bridge 328463361 at (1643, 3286), from 4.36 to 5.52 m below its deck, and Via Gioco di
  Sopra in its tunnel under the tertiary 1001748732 at (−1661, 3550), from 5.27 to 5.57 m. In Cesena
  the least clearance under a road bridge went from 1.25 m to 5.50 m (3.92 m under the Ponte Europa
  Unita, over a road tagged `maxheight` 2.4), and the Secante's tunnels run 5.41 m or more under its
  streets. Both maps' checks (`map.map-test.ts`, `cesena.map-test.ts`) read every road bridge. Two
  Cesena tunnels keep less: the car park ramp 68296970 (a service road in its square's pass, which
  no pass before it bounds) stays at the square's level, and Via Giovanni Spadolini's 166880964 runs
  5.1 m under two service roads, its ends pinned by junctions.
- The bed against the LiDAR (every 2 m of at-grade line, leaving out the 4 m+ gaps of streams):
  0.26 m off at the mean, 0.10 m at the median and 0.86 m at p90, 432 m of the line more than 1 m
  off (before these rules: 1.18, 0.87 and 2.77 m, 2 932 m). Its grade changes by at most 3.4% over
  20 m (a vertical curve of about 590 m), at 4 places by more than 2% (42 before).
- **Rail bed** (`rail-bed.ts`): once the grid is rounded to 0.1 m, each stretch of at-grade rail
  centreline inside a cell caps that cell's four corners at the stretch's lower rail elevation
  plus 0.05 m, floored to 0.1 m, so no interpolation of the cell (bilinear, or the drawn mesh's
  triangles) stands more than 0.05 m over the rail, and raises them to its higher rail elevation
  less 0.5 m, unless a road's core (`ROAD_RANKS`) or a wide stream's protected bed holds them.
  Within 6 m of a level crossing the road decides. The terrain stood up to 0.84 m over the rail by
  Via Riolo, where two tertiary roads (rank 1) keep the cells beside the line; a corner of a cell
  the line clips lies up to 5.7 m off it, outside the profile's 4.3 m core, and one stood 7 m
  under the track in the Aulella's carve north of its bridge. A run-out's at-grade track (section
  9) gets the same caps and floors beyond the play area alone (`BedLine.writes`), so no node in
  play moves for it. On Lunigiana the pass lowers 3,040 nodes (2,902 before the run-outs) and
  raises 72 (the build prints them as `bed`, 2026-11-07). On lucido, when the bed came in with the
  trains (#61, 2026-10-29), it lowered 2 050 nodes, 25 of them by more than 0.3 m: 4.0 m on the
  slope of the cutting west of Equi Terme at (920, 756), a corner 4.7 m from the centreline, 1.5 m
  at the Ugliancaldo tunnel's east portal, up to 1.3 m by Via Riolo. 4 of those 25 lay under a
  carriageway (up to 0.8 m, under the tertiary 183923158 beside the line by Via Riolo): there the
  road's ribbon stands over lower terrain at its edge. It raised 43 nodes, 27 of them by more than
  1 m, none under a carriageway: up to 11.4 m at (16,
  368), the abutment of the rail bridge 140780349 over Via delle Cave and the Lucido, which the
  river's carve (its gravel bed, outside the protected water) had cut 11.3 m under the LiDAR.
- **Ground under the decks** (`deck-ground.ts`, issue #92): the bare-earth model has no decks, and
  nothing else writes the ground under one, so it reached into them: more than 4 m from an end on
  125 of Lunigiana's 219 decks on `main` (93 of its 167 road bridges, 32 of its 52 rail bridges), 49
  of Cesena's 56 and 32 of the L's 57. On the SP59's bridge by Vinca (310573976, at (1003, −1884))
  the hillside stood 0.93 m over the road 9 m from its end, covering it and its parapet, and on Via
  delle Cave's (140780480, at (−368, 391)) 0.21 m over it. Once every tile is written, each road and
  rail deck's slab as drawn (`DECK_SLAB` in `kinds.ts`: 0.9 m deep under the deck's top, 0.4 m past
  the carriageway or the rail deck's 3.2 m of ballast either side, `src/render/lines.ts`) is read
  every 0.5 m along it, each cross-section across the slab every 0.5 m on the mesh the game draws.
  Walking in from each outer end, the deck's end run lasts until its slab first stands clear of the
  ground all across, and `END_RUN` (4 m, the issue's "more than a few metres") at most: there it
  meets the ground, which only stays at most 0.05 m (the rail bed's `BED`) over its profile, under
  every road's surface (`ROAD_LIFT`, 0.06 m or more). Between its end runs, the ground stays under
  the slab. A deck's pieces join where they share a vertex with tops within `ON_DECK` (`jointsOf`):
  OSM splits a viaduct into ways mid-span (24 of Lunigiana's pieces, 27 of Cesena's, 13 of the
  L's), and a joint is no end. Read on `main`'s build, the slab first stood clear more than 4 m from
  an outer end on 120 of Lunigiana's decks, 24 of them nowhere, up to 20.4 m in (the rail bridge
  621942962) and 19.1 m on a road (260987314); on 43 of Cesena's, up to 143 m of the primary
  70194399's 246 m, an OSM bridge drawn over a bank; on 26 of the L's, up to 12.8 m. Past 4 m the
  pass now lowers the ground under all of them. The pass is exact: the mesh and the deck's planes
  are linear on each triangle, so on each one the slab reaches over it holds the corners of the
  slab's part of the triangle under the plane, lowering the triangle's corner that weighs most there
  first, just enough and at most 0.9 m under the plane, floored to 0.1 m. A deck with a
  cross-section between its end runs left in its slab (the lowered ground cleared some in an end
  run) is laid again over the new stretch, until it lies still. A road's or the rail's core holds
  its nodes only behind a deck's ends (its approach): abeam of a deck, between the lines across its
  ends, a core is an approach's reaching past its end, beside or under it. Lunigiana's pass lowers
  668 nodes (the build prints them as `decks`, 2026-11-07; 735 while each road chain was cored at
  its widest piece's width, 618 before Fosdinovo's part, 208 of those 618 by less than 0.5 m), the
  deepest by 3.8 m at (1840, 11124): the end of a
  12 m footbridge (1161691572) climbing 60%, which as a bridge no chain profiles takes the elevation
  model's point there (below), 3.4 m under the averaged node beside it. Cesena's lowers 510, at most
  5.2 m at (−676, −568), and the L's 118 (132 with the widest cores), at most 1.8 m at (−368, 388),
  under Via delle Cave's bridge. The SP59's bridge now has the ground 0.12–0.92 m under its top
  along its first 4 m and clear of its slab past them, and Via delle Cave's 0.12–0.81 m under its
  top along its south end
  run and 1.03 m or more under it past 4 m from its ends. Beside the nodes, Lunigiana's map moves a
  vertex or two of 12 roads at grade where they meet a deck's end, by up to 1.6 m (they follow the
  ground), 6 buildings' floor or height by up to 0.6 m, 16 streams' floors under decks by up to
  0.54 m, two wall lamps with their buildings, the west end of Minucciano-Pieve-Casola's platform
  by 1.1 m (its lamp pole 5 cm), and a parked spot at (−40.3, 346.2) that now takes a truck;
  Cesena's a vertex of 24 roads, by up to 3.9 m, and the L's one road, 2 buildings and a stream. A
  first cut, capping every corner of each cell the slab reaches over as the rail bed does, lowered
  1,204 nodes and cut a hillside 11.2 m at (2944, −88), 7.3 m off a track bridge whose slab only
  grazed that cell; digging as deep as it took made a 6.1 m pit in a stream's bed by an abutment.
  `deck-ground.map-test.ts` checks every deck of Lunigiana, Cesena and the L ([Checks and
  tools](#checks-and-tools)).
- A bridge or tunnel no profiled chain covers (paths, steps) is a straight line between its ends.
  Under the rail both ends keep the road clearance, as in a profiled tunnel (the pedestrian
  underpass at Equi Terme station).

### 8. Water under decks (`water.ts`)

Bridges keep 2.5 m of clearance over the water: the surface is capped there, settled again
downstream, and re-carved outside road cores. At-grade road crossings imply a culvert, where the
water dips 0.3 m below the road (the two fords over the Aulella, at and below Codiponte, are such
crossings). Water left perched more than 1 m above the terrain (streams that end at a road cut)
drops to the terrain, except inside a wider channel it flows into or in a lake's water, whose
carved beds lie under it, and there only while it still runs downhill (a stream dropped into a
river's carved bed never steps back up): the Canale Doglio through the 18 m² lake at (2934, −2611).
A lake's water stands within 1 m of its level; higher, a surface inside its outline is the stream's
on the bank, and drops no lower than the level, where it meets the lake's. The Canale della Fola
runs into a pond 570 m from Arlia at its ground, 1.7 m over the level the pond's outlet caps it at
(its lowest edge node, down the outlet's cascade), and its last sample there, over the cascade
carved 4 m under it, stood 3.4 m over the ground; it now meets the pond at its level. Two streams
into ponds by Agnolo drop to their levels: 791367422 up to 1.4 m on the bank its pond's outline
reaches up, and the Rio di Antigo to a level 0.4 m under its own surface leaving the pond, where it
steps back up. The grid is then rounded to 0.1 m and stored as integer decimetres. The capping and
settling read no terrain and run before the grid is built (`capUnderDecks`); the re-carve runs in
each tile's window, which then reads the terrain under the water samples of its own cells before
rounding; the culverts and the perched drop run on those readings once every tile is built
(`dropPerched`).

### 9. The railway (`railway.ts`, `platforms.ts`, `rail-clear.ts`)

Once the rail is profiled and its bed laid, the build reads the railway off the shipped (rounded)
rail, so the game finds the same arc lengths in `MAP.rail` (`MAP.railway`).

- **Lines** (`findLines` in `rail-graph.ts`): the rail is a graph whose junctions are piece ends
  ([section 4](#4-the-rail-on-the-ctr)). A terminal is a dead end on the play area's outline, where
  the track runs on beyond it: within 0.08 m of it (`onOutline`), as rounding to 0.1 m moves an end
  cut on a slanted edge up to 0.05·√2 ≈ 0.071 m off it, while a lattice point off a vertical or
  horizontal edge lies 0.1 m or more away. From each terminal a walk goes on at every junction the
  way that turns least (under 60°, headings taken over 5 m: a single 0.3 m end segment turns up to
  12° on the 0.1 m grid, more than a turnout diverges) and never takes a piece twice; a walk that
  ends at another terminal is a line, and of two between one pair of terminals the one turning
  less in all. A dead end inside the map (a siding's buffer) is no terminal, and a ring with no way
  off the map gives no line. Each line runs the way most of its length was drawn.
  One line here: the Lucca–Aulla line's 102 pieces, 16,854.7 m from the outline at Pieve San
  Lorenzo (6700, 3423.2), in the Galleria del Lupacino, to Fivizzano's west edge by Rometta (−5300,
  4621.2), every piece in its OSM direction; 5 251.4 m in tunnels, 1 502.3 m on bridges. Its speed
  limits are OSM's `maxspeed`, pieces with one limit merged: 140 km/h through the Lupacino to s
  873.7, 85 to Equi Terme's stop (s 5979.8), 80 to Gragnola's track-2 stop (s 12016.7), 85 on to
  that edge.
- **Run-outs** (`continuations` in `rail-runouts.ts`, profiled in `build-terrain.ts`): past each
  terminal the build walks the track on along OSM's rail beyond the play area, cut to the built
  terrain's box (`clipBeyond`), so a train past a terminal runs on along the real line, over the
  real ground. The walk takes the terminal's own way from its cut, which lies within 10 m of the
  terminal (`JOIN`), from the terminal's point on to that way's first vertex 10 m or more from it
  (the CTR moved the line in play 0.7 m off OSM's at Rometta, and OSM's node 2.4 m past the cut
  zig-zagged the track 17°, a curve of 86 m), then at each end node the way turning least, under
  60° (`MAX_TURN`, as the lines' walk), until none runs on. Each chain is profiled with the rail
  pass from the terminal's shipped level (`start` in `profiles.ts`: pinned, and its first vertex no
  cut, so a bore from it keeps that level to the box's edge), its claims and rail bed writing only
  nodes beyond the play area (`writes`), so every node in play keeps what the lines in play wrote:
  the 3x still holds lucido's terrain node for node. In a notch the profile reads `loadDtm`'s edge
  drawn on and writes nothing, as no listed tile holds those nodes. Each stretch keeps its bridge
  and tunnel tags, and each line end's run-out ships in `MAP.railway.lines[].runOuts` ([The global
  file](#the-global-file)); the game runs a train out along it to `runOut` m past the terminal, and
  straight on and level past where it ends ([gameplay.md](gameplay.md)). Before them every line ran
  on straight and level past both terminals, and the render drew track past one only where it lay
  on the map's bounds: once Fosdinovo grew the box to x −11500, Rometta's terminal (−5300, 4621.2)
  on Fivizzano's west edge had real terrain past it, the straight run 16.75 m under the hill 192 m
  on and the hill 7.17 m under it 24 m on, with no track drawn, and trains came out of the hill.
  Lunigiana's two:
  - past Rometta 1,154.4 m to (−6359.6, 4250.1), down the Aulella's valley at grade on OSM ways
    183923123 and 61920253 (two stretches of 19 vertices; the bed from 123.4 to 115.2 m), the sim
    running 1,128.6 m of it; over the drawn run (192 m, `DRAWN_RUN`) the terrain stands at most
    0.025 m over its bed and 0.150 m under it, and its bank fills a gully 20–40 m past the
    terminal that the straight run hung 7.2 m over;
  - past Pieve San Lorenzo (6700, 3423.2) the Galleria del Lupacino, one stretch of 9 vertices,
    3,950.2 m on to the box's edge at (10600, 2795.6), level at the bed's 356.9 m, the sim running
    2,298.6 m of it, all in the bore.

  Cesena's four terminals and the L's two lie on their boxes' own edges and have none: past them a
  train runs straight on across the apron, as before. On the 3x lucido's east terminal (4900,
  3609.4) runs on 7,895.0 m east past Pieve San Lorenzo to its box's edge (12700, 2457.5), in 8
  stretches, the last two in tunnels.
- **Kinds** (`kindsOf`): a piece on no line is a `siding` when it leads only to dead ends (pieces
  with an end no other track shares, other than on a line, are taken away until none is left), else
  a `loop`: Gragnola's track 1 (two pieces) and Pieve San Lorenzo's loop (13) are loops; Gragnola's
  stub, Monzone's siding (two), Equi Terme's five pieces and Pieve San Lorenzo's yard (11, its track
  only the CTR has among them) are sidings. OSM's `service` tags play no part, so an OSM passing
  loop or siding gets its kind the same way.
- **Platforms** (`platforms.ts`): each CTR `0141` polygon (OSM's `railway=platform`
  where the 2019 sheets map no ground) is rasterised at 0.05 m and keeps the cells 1.60 m or more
  from every track centreline out of the tunnels (the ATR 220 is 2.883 m wide), 0.5 m or more past
  the edge of every at-grade carriageway, outside the CTR's level-crossing areas, and no more than
  1 m under the platform's top (Gragnola's polygon wraps the station building, whose forecourt side
  lies 2 m under the track). Each piece left is traced, simplified to 0.06 m and rounded to the
  0.1 m grid point that keeps those clearances; the platforms' shipped rings stand 1.63–1.73 m
  from the nearest track. A piece narrower than 1.2 m, or with tracks under 6 m apart on both sides
  of most of it, is a rail-level walkway, not a platform: Gragnola's strip between tracks 1 and 2
  (4.3–5.0 m apart; 1.74 m wide once clipped). Equi Terme's island platform lies between tracks
  7.1–7.6 m apart and stays one. So is a piece no edge of which comes within `PLATFORM_EDGE` (2.2 m,
  `src/sim/map/kinds.ts`, the reach of the render's yellow line) of a track: no train's step reaches
  it, and nobody waits there. The CTR maps a strip north of Pieve San Lorenzo's line as a platform
  (`23D15 AGE#252`, 381 m²), 2.45 m off it, between the track and Via Bugliatico's bank (the ground
  stands up to 5 m over its top on 42% of it): bare ground on the 2010 orthophoto, a 1 m path along
  the track and three low dark structures and a cabinet on the 2023 one, while the platform by the
  building and the island between the loop and the line stand 1.63 m off their tracks.
  A platform's top follows the rail head of the line beside it plus
  0.25 m (a walkway's plus 0.02 m): the 2015 line study calls the platforms low, "secondo vecchi
  standard", and RFI lists none raised to 55 cm; the exact height is not known. It is emitted per
  vertex of an axis along the line, from 1 m before the platform to 1 m past it, because the line
  climbs along them (Equi Terme's top falls 1.96 m over its 136 m). Platforms are `platform`
  areas, walkways `paved` ones; each has a station name, from the nearest station or stop node
  within 300 m.

  | Platform | Area | Width | Track side |
  |---|---|---|---|
  | Gragnola, between tracks 1 and 2 (`23D11 AGE#101`) | 184 m² | 1.74 m | walkway, between track 2 and the loop |
  | Gragnola, by the building (`23D11 AGE#102`) | 596 m² (627 before the forecourt cut) | 6.80 m | beside the loop, track 1 |
  | Equi Terme, the island (`23D29 AGE#166`) | 929 m² | 12.10 m (across the walkway to the building) | south of the line |
  | Monzone, by the building (`23D36 AGE#248`) | 615 m² | 8.66 m | north |
  | Monzone, across the line (`23D36 AGE#249`) | 201 m² | 4.91 m | south |
  | Minucciano-Pieve-Casola, by the building (`23D15 AGE#237`) | 461 m² | 7.60 m | south of the loop |
  | Minucciano-Pieve-Casola, the island (`23D15 AGE#238`) | 355 m² | 3.50 m | between the loop and the line |
  | Minucciano-Pieve-Casola, north of the line (`23D15 AGE#252`) | 381 m² | 6.50 m | walkway, 2.45 m off the line |
  | Fivizzano-Gassano (`23D02 AGE#111`) | 601 m² | 9.68 m | north |

- **Stations** (`stationsOf`): per line and station name, the extent along the line of that
  station's platforms within 2.5 m of it and of its station and stop nodes within 5 m, on the side
  of the biggest of those platforms: Minucciano-Pieve-Casola at s 1558.6–1667.1 (right of the line,
  which runs west there), Equi Terme at 5921.4–6057.0 (left), Monzone-Monte dei Bianchi-Isolano at
  8493.3–8597.1 (right, the building's side), Gragnola at 11911.6–12057.7 (left: track 2 trains call
  along the walkway) and Fivizzano-Gassano at 14454.2–14550.8 (right).
- **Level crossings** (`crossingBoxes`): every vertex a rail piece shares with a road, grouped
  into one box with the others on that road within 10 m, with its graph node (the graph keeps each
  vertex id's node, `buildGraph`'s `ids`) and the line's s at the node on the line: Equi Terme's
  foot crossing (s 5915.4), Via Riolo (8397.5), Viale 20 Settembre (11636.0), Via Castel dell'Aquila
  over both Gragnola tracks (12089.6, two nodes 2.1 m apart), Via Nuova (12335.8) and the old SS445
  by Gassano (13636.8); Pieve San Lorenzo's foot crossing lies on the loop alone, so it names no
  line (`line` and `s` −1).
- **Clearance** (`rail-clear.ts`): outside the crossing boxes (within 15 m of a
  box's nodes, on its road or within its verges: the crossing road's lanes and verges come within
  2.8 m of the track up to 12.4 m away, Viale 20 Settembre crossing at a slant) and the platforms,
  no walk verge or traffic lane comes within 2.8 m of an at-grade running-track centreline at its
  level (within 2 m of the rail's bed): the ATR 220's half-width, a person's radius (0.35 m) and 1 m
  between them. A road whose verge would is given a narrower one (`verge`, both sides, 0.05 m
  clear); a lane that would stops the build (none does). Three of the five narrowed verges lie
  inside their carriageway, along the whole road: Piazza della Liberazione's walkers go 0.13 m
  inside its edge for its 44 m, Via Riolo's 0.12 m for its 182 m and a service road's by Gassano
  0.15 m for its 153 m.

  | Road | Nearest its verge came | Verge (was) |
  |---|---|---|
  | Piazza della Liberazione (700763267, service, 7 m), beside Monzone station | 1.92 m | 3.37 m (4.30) |
  | Via Riolo (183923158, tertiary, 4.8 m), along the line from its level crossing | 1.94 m | 2.28 m (3.20) |
  | Piazza Paolo Sist (140780559, 12 m), by the same crossing | 2.76 m | 6.63 m (6.80) |
  | a service road (140780574, 5.4 m) along the line at the west portal of the 169 m tunnel by Gassano | 1.90 m | 2.55 m (3.50) |
  | an unclassified road (849844675, 5 m, 16 m long) by Pieve San Lorenzo's yard | 2.59 m | 3.03 m (3.30) |

The stage takes about 0.55 s, most of it rasterising the platforms.

### 10. Collision walls (`walls.ts`, `parapets.ts`, `deck-walls.ts`)

Walls are segments of at most 16 m. Blocked 4 m cells are traced with marching squares and
simplified (Douglas–Peucker, 1.5 m tolerance); a cell whose centre lies outside the play area is
never blocked, as the outline's walls stop everyone there (it costs the stage 0.15 s of its 1.5 s).
Slopes use a 12 m baseline, so shorter steps (terrace walls, road cuts) stop no one. Steep cells are
majority-filtered (3 × 3) so the walls follow slopes, not single-cell bumps.

| Wall source | `walk` | `shore` | `drive` |
|---|---|---|---|
| Water cells (within max(w/2, 2) m of the centreline, and the cells of the lakes and river polygons) | no | yes, except on any road or a steep cell | no |
| Slope | > 35°, except on any road | no | > 25°, except within w/2 + 1.5 m of a drivable road |
| Building outlines | yes | no | yes |
| `wall`, `cliff` barriers | yes | no | yes |
| `guard_rail` barriers | no | no | yes |
| The play area's outline (each ring's edges in ring order, 64 m pieces) | yes | no | yes |
| Road-exit caps (4 m inside, where drivable roads leave the area) | no | no | yes |
| Bridge parapets (w/2 + 0.25 m each side of a drivable bridge's deck, where `lines.ts` draws them, each at its deck's level; open where a road on the deck's own level reaches them: a junction on the deck, the next piece of the same bridge, a road or tunnel carrying on from it, and the inside of the deck's own bends, where one segment's piece runs on across the next one's carriageway) | no | no | yes, on the deck's level |
| The low space under a road bridge's deck ([below](#walls-under-the-decks)), on the ground's level | where the deck's underside stands under 1.8 m over the ground | no | under 2.65 m |

Water stops neither feet nor wheels: the player wades and swims, and vehicles float
([water.md](water.md)). The shore walls are the water's edge: the game joins them to the walk walls
for where people and animals spawn, and to the drive walls for the AI drivers' lanes and the
vehicle spawns (`wallsNear`'s `land` and `traffic`). The build still keeps the spawns
and traffic's dead ends clear of the water: it checks them against the walk walls with the shore
and against the drive walls with the water's cells open where a drivable road crosses, as the drive
walls held them before, and stores neither of those.

- Road buffers are padded by half a cell plus the simplification tolerance, so no traced wall
  comes within w/2 of a centreline. The carved banks of the wider streams skip the slope test, and
  so does the edge of a river polygon its river runs through (2 cells either side of its rings),
  carved to its river's floor: they are the way out of the water. A lake's bed only shelves, and so
  does a river polygon's whose river the map does not hold, so their banks are walled as steep as
  they are.
- Where a drivable road (not a tunnel) runs through or along a footprint, the house gives way:
  OSM centrelines and the surveys' footprints disagree by a metre or two, and none of these roads is
  tagged as a passage. `clipBuildings` cuts a corridor of min(w/2, 1.2) m half-width out of the
  footprint (rasterised at 0.2 m and traced like the walls), so the house drawn and its walls are
  one outline. A footprint cut in two becomes two buildings with the same id; slivers under
  4 m² are dropped. Clipped houses lose their hip roof.
- Tunnels, paths and steps under arches only open such a corridor in the walls: the house is
  drawn whole, the passage stays open and the interior stays closed. Within a footprint a corridor
  reaches, the walls are carved 0.25 m wider, half a raster cell and the trace's 0.15 m tolerance,
  as the slope walls' road buffers are padded, so no traced wall comes back inside the corridor:
  unpadded, a footway in Giucano (1326730180) cut four cells into a house, and the trace left the
  wall 0.54 m from its centreline, inside its 0.75 m. A footprint whose outline a corridor reaches
  by less than a cell, with no cell centre inside it, is carved too: left whole, a house's corner in
  Fivizzano stood 0.56 m from a footway's centreline (1065669242). On Lunigiana with Fosdinovo, 404
  footprints traced became 428; the houses drawn are unchanged, as `clipBuildings` keeps its own
  corridor unpadded ([Known data limitations](#known-data-limitations)). A motor road's corridor is
  its whole w/2: no arch spans a motorway's or trunk road's tunnel, and the 1.2 m left the Secante's
  7 m tunnel under a house in Cesena a 2.4 m gap, too narrow for traffic, which cut 1.45 km of it
  off.
- Tree trunks are not stored as walls. `wallsNear` indexes the trees as points and adds a 0.5 m
  square (`pushTrunk`, `TRUNK` in `kinds.ts`) around each tree a query reaches.
- **Walls with a level** (issue #91): a wall may carry a level, m a.s.l., and then stops only a body
  whose ground stands within 2 m of it (`ONE_LEVEL` in `kinds.ts`, `onOneLevel`): a car whose
  wheels, or a person whose footing, stand there. Every other wall stands at every level. The
  bridges' parapets and the walls under their decks ([below](#walls-under-the-decks)) are the walls
  with a level. A parapet (`parapets.ts`) needs one: walls are flat lines, so a parapet
  that stopped everyone would close the road under its deck too, and so it used to open wherever any
  road's carriageway reached it, the road under the deck included, and a car on the SR445's viaduct
  west of Gragnola (552592654, at (−2674, 4584)) drove off it there and dropped from 148.5 m onto
  the residential road 140780578 under it. Each parapet wall takes its deck's top at its middle (its
  profile plus `ROAD_LIFT`, to 0.1 m), and a parapet opens only where a road's surface, where its
  carriageway reaches the parapet, stands within 2 m of the deck's top there: a road carrying on
  from the deck, at any angle, opens it however the two are tagged, and one passing under it does
  not, even the SR445 itself, which runs on from its bridge 552592647 west of Gragnola and turns
  back under it 5.8 m lower. Lunigiana has 766 parapet walls, and the parapets of 5 bridges close
  over a road on another level (the viaduct; 552592647, over that loop; the SR445's 552592643, over
  a track 15.8 m under it; the Ponte di Codiponte, 328463361, over a residential road 5.5 m under
  it; and since Fosdinovo's part Via Giuseppe Verdi's at Bardine di San Terenzo, 599910879, over
  the track 599910873), Cesena 602 walls and 17 bridges, the L 79 walls and none (the build prints
  them as `parapets`; 2026-11-07, Lunigiana's 667 and 4 before Fosdinovo's part). The build's
  clearance meets a wall with a level as the game does, at the query's level: the ground at a spawn
  or a parked spot, a road's surface at a traffic dead end. So the service road 1501392819, which
  ends 2.2 m off 552592647's north parapet and 6 m under it, at (−3267, 4478), keeps its last 6 m
  edge in traffic, where that parapet took its turning room before; and on Cesena the closed
  parapets along 137735208's 200 m deck split into 15.4 m walls where gaps cut them into 9.5–14.8 m
  ones, so their ends lie up to 0.05 m nearer or farther from the centreline, and the truck's lane
  there is 1.45 m off it both ways, not 1.2 m one way.

#### Walls under the decks

A deck within `ON_DECK` (0.5 m) of the level a body was on takes its footing (`groundZ` in
`src/sim/map/ground.ts`), so the ground rising toward a deck's underside led onto its top, the head
through the 0.9 m slab first (issue #87): under Via Nuova's bridge in Gragnola (313852513) a walker
went up the bank from (−1600.7, 3675.3) and stepped from 164.26 m onto the deck's 164.76 m. The
build walls off the low space under every road deck, as an abutment would (`deck-walls.ts`, from
the ground as lowered under the decks: [Ground under the
decks](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)):
walk walls where the deck's underside (`DECK_SLAB.depth`, 0.9 m, under its top) stands less than a
person (`PERSON_HEIGHT`, 1.8 m) over the ground, drive walls where it stands less than the tallest
vehicle (the truck's 2.65 m). Someone under a bridge goes only where there is headroom, and onto its
deck only from its level, along the road at its ends.

- **The low space** (`deck-space.ts`) runs round each deck's line out to where its walls stand:
  past where its walkers go (`footReach`, w/2 + 1.3 m on a road, and the slab's 0.4 m past the
  carriageway at least) for the walk walls, half a metre past its parapets for the drive walls; and
  round its ends too, the top there the end's. There the ground at the terrain's level, as the game
  reads it (`atGrade`: the terrain, or a road at grade over it, an approach's carriageway floating
  at the deck's level over far lower ground included), stands within that headroom of the deck's
  top. Decks whose walls would touch are one space.
- **The walls** trace its outline on a lattice 0.25 m apart (marching squares with the crossings
  between the nodes, `traceContours` in `loops.ts`; simplified within 0.1 m, in pieces of at most
  4 m), and, inside it, the outline of the ground on the deck's level (within `ON_DECK` of its top)
  where the low space lies beyond: so nobody under the deck's level reaches that ground from below,
  even along a road passing through.
- **Their level**: each wall takes the ground just outside it (0.25 and 0.5 m out, every 0.5 m along
  it; a wall is split where that ground spans 3 m or more, along a step), midway through it, but
  stands at least `ONE_LEVEL` + `ON_DECK` (2.5 m) under every deck over it, to 0.1 m: anyone a deck
  holds, on it or on the road at its ends, passes every wall, and anyone on the ground below,
  within 2 m of that level, meets them. So a deck's ends stay open to its road's level by the walls'
  level alone.
- **Roads**: a road passing under a deck, its surface as the game reads it 2 m or more under the
  deck's top wherever it comes within the walls, keeps a corridor through the low space, 0.25 m past
  where its bodies go, where its ground stands 2 m or more under the top, walled along its sides;
  where a bank its carriageway's edge climbs rises nearer, the walls stand across it. Any other road
  opens a wall across its carriageway where its surface, as far along it either way as half the
  longest vehicle (3.8 m), comes within 2 m of the wall's level: a road carrying on from a deck's
  end, leaving it at an angle (the path 1240691428 off the end of 140780504 by Equi Terme), or
  passing through. No wall stands on a road on its level.
- **The verges at a deck's end**: pedestrians walk a road's verges (`walkSide`), off its
  carriageway, and onto a deck's at its end, where their ground comes within `ON_DECK` of it. A
  verge a few tenths of a metre to a metre under the end's top lies in the low space, so the walk
  walls round the end stopped them there (18 of Lunigiana's deck ends, 7 of Cesena's, 2 of the L's).
  A road meeting a deck's end (a vertex of its at the end) opens the walk walls round it as far as
  its walkers go (`footReach` + `PERSON_RADIUS`), behind the end and up to `ONTO` (2 m) past it,
  where the ground stands within 2 m (`ONE_LEVEL`) of the end's top. Farther under the deck the
  walls stay: opening as far as the walkers' reach round the end let a walker up onto bridge
  798008343 5.1 m from its end. A verge that dips 2 m or more under the end on its way (a ditch: 6.7
  m under 102308011's), or runs beside the deck more than 2 m past its end (a road turning back
  along it, as 145347889 by 1362959048), still meets the walls, as anyone under or beside a deck
  does: 5 of Lunigiana's deck ends and 1 of Cesena's.

Lunigiana has 5,983 walk walls and 10,215 drive walls under its 199 road decks (5,120 and 8,580
under 167 before Fosdinovo's part), Cesena 2,054 and 3,130 under its 50, the L 740 and 1,218 under
its 23 (the build prints them as `underDecks`; 2026-11-07; 6,032 and 10,166, 2,044 and 3,109, 758
and 1,219 while each road chain was cored at its widest piece's width, which moved the ground by
the decks' ends).
When they came in (2026-11-06, before Fosdinovo's part) they added 44.4 KB to Lunigiana's files
gzipped (32.02 to 32.06 MB), 13.1 KB to Cesena's and 6.0 KB to the L's, and against the same build
without them `pnpm map-diff` moved the walls alone (on Cesena their extent moves the walk walls'
lattice 1.8 m). They took the walls stage under half a second longer on Lunigiana (7.70 and 8.04 s
over two builds, from 7.65 s without them).

### 11. Road graph (`graph.ts`)

Nodes come from shared OSM node ids (clip points get their own), and edges are split to at most
25 m. Where a road leaves the play area, its end is pulled back 8 m, past the exit cap. `traffic` is
the largest connected component of the `motorway` to `service` edges (`isTraffic`: living streets
and links included), minus private roads, dead-end tunnel spurs, and dead-end tips with no room for
a car to turn (a 2.3 m circle clear of trunks and of the drive walls on the road's level, at its
surface there: lanes that end between houses); tracks are drivable by the player but get no AI
traffic. `walk` is the largest connected component of every edge except tunnels and motor roads
(`isMotorRoad`: motorways, trunk roads and their slip roads, where the Codice della Strada,
art. 175, bans people on foot), so nobody walks the Secante. The build keeps each vertex id's node
(`ids`), so the level-crossing boxes name their nodes without matching coordinates.

### 12. Trees, spawns, districts (`trees.ts`, `spawns.ts`, `districts.ts`)

- **Trees**: a jittered lattice at one tree per 50 m² inside the woods (`forest`, `conifer` and
  `mixed` areas, `WOODS`). Trees stay out of other areas, buildings (plus 2 m), roads (w/2 + 2 m),
  stream beds and the rail, its loops and sidings included (6 m), and stand 1 m inside the built
  terrain's box on the region's tiles (`tiles` in `region.ts`, those its parts' rectangles meet),
  outside the play area too. There the map holds no roads, water, rail or buildings, so the trees
  keep off the inputs' own, cut to the box beyond the outline (`clipBeyond` in `play-area.ts`; the
  roads as wide as the surveys map them, the buildings whose centre lies beyond it), and some part's
  OSM extract holds every listed tile's ground in the box ([section
  1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts); `fetch-osm.test.ts` checks
  the boxes the lock records), so the trees keep off OSM's roads there too. Before, on the
  L test region's notch, 1,763 more trees grew there, 467 of them on a road, 319 in a stream and 21
  in a house of lucido's map, which holds those whole (`l-region.map-test.ts` checks it). Sparse
  trees also line the banks of the streams the map holds at least 4 m wide: a candidate every 9 m
  along the OSM way on each side, kept by a hash of the way's id, the step and the side, at most one
  in a 4 m cell, and standing bed + 2 to bed + 5 m from the centreline. The steps count from the
  way's start (`WaterF.from`, where the outline cut the piece), so they stay put when the play area
  grows, but the bed is the piece's: where the outline newly cuts a way sized by its piece (the
  Lucido and the Caldanella by the piece's mean ground, Cesena's rivers by the piece's median
  width), its bank trees move with its width. Cesena's Savio (way 1029104404) is cut into pieces
  13.8 and 14 m wide; of Lunigiana's ways sized by their ground the outline cuts only the Aulella's
  last (172808472, at Fivizzano's west edge) and the Bardine's (790365369, at Fosdinovo's north
  edge), whose pieces stay in the 12 m class, and a mask across another
  could switch its water between 8 and 4 m wide and move its bank trees 2 m. The water areas and the
  rivers' gravel are areas too, so neither lattice nor bank trees stand in them: 1,725 fewer on
  lucido, 1,655 of them in the UCS gravel, mostly by the Aulella, 31 in the lakes and the river
  polygon and 39 at their edges, where the 2 m masks reach past the outlines. The UCS's woods add
  43,294 lattice trees, and 256 bank trees standing in them give way: 43,038 more in all. The olive
  groves grow olives on a lattice of their own, a tree every 7 m (204 a hectare: the groves round
  Gragnola hold 150–280 on the 2023 orthophoto, the tended ones about 6 m apart, the old ones 7–8
  m), each 2, 3 or 4 m into its cell (a quarter, a half and a quarter of them: up to 1 m off the
  whole metre by its middle), so the rows read as a grove's and not as a grid, and only where the
  land cover draws the grove (no area over it in `FILL`), after the woods' and the banks' trees,
  which keep out of the groves as out of every other area. They add 216,330 olives on Lunigiana
  (139,583 before Fosdinovo's part, when the groves and vineyards over OSM's forest took 27,248 of
  its trees and 104 bank trees). No cap: 5 090 371 trees on Lunigiana (216 330 olives and 2 829 on
  the banks, 2026-11-07; lucido alone's 1 079 138, 35 733 and 930)
  and 5 521 on Cesena (171 on the banks, no olive), positions rounded to 1 m (at most one tree per
  spot) and a scale of 0.8–1.3. Placement uses a fixed hash, not a random generator.
- **A fixed lattice**: it starts at the region's anchor (`anchor` in `region.ts`: Lunigiana's
  (−2900, −6100), the corner of its first part, lucido; Cesena's (−2000, −2000)), set once and never
  taken from the bounds, and its cells run on past it either way, so adding a part moves no lattice
  tree. A tree's id is its cell's number, (gj + 8192) × 16384 + (gi + 8192) for the cell gi east
  and gj north of the anchor (below 2²⁸), and a bank tree's is its 4 m cell's number past them,
  2²⁸ + (cj + 16384) × 32768 + (ci + 16384) (at most 2²⁸ + 2³⁰ − 1), and an olive's is its 7 m
  cell's number past those, `OLIVE_TREES` (2²⁸ + 2³⁰) + (gj + 8192) × 16384 + (gi + 8192) (below
  2³¹: the tiles keep ids as int32), so a tree is an olive by its id alone (`kindAt`). The cells run
  57.9 km (lattice), 65.5 km (banks) and 57.3 km (olives) from the anchor either way, and the
  scatter throws past them. The ids order the whole map's trees (south to north, west to east, then
  the banks, then the olives), seed each tree's look (3 × id, a mirror's one more:
  `src/render/trees.ts`), and never change as parts are added. A bank tree's seeds pass int32
  (Lunigiana's largest is 2 839 759 284), most olives' 2³² (Lunigiana's largest is 4 562 508 999),
  and `hash01` wraps them (ToInt32): no two seeds below 2³² meet, an olive's past it wraps onto one
  2 more than a multiple of 3, which no other tree's is, and only an olive's mirror's past it wraps
  onto a wood's tree's, one 1 431 655 765 ids lower, over 38 km away.
- **A tile at a time**: the scatter (`trees.ts`) works each of the region's tiles alone,
  rasterising its 2 m masks (the woods, the other areas, the buildings, the olive groves and the
  areas drawn over them) over the tile and a metre round
  it on the anchor's pixels, the pixels one raster of the whole map has there. A tree belongs to the
  tile of its rounded point, so two lattice points that round onto one spot, even from either side
  of a seam, meet in one tile, where a bit a metre keeps the first (the lattice's, then the bank
  trees', then the olives'). The tiles' trees are merged by id (`mergeTrees` in `trees.ts`). The
  scatter took 0.7 s for lucido's 30 tiles (the trees stage takes 4.2 s for Lunigiana's 102, 3.0 s
  for its 79 before Fosdinovo's part and 2.7 s before the olives) and holds one tile's five masks,
  5 MB, at a time.
- **Player spawn**: the Via Cesare Battisti sidewalk nearest the Carabinieri station, with 1.3 m
  clear of walk and drive walls. Cesena, and a test region without the Carabinieri, use a central
  street in its connected traffic network (the traffic node nearest the origin, `startNear`). The
  final rounded position must lie outside every building footprint and the water areas, and have a
  walk-clear route to its street centreline, sampled at intervals no greater than 0.5 m. Wall
  distance alone can accept a point deep inside a building, leaving the player trapped.
- **Parked spots**: on the right kerb of primary, secondary, tertiary, unclassified and residential
  roads (not bridges or tunnels; never by a motor road, where art. 176, comma 5 bans stopping on the
  carriageways and ramps), at least 12 m from junctions and 9 m from each other, with two or more
  buildings within 40 m, off every carriageway (tunnels included), clear of walls, its box's centre
  and corners out of the lakes and river polygons (whose shore walls open on the roads beside them),
  with the car's box at least 2.8 m from at-grade running track (the clearance rule) and 1.94 m from
  a loop or siding (a train's half-width, 1.44 m, plus 0.5 m: a spot by OSM's Gragnola loop stood
  1.4 m from it; measured from the car's centre, the rule kept a spot at (−1645.2, 3301.1) whose
  side stood 2.02 m from Gragnola's through track), and none within 20 m (in a straight line, so
  along any road too) of a level-crossing node: the Codice della Strada (art. 158) bans stopping "in
  corrispondenza o in prossimità dei passaggi a livello". That rule took three spots, 14.7–19.4 m
  from Via Nuova, Via Riolo and Viale 20 Settembre; others took their place. The two nearest the
  Carabinieri station come first (the sim parks their cars there: the station goes into the map as
  `spawns.police`, so the game never guesses it among the police POIs); the rest are the candidates
  (every 3 m along a road) whose place's hash falls under the map's share (`KERB_SHARE` in
  `spawns.ts`: 0.135 on Lunigiana, about one spot per 8 buildings, as lucido alone's 6,388 take
  795 besides the Carabinieri's 2;
  Cesena's 0.0613, a town's streets offering more candidates a building), taken in hash order 9 m
  apart, so a spot is kept or not by its own place and the candidates near it: each village gets its
  share, and a part that grows the region keeps every other part's spots (before, a count of one per
  8 buildings cut the whole map's candidates in hash order, and Fivizzano's buildings and roads
  reshuffled it). Car parks within 150 m of Monzone station add up to 6 nose-in spots each, 8 in
  all (3,500 spots on Lunigiana, 805 on lucido alone, 2026-11-07). The sim decides how many cars to
  park on them.
- **Districts** (`districts.ts`): 14 hand-placed discs (name, centre, radius) for Monzone's
  station, streets and hill clusters, then a disc per OSM `town`, `village` and `hamlet` node in
  play outside them (143 on Lunigiana: 26 of them lucido's, Gragnola, Equi Terme, Viano, Vinca,
  Tenerano, Ugliancaldo...; 79 Fivizzano's part's, Fivizzano the one town; 38 Fosdinovo's,
  Fosdinovo, Tendola, Ponzanello, Ceserano, Castelpoggio, Caniparola...), then 46 hand-placed
  landmark discs for the unpopulated mountains (lucido's 35: Monte Sagro, Pizzo d'Uccello, Foce di
  Vinca, Cava Cattani, Capanna Garnerone..., and the quarries of the Carrara side; Fivizzano's 7:
  Passo dei Carpinelli, Passo di Tea, Passo del Romito, Cima Belfiore, Monte Tondo, Monte Cucu and
  Monte Chiaro; Fosdinovo's 4: Foce del Cucco, La Pizza, Monte La Pianaccia and Monte Grugola; the
  last two parts' radii fitted on the 2023 orthophoto with the built terrain's contours over it):
  peaks, saddles and huts on their OSM nodes (Monte Chiaro on its castle's, on the hilltop, 72 m
  west of OSM's peak), quarries on their pits, localities and ridges centred by hand on the slope
  they name; 203 discs in all. None overlaps a village disc but Passo dei Carpinelli's, 70 m,
  inside Casone Carpinelli's and small enough to take none of its buildings or spots, so the pass
  names its own district (issue #17); Foce del Cucco's 200 m, which holds the SP72's and the SP9's
  junction on the pass and its 17 houses, stops 47 m short of Monte Carboli's (issue #18). The
  Fortezza della Verrucola is left to Verrucola's disc, the Castello Malaspina to Fosdinovo's, and
  the Castello di Ponzanello, 67 m past Ponzanello's disc, takes the hamlet's name by the nearest
  rim. A `locality` (a
  named hillside or field, like I Pianelli above Equi Terme) gets none: it would claim the village's
  station and spa. Each building outside Monzone's discs goes to the nearest place node within 600
  m; the place's disc is centred on its node and covers 90% of those buildings plus 10 m, clamped to
  80–400 m. `districtAt` picks the disc the point is relatively closest to, or the nearest rim
  outside every disc. Of the buildings in a settlement, found by geometry (10 or more others within
  150 m: 91% of lucido's and Fivizzano's part's buildings, 82% of Fosdinovo's), 86.9% stand in a
  disc (lucido's 90.0%, Fivizzano's part's 88.8%, Fosdinovo's 80.8%, where 24 of its 38 discs stand
  at the 400 m cap and Ceserano's disc leaves its western borgo out: [Known data
  limitations](#known-data-limitations)); `map.map-test.ts` holds them to 80%.

## Pinned inputs and CI

`data/raw` is gitignored. `data/raw.lock.json` pins it (`src/tools/raw-lock.ts`), and CI builds the
maps from it. The README's [Rebuilding the map](../README.md#rebuilding-the-map) gives the reasons
(git cannot delta the deflated inputs; Git LFS's free tier has a bandwidth cap) and the steps to
change an input.

- **The lock** holds one entry per file in `data/raw`, by its `/`-separated path, sorted. A pinned
  entry holds `sha256`, `bytes`, `asset` (`raw-YYYYMMDD/<path with / as .>`, or
  `raw-YYYYMMDD-2/…` past the first release of a day) and `source`. The asset is named after the
  path the file was pinned at: a file moved since keeps its entry's fields under its new path, and
  `fetch-raw` downloads it by the asset's name to that path, so a move uploads nothing. The OSM
  extracts moved into `osm/`, one a part, that way: `osm/lucido.osm.gz` is still
  `raw-20261030/lunigiana.osm.gz`, `osm/cesena.osm.gz` `raw-20261030/cesena.osm.gz` and
  `osm/pontremoli-town.osm.gz` `raw-20261103/pontremoli-town.osm.gz`. A fetched one, written by a
  fetch tool and not uploaded yet, holds the same without `asset`: its digest is of the bytes the
  tool wrote, so `pin-raw` uploads those bytes and no others. `readLock` (Valibot) rejects any other
  shape, a path with a part that starts with a dot (`..`, `.DS_Store`) and an asset outside a `raw-`
  release. `writeLock` writes the fields in that
  order, one per line, so a re-pin's diff shows only the files that changed. Today: 1,170 files,
  92.4 MB: 238 in `raw-20261030`, 8.94 MB; #11's 95 in `raw-20261103`, 1.16 MB (the 2009 sheets' 82
  files, Pontremoli's 12 DBT files and its OSM extract); #12's 16 in `raw-20261103-2`, 1.22 MB (the
  Sarzana test region's 13 Liguria files and its terrain's 3); #17's 487 in `raw-20261104`, 55.19 MB
  (386 CTR files, 73 of its 79 terrain tiles, 24 DBT files, the Bagnone ridge's 3 and
  `osm/fivizzano.osm.gz`); #15's lucido land cover in `raw-20261107`, 0.84 MB; and #18's 333 in
  `raw-20261107-2`, 25.01 MB (the 31 sheets' 248 CTR files, 38
  files of the 2009 sheets, 29 terrain tiles of 17.48 MB, Fosdinovo's 23 and the 6 of Fivizzano's
  its box grew, the two parts' land cover, 2.98 MB, Liguria's 15 files and `osm/fosdinovo.osm.gz`,
  2.03 MB). No entry names `raw-20261031` (#73's land cover), `raw-20261101` (#10's two terrains,
  lucido's one mosaic among them) or `raw-20261103-3` (#14's land cover with its woods) any more,
  nor `raw-20261104`'s land cover and those 6 tiles, nor `raw-20261107`'s Fivizzano land cover:
  only an older lock fetches them.
  From an empty `data/raw`, `pnpm fetch-raw` downloaded the 356 files of 29.3 MB the lock held on
  2026-11-03 in 41.8 s.
- **Sources**: each fetch tool calls `recordSource` for every file it writes (`fetch-rt` also for
  each file it finds unchanged). `fetch-rt` gives the archive URL of the CTR sheet or section a file
  came from, and of a DBT layer's comune with the EPSG:3003 box its records were cut to
  (`…/DBT2K_045014_PONTREMOLI_…7z, the records whose box meets EPSG:3003 1568924,…`), the terrain's
  sources (each `dtm/<i>_<j>.bin`, or a test region's `dtm.bin`, `dtm.json` and `dtm-src.bin`: the
  manifests' archives, the land-cover request with the date when the surface model fills, and
  Emilia-Romagna's WCS when it does), and the WFS request with the date for the land cover.
  `fetch-osm` gives every `/map` box, one a rectangle of its ground, and the date (and, for a test
  region's buildings, "buildings only"), `fetch-rer` the WCS request and the metadata URL, and
  `fetch-lig` each layer's first page and each crop's request, each with the date; `fetch-rt` names
  Liguria's crops among a terrain's sources when its chain takes them. A tile's file that held cells
  keeps the source its entry recorded for them, and a fetch that adds cells to it writes its own
  after it (`…; then, for the 15675 cells it lacked: …`, `writeTiles`), so a file never drops the
  source of a cell it still holds; a fetch that adds it no cell leaves that source alone. An entry
  that already holds the file's bytes, pinned or fetched, stays as it is; any other file becomes
  fetched. The entries pinned on 2026-10-30 say when the file entered git (`in git since 2026-10-20
  (66ae295)`) instead of a fetch date.
- **`pnpm fetch-raw`** (`fetch-raw.ts`) hashes `data/raw`, then downloads every pinned file that is
  missing or has other bytes with `gh release download`, one call per release, into a folder inside
  `data/raw`. It checks each download against its SHA-256 and size and moves them into place only
  when all match, so a mismatch fails the run with `data/raw` unchanged. It reports the fetched
  files and the files the lock does not list, and leaves them; a fetched file whose bytes `data/raw`
  no longer holds fails the run. From an empty folder: the 245 files before #11's in 44 s (241 in
  25 s on 2026-10-30); on a second run, none. A `data/raw` from before a move still holds the file
  at its old path, which `fetch-raw` reports as unlisted after downloading it to the new one, and
  which `pin-raw` refuses: move it there first (`mkdir -p data/raw/osm; mv
  data/raw/lunigiana.osm.gz data/raw/osm/lucido.osm.gz`, and `cesena.osm.gz` and
  `pontremoli-town.osm.gz` under their own names), or delete it.
- **`pnpm pin-raw`** (`pin-raw.ts`) refuses while a file has no entry, a file's bytes differ from
  its entry's (pinned, or fetched and since replaced), or an entry's file is gone (`planPin`, each
  with its fix). Otherwise it copies the fetched files under their asset names, checks each copy
  against its digest, and makes one prerelease per 1,000 of them with
  `gh release create`, not marked latest (gh uploads to a draft and publishes it once all are up).
  It writes the lock after each release. The release notes carry each source's credit and licence
  link and say the files are changed from their sources (`NOTES`).
  241 files in 38 s.
- **CI** (`.github/workflows/ci.yml`, `.github/actions/maps/action.yml`): the check job restores
  the maps from the cache under `maps-<os>-<node version>-<key>`, so a new Node is built and
  checked again. Every job reads the version from `.node-version`: the runner images update their
  Node 24 on their own schedules, and the x64 jobs must look up the key the arm64 job saved. On a
  miss it restores `data/raw` from the cache under the lock's hash, runs `pnpm fetch-raw` (saving
  `data/raw` once it checks) and `pnpm maps`, which builds the L test region too (`test-maps/`,
  cached and hashed with the maps: [Test regions](#test-regions)). The cache's paths are the
  global files, the tiles and the overviews (`src/sim/map/*/overview.png`,
  `test-maps/*/overview.png`), the same in the restore and the reproducible job's save, so a hit
  brings back every file `vite build` and the map tests read but the raw inputs: the check job
  sets the action's `raw`, so on a hit too it restores `data/raw` and runs `pnpm fetch-raw`, for
  `terrain-seams.map-test.ts`, which reads the terrain fetch-rt wrote, `pontremoli.map-test.ts`,
  which reads the DBT and the OSM extract fetch-rt and fetch-osm wrote, and `sarzana.map-test.ts`,
  which reads the NC5 fetch-lig wrote and the terrain fetch-rt wrote from it (Pages leaves it
  unset).
  `map-key.ts` hashes the raw lock, `package.json`, `pnpm-lock.yaml` and every file `build-map.ts`
  imports, followed from import to import (140 files today, in `src/tools`, `src/sim`, `src/render`
  and `src/maps.ts`, through the bakes and the overview's look, `src/render/map-style.ts`), so a
  change anywhere else reuses the cached maps, and a change to the full map's look builds a new
  overview. It fails rather than miss a file: on a specifier that names no file, an `import(`
  without a string literal and any `require(`. When the check job built the maps, the
  `reproducible` job builds them again on an arm64 runner (`ubuntu-24.04-arm`; the check job's is
  x64); the SHA-256s of the two builds must match, and only then does it save the maps to the cache,
  so a re-run checks a new key again. The hash is taken over the map files gunzipped, then the
  overviews' image data inflated (`node src/tools/png.ts <file>…` writes each PNG's IDAT chunks
  inflated to stdout), each in path order: another zlib compresses the same bytes differently, so
  the compressed files would not match. The x64 check job and Pages restore what it saved.
  Pages (`pages.yml`) runs the same action before `vite build` and saves nothing.
- **Tests**: `raw-lock.test.ts` checks the lock's format, `recordSource`, `writeRaw` leaving a
  file that unpacks to the same bytes as it is and `dropRaw`, that git ignores
  `data/raw` and the built maps, and that no tracked file is over 1 MB. `fetch-raw.test.ts` and
  `pin-raw.test.ts` run against a fake `gh`: a second fetch downloads nothing, a file moved since it
  was pinned comes by its old asset's name to its new path (the one at the old path reported and
  left), a download with other
  bytes fails with `data/raw` unchanged, a fetched file replaced since is refused, an upload of
  1,001 files takes two releases (`pin-raw.long-test.ts`), and the release notes carry the README's
  credits and licence
  links. `map-key.test.ts` checks every import form it follows, that it throws on the ones it
  cannot, that the key moves with the lock and the imported code and with nothing else, and that
  no imported file calls a `Math` function or `**` that rounds differently on arm64 and x64.

## Map files

A map is a global file, one file per 2 km tile beside it and, beside the tiles, the full map's
overview ([The overview](#the-overview)). The global file holds everything sparse and topological:
the roads' attributes, the rail, the graph, the railway, the tile list, the tables baked from the
dense layers and the vectors, and what the vectors give readers far from the player (`derived`).
The tiles hold the dense layers (terrain, walls, trees and land cover) and the vectors round them:
every road line, river, barrier, building and area, each whole in every tile it comes near. So the
game downloads and decodes the vectors only near the player, as it does the dense layers: on
Lunigiana the global file and the 4 tiles within 1 km of the start (−1_−1, 0_−1, −1_0 and 0_0) are
3.35 MB to download (3,351,533 B: the global file 1,247,151 B, the tiles 2,104,382 B; 4.32 MB while
the global file's line held the graph, the lanes and the residents, before format version 6, and
3.62 MB before Fosdinovo's part; 2.31 MB on lucido alone, whose global file is 0.31 MB, 311,589 B,
0.55 MB before version 6; 2.40 MB before the UCS's woods, 2.50 MB before its olive groves), where
on lucido they were 3.10 MB with the vectors in the global file, and a production build's JS heap
after a forced GC is 164 MB with Fosdinovo's part (2026-11-07, three runs on #18's final code; 161
MB before its review's fixes, against 130–131 MB for main's build beside them, and under the
245 MB issue #18 allows; 132–133 MB measured earlier that day with the olive groves, 130–132 MB
before them; 89–90 MB on lucido alone, 88–89 MB before the woods) where
lucido's was 123–124 MB with the vectors in the global file (`pnpm playtest heap`, three runs each,
2026-10-31, before and after main's water areas, #73; 2026-11-03 with the woods).

A tile is the square x 2000i … 2000(i + 1), y 2000j … 2000(j + 1) on the local origin, keyed `i_j`
(`TILE` and `tileKey` in `src/sim/map/kinds.ts`). The listed tiles are the region's, each tile one
of its parts' rectangles meets (`tiles` in `region.ts`): Lunigiana's 102 of the 132 in its box (i
−6…5, j −4…6) are Fosdinovo's i −6…−3 and lucido's i −2…2 up to j 0, the whole row j 1, where
Fosdinovo's rectangle, lucido's and Fivizzano's meet, and Fivizzano's i −3…5 from j 2 up; its two
notches are the 30 tiles no rectangle meets, i −6…−4 for j 2…6 and i 3…5 for j −4…0; Cesena's 4 are
−1…0 both ways, the whole box round its one rectangle (`tileRange`). The render's 192 m apron past
the bounds has no tiles of its own: it extends the edge nodes, as before. The game takes the box of
tile indices from the listed tiles, not from the bounds, and a region whose parts make an L lists no
tile in the notch the parts leave in the box round them: there a terrain or land-cover lookup reads
the nearest node or cell of the listed tiles in the nearest ring of tiles round the unlisted one (a
tie goes to the first in key order), so the ground past an inner edge of the play area extends that
edge, as the apron does past the bounds (`src/sim/map/tiles.ts`; `notchMap` in
`src/sim/map/__tests__/edit-map.ts` cuts Lunigiana to lucido's rectangle, anchor kept, and drops its
four tiles north-east of (2000, 0), a notch that stays put however the region grows, and the
`notch.test.ts` beside each runtime reader of the tiles and the play area checks it there; the
tunnel portals' `portals.test.ts` moves the outline onto a tunnel mouth instead, where neither the
railway's nor a road's tunnel has a mouth). The build works the terrain of the listed tiles alone,
reading none in the notch ([Pipeline](#pipeline)), writes the listed tiles alone and keeps a wall or
tree whose midpoint falls in the notch (an outline wall on its side, a house wall over it) in the
listed tile round it nearest it (`tilesRound` in `src/sim/map/kinds.ts`, the cut in
`src/tools/tile-map.ts`): such an item lies within a wall's reach of the play area, so its
coordinates pack as the tile's own do. A vector near the notch goes to every listed tile round it. A
wall or tree lookup over the notch reads the listed tiles round it, and a lookup of the vectors at a
point in it reads their vectors, merged (`placeAt`). The tiles round it are what `tilesOver` names
for a box over the notch, so the host keeps them in memory wherever a lookup there may read. The
coarse grid's nodes in the notch read the same nearest listed node and cell (`readAt` in the cut),
so a host that falls back to it where those tiles are not in memory finds the ground and cover the
tiles give: before, they held the notch's own land, up to 286 m off the extended edge on the L test
region, and 1,140 of its 4,774 heights and 488 covers differed (`l-region.map-test.ts` checks every
node against the tiles).

From every road the camera's view stays inside the render's 192 m apron, at the widest zoom and
any heading (measured before Fosdinovo's part: its edges are not), at most 121 m out, where the SP68
leaves the north edge at (2650, 13000) (`APRON` in `src/render/chunks.ts`). On foot the clear colour
shows past the apron where the ground falls away from a ridge by the edge (issue #3, step 3). On the
camera's geometry (30°, 500 m back, 8 texels a metre, the four seats), from a 25 m grid of the play
area within 600 m of an edge (2026-11-04): on the north edge, at the north-west seat, 141 view rays
from 79 points pass over the apron's last ground, by up to 64 m, and 72 rays from 44 points still do
past its mirrored tree crowns, 18 of those points within 30 m of path 495053637, round (6900–7060,
12760–12940). That edge goes when #22 and #23 join at y 13000. Lucido's south edge, which
Fivizzano's part leaves as it was, shows more: 1,089 rays pass over its ground alone, by up to
231 m.

| File | Lunigiana | Cesena |
|---|---|---|
| `src/sim/map/<name>.bin` (global) | 1.25 MB, 6.21 MB gunzipped | 0.40 MB, 1.74 MB gunzipped |
| `src/sim/map/<name>/<i>_<j>.bin` (tiles) | 102, 42.4 MB in all, 0.04 (−6_−4) to 0.63 MB (2_1) each | 4, 1.7 MB in all, 0.37 to 0.45 MB each |
| `src/sim/map/<name>/overview.png` | 5.56 MB, 4096 × 3540 px | 4.76 MB, 4000 × 4000 px |

On lucido alone they are 0.31 MB (1.50 MB gunzipped; 0.55 MB and 1.9 MB before format version 6),
30 tiles of 9.5 MB in all (the largest 0.59 MB) and 3.25 MB (3195 × 4096 px). With the vectors in
the global file, before #63, lucido's was 1.89 MB (6.26 MB gunzipped) and its tiles 5.70 MB, the
largest 0.31 MB. Each `.bin` file is gzip (level 9)
of one JSON line, a newline, then packed sections. The game never fetches: the browser host
downloads the global file, gunzips it and hands the bytes to `provideMap` (`src/sim/map/packed.ts`)
before anything imports the map module, then hands each tile to `provideTile`
(`src/sim/map/tiles.ts`) as the player moves ([architecture.md](architecture.md), "Tile streaming");
the full map downloads the overview itself the first time it opens. Node (the tests, the tools,
`ritmo-devtools lint`) reads the global file from disk, and a lookup in a tile not in memory reads
that tile from disk. The single 6.7 MB `monzone.bin` the tiles replaced held every layer at once
(28.4 MB gunzipped).

The build hash (`hash`, 16 hex digits of SHA-256 over every `.bin` file unstamped) is in the
global file and in every tile: `provideTile` refuses a tile from another build ("map tile i_j is
from another build"). The overview carries no hash: `overview.map-test.ts` checks it is the
picture its map paints ([Checks and tools](#checks-and-tools)). The files are not in git:
`pnpm maps` builds both maps from the pinned inputs, and CI caches them ([Pinned inputs and
CI](#pinned-inputs-and-ci)).

### The global file

`MonzoneMapJson` in `src/sim/map/format/global-file.ts` is the schema of the JSON line: `MonzoneMap`
(`src/sim/map/index.ts`, the decoded map the game reads; the railway's types, `Railway` and its
parts, in `src/sim/map/railway.ts`) with its bulk arrays (the coarse grid's heights and cover, the
graph, the lanes and the residents) left to the packed sections after the line, which holds how
many values each section has in their place.
Polylines and rings are flat `[x0, y0, x1, y1, ...]` arrays. Rings are open: outer rings
counter-clockwise, holes clockwise.

| Field | Contents |
|---|---|
| `version` | `6` (`MAP_VERSION` in `src/sim/map/format/sections.ts`; the decoders throw on any other, saying to run `pnpm map`, so a stale file says so: 3 cut the dense layers into tiles and baked the tables built from them, 4 moved the vectors into the tiles, 5 gave the walls their levels, 6 moved the graph, the lanes and the residents off the line into sections and gave the lines their run-outs). `readWholeMap` in `src/tools/map-file.ts` also reads the version before, and no older one (a format change writes the reader of the version it replaces and drops the one before it, [Map standards](standards/map.md)): a version-5 build's graph, lanes and residents from its line, decoded as a file whose sections hold none and given those of its line (`decodeUpgraded` in `src/tools/map-upgrade.ts`), its lines with no run-outs, so `pnpm map-diff` compares a build from before version 6 with one of today. A global file without the play area's `outline` makes the game throw, saying to run `pnpm maps` (`src/sim/map/global.ts`, `stale-map.test.ts`): it reads the outline everywhere and the Carabinieri's `spawns.police` |
| `name`, `hash` | the map's file name (`monzone`, `cesena`: its tiles are in the directory of that name) and the build hash |
| `origin`, `mPerDeg` | projection origin (lat, lon) and metres per degree |
| `bounds` | the built terrain's box `minX`, `minY`, `maxX`, `maxY` (m): the box round every part's rectangles, which the heightmap spans |
| `outline` | the play area's outline (`src/tools/play-area.ts`): flat rings on 0.1 m, outer counter-clockwise, holes clockwise (the play area left of every edge), each from its lowest (y, x) vertex; `insideRings` and `ringsDistance` (`src/sim/map/outline.ts`) test points against it. Lunigiana's is one ring of 59 vertices, Cesena's one ring, `bounds` itself. The game tests a point against the play area with it (`inPlay` and `outlineDistance` in `src/sim/map/index.ts`: teleports, bolts, herds, tunnel portals), the minimap clips to it, and the build's overview is transparent outside it; `bounds` is only the heightmap's extent |
| `heightmap` | the terrain lattice: `cell` (4 m), `cols`, `rows`, `x0`, `y0`, and `ax`, `ay`, the region's anchor (`region.ts`), only where it is not (x0, y0); its nodes are the tiles'. The lookups (`heightAt`, `terrainZ`, `coverAt`) and the land cover's raster (`coverBlocks`: its scanline and its cells near a wall or a road) measure a point's cell from the anchor (`anchorOf` in `src/sim/map/kinds.ts`), so a point keeps its height and its cover to the bit, and the bake its tables, when a part grows the box west or south and brings no data near the point ([What growing a region changes](#what-growing-a-region-changes)); Lunigiana's names lucido's corner, `ax` −2900, `ay` −6100, its box's corner lying at x −11500 since Fosdinovo (x −5300 with Fivizzano), and Cesena's anchor is its corner, so its file names none |
| `tiles` | `{ i, j, zmin, zmax }` per tile, south to north then west to east: its lowest and highest node, decimetres |
| `place` | `floor` and `downslope`, the sky's place ([weather.md](weather.md)), fitted at build time over every node the listed tiles hold (`listedNodes` in `grid-tiles.ts`: an L's notch has none) |
| `coarse` | `cell` (64 m), `cols`, `rows`, `x0`, `y0` on the origin's multiples over the bounds; the nodes' heights and the cover there are its two packed sections, as the tiles' lookups read them (in an unlisted tile, the nearest listed node and cell). For hosts reading far from the player, never the sim |
| `roads` | each road's attributes (`RoadInfo`), indexed by the graph's edges and the level crossings: `id`, `cls`, `name?`, `ref?`, `w`, `surface`, `oneway?`, `ramp?` (a motorway's or trunk road's slip road), `bridge?`, `tunnel?`, `passage?` (a tunnel through a building, OSM's `tunnel=building_passage`), `layer?`, `maxheight?` (an underpass's OSM clear height, m), `verge?` (where people walk, m from the centreline on either side, on the three roads pulled in off the railway; else w/2 + 0.8 m, 0.3 m on paths, steps and tracks). Its line, `pts` and `z`, is in the tiles ([A tile](#a-tile)) |
| `rail` | `id` (OSM way, negative for a track only the CTR has; not unique: the pieces cut from one way at its switches and the CTR's bridges share it), `kind?` (none on a line; off the lines `loop` or `siding`, from the topology), `bridge?`, `tunnel?`, `pts`, `z` (the bed under the sleepers per vertex, the rail head `RAIL_LIFT` 0.12 m higher, where the rails are drawn; at grade, more than 6 m from a level crossing, the terrain is at most 0.05 m higher and 0.5 m lower, but beside a lower road along the line). Tracks meet only at piece ends; no polyline repeats a vertex |
| `railway` | `lines`: `{ pieces: [{ rail, rev }], maxspeed: [[from s, to s, km/h]], runOuts: [before, after] }`, each a path of running pieces (`rail` indexes `MAP.rail`, walked backwards when `rev`) from terminal (a dead end on the play area's outline) to terminal, consecutive pieces sharing an end vertex, s in m from its first vertex, and `runOuts` its track on beyond the play area past its first terminal and past its last (`RailLine` in `railway.ts`, [section 9](#9-the-railway-railwayts-platformsts-rail-clearts)), each a list of stretches `{ pts, z, bridge?, tunnel? }` (flat x, y and the bed's z, walked away from the terminal, its first vertex the terminal's), empty where no track runs on in the box; `stations`: `{ name, line, s0, s1, side }` (side 1 right of the line's direction, −1 left), by line and s0; `crossings`: `{ road, nodes, x, y, line, s }` (`road` indexes `MAP.roads`, `nodes` the graph's nodes, `line` −1 and `s` −1 where only a loop or siding is crossed); `platforms`: `{ area, walkway?, name?, axis, top }` (`area` indexes the whole map's areas, its rings copied into `derived.platforms`; `axis` the line's centreline along it, `top` per axis vertex in m a.s.l.) |
| `pois` | `id`, `kind` (`key=value` or `area:<kind>`), `name?`, `x`, `y` |
| `districts` | `name`, `x`, `y`, `r` |
| `graph` | how many values each of `xy`, `edges`, `traffic` and `walk` holds; the node coordinates (flat x, y), the edges (flat `a, b, roadIndex` triples) and the traffic and walk edge indices are sections (below) |
| `walls` | `reach` (how far any wall sticks out of its midpoint along either axis, 33 m: the 64 m outline walls), `lattice` (each wall kind's and the trees' broad-phase corner, below) and `counts` (`walk`, `drive`) |
| `vectors` | how the vectors are cut into the tiles: `halo` (32 m, `HALO`: each feature lies whole in every tile it comes that near), `counts` (how many roads, buildings, water pieces, areas and barriers the whole map has, which a feature's index runs up to: 3,969, 24,331, 3,180, 13,570 and 87 on Lunigiana) and `lattice`, the corners of the broad phases that answer a box query over the tiles in the whole map's order, where the whole map's broad phase put them: the buildings' (the lowest corner of any building's box) and the rivers' sound's (the lowest water vertex) |
| `spawns` | `player`: `{ x, y, angle }`; `parked`: `{ x, y, angle, rest, truck? }`, `rest` per vehicle model that stands within 15° of level there its settled `[z, pitch, roll]`, `truck` where a truck also clears the walls (baked); `police?`: `{ x, y }`, the Carabinieri station the build chose (Lunigiana's POI 14183344901, Cesena's 806564311), whose two nearest level spots the game parks their cars on |
| `lanes` | baked: per vehicle model, each traffic edge's lane offset travelled b → a then a → b (`graph.traffic` order), −1 where the model may not drive it; the line holds `table`, every distinct offset ascending (111 on Lunigiana, the lane fit's float noise such as 2.0500000000000003 among them, kept to the bit), and `counts`, each model's lanes in the order the decoded map lists the models; the lanes themselves are a section of indices into the table |
| `farms` | baked: `{ building, rural, pen }` per farm (`building` indexes the whole map's buildings, the index the tiles' buildings carry; its centre is in `derived.farms`) |
| `lamps` | baked: every street lamp's lantern, `{ x, y, z, nx, ny, kind }` |
| `derived` | what the build works out from the vectors for the readers far from the player, where the tiles holding them need not be in memory (`Derived` in `index.ts`): copies of what the railway points at, `crossings` (per level crossing, its road's line, which the trains and the crossings read anywhere), `platforms` (per platform, its area's rings, for the trains' look-out) and `stations` (per station, the first station building of its name, or null: its canopy's wall); and tables the game's own code bakes, `bells` (`{ id, x, y, z, h }`, the tallest church or tower of every district that has one, heard all over the map: 109 on Lunigiana), `residents` (per walk edge, `graph.walk` order, the residents of the homes within 60 m of its midpoint, float32; the line holds their count, a section their bit patterns), `farms` (per farm, its building's centre, flat x, y: the mean of its outer ring's vertices) and `mouths` (every road tunnel's mouth, by road and its first end first: `{ road, x, y, z, angle }` where its portal stands, and either `crown`, `throat` and `back` (how far it stands back into the tunnel from the road's end, m) for its portal, `head: true`, `throat` and `back` (0) for an underpass's head wall, or `open: true` at the road's end, [section 7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts); 56 on Lunigiana) |

The global file's sections follow its line in file order (each coded as a tile's are, [A
tile](#a-tile)):

| Section | Integers | Bytes | Stride |
|---|---|---|---|
| coarse heights | the coarse grid's nodes, decimetres, each row delta-coded from its first node | 2 | its columns: the node to the south |
| coarse cover | the land cover of the 4 m cell north-east of each node | 1 | its columns |
| graph xy | the graph's node coordinates, decimetres (the build rounds the map to 0.1 m) | 4 | 2: the previous x or y |
| graph edges | (a, b, road) per edge | 4 | 3: the previous edge's |
| graph traffic, walk | edge indices, ascending | 4 | 1 |
| lanes | each model's lanes, model by model in the line's order, as indices into `lanes.table` | 2 | none |
| residents | per walk edge, its float32's bit pattern | 4 | none |

A section with no stride holds each value itself, zigzag-coded. The graph's integers take 4 bytes:
on Lunigiana neighbouring coordinates lie up to 212,969 dm apart, too far for 2. A zigzag-coded
byte holds lane indices below 128 only, so they take 2 bytes (0.8 KB more gzipped than 1 on
Lunigiana), and a stride on the residents could overflow on negative values. Decoding gives plain
arrays, as `JSON.parse` did, each value the same double: a coordinate's decimetres over 10, a lane
its table's double, a resident its float32. So nothing the sim reads moved: every value decoded
from the version-6 build was the version-5 build's to the bit on Lunigiana, Cesena, the L, lucido
alone and the 3x, every tile byte for byte but its version and hash, and `pnpm map-diff` found no
differences (2026-11-07). The build throws on a coordinate that is not a whole number of
decimetres, a resident that is not a float32 and more than 32,768 distinct lane values. They moved
off the line for issue #5's scale check (#18): the game parses the line with `JSON.parse` at load,
and Lunigiana's was 8,319,700 B with Fosdinovo's part, 5.66 MB of it the graph, the lanes and the
residents as text. Lunigiana's first `decodeMap` in a fresh Node process takes 23.1–23.5 ms and its
gunzip 6.5–6.6 ms, about 30 ms together, against 21.2–21.6 and 12.4–12.8 ms, about 34 ms, with
them on the line (three processes each, 2026-11-07).

The baked tables are what the game would otherwise work out at load from the dense layers and the
vectors, which it now holds only near the player. Each is computed by the game's own code at build
time (`src/tools/bake.ts`, [Pipeline](#pipeline)): the lanes by `bakeLanes` (`src/sim/lanes.ts`),
the parked rests by `bakeParked` (`src/sim/parking.ts`), the water's floor by `bedOf`
(`src/sim/water/channel.ts`; it is kept on each water piece in the tiles), the farms by `bakeFarms`
(`src/sim/population/farms.ts`) and their buildings' centres by `buildingCentre`, the walkers'
residents by `bakeResidents` (both `src/sim/population/density.ts`), the lamps by `bakeLamps`
(`src/render/sky/lamps.ts`), the road tunnels' mouths by `bakeMouths` (`src/render/portals.ts`)
and the bells by `bellsOf` (`src/tools/bells.ts`).
`src/tools/__tests__/bake.map-test.ts` runs them again on the shipped map, refits the place over
the joined heightmap's listed nodes and checks `derived`'s copies against the whole map's vectors,
so a change to that code fails `pnpm test:map` until `pnpm map` bakes the tables again;
`cesena-bake.map-test.ts`
does the same for Cesena in a process of its own (a process loads one map), so a change needs
`pnpm map --region cesena` too. `bake.test.ts` and `cesena-bake.test.ts` bake again only the
parked spots, water beds and farms within 1 km of Monzone station and of Cesena's start, so
`pnpm test` already fails on most such changes (the lanes, the lamps, the bells, the residents and
the mouths are worked out map-wide, and only the map checks catch them; `tunnels.test.ts` bakes
the SR445's, the 196 m track's, the 87 m path's and Pieve San Lorenzo's underpass's mouths again).

Gzipped on their own, the global JSON line's biggest fields on Lunigiana are the spawns 0.43 MB
(the parked rests, most of it), the lamps 101 KB, `derived` 100 KB (the farms' centres 92 KB, the
bells 2.3 KB, the mouths 1.6 KB), the farms 31 KB, the POIs 30 KB and the roads' attributes
29 KB, and its sections the graph's coordinates 224 KB, the coarse heights 104 KB, the residents
91 KB, the edges 51 KB, the coarse cover 20 KB, the lanes 15 KB and the traffic and walk sets 2.1
and 0.8 KB (gzip at level 9, as the files are; 2026-11-07). The line is 2.64 MB before gzip
(2,639,642 B; 8,319,700 B before version 6, 5.54 MB before Fosdinovo's part) and the sections
3.57 MB; Cesena's line is 0.96 MB (959,338 B; 2,355,974 before version 6), lucido's alone 0.65 MB
(651,626 B; 1.88 MB before version 6, 6.20 MB with the vectors). Gzipped one layer and one tile at
a time and summed over Lunigiana's 102 tiles, the
vectors are the areas 10.73 MB, the water 4.32 MB, the buildings 1.16 MB, the roads' lines 1.08 MB
and the barriers 11 KB; before gzip 30.26, 14.22, 4.95, 2.83 and 0.02 MB, the largest tile's JSON
line 0.97 MB (−4_1). On lucido alone's 30 tiles they are
1.95 (2026-11-07; 1.92 on #17's map, before the olive groves, 1.51 before the UCS's woods), 1.06
(the baked floor at full precision 36 % of it), 0.30 and 0.28 MB and 6 KB, and its largest line
0.79 MB (0_0; 0.77 MB before the olive groves, 0.70 MB before the woods). A feature lies whole
in every tile it comes near, so a tile's vectors repeat their neighbours': summed over the tiles,
the roads' lines take 1.60 times their bytes, the water 1.45, the barriers 1.29, the buildings 1.08
and the areas 2.97 (the box of one forest, area 879, reaches 56 of the 102 tiles, and its 113 rings
with it).

### A tile

A tile's JSON line (`TileJson` in `src/sim/map/format/tile-file.ts`) is `{ version, hash, i, j,
walls, trees, vectors }`: the counts of its walk, shore and drive walls and of its trees, and the
vectors round it (`TileVectors`, below). Each layer of the vectors is `{ ids, items }`: each
feature's index in the whole map's list, ascending, and the feature, whole:

| Layer | Each feature |
|---|---|
| `roads` | the road's line (`RoadLine`): `pts` and `z` (surface elevation per vertex); its attributes are `MAP.roads[id]` |
| `buildings` | `id` (OSM id, or negative for a survey's: `survey-ids.ts`, [section 3](#3-features-featurests)), `kind`, `name?`, `h` (wall height above `z0`), `z0` (lowest ground under the footprint), `style`, `ruins?`, `tint`, `outer`, `holes?` |
| `water` | `id`, `kind` (`river` or `stream`), `name?`, `w` (the water's width), `bed` (the gravel bed's half-width), `depth` (the bed is carved `depth`/2 under `z`), `pts`, `z` (the built water surface per vertex), `area` (the catchment upstream of each vertex, km²), `floor` (baked: the bed under the centreline per vertex, m a.s.l.) |
| `areas` | `kind` (one of `AREA_KINDS`), `name?`, `rings` (outer first, then holes), a water area's still `level?` (m) or its river's `waters?` (indices into the whole map's water; [section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)), whose pieces lie in every tile the area does; the platforms (`platform`) and walkways (`paved`) are the whole map's last |
| `barriers` | `kind` (`wall`, `guard_rail`, `cliff`), `pts` |

Its sections follow the newline in file order:

| Section | Integers | Bytes | Stride |
|---|---|---|---|
| heightmap | 501 × 501 nodes, decimetres (int16), each row delta-coded from its first node | 2 | 501: the node to the south |
| walk, shore, drive walls | (ax, ay, bx, by) decimetres from a point 100 m south-west of the tile's corner (the outline walls stick out of their tile) | 2 | 2: the previous x or y |
| walk, shore, drive wall ids | each wall's index in the whole map's list of its kind | 4 | 1 |
| trees | (x, y) whole metres from the same point (trees stand on whole metres), the scale in hundredths | 2 | 3: the previous tree |
| tree ids | each tree's id (its lattice cell's number, [Trees](#12-trees-spawns-districts-treests-spawnsts-districtsts); its look's seed), ascending | 4 | 1 |
| cover | 500 × 500 cells, the land-cover index | 1 | 500: the cell to the south |
| walk, drive wall levels | each wall's level (a bridge's parapet's, its deck's top; a wall under a deck's, the ground's there: [section 10](#10-collision-walls-wallsts-parapetsts-deck-wallsts)), decimetres a.s.l., or −32768 (`NO_LEVEL`) for a wall that stands at every level | 4 | 1 |

The levels come last (format version 5 added them). With the parapets' levels alone they added 15 KB
to Lunigiana's tiles gzipped (30.47 to 30.48 MB) and 2.5 KB to Cesena's: most walls have none, so
each tile's level sections are runs of one value (the walls under the decks, levels and all, add
44.4 and 13.1 KB: [section 10](#walls-under-the-decks)).

Each section holds n integers as the zigzag-coded difference (0, −1, 1, −2... stored as 0, 1, 2,
3...) from the value `stride` places back, split into byte planes: the low byte of every value, then
the next byte of every value. Neighbours differ little and like bytes sit together, which is what
gzip compresses best. One layout per kind of file lists its sections in file order, each with its
width, stride, count (read from the line) and transform both ways, and both directions walk it
(`src/sim/map/format/`: `sections.ts`, `global-file.ts`, `tile-file.ts`), so the encoder and the
decoder cannot disagree on where a section lies. `encodeMap` and `encodeTile` encode (the build
throws if a value does not fit, or if two sections that share a count, a wall's segment and its id,
disagree on it), `decodeMap` and `decodeTile` decode. The tables here and the layouts are the two
places a section's facts are written: a change to one is a change to the other. Decoding is exact:
the same numbers a one-decimal JSON array would give.

What goes in which tile:

- **Terrain**: node (c, r) of tile (i, j) is the lattice's node (500i + c − x0/4, 500j + r − y0/4),
  clamped to the lattice, so a tile's border rows and columns are its neighbours' too, and past the
  bounds a tile repeats the edge. The lookups keep the lattice's arithmetic and only read the node from
  its tile, so `heightAt`, `terrainZ` and `groundZ` give the same doubles as the whole heightmap did.
- **Walls**: each segment lives in the tile of its midpoint, clamped to the box of the listed tiles
  (Cesena's outline walls lie on a seam), or, where that tile is not listed, in the listed tile round
  it nearest the midpoint. A tile's walls keep the whole map's order and carry their index in it,
  and its walk and drive walls their level.
- **Trees**: each in the tile of its point, the same way (the scatter already made it there), with
  its id.
- **Cover**: the 500 × 500 cells of the whole map's raster that fall in the tile (`coverBlocks` in
  `src/sim/map/raster.ts`, rasterised at build time for the tile's cells alone, the same cells a
  raster of the whole map gives there); cells past the bounds are 0 and never read.
- **Vectors**: every road's line, river, barrier, building and area with a segment's box (a
  building's or an area's outer ring's box) within `HALO` (32 m, `src/sim/map/kinds.ts`) of the
  tile's square, whole, with its index in the whole map's list, in that order (`TileVectors` in
  `src/sim/map/format/tile-file.ts`, cut by `tile-vectors.ts`). The tile indices are clamped to the
  box of the listed tiles, so an edge tile holds what lies past the bounds by it too, and a feature
  near an unlisted tile goes to all the listed tiles round it (`tilesRound`). A feature thus lies in
  every tile it comes near: on Lunigiana 3,104 of the 3,969 roads and 22,344 of the 24,331 buildings
  lie in one tile, a road in up to 5, a water piece in up to 6, the 30 buildings by a tile corner in
  4, and the forest area 879 in 56 (on lucido alone 821 of 1,039 roads and 5,870 of 6,388 buildings
  in one, and a forest whose box spans the bounds in all 30). The halo is more than any carriageway,
  walkers' verge or river bed reaches off its line (13 m, the Aulella's bed; the build throws past
  it), so a lookup at a point reads the point's tile alone (`placeAt` in `src/sim/map/tiles.ts`),
  and more than the minimap's margin round a tile (23.3 m), so a tile's canvas paints from that tile
  alone.

`wallsNear` and `treesIn` answer exactly as the one broad phase over the whole map did, the same
items in the same order: each kind keeps its 16 m lattice (`walls.lattice`: the lowest corner of any
of its walls; the trees', 1 m north-east of the region's tree anchor, fixed so that a query's trunks
keep their order as parts are added, `treeCorner` in `src/tools/trees.ts`), each tile grids its
items on that lattice, and a query walks the cells the box touches south to north, west to east,
taking each cell's items in the whole map's order (by id) across the tiles that hold some
(`src/sim/map/lattice.ts`). It reads every tile those cells reach, `walls.reach` further for
walls. The order matters: the physics pushes out of walls one by one and keeps the first of
equal-time hits, so another order would move collisions at corners (map.map-test.ts drives a car
from the road into building −284056254855693, 23D28's `AED` record 141, at (28.7, 1145.7), 29 m east
of the x = 0 seam: with 3 of 5 wall orders tried it got inside). The buildings' broad phase answers
the same way, on 64 m cells of the buildings' lattice (`vectors.lattice.buildings`, the lowest
corner of any building's box): each tile grids its buildings on it when first queried, and a query
hands each building once, though the tiles round a seam all hold it, in the whole map's order (by
index).

Profiled roads and rail carry extra points where the elevation bends between OSM vertices (dips
under the rail, crests). Graph edges run a → b in the OSM way direction, so a `oneway` road may
only be driven from a to b. Game code reads the map through `src/sim/map/index.ts`: `MAP`,
`graph`, `heightAt`, `wallsNear`, `treesIn` (which hands each tree's position, scale and id),
`districtAt`, `roadClassOf` and `buildingStyleOf`. It reads the vectors through
`src/sim/map/vectors.ts` and `tiles.ts`, every answer the whole map's whatever is in memory:

- `buildingsIn(minX, minY, maxX, maxY, visit)`, the broad phase the sim and the hosts share, calls
  `visit(index, building, box)` with every building whose outer ring's box may overlap the query
  box, in the whole map's order, reading every tile its cells reach;
- `placeAt(x, y)` gives the vectors a lookup at a point reads: its tile's (in an unlisted tile, the
  listed tiles round it, merged), which hold every feature within `HALO` of the point;
- `roadLineAt(road, x, y)` and `buildingAt(i, x, y)` read one road's line or one building, by its
  index, where a lookup at the point reads: undefined, or a throw for a building, where it lies
  farther than `HALO` from the point's tile, so a point within `HALO` of it always finds it (a
  farm's building is read at its baked centre).

Three are for the hosts alone, since what they give depends on the tiles in memory:
`buildingsInMemory` visits the buildings of the tiles in memory, in no set order, and passes over
the rest without reading them (a far sound path's occlusion, the dogs' barking); `tileVectors(key)`
hands a tile's vectors to the renderer as the tile comes in; and `residentTile(key)` gives a tile
only while it is in memory, never reading it (the minimap paints a tile's canvas from it). The
ground lookups in `src/sim/map/ground.ts`
(`groundZ`, `footZ`, `deckNear`, `drawnZ`, `atGrade`, `roadLevel`) read the road lines in 16 m
buckets on the origin (`src/sim/map/buckets.ts`), each bucket from the place holding its centre;
`surfaceAt` (`surface.ts`) and the rivers' reaches (`src/sim/water/rivers.ts`) read theirs in 32 m
buckets at the point's place. A place's buckets are built on its first use and dropped with its
tile, and list the same items in the same order as one set over the whole map, so the answers are
the whole map's to the bit. `roadLevel(road, x, y)` takes the road's index and answers within
`HALO` of it, undefined farther off, where nothing stands on it. `platformTop` in
`src/sim/map/ground.ts` gives a platform's top at a point (its axis's nearest point) from the global
file (`railway.platforms` and `derived.platforms`), so it reads no tile, and `groundZ` stands
people on it (or on the terrain, where that is higher).
`inPlay(x, y, margin)` and `outlineDistance` test a point against the play area (`MAP.outline`,
through `src/sim/map/outline.ts`, which the build shares): the teleport (`SetPlayer`), the bolts,
the herds and the tunnels' mouths (one 0.5 m off the outline is an open end, not a portal) read it.
`coverAt` (`src/sim/map/cover.ts`) reads the land cover from the tiles, and `coarseHeightAt` and
`coarseCoverAt` (`src/sim/map/coarse.ts`) read the coarse grid. A lookup in a listed tile that is not
in memory throws "map tile i_j not loaded" in the browser; the host makes sure that never happens
(architecture.md). The game never reads the files itself.

### The overview

The overview is the full map's picture of the whole play area, painted once by the build, so the
full map (M, `src/hud/worldmap.ts`) needs no tile's vectors until it is zoomed in: it downloads
`<name>/overview.png` the first time it opens and draws it scaled over the map's bounds, smoothed,
with its frame, labels, north arrow, scale bar and the player's marker still painted live
([architecture.md](architecture.md)). `src/tools/overview.ts` paints it after the files
([Pipeline](#pipeline)) from the built map's areas, water, rail, roads and buildings, in the full
map's look (`paintLayers` in `src/render/map-style.ts`, which the minimap's canvases paint through
too: grass over the play area, clipped to it, then the areas, the water in one opaque colour, the
rail, the roads by class, narrowest first and at least `OVERVIEW_MIN` px wide, and the buildings).

- **Size**: 4096 px on its long side (`OVERVIEW_SIDE`), or fewer where that would pass 16 MP, under
  Safari's 16.7 MP canvas limit; whole pixels across and down, so the bounds span it exactly.
  Lunigiana's is 4096 × 3540 px at 0.19 px/m (3410 × 4096 px before Fosdinovo's part;
  lucido's alone 3195 × 4096 px at 0.41 px/m), Cesena's
  4000 × 4000 px at 1 px/m, the L test region's 4096 × 3328 px at 0.85 px/m and the 3x's 4096 × 1750
  px at 0.18 px/m.
- **Look**: `OVERVIEW_RATIO` is 5, so its lines are as wide as on a map 4096 / 5 ≈ 820 px on its
  long side, between a 1280 × 720 window's map (694 px on its long side, east to west since
  Fosdinovo's part) and a 1920 × 1080 window's (1,111 px). Shown on those, they come out 0.85 and
  1.36 times as wide as the full map painted them live before #63 (0.73 and 1.17 before Fosdinovo's
  part, on a map 600 and 960 px tall): one picture cannot keep a line's width in screen pixels on
  every window, and 820 px keeps it nearest the old on the common ones. Zoomed in, its lines would
  grow with the map (a road about 40 m wide), so the full map paints the tiles' own vectors over it
  there
  ([architecture.md](architecture.md)).
- **Determinism**: `src/tools/paint-raster.ts` paints with + − × ÷, sqrt, floor, ceil, round, min
  and max alone, antialiased (a fill over 4 sub-scanlines a row, each covered exactly across; a
  stroke by how far inside its edge a pixel's centre lies), so every machine paints the same
  pixels, and two builds here wrote the same bytes. `src/tools/png.ts` writes them as RGBA, each
  row under whichever of PNG's five filters leaves the least sum of its bytes taken as signed
  (libpng's heuristic), deflated at level 9: another zlib may compress the same image data to other
  bytes, so CI hashes the image data inflated ([Pinned inputs and CI](#pinned-inputs-and-ci)).
- **Transparency**: outside the play area the picture is transparent, so an L's notch shows the
  full map's own background, as the minimap's clip does: on the L test region the notch's 2048 ×
  2133 px are, and the row of 2048 px its south edge crosses is partly, and on Lunigiana all the
  box's land the play area leaves out ([section
  2](#2-projection-and-play-area-geometryts-play-areats)). Cesena's play area is its bounds, so
  every pixel of its overview is opaque.

## Checks and tools

The checks over the whole built map are map checks: `*.map-test.ts` files, which `pnpm test:map`
runs and `pnpm check` and CI run after `pnpm test`. `pnpm test` keeps only checks that read the
tiles and features round named spots, mostly Monzone station, so what it checks does not grow with
the map ([architecture.md](architecture.md#checks)). Run `pnpm test:map` after every `pnpm map`.
On 2026-10-31, with the vectors in the tiles and the water areas (#73), it ran 133 tests in 41 files
in 7.4 s on a 14-core Mac (before #73's merge: 118 in 40 files in 7.7 s at a load average of 6.5,
52 s of CPU with each file alone), the 3x test region's 5 skipped;
with the 3x built, those 5 pass in 5.4 s and 46 s of CPU alone. That morning it held 102 tests in 30
files (5.7–6.0 s, 37 s of CPU). The split took 21 s of CPU out of `pnpm test` on 2026-10-30 (228 to
207 s), when `pnpm test:map` held 58 tests in 20 files. On 2026-11-03, with #11's checks (the
buildings' ids and the 2009 sheets' buildings below, Pontremoli's town in [Test
regions](#test-regions)), it held 142 tests in 43 files, all passing with the 3x built, in 10.5 s.
On 2026-11-07, with Fosdinovo's part, it held 176 tests in 61 files, 171 passing and the 3x's 5
skipped, in 38.7 s within `pnpm check`, and with the review's fixes 181 in 64 files, all passing
with the 3x built, in 40.3 s.

`src/sim/map/__tests__/map.map-test.ts` checks the built map in 4.4 s alone, read whole (`wholeMap`
in `src/tools/map-file.ts` joins its tiles back into one heightmap, wall list, tree list, land cover
and list of each layer of vectors, every feature once, in the whole map's order, each road its
attributes and its line), as `rail.map-test.ts`, `railway.map-test.ts` and `clearance.map-test.ts`
read it: heightmap coverage, spawns clear of walls and off traffic lanes (with parking in the
district each village the map was widened for stands in, the disc at its point compared by object,
as Aulla's Bardine and Fivizzano's share the name: with Aulla's 20 spots dropped, the old check by
name still passed on Fivizzano's 5; the villages: Equi Terme, Gragnola, Colognola, Campiglione,
Viano, Vinca, Ugliancaldo and Tenerano, and the 15 of Fivizzano's part: Fivizzano, Casola in
Lunigiana, Gassano,
Soliera, Moncigoli, Mommio, Pugliano, Pieve San Lorenzo, Vigneta, Castiglioncello, Signano, Turano,
Antognano, Pieve San Paolo and Verrucola, and Fosdinovo's 35: the issue's ten, Fosdinovo,
Caniparola, Tendola, Ponzanello, San Terenzo Monti, Ceserano, Bardine, Marciaso, Pulica and Gignago,
with Colla, Castelpoggio and 23 more hamlets the traffic graph reaches, each on its OSM place node,
Ponzanello's on its own and not its castle's, where the issue put it, 237 m off and 124 m from any
traffic; Canepari and Lorano, 197 and 86 m from traffic, are left out, and so is Fivizzano's
Bardine, which shares Aulla's name), no walls on roads (read on the road's level, `roadLevel`:
a bridge's parapets over one stand on the deck's), no drivable road inside a footprint, closed
building interiors (a body starts on the nearest road where it stands clear of the walls: one
already in two is pushed out in the order the broad phase hands them, which a grown region moves),
one traffic component reaching the station, Monzone Alto and each of those villages, grades within
1.5× the class limits, plus the 0.1 m elevations' rounding over the 8 m measured (every class but
paths and steps has one; a track shortcut pinned at both ends by the bends of one quarry road may
only be the straight line between them, and so may any road's stretch between two junctions where
the uncarved DTM between them climbs steeper than that itself: Sercognano's Via Vittorio Emanuele at
29%, the lane down from Posara at 43%, a track at Pieve San Lorenzo at 37%), bridge and underpass
clearances (a road bridge 5.4 m or more over the rail's bed; a drivable road under a road bridge its
`maxheight`, 4 m untagged, plus the 1.5 m deck, less that rounding), no perched water (but a lake's
own, within 1 m of its level, over its carved bed: the stream through the pond 560 m east of Soliera
stands 2.6 m over its bed), the rivers' widths by reach (the Lucido's, and the ways either side
of each threshold of the Aulella's, the Rosaro's, the Mommio's, the Bardine's and the Bardinello's,
whose gorge's pair lies within 2 m of its 267 m, and the Pesciola's head and last way at 6 m:
with the gorge's threshold at 270 m the rebuilt map gave 797860907 6 m, and the check fails),
catchments growing downstream with no jump at a
tributary's mouth (the Lucido's 47 ± 2 km² at its mouth: 46.4; the Rosaro's 14.7 ± 0.5 at its entry,
near half what it carried when its heads were sized as the gauge's 208 km² less the map's D8; the
Aulella's 199 ± 3 leaving the play area: 199.4; the Bardine's 59 ± 2 leaving Fosdinovo's north
edge: 59.0; and none of the three a fill lake's D8 ran a river down before the water beyond the
play area was burned, the side stream 140780331 by Soliera under 1 km², Il Canalaccio under 6 and
the Canale del Torchio under 2: 0.18, 5.06 and 0.82), no walk or drive wall in a wide river and
shore walls by it, and valid names, classes, styles, area kinds and districts (each of those
villages is its own HUD name, Equi Terme's station and spa included, the Fortezza della Verrucola
Verrucola's; Monte Sagro, Pizzo d'Uccello, Cima Belfiore, Monte Tondo and La Pizza, and Passo dei
Carpinelli, Passo di Tea, Passo del Romito and Foce del Cucco name themselves; at least 80% of the
buildings in a settlement, those with 10 or more others within 150 m, stand in a district disc,
86.9% today ([section 12](#12-trees-spawns-districts-treests-spawnsts-districtsts)), where the share
of every building fell to 79.5% with Fosdinovo's farmhouses and huts; CTR street names cased like
"Via XX Settembre" and "Via Castel dell'Aquila"). It also checks, on Lunigiana, Cesena and, when
built, the L (in CI always), that no two buildings share an id but the pieces of one footprint:
pieces alike in kind, name, style, ruins and tint, and a survey's each within 6 m of another piece
of its id (`clipBuildings` cuts a road's corridor through a footprint: its pieces lie 4.11 m apart
at most on Lunigiana), an OSM multipolygon's outer rings any distance apart (Cesena's relations
1083815 and 2026837). Lunigiana holds 37 such ids, 36 a survey's road clips of 2 pieces and OSM's
building 700764113 in 2 (19 before Fosdinovo's part; lucido alone 5, all a survey's), Cesena 6 of
OSM and the L 1; a far house given another's id, in a scratch copy, failed it 7,471 m off. On the
same three maps it checks that no two buildings share one outline (two comuni's DBT archives of one
survey hold the same units, and the map drew 528 of them twice, under each comune's ids, which the
id check could not see) and that no OSM building's centre stands in a DBT unit (red on the build
that kept a zone's cut copy: 7 by the Carpinelli road, 849867953 among them; [section
1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)). And it checks that the Carrara
side's buildings come from the CTR 1:2000 of 2009: some building carries the 2009 sheets' id slot
(`SOURCES.ctr2009` × 2¹⁶ + section 22D, 197,183), and so does the church whose outline holds (−441,
−4844), the Chiesetta alpina, which OSM's chapel 700633221 drew before. `readSurveys` skips a source
whose folder is missing, so a build on a `data/raw` without the 2009 sheets would keep OSM's
buildings there and fail no other check; on #11's first build, whose buildings are OSM's there, it
fails on both counts. And that Fivizzano's walled centre is stone: every building whose centre lies
5 m and more inside one of its four cores (`STONE_CORES`, traced on the walls' outline to 5 m) is
stone, but its churches (#17's acceptance).

`global-file.test.ts` in `src/sim/map/format/__tests__/` round-trips a small global file through
`encodeMap` and `decodeMap` (a newline inside a name, the coarse grid, and the graph, the lanes,
their float noise and their models' order kept and a model with no lanes, and the residents, to the
bit, the line holding their counts and the lanes' table), and `tile-file.test.ts` a tile through
`encodeTile` and `decodeTile` (negative values, the widest deltas, an empty section, walls with and
without a level); they check that a file of another version, a value too far for its section, a
level for every wall but one, a wall or tree id short of its count, a tile whose sections do not
end with the file, a graph coordinate off the decimetre, a resident that is not a float32 or more
than 32,768 lane values throws; `stale-map.test.ts` that the game refuses a global file without the
play area's outline. `anchor.test.ts` rewrites Lunigiana's
global file to start its heightmap a tile east and north of its anchor, which the file then names,
and checks that `heightAt`, `terrainZ` and `coverAt` answer to the bit as on Lunigiana itself (read
by `lookups.ts` in a process of its own) at 440 points round Monzone station; measuring from the
first node instead, as before the anchor, it fails on all three.
`src/sim/map/__tests__/tiles.map-test.ts` checks the cut: the listed tiles are the region's
(Lunigiana's 102 of its bounds' 132, south to north then west to east), each with a file and the
notches' none, with their lowest and highest nodes (the nodes two tiles share are
`seams.map-test.ts`'s, below), each wall lives in the tile of its midpoint and each tree in the tile
of its point and no wall reaches farther than `walls.reach`, `heightAt`, `terrainZ` and `coverAt`
read the tiles bit for bit as the whole heightmap and land cover give them, a point's cell counted
from the anchor and the notches' nodes and cells the nearest listed ones (at points on and beside
every seam, inside every tile, far past each corner of the bounds, and so in every tile of the
bounds, each notch's too; a notch lies at a corner of the bounds, found from the list: Lunigiana's
north-west and south-east today), and
`wallsNear` and `treesIn` answer exactly as one broad phase over the whole map does (1,500 boxes
1–60 m across, half of them within 40 m of a seam; the trees' on the region's fixed corner, which
need not be their lowest).
`tiles.long-test.ts` (`pnpm test:long`, 0.48 s alone) checks, round three boxes by Monzone
station and a fourth on a bounds wall where the outline crosses a tile seam nearest the corner
(0, 0), found by geometry ((4900, −2000) today), each box holding a wall of every kind itself (the
16 m cells' corner, each kind's lowest wall, moves as a part grows the box), that `wallsNear`
answers the same in the same order whatever is in memory and in whichever order it came: it read
the tiles round its boxes twice over in 0.45 s on main and 0.53–0.55 s with Fosdinovo's part,
whose box moved the outline's west and its tiles off the (0, 0) cluster, so it left `pnpm test`
(the Long checks rule of [CODING_STANDARDS.md](../CODING_STANDARDS.md)). `tiles.test.ts`
(0.39–0.40 s) checks that every wall whose box overlaps a query is found (among the walls of the
tiles within `walls.reach` of it: a wall lives in the tile of its midpoint), that a lookup in a
tile not in memory throws, naming it, and that `cellCorners` reads a cell's four nodes as four
`nodeAt` calls do; both read their fixtures from `tile-kit.ts` beside them.
`src/sim/__tests__/seams.long-test.ts` (`pnpm test:long`) drives two cars across the x = 0 and y = 0
seams on Via Borgo
Monzone by the station: every frame's world and the final save are the same with the tiles read in
lazily and dropped every 20 steps as with the nine tiles round (0, 0) in memory.

The vectors read from the tiles answer as the whole map's did, and the checks compare them with one
broad phase over the whole map joined from the tiles (`wholeMap`), as the game had before #63:

- `src/sim/map/__tests__/vectors.map-test.ts`: each tile holds, whole and in the whole map's order,
  exactly the features with a segment's or outer ring's box within the halo of it, or of an
  unlisted tile it is round, and the waterways of each river polygon it holds, and `buildingsIn`
  hands the same buildings in the same order as one `staticGrid` of 64 m cells over the whole map's
  (1,500 boxes 1–600 m across, half of them within 80 m of a seam and the rest within 300 m of a
  building: 35,274 found on Lunigiana on 2026-11-07, 35,876 before the copies two sources both
  mapped went, 39,266 before Fosdinovo's part), its lattice
  on the lowest corner of any building's box.
  `vectors.test.ts` checks round Monzone station that `buildingsIn` answers the same whatever is in
  memory and in whichever order it came, each
  building once though the tiles round a seam all hold it; that a lookup reads its point's tile
  alone (`placeAt`, `roadLineAt`, none for a road 6.6 km off, a throw for a tile not in memory); and
  that `buildingAt` finds a building by its index near it while `buildingsInMemory` reads no tile.
- `src/sim/map/__tests__/ground.map-test.ts`: the ground, surface and water lookups read from the
  tiles answer to the bit as the whole map's (`ground-oracle.ts`: the ground model over the whole
  map's data, `wholeGround`, and the old surface and water broad phases), at 1,142,302 points on
  Lunigiana (seeded ones, half by the seams, every road and river vertex and every 16 m bucket of
  road; 13.8 s on 2026-11-07 at the 1,142,308 of #18's build before its review, against 658,633
  points and 8.2 s on the map before Fosdinovo's part, one run each); `ground-cesena.map-test.ts` does the same on Cesena and `ground-l.map-test.ts` on
  the L ([Test regions](#test-regions)). `ground.test.ts` checks round Monzone station's tile corner
  (0, 0) that they answer the same whatever tiles are in memory and in whichever order they came,
  and that a road's level is its surface's within the halo and none farther off.
- `src/tools/__tests__/deck-ground.map-test.ts`: on Lunigiana, Cesena and the L, the ground
  keeps out of every road and rail deck's slab (its 0.9 m under the deck's top) more than 4 m in
  from its outer ends (the issue's measure, its own constant, not the pass's end runs; a joint with
  the next piece of the bridge is no end, `jointsOf`), and nearer them stays at most 0.05 m over its
  profile, read every 0.5 m along and across the slab on the drawn mesh; where a node behind the
  ends of the deck and of the pieces joined to it is a corner of the triangle drawn there (its
  abutment) the approach's ground decides (section 7). It fails on 125 of Lunigiana's 219 decks, 49
  of Cesena's 56 and 32 of the L's 57 built on `main`, without the pass, and on 115, 45 and 30 with
  the pass's first end runs, as long as the slab took to stand clear; it takes 1.1 s.
- `src/tools/__tests__/parapets.map-test.ts`: on Lunigiana, Cesena and the L, every drivable
  bridge's parapets read every 0.25 m along both sides of each deck segment (`parapetFaults` in
  `parapets.ts` beside it): a car on the deck meets a wall wherever no road on the deck's level (its
  surface within 2 m of the deck's top, 0.15 m to spare) reaches the parapet (its carriageway, 0.5
  m to spare: the build reads it every 0.25 m, on 0.1 m); a car on a road well inside its
  carriageway there meets no parapet, which a junction on the deck closed or a parapet with the
  wrong level would; and no wall with no level stands there over a road passing under or over the
  deck. A car keeps to the drivable roads: a levelled wall across a footpath (the walls under a deck
  across the path off the end of 140780504) stops none. It fails on 4 of Lunigiana's bridges and
  16 of Cesena's built before the walls had levels (none of the L's), and on 4 and 14 with the
  levels dropped from today's build; 1.3 s alone, most of it reading the three maps.
- `src/sim/__tests__/under-decks.map-test.ts`, `under-decks-cesena.map-test.ts` and
  `under-decks-l.map-test.ts` (the L's skipped without its build, failing in CI): on every road
  bridge, the game's own walking and driving (`under-decks.ts`). From every point under its slab,
  every metre along and across it, where someone stands clear on the ground (not on another deck)
  with room to stand (2.7 m under the deck's top) next to one with less, a walker heads straight for
  the nearest ground under the slab within 0.45 m of the top and 4 m or more from its ends (the
  issue's measure), 5 cm a step, keeping to its level (`footZ`) and stopped by the first walk wall
  it meets (`walkBy`), or by stepping onto another deck: it never comes up onto the deck at a point
  abeam of it. Under a drivable deck a Panda does the same from where there is room for the tallest
  vehicle (3.55 m under the top), 0.1 m a step, its wheels on `groundZ` and stopped by the drive
  walls on their level (`moveCar`). And along each road meeting each end, from 6 m back along it to
  6 m onto the deck, a walker on its centreline and on either verge (`walkSide`, the road's then the
  deck's) and a Panda on its centreline that with nothing in their way are on the deck as they cross
  its end meet no wall with a level. A verge dipping 2 m (`ONE_LEVEL`) under the deck's end on its
  way, or running beside the deck more than 2 m past its end, is left out: 14 of Lunigiana's verge
  walks, 16 of Cesena's and 2 of the L's, the walls stopping 5 Lunigiana deck ends' and 1 Cesena
  one's ([Walls under the decks](#walls-under-the-decks)). Built without the walls under the decks it
  fails on 7 of Lunigiana's 167 road decks on foot and 7 by car, 1 of Cesena's 50 on foot and 2 and 2
  of the L's 23 (the ground the pass lowers keeps most decks out of reach), and on the build before
  the verges' openings round the ends (and the ground past 4 m) on 18 Lunigiana deck ends, 7 Cesena
  and 2 on the L. It takes 2.3, 0.3 and 0.3 s.
- `src/sim/population/__tests__/density.map-test.ts` sums the residents at 6,000 points, half of
  them within 40 m of a seam, by 4 reaches (45, 60, 140 and 250 m), and `farms.map-test.ts` reads
  the buildings near 20,000 points and every farm by 3 reaches (10, 25 and 40 m), whether each
  point is indoors, and every farm's building at its baked centre: the same buildings in the same
  order as one `staticGrid` of 64 m cells over the whole map's. `density.test.ts` and
  `farms.test.ts` read round Monzone station out to 600 m, over the x = 0 and y = 0 seams (625
  points 50 m apart and 2,401 points 25 m apart): with every tile dropped and read lazily, then with
  just the tiles that run read handed over, in key order and reversed, and no tile source, the
  residents, the ground checks, the buildings near a point, the farms' buildings and the spots off
  their walls come out the same.
- `src/hud/__tests__/location.map-test.ts`: the road the HUD names, read from the roads of the
  player's place, is the old answer over the whole map's roads, by every fourth vertex of every
  road, on it and off it, and along every tile seam; `location.test.ts` checks the same round
  Monzone in two residency orders, and that it names nothing where the place is not in memory.
- `src/audio/places/__tests__/water.map-test.ts`: the rivers' sound's reaches, built per tile and
  gridded at 32 m on `vectors.lattice.water`, are those of one grid over every reach of the whole
  map's water, the same in the same order, each once, with their geometry (1,500 boxes 1–800 m
  across, half of them within 80 m of a seam).
- `src/tools/__tests__/playtest-drive.map-test.ts`: the playtest bot's default drive
  (`defaultRoute`, below), chained from the whole map's roads, runs from within 600 m of the start
  to within 500 m of Vinca, across the x = 0, y = 0, y = −2000 and x = 2000 seams.
- `src/tools/__tests__/terrain-seams.map-test.ts`: the seams between the terrain's sources (issue
  #10), read from the DTM fetch-rt wrote (the tiles' files with each cell's source, or a test
  region's `dtm-src.bin`) on the build's own 4 m grid (`dtmDem`'s nodes, each the mean of a 5 m
  square), over Lunigiana's listed tiles (lucido's, Fivizzano's and Fosdinovo's: the 7 pairs of
  sources that meet there, Liguria's DTM's with the LiDAR and the 10 m DTM since Fosdinovo's part)
  and the `bagnone-ridge` and `sarzana-town` test regions, and Monte Sillara's summit there ([Test
  regions](#test-regions)). A
  step is how far the height difference across a seam lies outside the differences beside it, 3
  nodes either side on its own line and the two beside it, each within one source (`seamSteps` in
  `__tests__/seam-steps.ts`): a slope, a kink or a cliff on one side gives none, a ledge its height.
  Rough ground has steps of its own (on the ridge 0.6% of the LiDAR's node pairs step over 1 m,
  0.005% of the 10 m DTM's and none of the surface model's): so the test holds every seam to at most
  1 m more than the largest step within one source within 20 m of it. Lunigiana's seams pass it by
  0.53 m at most (Fivizzano's surface model by the 10 m DTM at (9860, 11596); lucido's by 0.30 m;
  Fosdinovo's by 0.52 m, the LiDAR by the 10 m DTM in Carrara at (−4776, −5328), its LiDAR by
  Liguria's DTM ed. 2023 by 0.37 m at (−8020, −5196) in Castelnuovo Magra and the 10 m DTM by it by
  0.19 m at (−5912, −5928) in Luni, over 1,242, 756 and 630 node pairs),
  the ridge's by 0.59 m (the LiDAR by the 10 m DTM; 0.94 m, a strip of the surface model, with the
  canopy filter's one pass), Sarzana's not at all (LiDAR to Liguria's DTM, its worst 0.06 m under
  the steps round it); with the band left out, the ridge fails by 3.9 m, with no bend at all by 12.0
  m, and without the canopy filter by 8.6 m. The steps themselves reach 1.73 m on the ridge (3.42 m
  on lucido, under the Rocca di Tenerano), where a gully the LiDAR shows ends against the 10 m DTM,
  as steep as the gully's walls round it. One place is excused (`SCARPS`), where the real ground
  steps at a seam and the test cannot see it: a step of the LiDAR's at its last node has no LiDAR
  node past it to bound it, so it never counts among the terrain's own. Under Fivizzano's ridge, at
  (9808, 10444), the 2010 flight's strip ends at the foot of a rock band its last metres climb (on
  the 2021 orthophoto, `rt_ofc.5k21.32bit`, grey rock and boulders, the west face in shadow; the
  2021 surface model climbs 7–8 m over 3 m along it), and the 10 m DTM past the strip has none: the
  seam there steps 2.03 m, 1.10 m more than the terrain round it. A seam within 8 m of the place may
  step as far as the band's own face there (4.1 m between two LiDAR nodes), no further, and the test
  fails when no seam is left there to excuse.

The overview's checks: `src/tools/__tests__/overview.map-test.ts` fails when a built overview (both
maps' and, built or in CI, the L's) is not the image its whole map paints now, so a change to the
look, the palette or the vectors needs `pnpm maps` again, as a stale bake does; `overview.test.ts`
checks its size (3195 × 4096 px for lucido's bounds, 4000 × 4000 for Cesena's), the look on an
L-shaped map (grass on the play area alone, the areas, the water, the roads by class narrowest
first, a tunnel dashed, no paths, the buildings on top, transparent in the notch) and that two
paints give the same bytes, which `pngData` gives back as the pixels; `paint-raster.test.ts`
checks that a fill covers the pixels inside and a pixel half inside by half by either rule, that
a stroke covers its width with round ends, each pixel once however many segments reach it, and
that a clip lets paint through by its coverage.

`src/tools/__tests__/bake.map-test.ts` runs the bakes again on the shipped map, given the whole
map's vectors joined from its tiles, and compares them, and the place refitted over the nodes of
the joined heightmap its listed tiles hold and `derived`'s copies of the railway's roads, platforms
and stations, with what it holds (the check is `assertBakesCurrent` in
`src/tools/__tests__/bakes.ts`), so code that changes a baked table fails `pnpm test:map` until
`pnpm map` runs; `cesena-bake.map-test.ts` checks Cesena's (`pnpm map --region cesena`).
`bake.test.ts` and `cesena-bake.test.ts` bake again the parked spots, water beds and farms within
1 km of Monzone station and of Cesena's start (`assertBakesCurrentNear`, through `bakeParked`,
`bedOf` and `bakeFarms` given just those: the water pieces and buildings of the tiles over the box
round the spot with a vertex, a building's first, within 1 km, 22 and 970 by the station, 2 and
3,777 at Cesena's start), so `pnpm test` fails too: proven red by changing the parked cars' `LEVEL`
(0.26 to 0.2) and the farms' `RURAL` (60 to 50, again with #63). The lanes, the lamps, the bells and
the residents are worked out map-wide, so only the map check catches a change to them.
`src/tools/__tests__/tile-map.test.ts` cuts a 24 m map into its four
tiles and joins them back as they were (walls in order, trees with sparse ids merged back in id
order, which is not their tiles' order) and the walls' levels, with the region's tree corner;
puts each vector whole, with its index and the water's baked floor, in every tile it comes within
the halo of, joins them back and writes the vectors' counts and lattice corners; gives a vector by
an unlisted tile to the listed tiles round it; refuses a road whose verge reaches past the halo and
a tile from another build; and stamps each tile as `encodeTile` packs it with the build hash.
`map-upgrade.test.ts` reads a version-5 build, its graph, lanes and residents on its line and its
lines with no run-outs, as the same build of today's (`decodeUpgraded`).
`build-output.test.ts` checks that `decimetres`, which rounds the grid into the
`Int16Array` the cut reads, throws for a height that does not fit int16 decimetres (4000 m,
−4000 m, 3276.75 m, NaN, infinity) instead of wrapping it. `src/__tests__/maps.map-test.ts` checks
that every listed tile of both maps has its file, of at most 0.7 MB, and that each map's global
JSON line is at most 8,000,000 B (it failed on the build before version 6: "lunigiana: the global
file's JSON line is 8319700 B"), and `maps.test.ts` one tile of each.

`src/tools/__tests__/overlap.map-test.ts` reads every building of the shipped map: no two of
different sources (OSM's and each survey's, by the id's slot) share half the smaller one's area,
nor an old-schema ruin ring and a unit of its own sheet (`overlapShare` in `overlap.ts`, the build's
own measure). On the build before `apartFrom` it found 70 such pairs among the 530 it measured; now
none among 331. Two buildings of one source may stand on each other, so it reads none of those.
In the unit tests, `overlap.test.ts` checks the share (0.5 and 0.4 for half and two fifths of the
smaller covered, 0 for a courtyard's hole and for an L round a house's corner) and that `apartFrom`
drops a copy and a larger building over small kept ones, never one that overlaps none;
`surveys.test.ts` that `bySourcePriority` drops a later source's copy outside the earlier one's
mapped area but keeps units of one source stacked; `ctr.test.ts` that a synthetic 2009 sheet's
ruin ring over its house goes and an L round the house's corner stays; and `features.test.ts`
that an OSM building over a surveyed one goes and that `building=no` and `building=roof` ways and a
`building=no` multipolygon are no buildings and keep their areas' kinds (each red before its fix).
`addresses.test.ts` checks the address vote: an address names its own road; one by a road beyond
the play area, and one 150 m from any road, names none; one by a cut way's piece beyond the play
area names its piece in play; and a way two streets vote for goes to the one with more votes
(the old vote fails three of the four).

`src/tools/__tests__/seams.map-test.ts` is a map test: it reads every tile of both maps, so it grows
with the map and runs in `pnpm test:map`, not `pnpm test`. Wherever two listed tiles meet it checks
each tile's own copy: every node they share has one height, and the walls carry on across the seam
as the tiles store them: each wall of each kind in exactly one tile, and at both ends of every wall
that crosses a seam the tiles within `walls.reach` hold the same walls touching that point as the
whole map does (the shore walls, closed outlines, an even number). On a tile with one border node
raised by a decimetre the height check fails, and with a wall crossing x = 0 moved into a tile 2 km
away (or dropped) the wall check fails. The roads need no check of their own: every tile a road
comes within the halo of holds it whole, the same line with the same z per vertex
(`vectors.map-test.ts` checks each copy against the whole map's), so a road's z has no seam, and
the ground under a road where it crosses a seam is read from the shared nodes alone (bilinear on
the seam's column or row), which the height check covers.

`src/tools/__tests__/water-areas.test.ts` checks every node of a synthetic scene against its
expected height: a lake on a flat basin (its median, capped at a low outlet's spill, OSM's `ele`
over both; its bed shelving from the shore to 3 m, an island over it left, its edge raised to hold
it), two river polygons meeting across a river and a tributary (carved to the floor at the nearest
point, the seam between them carved as their inside, a bank over the river and the outer edge
left, but raised to the floor where a ditch along it lies under it in the pass before the claims, a
gravel bar raised only in the pass that raises bars) and a river polygon no river reaches
(still water); that windows meeting at a column through the lake and its outlet, or at a row across
the river polygons and the bar, carve every node as the whole grid does (red with the ring of cells
round a window left out); and which nodes the roads may not claim. `water.test.ts` checks that
`dropPerched` keeps a lake's samples, and drops a surface more than `PERCH` (1 m) over a lake's
level, which is no water of the lake's, to that level. `water-areas.map-test.ts` checks both maps,
on the nodes their listed tiles hold (the joined heightmap holds 0 in a notch, where Fivizzano's 1
km lake at x 9150…10110 by y −150…910 lies): lucido's 7 lakes (the one by the Solco di Equi OSM's,
at 272.0 m) and the Aulella's river polygon on every stream with a sample in it, the Fosso di Tufo
too; the UCS gravel at Pian del Molino; each water area's level in whole decimetres or its
waterways, and at least one cell; a lake's nodes carved under its level or a bank over it, its edge
holding it but where a stream's channel (its bed's half-width and a cell, as `carve` reaches) runs
in, out or along; its level never over every node of its cells, and water in each lake but the
three the LiDAR reads no hollow under and those every node of whose cells is its edge (four on
Lunigiana); a river polygon's built surface falling downstream through it and
its outer edge left over its river's bed (to the 0.1 m both are read in); and no tree, parked car or
player spawn in the water. `spawns.test.ts` keeps a parked car's box and the player's spawn out of a
lake, `walls.long-test.ts` (`pnpm test:long`) rings a lake with shore walls, leaves a river
polygon's carved banks open and keeps a house's walls out of the middle w/2 of a path that reaches
into it (Giucano's footway four cells into a house, and Fivizzano's 0.56 m from a house's corner,
which no cell centre's carve reached: each red before its fix), `cover.test.ts` pins the cover bytes
(the olive groves last), draws the woods first, the UCS's conifer and mixed over a forest and every
other area over each wood, an olive grove over a wood, grassland, farmland and residential land and
a farmyard, a park and a square over it, and draws the bars over the river and the line's bed only
outside the water, and `features.test.ts` maps the water tags, `ele`, the POIs and the orchards (an
olive orchard a grove, an untyped one below 600 m of the ground given, none without it).

The survey adapters are checked on fixtures of a few records cut from real sheets
(`src/tools/__tests__/fixtures/`, 36,163 B in all: cut by record with `subsetShp`, in file order,
and gzipped, the fields that name people blanked; each test's header says which records came from
where): `ctr2019` (18 files from 23D11, 23D20 and 23D14, whose one unit lies outside lucido's box),
`ctr2009` (14, from 22D04, 22D05, 22D13 and 22D18), `ctr10k` (8, from section 249020, a unit and a
road surface of them inside a 2019 sheet's `AZR`) and `dbt2k` (12, from Pontremoli). `ctr.test.ts`
reads the 2019 sheets (kind, style, eave, height and courtyards by code, the box clip, the ids
against the old encoding and 23D11's `AED` record 0 worked out by hand, the road surfaces, their
names and the `AZR` rings) and the old schema (codes kept and dropped, `Quota_gr` the eave and none
without it, a ruin from a closed `ML_l` line of code 0205 alone, 23 m² as surveyed, with no eave and
numbered from 5 × 10⁴ in a sheet and 5 × 10⁶ in a section, an open wall stub and a closed line of
another code left out, only 0101 and 0102 surfaces and none in a tunnel (22D13's asphalt of `Sede`
054), `AC_a` the mapped area, ids by sheet and by section, 22D18 outside the default box), and cases
street names (proven red on "PIAZZA UNITA' D'ITALIA" and "VIA SANT'ANTONIO" before the elisions were
cased, and on "VIA DEL PRA'", "VIA G.B. NATALI", "VIA VETERANI DELLO SPORT", "VIALE DEI MILLE",
"PIAZZALE DELL'UCCELLIERA" and "PIAZZETTA DI SOMMOBORGO" before the accents, the initials, `DELLO`
and those kinds); `dbt.test.ts` `kindOf`'s every rule in its order (0603, the NC5's rail service,
a station, and 09, its farm buildings' agricultural use, a barn), the units standing on the ground
(eave and height, the code's default where `un_vol_av` is 1.06 m, the artefacts, a tank left out,
ids by comune), the road surfaces from the carriageways (a road's dirt 407.8 m² and paved 22.6 m²
each its own surface; Via Belmesseri's 265.4 m² carriageway, not its 406.9 m² road area with the
sidewalks; the A15's in a tunnel left out), the road areas of roads with none, paved and named
(Vicolo Santa Cristina), the dirt tracks, the zones, a street name `readDbt` reads as UTF-8 (proven
red with the tables read as latin-1, which garbles its "À"), a vertex placed with
`DBT_RESIDUAL`, a record two comuni's archives both hold read once, under the first comune's ids
(the fixture copied under two ISTAT codes gives the same buildings and road surfaces as one, and
its zones twice), and of the copies two archives cut at their own edges the larger (a unit's 80 m²
copy, not its 20 m² one: proven red on the first copy), every zone, and a road's two areas but the
identical copy of one; `nc5.test.ts` on layer files written as `fetch-lig` writes them, Sarzana's
cathedral's attributes among them: a footprint per polygon at its own eave (a multipolygon's two
parts, a ring's highest Z), each kind and style of the DBT's codes, the minor buildings' ids from
10⁹, the carriageways paved but the one in a tunnel, a building in two parts' files read once but
each part's own clipped piece of the mapped area kept (proven red with it read once by its
`classid`), and a feature without its `classref` refused; `survey-ids.test.ts` the section codes and
their refusals (`element5k` too), 23D11, 22D11 and 24C11 and the five sources apart, `id | 0` the
old id and its seeds, and safe integers up to the last slot; `surveys.test.ts` `bySourcePriority`
on squares and `readSurveys` on a copy of the fixtures and an NC5 folder, in their order, which
drops those two 1:10 000 records; `features.test.ts` a surveyed building's tint the one its
2019 id gave, in any section (the old seed, `-id % 1e9`, breaks 10 of its 12 cases).
`src/tools/__tests__/shp.test.ts` subsets a synthetic shapefile with `subsetShp` and reads it back,
keeps records by their box and blanks the fields it is told to, and reads a table's NUL padding and
UTF-8.

`src/tools/__tests__/ctr-rail.test.ts` checks the track chaining, the tunnel cut and the clip on
synthetic lines and reads synthetic CTR rail layers (`shapefile.ts` beside them writes those).
`src/sim/map/__tests__/rail.map-test.ts` checks the rail in the built map: the running line is one
chain from edge to edge of the play area's outline, past every station, its loops (Gragnola's and
Pieve San Lorenzo's) ending on it and Gragnola's loop the track by the station building, every kind
one of `RAIL_KINDS`; at grade, the
rail meets roads and water only at vertices they share, level with the road (Via Riolo, Viale 20
Settembre, Via Castel dell'Aquila twice, Via Nuova, and Equi Terme's foot crossing); no rail, road
or water polyline repeats a vertex, and a rail segment under 1.85 m joins two shared vertices; no
terrain stands more than 0.05 m over at-grade track more than 6 m from a level crossing, nor more
than 1 m under it but beside a lower road running along it (within 30°, its core within one cell);
no 40 m chord of the running line curves tighter than 250 m (the line's tightest curves are 300 m;
chords under 40 m see the CTR's own drawing, 193 m at 20 m); and a parked car's box keeps 2.8 m from
at-grade running track and 1.94 m from a loop or siding. On the map before the rail moved onto the
CTR the chain, crossing, terrain-over-track and parked-car checks fail; the curve check fails
without the spline's reweighting (249 m at the Terma tunnel's south portal); on the map before the
switches, the bridges and the parked cars were mended the repeated vertex (Gragnola's loop at the
stub's switch), the ground (8.2 m under the track north of the Aulella bridge) and the parked car
(2.02 m) fail. `src/sim/rail/__tests__/lines.map-test.ts` holds each line's run-out
([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)) on the stored track vertex by
vertex, straight and level past its end, and over the drawn run (within the bounds, off bridges,
out of tunnels) the terrain at most 0.05 m over its bed and 0.5 m under it (the rail bed's `BED`
and `BANK`, `checkTerminals`): the map before the run-outs had it 16.75 m over the bed 192 m past
Rometta, and 174 m past Pieve San Lorenzo, whose straight run had been at grade inside the hill.
`src/render/__tests__/rail.map-test.ts`, `rail-cesena.map-test.ts` and `rail-l.map-test.ts`, each
in a process of its own, find both rails drawn every metre of every drawn run out of a tunnel, at
the rail head within the bounds (`checkDrawnRuns`: 384, 1,536 and 768 points; Lunigiana's east one
lies in the Lupacino), the last two with `checkTerminals` on Cesena and the L; each failed on its
map before (no rails drawn where the trains ride; on Cesena and the L the old apron track ran
square to the edge, not along the run-out). In `src/tools/__tests__`, `rail-runouts.test.ts`
checks the walk (OSM's way from its cut, then on at shared nodes the straightest way; none for a
cut off the outline or where no piece of the terminal's way has its cut beside it; through a way
the track passes a switch of); `rail-match.test.ts` checks the matching (a run keeps to
its track past a nearer parallel one, tunnels and track ends stay unmatched), the simplification,
the smoothing spline, `insertOn` giving its id to a vertex already there and `pruneShort`;
`conflate.test.ts` conflates a synthetic line with a tunnel, a level crossing, a culvert, a loop and
a siding crossed by roads, the half-segment guard, Gragnola-style swaps, a line no CTR maps (kept as
OSM has it), the CTR's crossing polygons and a siding the CTR draws from beside its switch (it starts
at the switch); `rail-spans.test.ts` slides a bridge end to keep its river (and its margin), adds a
culvert, leaves a stream under a CTR bridge alone, cuts at-grade track into the CTR's bridges and
takes one out past a stream crossing under it (`spanned`); `rail-graph.test.ts` cuts a piece at a
switch, finds a line straight through turnouts past a passing loop, a yard and a spur, takes
junction headings over 5 m, and finds no line on a ring, with each piece's kind;
`rail-levels.test.ts` bounds the rail over a tagged and an untagged underpass, under a road bridge,
at a level crossing (no pin) and over a river, a 2 m stream and a 4 m one, and never holds the rail
under the ground where a road bridge crosses it (the road rises over it instead);
`road-levels.test.ts` bounds a road under a bridge by its `maxheight` (4 m untagged) plus the 1.5 m
deck, 2 m either side of the crossing, a bridge or tunnel in an earlier pass by the other road's
natural level, and never a road at grade over a tunnel, and binds a chain that crosses itself from
one natural level, its bridge clear over the road below; `features.test.ts` folds each link into
the class below, gives a main road its `lanes` width, and makes a motorway, its links and a
roundabout oneway and a motorway's or trunk road's link a ramp, makes no road of a highway line
tagged `railway=platform` (Pieve San Lorenzo's footways; proven red without the rule), keeps one
vertex of two in a row on one 0.1 m point (the one another way shares) and drops a culvert but
under a bridge; `profiles.test.ts` levels a tunnel's portals and a bridge's ends with the ground
outside them, runs a tunnel the outline cuts, in two pieces, level from its one portal, carries a
tilted bound inside a climbing tunnel to its portals along its slope, writes two roads' claims into
two windows that share a seam just as into the whole grid, lays a road's bridge of two pieces as
one deck (the rail a deck a piece), opens a road tunnel's mouths at its approaches' level against a
road over it and one beside it, keeps a junction it sets within reach of the short link to a
junction set before, and holds each bound on its own piece where a chain crosses itself (a loop
clears its own bridge), cores each piece at its own width (a wider piece joined on along its
chain leaves the grid beside it as it was: with every piece cored at its chain's widest, as
before, it fails at node (0, −12)) and holds a tunnel's mouths at their approach's width (4 m and
5 m beside a 10 m bore), and runs a chain on from a start's level (`start`: the first vertex at
it, a bore from it level to where the box cuts it, its claims only where `writes` lets them);
`junction-reach.test.ts` keeps a junction within its links' steepest grade
of the junctions they lead to; `rail-bed.test.ts` lowers a grid under a line, raises the corners
far under it but a kept one, moves a window's nodes as it moves the whole grid's, levels a siding
on the line beside it, and moves a run-out's nodes beyond the play area alone (`writes`);
`deck-ground.test.ts` reads a cell as the game draws it, lowers a hump under a deck's slab and no
node off it, leaves a bank the slab's edge grazes (the ground under
the slab goes instead), brings a hillside down under the road along a deck's end run (the SP59's
by Vinca) and clears the slab past `END_RUN` (4 m) though it first stands clear 19 m in, lowers the
ground under a deck lying on it all along past its end runs, keeps a rail deck's ground off its
ballast, lowers the ground at a joint between two pieces of a deck as under the deck whole (a deck
0.5 m off the joint's level is no piece of it), and flags the nodes round a slab abeam of its deck
or behind its ends; `grid-tiles.test.ts` checks that the tiles' windows cover the grid,
neighbours sharing their border nodes, and that the tile `cellTile` names for a point (on and off
the seams and the grid's edge) holds the four nodes of the cell read there, a point at a corner of
Lunigiana's box in a notch (found from the list: its north-west and south-east today) in a tile off
the list, and on the L test region's lattice that its notch's tiles get no window, `listedNodes`
holding every node but the notch's 285,000, and that `extendEdges` gives each of those the listed
node the game reads there (by its sides, its corner and its far corner) and leaves the rest;
`catchment.test.ts` that a notch's nodes are outlets, that an inflow from beyond the grid is carried
down its stream from its node, and only there, that a river cut short of the grid's edge drains on
down the water beyond the cut, not down a side stream beside it, and that water coming in at the
grid's edge is no outlet for the water it joins (each of the two red before the change it guards)
([section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)); `spawns.test.ts`
parks cars off running track, off a siding and away from a level crossing; `platforms.test.ts` clips
a platform off a track, a road and a crossing area, makes a strip between close tracks, a narrow one
and one no edge of which comes within 2.2 m of a track walkways, and leaves out the ground far under
a platform's top; `railway.test.ts` checks the
speed limits, crossing boxes and stations; `rail-clear.test.ts` narrows a verge beside a track,
leaves one at another level, in a box or on a platform alone, and throws for a lane.
`src/sim/map/__tests__/railway.map-test.ts` checks `MAP.railway`: each line runs terminal to
terminal, its pieces sharing their end vertices bit-identically, every running piece on one (today
the one line, from the outline at Pieve San Lorenzo to the outline by Rometta); the speed limits
cover it, 80 or 85 km/h but in the Galleria del Lupacino (OSM's 140), 80 km/h from Equi Terme's stop
to Gragnola's; the five stations lie along their platforms, a platform within 4 m of the line's side
at each one's middle; each crossing box's nodes are vertices of its road and of the rail, the line's
s on one of them (a box on a loop alone, Pieve's foot crossing, names no line), and every vertex an
at-grade road shares with at-grade rail is in a box; the
platforms stand 1.55 m or more from every track and 0.44 m or more past every carriageway's edge
(0.5 m less the rings' 0.06 m simplification), their top the rail head plus 0.25 m (Gragnola's
walkway 0.02 m) and `groundZ` on them their top or the terrain where that is higher, or a footway
OSM draws along one up to 0.09 m over it (Fivizzano-Gassano's); the line's grade changes by under 4%
over 20 m, and under 2% through a level crossing (the map before the fixes changed it 4.1% at s
6269); through its tunnels each stretch of 100 m or more (the whole of a shorter tunnel) climbs or
falls 2.5% at most, 0.1 m more for the bed's rounding (issue #17); and it runs on over lucido's
seam with fivizzano at Gragnola, between stations, within 2.5% over 100 m either way.
`src/sim/map/__tests__/levels.map-test.ts` checks what the level rule (`onOneLevel`, 2 m, in
`src/sim/one-level.ts`) rests on, on Lunigiana, Cesena and, when built, the L (in CI always):
wherever two ways cross on two levels with no node in common (a road, path or rail bridge over a
road, a path, steps or the rail, or a road, a path or the rail over a tunnel: `passesOver` in
`road-levels.ts`), unless both are the rail, the way above stands more than 2.5 m over the one below
between any two of their points within 3.99 m of each other and of the crossing, so a deck's slope
toward its end counts too. That reach is the farthest of how far from a car's axis the person who
gets into it stands (`ENTER_GAP` and the truck's half-width, 3.225 m), how far from its middle a
vehicle reaches into a driver's path, where the driver reads its level (the truck's half-diagonal,
3.99 m), and how far apart two bodies touching are read, each on its own axis where they touch (two
trucks' half-widths, 2.45 m); a vehicle a person or an animal may run from is read on its axis
abeam them, and past its bumpers on its axis's line too; a train's car is read at the rail head under
its middle, which the line's 2.83% at most keeps within 0.28 m of the rail head where it reaches
the path. Paths over paths count since
people step apart only on one level. The 0.5 m over `ONE_LEVEL` covers the surfaces' lifts over
their
profiles (0.06–0.24 m), the 0.1 m rounding and a truck's wheels rolled 25° (0.16 m). It visits 50
crossings on Lunigiana (49 before Fosdinovo's part; the least 4.24 m, a path over the rail's tunnel
at (2544, 1057)), 161 on Cesena (2.63 m, a path bridge over a path at (−1044, −1321)) and 18 on
the L (5.39 m), in 1.9 s;
Lunigiana and the L have no path over a path. Out to 12 m of a crossing, where two bodies may still
touch across an oblique one, no road over a road or a path, or path over a road, comes nearer than
4.95 m on Lunigiana, 3.06 m on Cesena and 5.02 m on the L outside the listed ones. Cesena's
crossings that keep less are listed by OSM id ([Known data limitations](#known-data-limitations)),
and each must still fall short, so a fix drops it from the list. With the SR445's viaduct west of
Gragnola lowered 4 m in memory, it falls short at 1.94 m over the residential road under it. Only
crossings are visited: where a deck lifted 2.5 m or more over the terrain overlaps another way's
carriageway in plan without crossing it and the two stand 2.5 m apart or less, that way meets the
deck there, within 25 m of a node they share, or else joins its approach within three joints and
comes within 4.8 m of its end (10 ways on Lunigiana, 3 of them on the L, none on Cesena): on its
level there.
`src/sim/map/__tests__/joints.map-test.ts`, `joints-cesena.map-test.ts` and `joints-l.map-test.ts`
(each region in its own process, the L skipped without its build but required in CI) check what a
driver's level rests on where its way meets a bridge's deck or a tunnel's floor: at every joint
where a Panda may drive from a road onto or off a bridge or a tunnel, or from one bridge way onto
the next, with no junction and no turn of 30° or more, a driver standing on its lane up to 40 m
before the joint reads a Panda standing in its lane past it, together up to 40 m apart and every 2
m along both, on its level, rolled along the arc it steers to it (`onPathLevel`, where that arc
keeps to the carriageways; `joint-checks.ts`). 40 m covers a Panda at the primary roads' 16 m/s,
which starts braking for a car standing 27.1 m ahead. It checks 68,167 places at 541 joints on
Lunigiana, 16,189 at 105 on Cesena and 9,077 at 67 on the L, in 0.9 s (2026-11-07; 58,814 at 463
and 8,393 at 63 before #18). Read as before, nearest the driver's ground carried along its lane's
slope, the check failed at 30 joints on Lunigiana before #18 (among them the SR445 coming down 15%
onto its viaduct from the east), 7 on Cesena and 8 on the L;
rolled, only at a mouth of Pieve San Lorenzo's underpass (756577583) on Lunigiana, listed
([Known data limitations](#known-data-limitations)), which must still fail, so a fix drops it.
`src/sim/map/__tests__/clearance.map-test.ts` checks the clearance rule
on the verges people walk (`walkSide`) and the lanes cars drive (`laneSide`), and that no parked car
stands within 20 m of a crossing node; on a map built without the narrowed verges and the parking
rule, both fail (Piazza Paolo Sist at 2.75 m and Via Riolo at 1.92 m, a car 19.4 m from Viale 20
Settembre).

The part tools ([Adding a part](#adding-a-part)) are checked offline in `src/tools/__tests__`:
`cartoteca.test.ts` parses GML and GetFeatureInfo answers trimmed from real ones (a hole, a
multipolygon written as one `ms:GEOMETRY` per polygon, a tile in lots 004 and 006; section 249030's
editions of 1995, 2010 and 2021, its DXF and EPSG:3003 links passed over; Minucciano's two DBT
surveys; an answer with no href, no licence or no block), builds the archive URLs (and throws on a
malformed name) and `gfiUrl`, blanks the surveyors' names of a mapped area leaving its main file
byte for byte (`withoutSurveyors`, on a dummy name), keeps the records whose box meets a box, edges
included (`meetingBox`), and keeps `insidePoints` inside a wedge, a footprint with a hole and one
under 100 m tall; `dtm-mosaic.test.ts` pins `lucido`'s crop to the formula `fetch-rt` used before
parts and reads a synthetic grid; `net.test.ts` serves a local HTTP server to check the
`User-Agent`, the immediate 4xx and `overpass` moving on from a 504 or an answer with a top-level
remark (a server timeout) but not from a tag named `remark`, and `net.long-test.ts` (`pnpm
test:long`) the retry of a 5xx after 2 s; `manifest.test.ts` pins `lucido`'s 25 sheets, 85 tiles
(its rectangle's 66, 47 of 2010 before 19 of 2012, then the 19 its tiles needed once Fivizzano grew
the box, 17 before 2), one 10 m DTM, three surface-model elements and the 12 sheets of 2009, with
no CTR 1:10 000 or DBT, `sillara`'s picks and `pontremoli-town`'s one DBT, reads a manifest
written before the newer lists as listing none of them, and refuses one listing Minucciano's two
DBT surveys but reads one of them alone; `fetch-rt.test.ts` runs `fetch-rt` and checks that it
refuses a stage for a test region with buildings of its own and any test region with
nothing of its own, before any request; `pick-sheets.test.ts`, `pick-lidar.test.ts` and
`pick-diff.test.ts` check the area rule, first wins, the holes and the surface model's elements over
them on synthetic grids, and `pick-lidar`'s mask against `tileCrop`'s seeded crop on an L's tiles
(a cell is left to the replay exactly where the crop leaves it to the LiDAR, the notch out though
its tile's file holds it), the earlier parts' tiles before the candidates and a cell out of the
replay never counted, each proven red; `rt-index-file.test.ts` the index's box (lucido's its
rectangles' to the metre, Fivizzano's rectangles' reaching their tiles' cells, a test region's with
terrain of its own its rectangles') and an index a metre short of it on any side refused;
`dtm-tiles.test.ts` a part's tiles and their cells (`partTiles`, an L's notch tile none) and the
tile files a folder holds (`tileKeys`); `fetch-dtm.test.ts` the seeded crop (`tileCrop`: a held
cell's height and source, a needed one empty, the rest out), the chain filling it without taking or
meeting an out cell, `writeTiles` keeping a file's cells and adding the means of those it lacks,
and the source it records: a file it adds cells to keeps the earlier source with its own after it
for the cells it lacked, one it adds none to the earlier alone, a new file its own alone (proven
red); `dtm.test.ts` `readTiles` on two tile files side by side, the box over the first and half the
second: the shipped map throws naming a listed tile with no file, and a tile and the EPSG:3003 cell
its file lacks inside the box (not one past it, which a scan of the whole file would meet first),
and a test region builds on the files there are, a cell none holds drawn on from the edge, each
proven red with its guard taken out; `rt-cache.test.ts` that `fetchZip` extracts an archive again
when the OS purged some of its folder's files; `fill-chain.test.ts` bends a filler into a 100 m hole
of a tilted LiDAR (no step over 0.1 m at its rim), carries a 20 m ripple the lattice cannot fit
through the band, keeps a filler to its `where` and its data, bends a second filler onto the LiDAR
and a first filler a cell off it, and keeps a filler with a `fade` to its own heights 1.3 km from a
strip of LiDAR, where unfaded it is lifted onto the LiDAR all over (proven red with the fade
ignored; `fill-chain.long-test.ts`: a 5 km hole, linear in its cells); `terrain-sources.test.ts`
reads ASCII grid windows (corner and centre registered), a GeoTIFF in EPSG:7791 and Liguria's in
EPSG:3003 (GeoServer's own keys and model transformation, `fixtures/lig`: the 200 m square of the
DTM by Piazza Matteotti and two crops of it that overlap, each as the WCS gave it; its rows rising
north as the town does), a 7791 file and another transverse Mercator under GeoServer's keys (its
false easting moved) refused as 3003, the two crops pasted into the square (`ligRaster`), `unround`
(a rounded slope straight again within 0.12 m, every cell within 0.5 m of its whole metre, a plain
flat, a cell without data left out), the WCS request, the
projection lattice (within 1 mm; the box round its corners within 0.01 mm), the open ground and the
canopy filter (a tree with its fringe, a pit, scraps and strips narrower than the square, a slope
left alone, and the smooth edge of a wood wider than the square, which one pass left standing over
the clearing, proven red); `liguria.test.ts` the WFS's count and pages, sorted, from each
`startIndex`, the land
use's CQL filter, `fetchWfs` reading three pages and refusing a short answer, a repeated or
unsorted row, a count that moves while paging and an answer with no count, the polygons on whole
centimetres, `nc5File` clipping the mapped area alone and keeping a building past the box whole,
`udsPolygons` (a fourth-level code kept whole, Z dropped, decimetres; a code outside the classes
refused), `staleCrops` (a `.DS_Store` left alone, proven red), `beyondCoverage` (only the
empty-subset 404), the crops of `dtmTiles` covering
`fetch-rt`'s crop of a tile-aligned part 6 km tall, of an L with its notch and of the Sarzana test
region (proven red with the tiles of the rectangles alone), and the DTM's crop on the lattice's
edges, each edge 3 m inside its line, refused past 512 cells; `ucs.test.ts` the land cover in
EPSG:3003 and 25832 by each file's `crs`, the classes by three digits (5121 a lake, 5111 left out)
but Liguria's fourth-level overrides (`kindOfCode`: 2211 an olive grove, 2212 left out, 2231 an
olive grove by its 223), a polygon two files hold read once, a multipolygon's every polygon, a file
in another CRS refused, a wood cut on the 500 m squares, each piece 4 m past its square, filling the
whole wood's pixels but within 6 cm of its edges, an open cover kept whole, and a clearing wider
than a piece kept clear whichever vertex its ring starts at; `fetch-lig.test.ts` the tool's refusals of two parts and an unknown one
before any request; `crs.test.ts` inverts `utm32ToLatLon` within 1 mm, on Liguria's side too; `footprint.test.ts` the
edges of an L and of a mask (a slanted edge's bearing, a seam along a neighbour's rectangle or
mask, an edge cut where a neighbour's mask stops), clusters, a road that leaves and comes back,
across a mask's slanted edge too, one out through a seam that never leaves, one that runs off the
query box (unresolved) and a mistyped flag; `footprint-report.test.ts` lucido's report and two
unmasked parts' as they were before masks were judged, a road out and back through a neighbour,
and a masked part's findings on its slanted edge; `fetch-osm.test.ts` the split on HTTP 400 with a
fake server, the part its arguments name (`partToFetch`: a Lunigiana part, Cesena's one part, a
missing or unknown key), the refusal of a test region's part (before any request) but one with
buildings of its own, the boxes it asks for (`partBoxes`: each rectangle of a part's tiles cut to
its box plus 100 m, lucido's and Pontremoli's the boxes their pinned extracts' sources name, the
L's six tiles two boxes, not its notch's two), the ground it asks for (`partGround`: a part's own
tiles cut to the grown box, then the strip the box adds to an earlier part's tiles, a tile no
rectangle meets in neither), that the extracts the lock records hold the ground of every listed
tile in Lunigiana's box (red on Fivizzano's extract over its rectangles alone: 2,790 hm² in none),
and `buildingsOnly` (a road, a `building:part`, a land-use multipolygon and a `type=building`
relation left out, each element's XML as the API wrote it, and the rings `assembleRings` rebuilds
from `osmXml`'s file); `osm.test.ts` the merge of a region's parts' extracts (`mergeOsm`,
`readOsms`: the first part's element of a duplicate id kept, each kind ordered by numeric id, not as
strings, and one extract read back in its own order); `coverage-grid.test.ts` and `coverage.test.ts`
first wins, the tally, ring assembly, no picks, a WFS error answer never cached, a mask's play area,
each fill source read from the nearest cell of a tile file (none where no file holds one) and no
fill columns while a play-area cell has no terrain, each proven red; `ortho.test.ts` and
`ortho-wms.test.ts` the pixel mapping, tiles, licences (an unlisted sibling flight is look only)
and an error answer for capabilities; `playtest.test.ts` the spots, the command line (shots, heap
and drive with their defaults and flags) and the spot script;
`playtest-drive.test.ts` the frame stats, the road chained through shared ends from the free end
nearest the start and at a fork toward the goal, the page's drive script (run in a `vm` against a
fake `gta`) and its report (the SP59 itself is `playtest-drive.map-test.ts`'s, above, as it reads
the whole map's roads); `cdp.test.ts`, on a fake Chrome, a command's own timeout and the socket
closed when a tab cannot open; `map-diff.test.ts` each category's change on small maps, a key it
does not compare, walls and trees in another order (the fewest moved counted, copies of a removed
segment left out), a tree on a spot both maps plant with another id there, buildings equal but for
their id as one `ids:` line (a farm on one no difference, `--except buildings` accepting it; one
that also changed removed and added; pieces sharing an id and identical copies paired one to one in
order), a wall that only took a level as another wall, a map from before the outline and
`--except`, and `map-diff-args.test.ts` its command line;
`geometry.test.ts` `clipRing` to a box; `trees.test.ts` the tiles' scatters merged by id against the
scatter of their whole box (with two lattice points rounding onto one spot from either side of a
seam, and a stream beside another whose bank trees fall in its 4 m cells), a tile's trees and ids
when the region's box grows, a stream's piece the outline cut keeping the whole stream's bank trees,
a stream's banks in every listed tile and none in one left out, the last bank cell's tree
getting the largest id (its look's seeds below 2³², a cell further throwing), the conifer and
mixed woods growing a forest's trees, an open area over one keeping them out, and the olive
groves' own 7 m lattice (ids from `OLIVE_TREES`, each olive 2, 3 or 4 m into its cell, olives over
a wood or a field and none under a park, the same olives as the box grows and across the tiles,
the last olive cell's id an int32 and a cell further throwing); `region.test.ts` the
regions' parts, bounds, tiles and tree anchors, `pontremoli-town` the one region with buildings of
its own and `surveyDir`, `sarzana-town`'s 6 tiles, its terrain of its own and `ligDir`, the OSM
extracts each region's build merges (`osmFile`, `osmFiles`: a test region Lunigiana's parts', but
`pontremoli-town` its own), and `checkMask` on a diagonal mask in an L and on each fault (too few
vertices, off 0.1 m, clockwise, a repeated vertex, a fold, a crossing, a vertex or an edge outside
the rectangles, a mask round a gap in a donut of rectangles); `play-area.test.ts` the outline of one
rectangle (south, east, north, west), an L of two, overlapping rectangles, rectangles sharing a
side, a diagonal mask, a mask and a rectangle crossing off the 0.1 m lattice, a hole, two rings
touching at a corner and a hole touching the outer ring or another hole at one, `onOutline` finding
rail ends rounded off a slanted edge, the notch cutting a line in two with ids kept and cuts
id-less, each piece's start along the whole line (`clipPieces`), a line past the L's inner corner
(or a mask's slanted one) within a micrometre staying whole, a cut on the 0.1 m point of the vertex
beside it taking that vertex's place (leaving, entering, a dip into the play area on one point, the
pieces beyond it), so that no piece, rounded as the map ships it, repeats a vertex, Lunigiana's
outline one ring round lucido's rectangle and Fivizzano's and Fosdinovo's masks from Fosdinovo's
south-west corner with its seams inside it, and clipping to one rectangle against Liang–Barsky on
4000 random lines and lines through its corners;
`src/sim/map/__tests__/outline.test.ts` `insideRings`'s margins round the L's inner corner, a
clockwise hole, and `edgeDistance` beside and past an edge; `walls.test.ts` the outline walls
closing the L and a rectangle's running south, east, north, west, and a guard rail kept whole along
its road inside its w/2 but opened where a drivable road's middle 1.2 m reaches it, to the last free
0.25 m sample, as OSM's by Tendola needs, while a wall drawn the same, standing in the road, goes;
`parapets.test.ts` a deck's parapets closed over a road 7 m under it at the deck's top, 150.2 m, and
open where a road on its level joins it from one side alone, on 0.1 m and in pieces of 16 m at most,
and `parapetFaults` finding the opening the old rule left over the road under it, a parapet across
the joining road and the parapets with no level over the road under it; `deck-walls.test.ts`
`traceContours` ringing a disc anticlockwise on its circle, and over a valley under a deck the walk
walls crossing its line where the ground stands 2.7 and 0.5 m under its top and running along it at
its walkers' reach, every wall 2.5 m or more under its top and within 2 m of the ground under it,
none on the road carrying on from its ends, a footpath 2.5 m under it keeping a walled corridor and
one 1.2 m under it opening the walls across it.

`node src/tools/preview-map.ts [pxPerM=1] [minX,minY,maxX,maxY] [out.png]` draws a top-down PNG of
the built map, its trees, walls, roads, buildings, water, areas and barriers read whole from the
tiles, joined in the whole map's order, which its alpha blending follows (the running line dark,
loops and sidings purple, rail bridges with a pale deck, platforms pale, walkways sandy,
level-crossing nodes white): the same PNGs, byte for byte, as when it read the vectors from the
global file. It writes `.research/map-preview.png` by default.

## Adding a part

The map grows one part at a time (issue #3 holds the extent, the order of the parts and the runbook
each part follows). A part is a key in `PARTS` (`src/tools/region.ts`) with its rectangles in local
metres, on 100 m multiples, and, where it plays less than them, a mask: one simple counter-clockwise
ring on 0.1 m inside the rectangles, its edges and all it encloses (`checkMask` throws on any other
when the region loads, naming the fault: a mask round a gap the rectangles leave fails too). The
region's play area is the union of its parts' masks, or rectangles where a part has none, and its
`bounds`, the built terrain, the box round every part's rectangles ([section
2](#2-projection-and-play-area-geometryts-play-areats)). Lunigiana's parts are `lucido`, with no
mask, `fivizzano`, masked off Emilia-Romagna, and `fosdinovo`, masked off Carrara's corner. Its
sources are its manifest, `data/parts/<part>.json`: `pick-sheets` writes `ctr`, `pick-lidar` `lidar`
and `dsm2021`, and the rest are written by hand, `dtm10` from the provinces the LiDAR's holes lie in
and the older surveys from `rt-index`'s lists: `ctr2009` the 2009 sheets whose own mapped area
(`AC_a`) meets the part, among the frames `pick-sheets` lists with no 2019 sheet, and `ctr10k` and
`dbt2k` each section or comune by its archive's name with the MD5 and no extension, as `rt-index`
found it (`S_249020_2010_6707_a797…`, `DBT2K_045014_PONTREMOLI_2010_2010_3003_21f4…`). List a
1:10 000 section only where nothing finer maps the part's buildings: its mapped area drops every OSM
building in it. A comune with two DBT surveys, one of 2010–2013 and one of 1988–2006 (the
cartoteca's `dbt.2k` index over Lunigiana and round it lists 20 on 2026-11-03, all in the province
of Lucca, Minucciano, Piazza al Serchio, Sillano, Camporgiano, San Romano in Garfagnana and Vagli
Sotto among them), lists the one that maps the part: `fetch-rt` pins a comune's layers by its ISTAT
code alone, and `readManifest` refuses two of one comune. A part in Liguria's comuni, which have no
CTR or land cover of Regione Toscana's, runs `pnpm fetch-lig <part>` before `pnpm fetch-rt`: the
build reads each of a region's parts' NC5 and land use from `data/raw/lig/<part>/`, and `fetch-rt`'s
chain fills the cells its LiDAR leaves from the part's DTM crops there ([section
1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)). The tools below scope a part
and check it. `rt-index`, `coverage` and `footprint-check` write their scratch in
`.research/<part>/` (gitignored), `ortho` in `.research/ortho/` unless given a file, `playtest` in
the folder it is given; every request names only the project in its `User-Agent` (`net.ts`), and the
tools print paths relative to the repository. Measured on `lucido` on 2026-10-29, on `fivizzano`,
issue #17's part, on 2026-11-04 and on `fosdinovo`, issue #18's, on 2026-11-07 (arm64, Node
24.14.1).

- **`pnpm footprint-check <part> [--refresh]`** (`footprint-check.ts`, the report in
  `footprint-report.ts`, geometry in `footprint.ts`) checks what the part's edges cut through: one
  Overpass query over the box round the part's rectangles + 1 km (place nodes, building centres,
  highway ways; cached in `footprint-osm.json`). It judges the part's play area, its mask where it
  has one, else its rectangles' union, cut into straight edges named by the way they face out:
  `E x=4900 y -6100..3900` along a vertical or horizontal line, and on a mask's slanted edge the
  nearest compass point, the bearing and the ends, `NE 53° 800,2000..2000,400`. An edge is cut
  wherever another part's play area starts or stops beside it, and a piece whose outer side lies in
  another part's play area (its mask, or its rectangles without one) is a seam with that part:
  listed, never a finding. It reports the places within 300 m of an edge that is not a seam,
  clusters of 5 or more buildings linked at 50 m with a member within 300 m of one, and the roads
  that leave the play area across such an edge and come back (ways join at shared nodes, so a road
  split into several ways counts); paths and steps are notes, not findings. The play area a road
  leaves, and a place or building lies inside, is every built part's, so a road out through a seam
  runs on a built part and never leaves, and one out and back across another part's edges alone is
  that part's to judge. A road whose way out runs to within 50 m of the query box's edge without
  coming back is listed as unresolved: the 1 km pad is how deep the check sees. It writes
  `footprint.json`, with the mask when the part has one. `lucido`: 32 places, 23 clusters
  (Argigliano, 188 buildings, is cut 2 m inside the east edge), 16 drivable re-entries (the SR445
  runs 780 m outside the north edge), 15 path notes, 7 unresolved roads (the SR445 north, the SP10
  west) and 2 paths; 99 s with the query, 0.2 s cached. `fivizzano`, with its mask (42 vertices, 43
  edges, 2 of them seams with lucido: y 3900 for x −2900…4900 and x 4900 for y −900…3900), over 221
  places, 12,538 buildings and 3,186 highway ways: 15 places, 34 clusters, 40 drivable re-entries,
  12 path notes and 2 unresolved roads (the SS63 north of y 13000 and an unclassified road south of
  the leg's y −900), in 150 s with the query (one Overpass mirror answered 504 and the next served
  it). Every finding on a permanent edge lies on the Serchio side, in Minucciano and Sillano
  Giuncugnano, where the roads belong to the Garfagnana's network and the runbook's road rule cannot
  be met: 14 roads leave and come back there (towards Minucciano town, Sermezzana, Varliano, Piazza
  al Serchio and Ponteccio), and Sermezzana (148 buildings, 90 m out) and Capoli (47, 140 m) lie
  whole outside. The rest lie on edges later parts join: y 3900 west of lucido (#18, joined since),
  x −5300 (#19) and y 13000 (#22, #23) ([Known data limitations](#known-data-limitations)).
  `fosdinovo`, with its final mask (17 vertices, 18 edges, 2 of them seams: x −2900 for y
  −5324.9…3900 with lucido and y 3900 for x −5300…−2900 with Fivizzano), over 125 places, 8,926
  buildings and 2,655 highway ways: 12 places, 55 clusters, 43 drivable re-entries, 4 path notes
  and 6 unresolved roads, in 271 s with the query (one Overpass mirror timed out and the next
  served it). All lie on edges later parts join, x −11500 (#20), y −6100 west of x −4600 (#21) and
  y 3900 west of x −5300 (#19), but on its permanent edges in Carrara: Castelpoggio's houses run on
  in a chain to Noceto, whose 163 buildings cluster 147 m past the south edge (x −4600…−4000),
  Via Giacomo Ricci (61316266) loops out 583 m across y −6100 to Noceto and back, the Ruschetti
  locality and 5 houses stand 104–111 m past x −4000, and the SP73 leaves once, at (−4000, −5563),
  toward Gragnana. On the issue's mask, the line 1 km beyond the comuni alone, the critic found
  Castelpoggio 89 m out and the SP73 out 1,985 m and back, so the mask bends out east of x −4000
  ([section 2](#2-projection-and-play-area-geometryts-play-areats)).
- **`pnpm rt-index <part>`** (`rt-index.ts`, readers in `cartoteca.ts`, the box in
  `rt-index-file.ts`) lists the cartoteca over the box round every cell `fetch-rt` may read for the
  part, + 500 m (`indexBox`): for a Lunigiana part, the EPSG:3003 box round its tiles' squares cut to
  the region's bounds, whose cells its fetch writes (`tileNeed`); for a test region with terrain of
  its own, its rectangles' box, round the mosaic it writes. The tiles' box holds the rectangles' and
  is wider where a rectangle stops short of its tiles' edges or the region's bounds grow past a
  part's rectangles: lucido's alone was its rectangles' to the metre (1586928, 4883839 to 1595866,
  4894945), and in the region Fivizzano grew it reaches 1,101 m further west and 1,100 m further
  east, where its tiles i −2 and 2 run to x −4000 and 6000, and 116 m further north (1585827,
  4883825 to 1596966, 4895061), so lucido's index was taken again; Fivizzano's reaches 1,112 m
  further south than its rectangles', where the leg's tile runs to y −2000, and 40 m further east.
  `pick-lidar` refuses an index whose box is short of today's (`checkIndexBox`), as when a later part
  grows the region's bounds and so the part's tiles' cells. It asks WFS GetFeature on
  `rt_cartoteca.ctr2k` (sheet frames by year), `ctr10k` (section frames by edition), `lidar2k` (the
  tiles' data footprints by lot), `dbt.2k` (a block per comune and survey, its polygon the comune's,
  not the area it maps) and `lidar2k_DSM_autocorrelazione_2021`. The index has no archive names, so
  it asks a text/html
  GetFeatureInfo (`gfiUrl`) inside each tile's own footprint (`insidePoints`: the widest inside
  spans first, clear of the 50–70 m band below the north edge where the server answers nothing, up
  to 16 points, because the server's footprints do not match the WFS's to the metre) for the
  MD5-suffixed DTM archive and the owner, whose licence the answer states (RT: CC BY 4.0; MATTM: CC
  BY-SA 3.0 IT); inside each 2010 CTR 1:10 000 frame for its EPSG:6707 archive and licence
  (`ctr10k`: section, title, flight, archive, licence); and inside each DBT comune for the archive
  of that block's ISTAT code and flight years, among the comune's every survey, and its licence. It
  HEADs every 2009 and 2019 sheet (printing any whose `ctrUrl` is not the index's `fileshp`: none
  is), 1:10 000 section, DTM tile, DBT archive and DSM element and writes `index.json`. `lucido` on
  2026-11-03: 102 CTR frames (30 of 2019, 18 of 2009), 15 CTR 1:10 000 frames, the 2010 edition of 6
  sections (234140 Fivizzano, 234150 Casola in Lunigiana, 249020 Gragnola, 249030 Minucciano, 249060
  Gragnana, 249070 Gorfigliano, 2.59–3.97 MB each), 99 LiDAR tiles (54 of lot 004, 25 of 005, 20 of
  MATTM's 006), 7 DBT blocks (Minucciano 2011 and 1988–2000, Carrara 2000, Casola 1988–1993,
  Fivizzano 1993–2000, Fosdinovo 2000, Massa 2000), 15 DSM elements, all archives named and
  answering 200, every section and DBT block CC BY 4.0, in 1,451.7 s and 135.8 MB, as the server
  answered its GetFeatureInfo 503 after about 67 s that day (14 s on 2026-10-29: the run takes the
  server's time). `pontremoli-town`: 6 CTR frames, all of 1993, section 233030 of 2010
  (5,513,771 B), Pontremoli's DBT of 2010 (52,357,541 B), 18 LiDAR tiles and 4 DSM elements, in
  234.3 s. `fivizzano` on 2026-11-04, over 1584412, 4888033 to 1601445, 4904126: 200 CTR frames (87
  of 2019, none of 2009), 35 CTR 1:10 000 frames (the 2010 edition of 13 sections), 222 LiDAR tiles
  (163 of lot 004, 8 of 005, 1 of 003 and 4 of 010, RT's, and 45 of MATTM's 006 and one 006 tile,
  23d17, whose GetFeatureInfo names no archive), 12 DBT blocks (Giuncugnano 2011, Minucciano 2011
  and 1988–2000, Piazza al Serchio 2010–2011 and 2000, Sillano 2011 and 2000, Aulla 1998, Casola
  1988–1993, Fivizzano 1993–2000, Fosdinovo 2000, Licciana Nardi 1998) and 42 DSM elements, every
  archive answering, in 39 s; lucido's again, over its tiles' box: 135 CTR frames, 21 CTR 1:10 000
  frames, 130 LiDAR tiles, 7 DBT blocks and 25 DSM elements. `fosdinovo` on 2026-11-07, over
  1578335, 4883730 to 1588962, 4894948: 119 CTR frames (52 of 2019, 14 of 2009), 18 CTR 1:10 000
  frames (the 2010 edition of 9 sections), 122 LiDAR tiles (74 of lot 004, 13 of 005 and 10 of 003,
  RT's, and 24 of MATTM's 006 and the 006 tile 23d17, whose GetFeatureInfo names no archive), 4 DBT
  blocks (Aulla 1998, Carrara 2000, Fivizzano 1993–2000, Fosdinovo 2000) and 20 DSM elements, every
  archive answering, in 28 s; and Fivizzano's again, its box grown 698 m west to its tiles' strip
  (1583714, 4888033 to 1601445, 4904126): 208 CTR frames, 35 CTR 1:10 000 frames and 226 LiDAR
  tiles.
- **`pnpm pick-sheets <part> [--write]`** keeps the 2019 sheets whose mapped area (`AZR`), clipped
  to the part's rectangles, covers a positive area, and lists the frames that meet the part with
  only older sheets. Without `--write` it prints the difference from the manifest's `ctr`; with it,
  it stores them sorted by name. `lucido`: the 25 sheets of the manifest (8.66 km² of `AZR` in the
  78 km² play area); the 5 dropped (23D02, 23D04–07) lie wholly north of it, and 24 frames meet it
  with only 1987, 1993 or 2009 sheets (22D02–15 of 2009 on the Carrara side; the 12 of them whose
  `AC_a` meets lucido, 22D02–07 and 22D10–15, are its `ctr2009`). `fivizzano`: 52 sheets (16.42 km²
  of `AZR` in its 145.82 km² play area, 24E41's 0.16 km² among them), and 36 frames that meet it
  with only sheets of 1987–2006, none of 2009, in 15.5 s. `fosdinovo`: the issue's 31 sheets, every
  one kept (7.10 km² of `AZR` in its 84.98 km² play area), and 22 frames that meet it with only
  older sheets, 9 of them of 2009 (22C08, 22C16, 22D01, 22D02, 22D09, 22D10, 23C64, 23D57 and
  23D58: its `ctr2009`), the rest of 1987 and 1993, in 9.6 s.
- **`pnpm pick-lidar <part> [--lots 004,005] [--write]`** replays `fetch-rt`'s first-wins mosaic
  (`dtm-mosaic.ts`'s reader) on a one-byte mask of the 1 m cells `fetch-rt` fills for the part. For
  a Lunigiana part those are the cells its tiles need (`partTiles`: each tile's square cut to the
  region's bounds, HALO round it, two 1 m cells a lattice cell each way as `tileCrop` takes them;
  `needMask`), and every other cell of the box round them is out of the replay, so an L's notch
  tile is never a hole; for a test region with terrain of its own, its rectangles' crop (`cropOf`),
  all of it to fill. A cell a tile file in `data/raw/rt/dtm` holds counts as written first, as
  `fetch-rt` keeps it; then every earlier part's manifest tiles write, in `PARTS` order, as
  `fetch-rt` mosaics them before the part's (those the index lists: any other lies past its box);
  then RT's tiles of the named lots, in lot order then by sheet, each kept when it writes a needed
  cell nothing wrote before. MATTM's lots are skipped, with their licence. It refuses an index whose
  box is short of `indexBox`'s, which may lack tiles over the rest. It reports the cells needed and
  held, each tile's area, the holes left for the terrain chain, and the surface model's elements
  whose index footprint meets a hole (`elementsOverHoles`), and without `--write` the difference
  from the manifest's `lidar` and `dsm2021`; `--write` stores both. Run it before the part's first
  `fetch-rt`: after that its own cells are held too, so a run keeps only the tiles a fetch would
  still take (where a grown box adds cells) and `--write` drops the rest; to pick a fetched part
  again from the start, delete its tiles' files first, as to fetch it again. On 2026-11-04 every one
  of the 79,588,544 m² lucido's 30 tiles need is held, so a run keeps none of its tiles. Its numbers
  below are from 2026-10-29, on its rectangles' crop before the tile files; on its tiles' cells
  without them they were not measured again, as 36 of its 66 archives are not in the cache and the
  run needs its index (`rt-index`), both over the network. `lucido` (19 s, 565 MB): the manifest's
  66 tiles; holes 654 734 m² in 5 pieces, the largest 361 141 m², exactly the cells `fetch-rt`'s
  chain fills; elements 249062 and 249064. `fivizzano` (2026-11-04, from the archive cache, its
  index over its tiles' box, a crop of 16,096 × 15,156 m): its 56 tiles need 185.43 km², 29.47 km²
  of them held by lucido's tile files, and lucido's 50 tiles over the crop write 8.89 km² first; of
  lot 004's 163 candidates 91 are kept, and lots 005, 003 and 010 (`--lots 004,005,003,010`, 176
  candidates) keep none more; one hole of 2.55 km² is left along the border with Emilia, centred at
  (10242, 11415), 872 × 3,307 m, under the surface model's elements 234123, 234124 and 234164. Its
  first run, over its rectangles' crop with no held cells and no earlier part, kept 130 tiles and
  left 2.57 km². `fosdinovo` (2026-11-07, `--lots 004,003,005`, 54 s): its 30 tiles need
  97.66 km², 24.00 km² of them held by tile files, and lucido's and Fivizzano's 39 tiles over the
  crop write 17.21 km² first; of the 97 candidates 32 of lot 004 are kept, and lots 003 and 005 keep
  none; one hole of 4.548 km² is left, centred at (−6629, −5574), 4,201 × 1,674 m (in play, 1.92 km²
  of Carrara, 1.83 of Castelnuovo Magra and 0.65 of Luni), under the surface model's elements
  249052 and 249053. Fivizzano's again, for its tiles' strip x −6000…−5300 that Fosdinovo's box adds
  (`--lots 004,005,003,010`, 126 s): its 56 tiles need 193.20 km², 185.44 km² of them held, and 11
  lot-004 tiles new to its manifest fill the rest, leaving no hole. `sillara`: 8 of its 13 tiles;
  one hole of 12.41 km², elements 234011–234014 and 234051. PR #2 had found its 65 tiles with a
  GetFeatureInfo grid 640 m apart, which missed `22d14` of lot 004, a 98 m wide 2010 sliver below
  Picco di Navola (19 518 m² in the crop, local x 3843–3943, y −5750…−5473) that `pick-lidar` added:
  506 heightmap nodes moved there, 474 of them under 0.5 m and none on average, up to 8.4 m on the
  steep rock face, where the 2010 and 2012 flights classify the ground differently. The `dtm10` list
  is written by hand, from the provinces the holes lie in (the 10 m DTMs have no index layer).
- **`pnpm coverage <part> [--refresh]`** (`coverage.ts`, raster in `coverage-grid.ts`) tallies, per
  comune (OSM `admin_level=8` boundaries), the part's play area (its mask, or else its rectangles)
  mapped by the manifest's 2019 sheets, by each LiDAR lot (the index footprints in manifest order,
  first wins) and by no LiDAR, and, once `fetch-rt` has written the part's terrain under every cell
  of its play area, by each source the chain took past the LiDAR (surface model, 10 m DTM, Liguria's
  DTM ed. 2023, DTM 5x5) at each cell's centre: for a Lunigiana part from the files of its tiles
  (`tileSource`: the nearest lattice cell, in the file of the tile whose square holds the centre),
  for a test region with terrain of its own from its `dtm-src.bin`. A source the chain gains fails
  the typecheck until it has a column, and `fillLayer` throws on one it does not know. It tallies
  the UCS 2019 woods (311–313, 324) against OSM's forest too, on 10 m cells counted when their
  centre lies in the play area; it stops when the manifest holds no picks yet. It prints the
  markdown table for the PR and writes `coverage.md` and `coverage.png`. `lucido`: 6 comuni
  (Fivizzano 50.62 km²); CTR 11.1%, lot 004 78.6%, lot 005 20.5%, no LiDAR 0.66 km² (0.7% over the
  mosaic's holes: the footprints' slivers and the 10 m cells); OSM marks 92.7% of the 54.69 km² of
  UCS woods as forest. From its tile files the chain's columns read the surface model on 0.02 km²
  and the 10 m DTM on 0.63 km², each of the 780,000 cells' source the build's sampler's (`loadDtm`)
  too (2026-11-04, the columns alone: the whole run needs its index and the Overpass answers).
  `fivizzano` (2026-11-04, its mask honoured, every part's LiDAR in `PARTS` order, so lucido's lot
  005 counts nowhere in it), in km²:

  | Comune | Play area | CTR 2019 | LiDAR (lot 004) | no LiDAR | surface model | 10 m DTM |
  |---|--:|--:|--:|--:|--:|--:|
  | Fivizzano | 89.92 | 10.79 (12.0%) | 89.71 (99.8%) | 0.21 | 0.04 | 0.17 |
  | Casola in Lunigiana | 25.64 | 4.29 (16.7%) | 25.64 (100%) | 0 | 0 | 0 |
  | Minucciano | 12.49 | 0.91 (7.3%) | 12.49 (100%) | 0 | 0 | 0 |
  | Sillano Giuncugnano | 11.42 | 0 | 11.07 (96.9%) | 0.35 | 0.19 | 0.16 |
  | Licciana Nardi | 4.40 | 0.43 (9.7%) | 4.40 (100%) | 0 | 0 | 0 |
  | Comano | 1.93 | 0 | 1.93 (100%) | 0 | 0 | 0 |
  | Total | 145.82 | 16.42 (11.3%) | 145.25 (99.6%) | 0.56 (0.4%) | 0.23 | 0.33 |

  Liguria's DTM and the DTM 5x5 fill none of it (Ventasso and Piazza al Serchio hold 0.00 km² of the
  play area); OSM marks 91.4% of the 111.03 km² of UCS woods as forest (108.07 km² of OSM forest).
  `fosdinovo` (2026-11-07, its mask honoured, in 252 s with the Overpass answers), in km²:

  | Comune | Play area | CTR 2019 | LiDAR (lot 004) | LiDAR (lot 005) | no LiDAR | 10 m DTM | Liguria's DTM |
  |---|--:|--:|--:|--:|--:|--:|--:|
  | Fosdinovo | 44.68 | 4.99 (11.2%) | 44.67 (100%) | 0 | 0 | 0 | 0 |
  | Fivizzano | 20.02 | 1.45 (7.2%) | 20.02 (100%) | 0 | 0 | 0 | 0 |
  | Aulla | 8.84 | 0.62 (7.0%) | 8.84 (100%) | 0 | 0 | 0 | 0 |
  | Carrara | 6.31 | 0 | 2.61 (41.4%) | 1.77 (28.0%) | 1.93 | 1.93 | 0 |
  | Castelnuovo Magra | 3.48 | 0.02 (0.6%) | 1.65 (47.4%) | 0 | 1.83 | 0.04 | 1.75 |
  | Sarzana | 1.00 | 0.02 (2.2%) | 1.00 (100%) | 0 | 0 | 0 | 0 |
  | Luni | 0.65 | 0 | 0 | 0 | 0.65 | 0.17 | 0.48 |
  | Total | 84.98 | 7.10 (8.4%) | 78.79 (92.7%) | 1.77 (2.1%) | 4.42 (5.2%) | 2.13 | 2.23 |

  Lot 005's 1.77 km² in Carrara are lucido's tiles of 2012, which count first; the surface model and
  the DTM 5x5 fill none of it. OSM marks 93.4% of the 65.41 km² of UCS woods as forest (67.23 km² of
  OSM forest; the UCS stops at Liguria's border, and the tally reads none of Liguria's land use).
  `sillara`: see [Test regions](#test-regions).
- **`pnpm ortho <x0>,<y0>,<x1>,<y1> [layer] [out.svg] [--px <m>] [--refresh]`** (`ortho.ts`,
  `ortho-wms.ts`) draws a Regione Toscana orthophoto crop (WMS GetMap in EPSG:4326, which maps
  linearly onto the local frame; 0.5 m a pixel by default, tiled past 4096 px) with the built map's
  building outlines (`monzone.bin` and its tiles joined, `wholeMap`), the `STONE_CORES` discs
  (`stone-cores.ts`) and
  each stream's water width and bed over it, for placing the hand tables. The outlines sit within
  1.8 m of the roofs on the 2010 flight (`rt_ofc.2k10`, the default) and 3.6 m on 2021's, in
  varying directions: roof lean. Its licence
  table follows the layers' metadata: a layer is traceable only when its abstract names Regione
  Toscana (or IGM-RT) as the owner and it links an RT record granting CC BY, as the 1954 flight
  (`10k54`) does. AGEA's flights (`rt_ofc.10k13` and `5k25` among them), Blom's (`10k07`,
  `2k11.aulla`), IGM-RT's 1960s flights (`10k63`, `10k65`, `10k68`) and the layers without an RT
  record (`10k88`, `2k06`, `5k12`) are look only, never traced, and so is any layer the table does
  not list (only band variants such as `.nir` or `.grey.rt` take their flight's row); the tool warns
  and marks the image.
- **`pnpm playtest shots|heap|drive`** (`playtest.ts`, its CDP client in `cdp.ts`, the drive's
  route, page script and report in `playtest-drive.ts`) drives a headless Chrome already running
  ([docs/standards/playtest.md](standards/playtest.md)) in a tab of its own: `shots <url> <outdir>
  <name>:<x>,<y>[,<texels/m>] … [map]` pins the view on each spot (dev builds only: it needs
  `window.gta`) and writes a PNG each, `map` the full map; `heap <url>` prints the first frame (the
  card's "Press any key"), the slowest and p99 frame and the JS heap after a forced GC, with `--at
  x,y` (dev builds) standing at that point once its tiles are in memory. `--date YYYY-MM-DD` (both)
  starts the game on that day, the page's clock moved there before it loads, so its snow line and
  its woods' leaves are that day's ([weather.md](weather.md#the-seasons-snow-line)), and on a dev
  build stops the clock at noon under a clear sky, settled. `shots`
  pins each spot twice: first on the coarse grid's height where its tile is not in memory
  (`gta.heightAt` falls back to it), then, 2 s later, once the view's tiles have streamed in, on the
  exact ground. `lucido`, production build, `?seed=7`, three runs on 2026-10-31 interleaved with
  main's build: first frame 0.32–0.35 s, slowest frame 16.8 ms, heap 88–89 MB (array buffers
  included; on 2026-11-03 with the UCS's woods 0.35–0.37 s and 90 MB, against 0.34–0.38 s and 89 MB
  before them), against main's 0.41–0.44 s and 123–124 MB with the vectors in the global file, where
  the whole map before the tiles took 0.92–0.98 s and 250 MB (dev build then 1.01 s and 274 MB).
  On 2026-11-04 with the season's snow and leaves (the game starting that day: snow on the high
  north faces, the woods bare above about 1200 m), seven runs each interleaved with main's build:
  first frame 0.33–0.36 s against 0.32–0.35 (one cold first load after the build at 0.66 s), heap
  89–90 MB against 88–90, slowest frame 16.8 ms in every run. Standing on Pizzo d'Uccello on 1 March
  (`--at 4210,-2454 --date 2027-03-01`, dev build, the snow down to 1384 m and every wood bare):
  slowest frame 16.8 ms in three runs, heap 100 MB, the same as main's. Lunigiana with Fivizzano
  (2026-11-04, production build of 1,237,029 B of JS, `?seed=7`, three runs): first frame 0.41 s,
  slowest frame 16.8 ms, heap 130–131 MB, against main's lucido at 0.33–0.36 s and 89–90 MB;
  standing at Fivizzano (`--at -321,8511`, dev build, two runs) 0.45–0.54 s and 160 MB. With
  Fosdinovo (2026-11-07, production build, `?seed=7`, three runs): first frame 0.41–0.47 s, slowest
  frame 16.8 ms, heap 161 MB, against main's 130–131 MB, under the 245 MB issue #18 allows; on
  #18's final code (1,036.60 kB of JS, 322.84 kB gzipped) first frame 0.40–0.41 s, slowest frame
  16.8 ms, heap 164 MB.
- **`pnpm playtest drive <url> [--port N] [--speed m/s] [--seconds s] [--route x1,y1,…]`** (dev
  builds only: it needs `gta.player`, `gta.teleport` and `gta.tiles`) runs the tile streaming at
  speed. It dismisses the title card, teleports the player to the route's start and waits until the
  tiles in memory have held still for 1 s, then each animation frame teleports the player to where
  `--speed` (40 m/s) has reached along the route, held at its end, for `--seconds` (the route's
  length at that speed). The default route is the SP59 from Monzone to Vinca, chained from the
  whole map's roads with ref SP59 (`wholeMap`: their lines are in the tiles, so the tool reads all
  102 at startup) through their shared ends, from the free end nearest the spawn and at a fork
  toward Vinca (it throws when the chain ends more than 500 m from Vinca, so a rebuild that splits
  the road fails loudly): 386 vertices, 7,937 m, 198.4 s at 40 m/s, through tiles 0_0, 0_-1, -1_-1,
  0_-2 and 1_-2. It prints one JSON line: the slowest and p99 frame, the slowest frame within 1 s of
  each tile seam the player crosses and of them all, the frames over 30 ms with where they came, the
  most tiles in memory at once, those in memory at the end and the heap after GC. `lucido`, dev
  build, `?seed=7`: the five seam crossings come at y = 0 at 7.4 s, x = 0 at 20.4 s and 29.3 s,
  y = −2000 at 87.7 s and x = 2000 at 183.7 s. On 2026-10-31, with the vectors in the tiles, the
  slowest frame was 16.8 ms and none passed 30 ms, at most 6 tiles were in memory, 4 at Vinca (0_-2,
  1_-2, 0_-1, 1_-1), and the heap there was 123 MB; main's build then had one frame of 33.3 ms and
  156 MB (two runs before, each seam at 16.8 ms at worst, one with a 33.3 ms frame off the seams,
  157 MB). On 2026-11-03, with the UCS's woods and the trees' species, the same but 124 MB. With
  Fivizzano (2026-11-04, dev build, 40 m/s, a `--route` of 19,838 m from Monzone station through
  Gragnola, over the y 3900 seam, through Gassano, Fivizzano, Casola and Pieve San Lorenzo and back
  over the x 4900 seam to Ugliancaldo's slope): 13 tile seams crossed, the slowest frame 16.8 ms at
  each and everywhere, none over 30 ms, at most 10 tiles in memory and 187 MB of heap at the end.
  With Fosdinovo (2026-11-07, dev build, `?seed=7`, 40 m/s, a `--route` of 23,797 m from Monzone
  station over the x −2900 seam to Marciaso, Fosdinovo, Tendola, Bardine and Ceserano and back over
  the y 3900 seam by Gragnola): 15 tile seams crossed (x −2000, −4000, −6000 and −8000, and y 0,
  −2000 and 2000, several twice), the slowest frame 16.8 ms at each and everywhere, none over 30
  ms, at most 8 tiles in memory and 210 MB of heap at the end.
- **`pnpm map-diff <a.bin> <b.bin> [--except <category,...>]`** (`map-diff.ts`, `map-diff-args.ts`,
  `map-diff-dense.ts`, `diff-lists.ts`) prints, category by category, what differs between two
  built maps, each a global file with its tiles in the directory of its name beside it (keep a
  build with `cp -R src/sim/map/monzone.bin src/sim/map/monzone /tmp/before/`). It joins each map
  whole (`readWholeMap` in `map-file.ts`) and compares the heightmap's grid (with the anchor its
  lookups count from where either map names one: a map grown round lucido's anchor shows only its
  grid moved) and its nodes (count, largest and RMS difference, their box), the land cover's cells,
  the coarse grid (its lattice, then how many heights and covers differ), walls (and their reach,
  lattices and counts), trees, roads, buildings, water, rail, areas, the tile list, the place, the
  name, the play area's outline (its rings as a multiset; a map built before it, issue #7, has
  none) and the baked tables (lanes, farms, lamps) and the rest, matched by id or as multisets, and
  any key it does not know as its own block; the build hash is left out, as anything else changes
  it, and so are the global file's `vectors` and `derived` (`joinTiles` drops them: the one follows
  from the vectors compared, the other from them and the bakes' code, which `bake.map-test.ts`
  checks). Order counts only for the walls of each kind and the
  trees: beside their multiset change it prints the fewest of the items both maps hold that must
  move to restore their order, and where (`walk order: 1 of 2 shared segments moved, in x …`; one
  item moved from the front of a list to its back is 1), since the physics resolves contacts in
  wall order and the trunks a query hands come in the trees' order. A tree on a spot both maps
  plant that carries another id there is a difference too (`ids: 1 of 2 trees on a spot both maps
  plant renumbered, in x …`): the id seeds its look. Buildings equal in every field but their id
  pair up first, one to one in order of occurrence (pieces sharing an id and identical copies in
  their own order), and print as one line under buildings, `ids: N of M buildings both maps hold
  renumbered, in x …`, M the buildings both maps hold the same but for the id, then the first
  3 as `renumbered building a -> b`; a farm on a renumbered building is compared under its new id.
  So a new numbering of the surveys' buildings (`survey-ids.ts`) is that block, which `--except
  buildings` accepts, not every building removed and added and 2,402 farms with them: main's lucido
  against #11's first build, whose buildings differ only in their ids, prints `ids: 5765 of 6379
  buildings both maps hold renumbered, in x -2900..4900, y -2790..3900` and nothing else, in 1.55 s.
  A building whose id and another field both changed is still removed and added. Every copy of an
  item with a copy added or removed is left out of the order, as which copy went is unknown
  (Lunigiana's walk and drive walls each hold 4 segments twice, 8 while the buildings two sources
  both map stood twice and 4 before Fosdinovo's part, and Cesena's 28 segments 2 to 4 times, 51
  extra copies; 2026-11-07). It compares two builds of the format version the decoders read, or a
  build of the version before (5: the graph, the lanes and the residents on the global file's line
  and the lines with no run-outs) with one of today: the version-5 builds of
  Lunigiana, Cesena, the L, lucido alone and the 3x against the same code's version 6 gave no
  differences (2026-11-07), and it exits 0 for "no
  differences", 1 when they differ and 2 on bad arguments, an unknown category among them, or a file
  it cannot read. `--except trees,walls` accepts those categories (the names its blocks print:
  `unhandled keys`, `top level`, `outline`, `tiles`, `heightmap`, `cover`, `walls`, `coarse`,
  `trees`, `roads`, `buildings`, `water`, `rail`, `railway`, `areas`, `barriers`, `pois`,
  `districts`, `spawns`, `graph`, `lanes`, `farms`, `lamps`): their differences are still printed,
  the last line names them as accepted, and the exit code is 0 unless another category differs.
  The shipped map against itself (two builds are byte-identical): no differences, 1.1 s; against
  main's build from before #63, joined from its global file and tiles: no differences either, so
  the cut moved every vector into the tiles unchanged (on Lunigiana, Cesena and the L test region).
- **The largest tile**: the build prints it; a tile is at most 0.7 MB gzipped (issue #3's scale
  checks for the parts, #18 and #21–#23; `src/__tests__/maps.map-test.ts` fails past it), and
  Lunigiana's largest, 2_1 (x 4000…6000 by y 2000…4000: Argigliano, Pieve San Lorenzo and its
  station), is 0.63 MB (632,249 B, 624,987 B before Fosdinovo's part; its JSON line 0.92 MB before
  gzip), and Fosdinovo's, −4_1 (x −8000…−6000 by y 2000…4000: Ceserano, Canova and the Bardine),
  0.63 MB too (627,856 B), its JSON line the map's longest, 0.97 MB; `lucido`'s alone, 0_0, is
  0.59 MB with its vectors (its JSON line 0.79 MB), where −1_−1's 0.31 MB was the largest without
  them; Cesena's largest is 0.45 MB and the L's 0.55 MB (2026-11-07).
- **The global file's JSON line**: at most 8 MB, 8,000,000 B (issue #5's `map.json` check, which
  #18 asks of its part; `src/__tests__/maps.map-test.ts` fails past it on either map): the game
  parses it with `JSON.parse` at load, so a bulk array goes in a packed section after it ([The
  global file](#the-global-file)). Lunigiana's is 2,639,642 B and Cesena's 959,338 B; Lunigiana's
  was 8,319,700 B with Fosdinovo's part before version 6 (2026-11-07).

Each part's inputs are its own files since #17 (Fivizzano, the first part after lucido), so a part
adds files and cells and moves none (`--region cesena` builds the separate Cesena map instead, and
the part tools refuse it; a [test region](#test-regions) builds from Lunigiana's inputs and fetches
none, but `bagnone-ridge`'s terrain, `pontremoli-town`'s buildings and `sarzana-town`'s terrain and
Liguria sources). `pnpm fetch-osm <part>` writes the part's own extract,
`data/raw/osm/<part>.osm.gz`, over the ground of its tiles that the earlier parts' leave it and
the ground its grown box adds to their tiles (`partGround`), so their extracts stay as pinned, as
their cells do when `fetch-rt` adds to their tiles; the build merges every part's by id ([section
1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)), so overlapping parts are
harmless. Fivizzano's, its 6 ground rectangles plus 100 m (177.90 km²; the third, its tiles north
of y 4000, split in four on HTTP 400: 9 `/map` calls), then 52 multipolygon relations whole, is
195,450 nodes, 13,346 ways and 233 relations, 3,335,726 B, in about 22 s (2026-11-04); over its
four rectangles alone it was 170,947 nodes and 2,906,965 B. Fosdinovo's, its 3 ground rectangles
plus 100 m (79.45 km²; the first, its tiles south of y 2000, split in four: 6 `/map` calls), then 25
multipolygon relations whole, is 115,713 nodes, 7,745 ways and 124 relations, 2,029,430 B, in
20.5 s (2026-11-07). `pnpm fetch-rt <part>` adds the cells
the part's tiles need to a file a tile (`rt/dtm/<i>_<j>.bin`), keeping every cell another part's
fetch wrote, and its land cover to `rt/ucs/<part>.json.gz`. A part that grows the region's box grows
the cells the earlier parts' tiles need too: Fivizzano's added 21.8 km² to lucido's (its tiles cut
to the box reach past its rectangle), so lucido's manifest took 19 LiDAR tiles and a surface-model
element more, `pnpm fetch-rt lucido` ran again and wrote those cells alone (69 s, 1.77 GB), and then
`pnpm fetch-rt fivizzano` wrote its 49 tiles of its own and added nothing to the 7 it shares with
lucido (232 s and 3.51 GB with its downloads; [section
1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)). Fosdinovo's added 7.77 km² to
Fivizzano's, the strip x −6000…−5300 of its 6 tiles i −3, and none to lucido's, whose tiles i −2
Fivizzano's box had already made whole: so `rt-index fivizzano` and `pick-lidar fivizzano` ran
again, its manifest took 11 LiDAR tiles more, `pnpm fetch-rt fivizzano` wrote those cells alone
(235 s, 2.38 GB, its land cover gaining 300 polygons there), and then `pnpm fetch-rt fosdinovo`
wrote its 23 tiles of its own and added nothing to −3_1, Fivizzano's (115 s and 2.02 GB). The build
names a tile whose file lacks a cell the box needs, so a fetch left out fails it. The part tools
above work on those cells: `rt-index` asks over the box round them, `pick-lidar` replays the mosaic
on them after the cells held and the earlier parts' tiles, and `coverage` reads the chain's sources
from the part's tiles' files. The build works a tile at a time since issue #7
([Pipeline](#pipeline)). Regione Liguria's inputs are a part's already (`data/raw/lig/<part>/`,
`fetch-lig <part>`), its DTM cropped a tile at a time round the crop of the part's rectangles
(`dtmTiles`), which holds the cells its tiles need only where the rectangles reach within the crop's
margin of the tiles' outer edges or the region's bounds stop there: for `sarzana-town`'s rectangle
as a part beside lucido, 47,467 of those 2 m cells, in the HALO bands past its tiles' north and east
edges, lie beyond every crop, so a Liguria part of Lunigiana needs `dtmTiles` taken round its tiles
first.

A part's new inputs are pinned like any other: after `pnpm fetch-osm <part>`, `pnpm fetch-rt <part>`
(and that of every part whose tiles the grown box reaches) and `pnpm map`, `pnpm pin-raw` uploads
them and the lock goes into the part's PR ([Pinned inputs and CI](#pinned-inputs-and-ci)).

### What growing a region changes

A part grows the built terrain's box, and a box grown west or south of the region's anchor moves
the grid's first node: what the build and the game measure from the anchor keeps its bits, and
what is fitted over the whole box, or cut at the box's edge, does not. Each part was measured so in
two pairs of builds, what its code alone changed and what its presence changes in the earlier
parts' rectangles, and the 3x test region shows a box grown beside lucido before a part plays.

#### Fivizzano (issue #17)

Fivizzano's code and presence moved lucido's map by these. When Fivizzano joined lucido
(issue #17), `pnpm map-diff` compared three builds of 2026-11-04: main's lucido (at ca52d42), lucido
alone at #17's code (Lunigiana's parts cut to lucido, so it reads lucido's extract alone, where the
`lunigiana-lucido` test region also reads Fivizzano's and names 6 more roads from it: [Test
regions](#test-regions)) and Lunigiana grown. The first pair shows what the code alone changed on
lucido, each a fix the new part needed and made for every part; the second what Fivizzano's
presence changes in lucido's rectangle.

The code alone (main's lucido against lucido alone):

- **Parked spots**: a spot is kept by the hash of its own place (`KERB_SHARE`, [section
  12](#12-trees-spawns-districts-treests-spawnsts-districtsts)), not cut from a count of the whole
  map's candidates: 702 of the 808 spots moved, once (807 are left), so that a later part moves none
  but along its seams.
- **The Aulella's calibration**: the 161 km² from beyond lucido (`AULELLA_OFF_MAP`) are gone, as
  Lunigiana's box holds the Aulella's catchment but the Rosaro's heads; those 14.7 km² come in at
  (3528, 13000), which lucido alone does not reach, so its Aulella carries its own D8 area alone
  ([section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)).
- **Culverts and road tunnels**: the culverts under CTR rail bridges stay open streams (the Canale
  della Selva's and stream 810591045's: 2 water pieces more), the bridge over the Canale della Selva
  grows from 22.0 to 25.8 m, and the road tunnels' mouths open at their approaches' level: 91
  heightmap nodes move, up to 6.9 m and 1.77 m RMS over them, with 11 walk, 19 shore and 7 drive
  walls added and 18, 22 and 7 gone, 2 land-cover cells by the Canale della Selva's channel and 4
  buildings' height or floor and 2 roads' z by 0.1 m.
- **Lanes**: 35 of the Carabinieri car's lanes and 3 of the Panda's change (`bakeLanes`).
- **Districts**: Fivizzano's 7 landmark discs are listed, as the landmarks are not cut to the play
  area.
- **Bells**: each tower's hour-strike lag (up to 6 s, `TOWER_LAG`) is hashed from its building's id
  (`Bell.seed` in `src/audio/places.ts`), not from its place in `derived.bells`: all 27 of lucido's
  towers change their lag once, by 0.04–4.69 s (Monzone's, at (−32, −59), from 0.01 to 4.70 s), so
  that a later part, which lists them in another order, changes none.

Fivizzano's presence (lucido alone against Lunigiana), in lucido's rectangle:

- **The place** (`placeFrom`, fitted over every node the listed tiles hold): the floor goes from
  230.3 to 213.6 m and the downslope from 2.127 to 2.982 rad, and the weather with them
  ([weather.md](weather.md)).
- **The terrain**: 9,422 of lucido's 4,879,451 nodes move, up to 12.3 m and 0.85 m RMS over them,
  all in x −2864…4900, y 0…3900: 5,242 within 300 m of the seams; along the rail, whose whole line
  is fitted again (up to 1.9 m); along the roads the seams no longer cut (up to 4.7 m); and a bank
  by the Aulella the SR445 claims (12.3 m at (416, 3072)). 42 land-cover cells by the north seam
  change (y 3078…3898). That bank was the SR445's chain cored at its widest piece's width, which
  #18's review ended ([section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)):
  measured since against `lunigiana-lucido`, which reads Fivizzano's extract too, so only roughly,
  Fivizzano's presence moves 3,745 of lucido's nodes, up to 6.5 m at (−1524, 3724) and 0.65 m RMS,
  in x −2864…4900, y 0…3900, 1,928 of them within 300 m of the seams and the other 1,817, up to
  1.5 m, along Monzone's rail line and the roads at its crossings, all fitted again (2026-11-07).
- **Walls**: the walk and drive broad phases' corner moves 2,400 m west with the box (x −2900 to
  −5300, `walls.lattice`), so 928 walk and 1,042 drive segments both maps hold come in another
  order, and walls change along the seams, where the outline walls go.
- **Lines and buildings across the old edges**: the roads, water and rail the seams cut are whole (8
  of lucido's road pieces and 3 water pieces, the Torrente Rondonaia's and two of the Aulella's,
  join their parts past them), the Aulella's river polygon by the Tassonaro too, and 108 water
  pieces change, most of them their catchments, as what drains across the old edges counts. 5 of
  lucido's buildings go (OSM's 700764389 and 4 CTR units across its west edge, which the box no
  longer clips: kept whole or dropped by their centre) and 73 change their floor or height
  (700768027's floor 258.2 → 256.2 m).
- **Parked spots and lanes**: 20 of lucido's spots go and 22 come, all within 341 m of the seams,
  and 17 more keep their place with another rest or truck flag; the truck's lanes follow the graph's
  loops through Fivizzano's roads.
- **Trees**: 556 more stand in the 1 m strip along lucido's old box edges, which the scatter kept
  clear, and 16 of lucido's go or move, 13 of them within 10 m of those edges.
- **Tiles**: 12 of lucido's 30 change their `zmin` or `zmax`, those along its sides and north edge
  whose land past its rectangle the box now holds.
- **Owls, ambience and bells**: the owls' 500 m squares and the 32 m ambience blocks count from
  the anchor, so 212 of lucido's 216 owls keep their spot and every block its cells and shares (the
  box grew 2,400 m west, 75 blocks, so counted from its corner they would have lined up too, but
  not for a part that grows it by other than a multiple of 32 m); all 226 of its farm dogs keep
  their spot. Lucido's 27 towers take new places in `derived.bells` (Equi Terme's from 0 to 3), as
  the build lists the bells in the whole map's building order, but each keeps its hour-strike lag,
  hashed from its building's id ([audio.md](audio.md)).
- **The terrain's colours**: the ground's colour patches and stripes count from the anchor (`shade`
  in `src/render/terrain.ts`), so lucido's ground keeps its look: none of the 89,600 terrain faces
  within about 400 m of Monzone station changes colour against main's lucido, whose box corner is
  the anchor too, where counting from Lunigiana's box corner would recolour 30,145 (34%).
- **The railway**: the line runs on to Pieve San Lorenzo and Rometta, with 5 stations, 7 crossing
  boxes and 9 platforms (3, 5 and 5 on lucido alone) ([section
  9](#9-the-railway-railwayts-platformsts-rail-clearts)).

The fixes to Fivizzano's own inputs that followed (its extract over its tiles' ground, the DBT's
larger copies, the Rosaro's measured heads) move nothing in lucido's rectangle (`pnpm map-diff` from
the build before them, 2026-11-04). Past it, 7 OSM buildings by the Carpinelli road go, with the
walls round them, and 2 DBT units there come whole, Minucciano's copies in place of Giuncugnano's
cut ones; 2 farms go; 13,446 trees go and 190 come beyond the play area, where the new extract
brings roads, buildings and water; 24 land-cover areas come and 2 go (residential 2, cemeteries 3,
quarries 3, rock 2, car parks 6, forest 4 and others), all beyond the play area but the paving by
those buildings, drawn larger (929 → 1,137 m²); 19,234 land-cover cells change (and the 75 of the
coarse grid's 75,250 nodes that sample them), 13 of them in the play area by those buildings, in x
7250…7278, y 3966…4094: 10 the larger paving takes and 3 within 3 m of the buildings that go,
which lose their paving; the Rosaro from its entry and the Aulella below its mouth carry 11.5 km²
less; and 8 heightmap nodes beyond the play area move up to 0.9 m, under a pond at (5390, −3000)
carved to its level, where the new extract brings OSM's (way 1179811014, 201 m²) and the land
cover's water body there (211 m²) gives way to it, and the place's downslope, fitted over every
node, with them (by 2.8 × 10⁻¹¹ rad).

#### Fosdinovo (issue #18)

Fosdinovo's code and presence moved the map of lucido and Fivizzano's part by these. `pnpm
map-diff` compared three builds of 2026-11-07: main's Lunigiana (at 8f9baa5), Lunigiana at #18's
code without Fosdinovo's part (`PARTS` less it, on the same `data/raw`) and Lunigiana grown. The
code alone was measured on #18's code before its review, whose fixes moved the map again (each
against the build before it, below); the presence again on its final code, Lunigiana without
Fosdinovo's part built with `region.ts` edited in memory by a module hook. The
part grows the box 6,200 m west, a length no multiple of the walls' 16 m cells nor of the render's
128 m chunks, and makes two of the earlier parts' edges seams: lucido's west side north of
Carrara's cut and Fivizzano's south side west of lucido. Fivizzano's west side, x −5300 north of
y 3900, stays an edge of the play area, now inside the box.

The code alone (main against Lunigiana without Fosdinovo's part):

- **Walls**: the arch corridors are carved 0.25 m wider through a footprint, and a footprint a
  corridor reaches by less than a cell is carved too ([section
  10](#10-collision-walls-wallsts-parapetsts-deck-wallsts)): 1,246 walls of each kind, walk and
  drive, come and 1,341 go, in x −5052…9863. The guard rails' rule moves no wall there: no rail
  but Tendola's, in Fosdinovo's part, meets a drivable road's middle.
- **Lanes and traffic**: 17 of the Panda's lanes, 19 of the Ape's and 22 of the Carabinieri car's
  change, most of them in Gragnola's borgo (x −1810…−1540, y 3310…3580), where those walls moved,
  and one traffic edge comes, at (9400–9410, 5331–5352).
- **Catchments**: the water beyond the play area is burned and the entries keep their ground
  ([section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)): 67 of the
  2,079 water pieces change, 589 values in all, most by what comes in at the edges: the Fosso della
  Ruota, coming in at x 6700, carries its 2.72 km² from beyond from its first sample (0 before),
  the Fosso di Mandria 0.19 and the Canale della Scolosa 0.17; the rest move by 0.11 km² at most.
- **Districts**: Fosdinovo's 4 landmark discs are listed, as the landmarks are not cut to the play
  area.
- **Fosdinovo's sheets, read without its part**: they lie in `data/raw/rt/ctr` with the others, and
  the build reads every sheet there whatever the parts (`ctrRecords` in `ctr.ts`), so their road
  surfaces add 115 paved areas beyond the play area west of lucido (x −5300…−3592, y −6100…2794),
  with 796 of the land-cover cells there and 3 of the coarse grid's nodes, and 24 trees come and 66
  go there.

Fosdinovo's presence (Lunigiana without Fosdinovo's part against Lunigiana), in lucido's and
Fivizzano's rectangles:

- **The place** (`placeFrom`, fitted over every node the listed tiles hold): the floor goes from
  213.6 to 162.3 m, the lowest listed node now 18.1 m on the Magra plain by Sarzana, and the
  downslope from 2.982 to 2.918 rad, and the weather with them ([weather.md](weather.md));
  `REFERENCE_PLACE` follows, 162 m and 2.92 rad.
- **The terrain**: 869 of lucido's 4,879,451 nodes move, up to 13.3 m and 1.09 m RMS over them,
  all in x −2900…−2368, y −4868…3652: 471 within 300 m of its west edge, where the roads and
  streams the edge cut run on (145 on the edge itself, the 13.3 m at (−2900, −3212) among them),
  and the other 398, up to 2.5 m (0.68 m RMS), along Via San Rocco (498819412, 700763279,
  542549806, 80377931) and via Botteghino (719407874, 542549804, 498819410) by Viano, whose
  junctions are fitted again now that 719407875 runs whole to x −3277 (Via San Rocco's from 498.1
  to 500.4 m, via Botteghino's from 389.4 to 390.6 m). Nothing moves on the Strada comunale per
  Campo Cecina: on #18's code before its review 6,746 nodes moved, 0.86 m RMS, out to x −588, 3,479
  of them along that road, as Fosdinovo's 8.4 m 519669896 joined onto its chain widened its core
  ([section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)).
  67 of Fivizzano's nodes move, up to 2.3 m at (−3288, 3900): 26 on its seam y 3900 west of
  lucido (x −5260…−3288), the other 41 within 32 m north of it (y 3904…3932); and 3 land-cover
  cells change, at lucido's west edge.
- **Walls**: the walk and drive broad phases' corner moves 6,200 m west with the box (x −5300 to
  −11500, the drive walls' from (−5301.4, −6101.2) to (−11503.5, −6102), `walls.lattice`), half a
  16 m cell past whole cells, so 2,065 walk, 2,276 shore and 5,195 drive segments both maps hold
  come in another order (2,529, 2,276 and 5,212 before the review), and walls change along the old
  edges, where the outline walls go.
- **Lines and buildings across the old edges**: 31 of lucido's road pieces become 22, whole across
  its west edge (the SP10 di Tenerano, 260987317, and Via Provinciale by Campiglione, 175092604,
  among them), its 19 water pieces there 13, and Fivizzano's 10 across y 3900 west of lucido 5. 18
  of lucido's buildings by Viano (x −2450…−2369; 21 before the review) change their floor or
  height where the ground moved (the Centro Sportivo Italiano di Viano's height 6 → 5.8 m), and on
  Fivizzano's west edge, which the box no
  longer clips, 3 CTR units come whole and OSM's 700763582 goes, kept or dropped by the centre of
  the whole. 66 areas along that edge give way to 43 the new box clips, the one forest whose box
  spans the bounds (area 879) runs on into Fosdinovo's part (113 rings, 92 before), and the 2 river
  polygons keep their rings but take new `waters` indices. 19 water pieces of the two parts change
  their catchments, most by what now drains in from beyond: the Aulella leaves with 199.4 km²
  (199.0), the Canale di Moncigoli's head west of x −5300 in the box, and the Torrente Arcinasso and
  the Fosso della Cavana move by 0.05 km² at most.
- **Districts**: two of lucido's discs change, as the buildings each place node takes change by
  the old edge: La Traggiara's r from 320 to 250 m, Vezzanello's from 200 to 210 m.
- **Parked spots and lanes**: 15 of lucido's spots go and 15 come, all along Via Provinciale
  (175092604) by Campiglione, x −2387…−2273: its candidates, every 3 m from the way's start, moved
  when the edge stopped cutting it. 7 more keep their place with another rest, where the ground
  moved, all on Via San Rocco by Viano (x −2487…−2388; 15 before the review, by Viano and on the
  Campo Cecina road). The 7 traffic edges at the old cut ends
  go, and the truck's lane changes on 394 of the old traffic edges, all in x −2887…−1164, y
  −60…1307, as the graph's loops run on through Fosdinovo's roads.
- **Trees**: 198 more stand within 1.5 m of x −5300, the box's old west edge, in the 1 m strip
  inside it the scatter kept clear, and none of lucido's or Fivizzano's go or move.
- **Tiles**: 8 of the 79 change their `zmin` (and −3_1 its `zmax`, by 0.1 m): −2_−2 and −2_0, whose
  lowest nodes now lie in their strip x −4000…−2900, which Fosdinovo's water and roads carve, and
  Fivizzano's column i −3 (−3_1 to −3_6), whose lowest nodes now lie past x −5300, the box's old
  edge (−3_2's from 105.3 to 101.0 m).
- **The coarse grid and the chunks**: the coarse grid starts at x −11520, not −5312, with 347
  columns, not 250; the render's terrain chunks count from the box's west edge less the 192 m apron,
  so every chunk's square moves 56 m (6,200 m is 48 chunks of 128 m and 56 m), while the ground's
  colour patches count from the anchor and keep their look (`terrain.test.ts` finds its wooded
  chunk by its cells, not its middle).
- **Bells**: all 84 towers keep their bell, and Fosdinovo's part adds 25.
- **The railway**: no rail runs in Fosdinovo's part, so the line keeps its pieces, stations and
  crossings, but Rometta's terminal, on the box's edge without the part, now has its box's terrain
  past it, and runs on along OSM's track there ([section
  9](#9-the-railway-railwayts-platformsts-rail-clearts)): a run-out writes the ground beyond the
  play area along the track OSM maps on past a terminal, so a part that leaves a terminal on an
  inner edge carves its rail bed there. Rometta's moved 1,055 of Lunigiana's nodes when it came in
  (`pnpm map-diff` against the build before it), all beyond the outline in x −6000…−5304,
  y 4260…4632, each within 12.2 m of the stored run-out, up to 8.5 m (a gully 20–40 m past the
  terminal, now under its bank) and 1.047 m RMS over them, and 6 of the coarse grid's nodes; no
  node in play moved, and Cesena and the L did not change.

On the other maps the code alone moves less. On the L test region (main's against #18's): road
1002673816's cut at its notch's side, which no longer repeats a vertex (its cap 0.77 m on), 6
heightmap nodes by 0.1 m beside it (x −8…8, y 1904…1924), the walls, 13 water pieces' catchments by
0.01 km², the lanes, Fosdinovo's 4 landmark discs and the 2 street names Fosdinovo's extract gave
it, which the review's address rule took away again ([Test regions](#test-regions)). On Cesena:
the walls round its arch corridors (2,085 come and 2,208 go), the lanes, and the Cesuola's
1.74 km² that now drain to the Savio ([section
6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)).

The review's fixes are code changes of their own, made for every part, each measured against the
build before it (`pnpm map-diff`, 2026-11-07):

- **Each road piece cored at its own width** ([section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts))
  moves far more than Fosdinovo's seam: 209,141 of Lunigiana's 26,392,176 heightmap nodes, up to
  34.8 m and 0.868 m RMS over them (147,178 by 0.5 m or less, 36,462 by up to 1 m, 19,886 to 2 m,
  4,952 to 5 m, 575 to 10 m and 88 more), almost all banks beside roads that a wider piece
  elsewhere on the chain had cored or filled. 203,888 of them come nearer the uncarved LiDAR, the
  bank over the SP59 at (52, −292) by 15.2 m among them, but not all: 30 nodes, all between a road
  and a water, end more than 5 m farther from it, as the second carve lowers every node no core
  owns and a narrower core leaves a water's trench room (the SP52's shoulder at (9628, 5660),
  −34.8 m, the worst: [Known data limitations](#known-data-limitations)). Every profiled road
  keeps its line and z; 104 paths and 16 steps change z, by up to 2.8 and 1.7 m, as they follow the
  ground; 2,280 buildings change their floor or height, 1,191 parked spots their rest, 339 lamps
  and 166 water pieces their floor; 18,804 walk and 17,056 drive walls come and 20,325 and 17,870
  go; 820 of the coarse grid's nodes move; Pieve San Lorenzo's platform loses 0.4 m at its west
  end; the ground under the decks loses 67 of its lowered nodes; and the bores' wall triangles
  follow the ground by their mouths. Cesena's terrain moves at 671 nodes, up to 3.8 m, the L's at
  14,293, up to 13.2 m. The build takes 124.8 s, against 124.4 s, and the grid stage ends at
  2,176 MB, against 2,174 MB. The `profiles.test.ts` checks fail with every piece cored at its
  chain's widest.
- **The rail's run-outs** (section 9): Rometta's 1,055 nodes beyond the outline (above) and the
  line's run-outs; on Cesena and the L, whose terminals lie on their boxes' edges, no difference.
- **The graph, the lanes and the residents in packed sections** ([The global
  file](#the-global-file)): no difference on any map, the global files 1.25 MB on Lunigiana, from
  2.21 MB, and 0.40 MB on Cesena, from 0.62 MB.
- **One copy of a building two sources map** ([section 3](#3-features-featurests)): 53 buildings
  go, with 358 walk and 358 drive walls, and 6 trees grow in their place: on lucido 11 of OSM, on
  Fivizzano's part 15 of OSM and 3 of the DBT, on Fosdinovo's 19 of OSM, 2 of the NC5 and 3 ruin
  rings, with 9 farms and 12 parked spots; 3 district discs in Fivizzano's part shrink with them
  (Pò's r from 120 to 110 m, Posara's from 320 to 310, Pratolungo's from 300 to 270). The L and
  lucido alone lose the same 11 OSM buildings, and Cesena, which has no survey, nothing; the
  build's features stage takes as long as before (8.5 s into Lunigiana's build).
- **No `building=no` or `building=roof`**: 4 buildings go (the restaurant compound by Canepari, a
  pool's pergola there and two canopies in Fivizzano's part, 622849759 and 622851417), with 31 walk
  and 31 drive walls, 2 lamps on their walls and 4 land-cover cells; 11 trees grow in the
  restaurant's grounds, and the Carabinieri car's lane past 622851417 moves from 0.25 to 0.5 m off
  the centreline. Cesena loses its 2 roofs and 108 walls of each kind; the L, lucido alone and the
  3x nothing.
- **The Torrente Pesciola a wooded torrent**: its 21 ways go from 4 to 6 m wide, their bed from 3
  to 4 m and their depth from 1 to 1.5 m, and 24 tributaries' floors move at their mouths; 5,138
  terrain nodes are carved anew along it (x −6604…−5408, y −1828…1376), up to 6.7 m and 0.66 m RMS,
  with 613 land-cover cells, 4 roads' z by up to 0.8 m where they cross it, and 191 trees off its
  banks (7 more stand); the 3x, whose terrain holds the Pesciola beyond its play area, loses 183
  trees, and Cesena, the L and lucido alone nothing.
- **An address names only the road it stands by** ([section 3](#3-features-featurests)): only
  roads differ. On Lunigiana 693993316 and 698929404 lose their names; on the L 6 ways (12 pieces)
  and on lucido alone 14 (22 pieces) lose the names voted from beyond their edges; on Cesena 18
  ways change: 5 lose names voted from 61–286 m off (Via Gianni Rodari, Vicolo Cerchia, Via
  Falconara, Via Emilia Ponente, and Via Emilia Levante on 1027495734), 695751893 takes Via San
  Cristoforo, and 12 contested ways go to the street with more votes for them (587877842 to Via del
  Mare's 26, not Via Puglie's 2).

#### Beside lucido: the 3x test region and a notch

The 3x test region grows the box but not the play area, which stays lucido's: it shows what a part
changes beside lucido before it joins the play. Measured against lucido alone on 2026-11-04, with
the real terrain Lunigiana's grown box gives the 3x past lucido ([Test regions](#test-regions)),
and its place, catchments and areas again on 2026-11-07, with Fosdinovo's tiles west of lucido:
`node src/tools/build-map.ts --region lunigiana-lucido` and `--region lunigiana-3x`, then `pnpm
map-diff test-maps/lunigiana-lucido.bin test-maps/lunigiana-3x.bin`, as the shipped map is no
longer lucido:

- **The same to the bit**: every terrain node in lucido's rectangle, the land cover more than 50 m
  in from its edge, the lamps, water beds and parked spots' rests the bake makes
  (`x3-region.map-test.ts` checks these), and the roads, rail, railway (its platforms all in play,
  `x3-region.map-test.ts`) but its line's run-out, POIs, graph, lanes, lucido's trees (each with
  its id) but 2 and the coarse grid's nodes in lucido's box. Lucido's east terminal (4900, 3609.4),
  on lucido alone's box edge, runs on along OSM's track on the 3x, 7,895.0 m east past Pieve San
  Lorenzo to its box's edge, its bed written beyond the play area alone ([section
  9](#9-the-railway-railwayts-platformsts-rail-clearts)). The 2 trees (ids 155837518 and 155853902, at (4899, 3228) and
  (4898, 3240)) stood within 2 m of the east edge, 1.2 m from the bed of the Torrente Rondonaia
  (way 788514322), which on the 3x runs on past the edge and keeps trees off its bed there as in
  play (`clipBeyond`, [section 12](#12-trees-spawns-districts-treests-spawnsts-districtsts)). The
  DTM's projection lattice, the build's grid lookups, the game's (`heightAt`, `terrainZ`,
  `coverAt`) and the land cover's raster count a point's cell from the anchor ([section
  5](#5-heightmap-dtmts-terraints), [The global file](#the-global-file)). Counted from the box's
  corner, as they were before, the heights of 25 buildings, 22,698 water-bed values, 133 lamps and
  the rests of 664 parked spots differed in their last bits, and 3 land-cover cells 0.8–3.6 km in
  from the edge, where an area's edge passes a cell's centre to within a few ulps.
- **The place** (`placeFrom`) is fitted over every node of the built terrain the listed tiles hold
  (all of the 3x's): the 3x's floor is 180.8 m and its downslope 2.066 rad against lucido alone's
  230.3 m and 2.127 rad (210.9 m and 2.004 rad before Fosdinovo's tiles), and the weather moves with
  them ([weather.md](weather.md)).
- **The catchments** route D8 over the listed tiles' nodes, the grid's edge the outlet, so what
  drains across lucido's edge from the land beyond counts, and the water beyond lucido is burned
  with its own ([section 6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)): 53
  of the 583 water pieces gather other areas, 2,130 values in all, the Torrente Tassonaro's most,
  its heads past lucido's east edge (0 → 19.68 km² at its first sample, (4900, 3524.4); 68 pieces
  and 0.13 → 18.36 km² before the water beyond was burned).
- **Tiles**: the 10 tiles along lucido's west and east edges whose lowest or highest node now lies
  past them, on the real terrain there (-2_-4 to -2_1 and 2_-3 to 2_0), change their `zmin` or
  `zmax`.
- **Buildings across the edge**: on lucido each is clipped to its box and kept by the centre of what
  is left; on the 3x the box reaches past it, so it is kept whole, or dropped, by the centre of the
  whole. 9 change and 9 go, none reaching more than 19.2 m in from the edge, but no parked spot
  goes with them: a spot is kept by its own place's hash (`KERB_SHARE`), and both keep the same 805
  spots in the same order ([Test regions](#test-regions)). 2 farms go too (6 more keep their farm on
  their whole building), the paving in front of them (6 land-cover cells within 6 m of the edge) and
  10 m of a district disc of Argigliano's (r 120 → 110 m).
- **The walkers' residents** count the homes within 60 m of a walk edge's midpoint (`EDGE_REACH`),
  so the buildings across the edge change them near it: 13 of lucido's walk edges along its west
  edge, their midpoints up to 54.5 m in, 7 of them crossing `PEOPLED`.
- **Areas across the edge** are clipped to the box, not the play area, so on the 3x 87 run on
  whole past lucido's edge (64 of them forest) and 4,703 more lie beyond it (84 and 2,140 before
  Fosdinovo's tiles). A cut is rounded to 0.1 m, which moves the cut edge by up to 5 cm; the 6
  land-cover cells that differ are all the paving above.
- **Water areas across the edge**: a lake the box cuts takes its level from the nodes inside it,
  and a river polygon the waterways that run through the part of it inside, so a part that carries
  one on whole may move its level or its river: the river polygon by the Tassonaro's mouth, cut at
  lucido's north edge, follows the Tassonaro's tail, and whole with Fivizzano the Tassonaro and its
  tributaries, the Aulella running 122 m west of it. None lies across an edge the 3x grows.
- **Walls**: a cell's slope reads the nodes up to 8 m round it, and on lucido those past its edge
  are the edge's own (clamped), so the steep cells along the edge differ, and a loop of blocked
  cells that takes one in is traced and simplified anew along all its length: walk walls differ up
  to 396 m in from the edge, drive walls 104 m and shore walls 26 m, and 590 walk and 362 drive
  walls both maps hold come in another order (593 and 355 before #18's review) (a loop that changed
  starts elsewhere). The walk and drive broad phases start at the lowest corner of any of their
  walls (`walls.lattice`), which a
  building kept whole past the edge moves (to x −2917.3 on the 3x), so every wall may fall in
  another 16 m cell and a query may hand them in another order; the trees' corner is the region's,
  fixed for good.
- **The coarse grid** covers the box: its nodes past lucido's edge (x −2944 and 4928) read the
  land there, where lucido's read its edge.
- **A notch**: where a part's rectangles leave tiles of the box off the list (#17's and #18's grow
  Lunigiana's box to x −11500…10600 by y −6100…13000, 30 of its 132 tiles unlisted in two notches),
  the build reads
  no terrain ([Pipeline](#pipeline)): the place leaves those tiles out, and the catchments and the
  walls' slopes stop at the notch's sides as at the box's edge. Measured on the L test region on
  2026-11-04 against its build from main at ca52d42, which still worked the notch's 2 tiles (`pnpm
  map-diff`): its listed nodes, land cover, coarse grid, tiles' `zmin` and `zmax`, trees, roads,
  buildings, rail, areas, railway and baked tables, and its water but the catchments, are the same
  to the bit. Its place moves, the floor 179.4 → 173.1 m and the downslope 2.517 → 2.630 rad. Its
  catchments lose what the notch drained into them: 25 of its 136 water pieces, 743 of their 8,079
  values, the Torrente Aulella's most (166.52 → 161.29 km², the 161 from beyond the map included:
  it comes in from Codiponte, in the notch), Il Canalaccio's 0.23 → 0.01 km² and the Canale della
  Selva's up to 0.11 km². Its walls move within 16 m (walk: 12 added, 19 gone) and 34 m (drive: 99
  added, 102 gone) of the notch's west side, where a cell's slope reads the leg's edge extended in
  place of the notch's ground.

## Known data limitations

- **Cesena's footbridges and two of its tunnels stand too near the ways they cross for the level
  check.** Paths and steps are not profiled, so a footbridge runs straight between its ends at the
  terrain's level
  ([section 7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)):
  within 4 m of where they cross, 57046028 stands 2.17–2.34 m over Viale Europa and Via Arturo
  Carlo Jemolo at (−296, 563) and 2.18 m over the path beside them, 137735218 and 137735231 1.90
  and 1.68 m over Via Riccione at (−684, 470) and (−687, 485) and 1.09–1.64 m over the Ciclovia del
  Savio and Via Riccione's footway at (−680, 471), (−663, 477) and (−665, 492), and the Passerella
  dell'Ippodromo 23775268 2.27 m over the path under it at (−683, 1001); the path bridge 683510421
  even lies 0.72 m under the Sottopasso Cervese, the path it crosses at (763, 629). The pedestrian
  underpass 69488617 runs 0.68 m under Via Giuseppe Di Vittorio at (−1243, 440), and the car park
  ramp 68296970 stays at its square's level, 0.24 m over Via Piazzale Sanguinetti at (586, 579).
  Within 2 m the level rule takes the two ways for one level: from the footbridges over Via
  Riccione, or the underpass under Via Giuseppe Di Vittorio, a person can get into a car on the road
  under or over them, and a car on the road brakes for someone on the footbridge over it or in the
  underpass under it, can hit them, and they run from it; on the footbridges and the paths under
  them people step apart as if they met (`levels.map-test.ts` lists each crossing by its two ways'
  OSM ids).
- **Pieve San Lorenzo's underpass meets the road out of one mouth a step over its floor.** The
  underpass under the station (756577583) lies level at 350.6 m to its mouth at (5040, 3634), where
  the road out of it, 1191727402, starts 0.9 m higher, as that mouth opens
  ([section 7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)),
  and climbs with the terrain to 352.6 m 2 m on. A driver in the underpass reads a car standing just
  past that mouth off its level and does not brake for it (`joints.map-test.ts` lists the joint by
  its two ways' OSM ids).
- **The olive groves and vineyards are the land cover's of 2019, abandoned ones included.** On the
  2023 orthophoto (2026-11-07) many of the UCS's olive groves round Gragnola are groves going back
  to wood or to oak-dotted pasture, and of 115 ha it draws under OSM's forest 44% is closed wood:
  the map grows olives there all the same, in rows, never a grove half taken by the wood. Of its
  vineyards checked, about half the area is still worked; the rest is grass, scrub or young wood,
  and where vines and olives share a polygon (0.6 ha of olives in a vineyard at (299, 7058)) one
  kind takes it all. One of OSM's orchards with no `trees` tag, 699008679 at (−1009, 7805), is a
  young fruit or nut orchard, which the height rule makes an olive grove. The olives stand on one
  7 m lattice, where the tended groves stand about 6 m apart and the old ones 7–8, and their rows
  follow no terrace (the ground's bare strips do).
- **The terrain is 4 m.** The LiDAR resolves 1 m (stored at 2 m), but the game grid averages it over
  4 m cells: terrace walls, steps and narrow road benches are smoothed into slopes. Slopes come from
  a 12 m baseline. The LiDAR is from 2010 (2012 on the Carrara side), so earthworks since then are
  missing: the quarry floors of the Sagro and Solco basins have moved since, and the OSM and UCS
  quarry outlines (2019–2026) do not match the terrain cut there. The datum residual is fitted on
  the 2010 flight; the 2012 tiles agree with it within about 0.2 m of elevation, but their
  horizontal fit is not checked (the 2009 sheets' buildings stand there, but nothing has matched
  them against the 2012 flight's surface model). The cells no flight covers ([section
  1](#1-sources-osmts-ctrts-dbtts-nc5ts-ctr-railts-shpts-ucsts-crsts)) are smoother: the 10 m DTM's
  (0.63 km² of lucido, south of Tenerano and round the Cava Bardiglio, and 0.33 km² of Fivizzano's
  0.56 km² without LiDAR, along the border with Emilia in Fivizzano's and Sillano Giuncugnano's
  comuni, where the surface model holds the other 0.23 km², and 2.13 km² of Fosdinovo's 4.42 km²
  without LiDAR, in Carrara, Castelnuovo Magra and Luni, where Liguria's DTM holds the other
  2.23 km²) misses the small relief and shows its
  own 10 m creases, and the bend carries the LiDAR's relief only 50 m in, so a gully or a rock face
  the LiDAR shows ends against the fill: where a face under the Rocca di Tenerano meets it, at
  (−1272, −2660), the 2 m cells step up to 5.3 m (5.2 m with the fill before the chain); under
  Fivizzano's ridge, at (9808, 10444), the LiDAR's strip ends on a rock band the 10 m DTM past it
  lacks, and the game's 4 m grid steps 2.03 m at the seam (`terrain-seams.map-test.ts` excuses it).
  The surface model's cells are the ground of 2021, a decade after the LiDAR, and its canopy filter
  takes any bump or pit narrower than 9 m and 0.7 m high or deep for a tree or a failed match, the
  relief of bare rock included, and, in its second pass, a few metres of ground round what the first
  cleared: on the Bagnone ridge it keeps 45% of the pastures and 22% of the bare rock without LiDAR,
  and the bent 10 m DTM fills the rest, Monte Sillara's summit included. A wood wider than the
  square whose canopy is smooth all over would still stand as ground: the filter clears a wood by
  its rough crowns, and the second pass its edge.
- **Liguria's sources are coarser than Tuscany's** (issue #12; Fosdinovo's part's in Castelnuovo
  Magra, Sarzana and Luni, 561 of its buildings and 2.23 km² of its terrain, and the Sarzana test
  region's).
  Its DTM ed. 2023 is a 5 m grid of whole metres interpolated from the NC5's 1:5000 restitution,
  3.00 m RMS from the 2010 LiDAR where both cover the test region's mosaic (0.34 km², the DTM 0.54 m
  lower on average; 1.33 m RMS on ground under 3% steep), smoothed between its metres, so a terrace
  wall or an embankment a few metres wide is a slope there. Within about 1 km of the LiDAR the chain
  bends it onto the LiDAR (0.87–0.94 m at the median within 250 m), while the NC5's eaves stay in
  its own frame, so the buildings there stand that much shorter. It lies about a metre over the
  minor buildings' foot: their eaves stand 1.11 m over it at the median, where over the LiDAR's
  ground they stand 2.23 m, so 793 of the test region's 1,299 sheds take their default 2.5 m. The
  NC5's carriageways are all paved, as no field of theirs gives the surface, and unnamed, and a road
  with no carriageway has no surface (its road areas, `L6861`, are not read, where the DBT's fill
  in); its bell towers may be coded churches (Sarzana's cathedral's is). The land use keeps the open
  classes alone, and the Magra's gravel, inside its river bed (5111), is not drawn as pebble.
- **The rail is the CTR's where the CTR maps it, and OSM disagrees at Gragnola.** OSM draws
  Gragnola's loop on the east track, its "main" way crossing over to the west track inside the
  station and a south switch at (−1674.0, 3189.9); the map follows the CTR, the orthophoto and
  RFI's track use instead ([section 4](#4-the-rail-on-the-ctr)), so OSM's loop ways and that switch
  are not used. Where the CTR has no line (the tunnels, the 190 m north of the Terma tunnel, the 912
  m north of Gragnola and the 1,780 m west of Gassano, which no 2019 sheet maps), the track is
  OSM's, moved and smoothed: the tunnels' axes are estimates, the open line there lies 3.4 and 3.6 m
  from OSM's vertices at most, and the Galleria del Lupacino, at the line's end, is OSM's drawing
  moved 1.6–1.7 m. Pieve San Lorenzo's yard siding 621942965 ends at the loop's switch, 0.9 m off
  its CTR track, and the CTR draws two of the yard's tracks 2 m apart up to its east switch
  (5875295216), so the line jogs 2 m sideways there. The CTR draws curves with a vertex every 12–21
  m turning 2–5.5°, so the running line has kinks a train's cars feel (193 m over 20 m chords at
  (−1253, 2271)). The CTR is from 2019: Monzone's and Equi Terme's old sidings may since have been
  lifted. The Via Castel dell'Aquila track-2 crossing slides 1.60 m of a 3.26 m road segment, 0.03 m
  inside the half-segment guard, so an OSM edit there can stop the build. Where a road runs beside
  the line above it (Via Riolo), the rail bed leaves the road's ribbon up to 0.8 m over the terrain
  at its edge.
- **The 4 m grid holds one level where a road runs beside the line below it.** By the Aiola
  tunnel's west portal the tertiary 542115787 runs 5.4 m beside the line and 6 m below it, south of
  Gragnola the Via Provinciale 9.6 m off and 6.7 m below: the road's core keeps the cells, so 26 m
  of track stands up to 5.7 m over the drawn ground there and 1 m at (−1248.6, 2001.7). The
  retaining walls between them are for the render to draw.
- **The rail's level is the LiDAR's, smoothed under a 2.5% grade limit.** The CTR's track lines
  carry no heights. On the line's at-grade track, sampled every 2 m against the LiDAR's ground
  (`loadDtm`), the bed lies within 0.09 m of it at the median and 0.56 m at p90 (0.10 and 0.90 m on
  lucido alone, whose figures by an earlier measure were 0.10 and 0.86 m: [section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts));
  where the ground is steeper than the limit allows or bends within the 100 m smoothing it stays
  off: up to 1.3 m under the ground and 3.2 m over it along Monzone's station (s 8568–8818), 2.2 m
  under it south of Gragnola (s 11318–11568), 4.5 m over it past the Aulella bridge north of
  Gragnola (s 12525–12550), where the bridge holds it 3 m over the river, and 6.0 m over it on the
  1.8 km west of Gassano that OSM alone draws (s 15000–15300). The short bridges the CTR maps over
  ditches keep the line's level, under 3 m over their streams.
- **Platforms are the CTR's outlines at an assumed height.** Their top is the rail head plus 0.25 m:
  the sources say only that the platforms are low. The CTR's outlines reach past the platform
  proper: Monzone's north one runs up to the street, where the terrain stands up to 0.30 m over its
  top on 8% of it (people stand on the terrain there); Gragnola's wraps the station building and is
  cut where the ground lies 1 m under its top, on the forecourt side. Along Monzone's platforms the
  rail's bed, and the platforms with it, lie a median 0.29 m (up to 0.72 m) under the LiDAR ground
  (0.62 m, up to 1.34 m, while the Lucido's banks held the bridge ends low), the cost of the
  profile's 2.5% grade limit and 100 m smoothing; Equi Terme's island lies within 0.24 m of it at
  p90. The 4 m terrain under a platform is not shaped to it: what is drawn there has to be the
  platform itself. Gragnola's trains call along the walkway between its tracks (RFI's step-free
  access reaches only track 1). A station has one side, its biggest platform's: Monzone's smaller
  one across the line counts towards its extent, not its side. The strip the CTR maps as a platform
  north of Pieve San Lorenzo's line (`23D15 AGE#252`, 381 m²) is a walkway on the map, as no edge of
  it comes within 2.2 m of a track (2.45 m off): bare ground on the 2010 orthophoto, a path, three
  low structures and a cabinet on 2023's, so nobody waits there and no yellow line is drawn, though
  the CTR codes it a platform.
- **A narrowed verge holds along its whole road.** `verge` is one value per road, both sides:
  Via Riolo's 2.28 m keeps its walkers 0.12 m inside the carriageway's edge for all its 182 m,
  Piazza della Liberazione's 3.37 m 0.13 m inside for all its 44 m and a service road's by Gassano
  (140780574) 2.55 m 0.15 m inside for all its 153 m, not only along the line.
- **Roads are profiled, not copied.** Road surfaces follow the LiDAR within 0.5 m on Monzone's
  provincial roads (90th percentile), but the steep lanes of the hill villages are steeper than
  the 15% class limit and are fitted up to 3 m off the terrain there. Bridges come from the OSM
  tags: the LiDAR terrain has no decks, so the build lowers the ground under them ([section
  7](#7-road-and-rail-profiles-profilests-grid-claimsts-terraints-rail-levelsts-road-levelsts-junction-reachts)).
  Where a deck lies on the ground near its ends (an OSM bridge drawn over the bank, the SP59's by
  Vinca for its first 13 m) the ground stays in its slab, the slab's sides buried, and in the
  triangles of the drawn mesh at a deck's very ends its approach's ground holds: there a
  footbridge's end, which takes the elevation model's point, can sit under the ground beside it
  (0.9 m at 307484962's north end, (5336, 3542)).
- **A stream's flat surface leaves a trench beside a road.** The unnamed stream 788260386 beside
  the SP52 holds a surface of 765.7 m while the ground under it climbs to 800 m, so its bed is a
  trench along it, and the carve after the claims lowers every node no road's core owns: with each
  road piece cored at its own width, the SP52's shoulder on the gorge's lip at (9628, 5660) falls
  34.8 m into it, to 765.3 m, where the core of a wider piece on its chain had reached it, 6.8 m
  off the centreline, and held it at the road's level. 30 nodes, all between a road and a water, lie more than 5 m farther from the LiDAR since the
  cores narrowed ([What growing a region changes](#what-growing-a-region-changes)); the stream's
  surface is a follow-up.
- **A run-out with no track past it goes straight on.** Past a terminal the run-out follows OSM's
  track beyond the play area as far as it runs in the built terrain's box, then straight and level
  along its heading ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)). A terminal on
  the box's own edge (Cesena's four, the L's two) has none: its run-out crosses the apron (the
  edge's heights drawn on outward, which only a track square to the edge would lie on) straight on
  at its level, and the render draws the rails where the trains ride: Cesena's at most 0.7 m over
  that ground, the L's 8.1 m under it 180 m past Equi Terme's end of the foot, (2400, 988.1), 10.3°
  off square along its hillside, and 8.8 m over it past the leg's north end, (−1859.5, 3900). A
  run-out is profiled on its own, so the line in play keeps its profile: by Rometta the grade turns
  from −6.1‰ to −24.8‰ at the terminal (the ground beyond falls 2.4 m in its first 100 m), OSM's
  line beyond meets the CTR's 0.7 m off, a 4.1° turn there, and over the drawn run OSM's polyline
  kinks 4–7° every 30–60 m, its tightest 20 m chord a curve of 152 m. Nothing lowers the ground
  under a run-out's bridge or draws a portal at a run-out's bore within the drawn run: no map has
  one today. Every cut end in play that OSM's rail carries on is profiled and carved, not a line's
  terminals alone: on Lunigiana only the two terminals are.
- **Junction profiles disagree.** Each road's profile is a line, flat across its ribbon, so where
  two roads overlap their surfaces differ: by more than 0.15 m at 16% of the overlapping points
  and up to 2.9 m (measured over 6,000 of them). The ground the wheels and feet stand on
  (`groundZ`) blends the overlapping surfaces, so it stays continuous, while each ribbon is drawn
  at its own profile: under the highest drawn ribbon a wheel sits more than 0.3 m low at about 2%
  of the points inside two or more carriageways, up to about 2.7 m (a residential lane over the
  Via di Ugliancaldo near (4188, 1477)). Tyre marks lie on the highest ribbon within 3 m over the
  wheel (`drawnZ`), so one in a tunnel stays on its floor, not on the hill above. A bridge
  that runs into a tunnel through a stub of at-grade road over a river bank (the 3.4 m bridge at
  Gragnola, OSM 140780476) has no wall on the stub's sides, so a car can drive off it into the
  river.
- **Paths and steps follow the terrain.** They can be very steep (the summary prints the worst
  grade per class). Footways and pedestrian lanes are paths, so the HUD does not name them (Via
  Buca in Equi Terme).
- **Roofs are procedural** (`src/render/roof.ts`: hip roof when the footprint nearly fills its
  minimum-area rectangle, flat otherwise): the CTR gives eave heights, not roof shapes. Small
  units (stairwells, extensions) are separate buildings, so roofs step where the real ones do,
  but every unit gets its own roof.
- **The surveys are of 2019 and 2009** on lucido (the DBT of 2010 waits for Pontremoli, #24) and
  map the villages, the settled valleys and the Carrara side; OSM fills the rest (448 buildings on
  lucido alone: huts, quarry sheds). On Fivizzano the 2019 sheets map 11.3% of the play area (16.42
  of 145.82 km²) and none of Sillano Giuncugnano's, and the DBTs of 2011 of Minucciano and
  Giuncugnano 4.21 km², 3.29 of it beyond the sheets; OSM fills the rest, 794 buildings at their
  `height` tag or the default 6 m. On Fosdinovo the 2019 sheets map 8.4% of the play area (7.10 of
  84.98 km²; 11.2% of the comune of Fosdinovo, where the issue counted 14%), the 2009 sheets its
  south-east round Castelpoggio (661 buildings) and the NC5 Liguria's comuni (561); OSM fills the
  rest, 1,528 buildings. Two sources' buildings meet where one's mapped area ends, and one sharing
  less than half the smaller one's area with the other's stands beside it: OSM's shed 700765347
  stays, 41% of it over the CTR unit −284056252255569 ([section 3](#3-features-featurests)). Road
  widths fall back to the class width where no survey has a road surface (6 of the SR445's 12 pieces on lucido keep
  its `lanes` width, 7 m), and a surface that spans several streets
  lends its name to all of them.
- **The older surveys draw less.** The 2009 sheets draw no garages, and their ruins as lines: the
  map reads the closed ones as ruins (35 on lucido, 4–263 m², all at the 2.5 m default, as they
  carry no elevation) and leaves out the open wall stubs. A sheet's mapped area replaces OSM's
  buildings in it with those surveyed in 2009: of the 33 OSM ruins among the 155 OSM buildings they
  replace, 16 stand inside a 2009 ruin, and of the other 17, 13 lie within 10 m of a wall stub and 4
  by none; 29 of the 155 overlap none of the map's 175 buildings of 2009 (26 tagged `building=yes`,
  13 of them with a `ruins` tag, 2 `building=ruins` and 1 `residential`), built since, ruins, or
  OSM's errors. Of the map's 140 units from the 2009 sheets, 130 (92.9%) take their height from the
  eave; the other 10 stand at their kind's default. The DBT counts a bell tower as a tower however
  its use is coded (Pontremoli's 2019 sheets call the 3 they share with it churches), and its
  residual is fitted at Pontremoli alone. The CTR 1:10 000, which maps all of Tuscany, merges
  terraces into one unit and lies about 1.9 m off the 1:2000, so no part lists it yet.
- **Facade styles are a judgement.** The stone cores are discs traced by eye on the orthophoto;
  many old houses in the cores are plastered in reality, and a whole hamlet of up to 200
  buildings takes one style.
- **River widths are one value per river.** The Aulella's 12 m water and 26 m bed fit Gragnola
  better than the wooded channel at Codiponte; the gravel bars of the Lucido at Pian del Molino
  are wider than its 22 m bed. The Vinca branch below Vinca is one OSM way, so its 8 m fits the
  valley floor below the SP59 bridge but not the 3–6 m gorge just below Vinca. The LiDAR still
  shapes the banks. The UCS gravel draws the Lucido's and the Aulella's bars where they lie, but the
  water itself spreads only as wide as each river's bed: a river runs wider only where OSM draws its
  polygon. The Rosaro's river part is 7 m of water in a 14 m bed from Fivizzano to Soliera, where
  its gravel runs 10–28 m wide, and the wooded torrents' 6 m (the Aulella's gorge, the Rosaro's
  streams, the Mommio, the Bardinello, the Pesciola) take one value from 9 to 49 km² of
  catchment. The Bardine's
  12 m of water in a 26 m bed below Bardine are the 2010 orthophoto's; the 2023 one shows 6–10 m of
  water in a 6–25 m bed there, its bars grown over.
- **Water areas are where OSM and the UCS draw them.** A lake's level is the LiDAR's of 2010 and
  its outline OSM's, so a pond whose outline reaches up a slope shows a muddy margin (the lake's
  own cover where the ground stands over the level), and a lake the LiDAR reads no hollow under
  holds no water (the intermittent pond at Prati di Campocecina), nor does a pool with no node all
  four of whose cells are water (the pool on the Canale Doglio). The intermittent Bozzetti pond is
  always full; under Fivizzano's Arlia power station forebay and a pond on a slope the LiDAR reads
  no hollow either, and its 7 × 9 m pond by Pieve San Lorenzo and two pools on the Torrente
  Arcinasso beyond its play area have no such node, so they hold none ([section
  6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)). The river polygon OSM
  draws by the Tassonaro's mouth, the edge of the Aulella's bed, follows the Tassonaro and its
  tributaries, as no piece of the Aulella, 122 m west of it, runs through it. A river polygon's
  water is its river's depth, so on Cesena's Savio, whose catchment the map holds only 4.7 km² of,
  it is a few centimetres deep: of the 5,114 cells of 4 m whose centre lies in its polygons, 60.1 %
  hold water at the mean flow and 68.0 % in a spate (`waterUnder`, 2026-11-07; 59.5 % and 67.8 %
  while it held 2.95 km², before the Cesuola's 1.74 km² of the town drained to it, [section
  6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts); an earlier count, whose
  method is not recorded, gave 54 % and 62 %).
- **Land cover is 1:10 000.** The UCS polygons (0.5 ha minimum) generalise the edge between rock,
  pasture and wood, and their woods take in the gardens and sheds on a hamlet's edge.
- **Tree species are drawn, not mapped.** No open source maps them tree by tree: each tree's comes
  from its land cover, height and aspect by the forest inventory's shares (`speciesAt` in
  `src/render/trees.ts`), so a beech wood or a chestnut grove has its mix, not its edge. On the
  built map the beech's share of the woods' trees is 0% below 400 m, 1.3% at 400–800 m, 17.6% at
  800–1000 m, 57.8% at 1000–1200 m, 89.5% at 1200–1400 m and 98.7% at 1400–1600 m, against the
  inventory's 0, 0–1, 16, 55, 89 and 100% (`trees.map-test.ts`); the oaks' 31.6% below 200 m, 34.1%
  at 200–400 m, 18.4% at 400–800 m, 18.0% at 800–1000 m and 11.1% at 1000–1200 m against its 39, 26,
  18, 23 and 10%. The hop-hornbeam and the riparian
  trees draw as chestnut, and the black pine and Douglas fir of the plantations as the conifers'
  cone. Liguria's woods come through `UCS_CODES` too (3111–3115 as `forest`), once `fetch-lig`
  fetches a part again: the Sarzana test region's file predates them.
- **Some names only exist on addresses.** A street names one OSM way, the one most of its
  addresses stand by within 100 m (by the nearest vertex, not segment), so a street drawn as
  several ways names one of them, and a way two streets vote for goes to the one with more votes;
  an address over 100 m from its road names nothing ([section 3](#3-features-featurests)).
  Culverted waterways are dropped, but under a CTR rail bridge; at-grade crossings imply a culvert
  instead.
- **The named streams' width is a guess.** A stream OSM names is 4 m wide wherever the build
  measured none ([section 3](#3-features-featurests)), the Torrente Tassonaro among them, though it
  drains 19.4 km² at its mouth, as much as the wooded torrents of 6 m (the Pesciola, 4 m until #18's
  review, was measured on the orthophoto and drawn 6 m wide since): the
  Canale di Campiglia runs in a channel about 2.5–3 m wide by Gassano on the 2023 orthophoto, and
  its protected bed, 3 m either side, takes its CTR bridge out to 17.5 m (the bridge is 6.7 m).
- **The Aulella is calibrated at Soliera alone.** The Soliera gauge's flows over its 208 km² set
  the discharge per km² everywhere, but the map's catchments are its own D8's and the Rosaro's
  heads: 196.5 km² just below the Rosaro's mouth and 199.4 leaving the play area, as the gauge's
  delineation is larger than the DTMs' (the 10 m DTM's basin there is 200.73 km²). Above the
  Rosaro's mouth the Aulella carries what the map's own D8 gathers, 41–60 km² from Codiponte to the
  Lucido's mouth below Gragnola, so it runs 1.39 m deep there in a spate. Before #17 it ran about
  2.5 m deep there, as lucido added the 161 km² beyond its edge at Gragnola, the Rosaro's catchment
  among them, which joins only at Soliera.
- **The Rosaro's heads come in at one point.** The 14.7 km² of the catchment north of y 13000, the
  heads of the streams under the Cerreto pass, enter at one water sample, the Rosaro's nearest
  (3528, 13000) and 12 m inside the edge (`OFF_MAP`): 13.1 km² come down the Rosaro's own head and
  1.6 down rivulets west of it, which carry only their area in the map until they join the Rosaro,
  and the Rosaro all 14.7 km² from the edge.
- **Fivizzano's permanent edges cut the Serchio side.** Its edges in Minucciano and Sillano
  Giuncugnano face the Garfagnana, which no part of Lunigiana takes, and the roads there belong to
  its network, not to a line a rectangle can follow: 14 roads leave the play area there and come
  back (towards Minucciano town, Sermezzana, Varliano, Piazza al Serchio and Ponteccio), each capped
  where it leaves, and Sermezzana (148 buildings, 90 m outside) and Capoli (47, 140 m) lie whole
  outside (`pnpm footprint-check fivizzano`, [Adding a part](#adding-a-part)). The two Lucca
  rectangles keep Pieve San Lorenzo, Novella, Renzano, Magliano, Varliano and Montale whole.
- **Fosdinovo's permanent edges cut Carrara.** Its edges in Carrara (y −6100 for x −4600…−4000,
  x −4000 up to the line 1 km beyond the comuni, and that line) face Carrara's side of the Apuans,
  which no part of Lunigiana takes: Castelpoggio's houses run on in a chain to Noceto, whose 163
  buildings cluster 147 m past the south edge, Via Giacomo Ricci (61316266) loops out 583 m across
  y −6100 to Noceto and back, capped where it leaves, the Ruschetti locality and 5 houses stand
  104–111 m past x −4000, and the SP73 leaves once, at (−4000, −5563), toward Gragnana (`pnpm
  footprint-check fosdinovo`, [Adding a part](#adding-a-part)).
- **The seams to come are edges until their parts join.** At x −5300 north of y 3900 and y 3900
  west of it (#19), at x −11500 (#20), at y −6100 west of x −4600 (#21) and at y 13000 (#22, #23)
  the map ends: 2 of the 6 buildings by Rometta's station stand in play at x −5300, the Aulella
  leaves there 700 m short of the notch and the Bardine at (−10572, 3900), 100 m short of it,
  Canepari's houses reach within 1 m of x −11500, 83 of the 132 buildings of a cluster by
  Caniparola stand inside y −6100, Baccana's houses reach within 12 m of y 13000, and the SS63
  crosses y 13000 three times (out at x 4441, back at 5106, out again at 5323), capped where it
  leaves.
- **Cima Belfiore's summit plays past OSM's border.** OSM puts the summit node (577763720, at
  (9705.5, 12014.0)) 3.6 m inside Emilia-Romagna (Ventasso), and the landmark point (9706, 12014)
  4.1 m; the mask bends out to (9726, 12014) round both, so the summit and a sliver of Emilia round
  it are in play, and the rest of Emilia's 0.76 km² in the rectangles is not.
- **Two districts are named Magliano, and two Bardine.** OSM's hamlet by Fivizzano's west edge
  (−5078, 9369) and the one by the SR445 in Minucciano (9883, 6122) each name a disc, and so do
  Aulla's Bardine in the Bardine valley (−9182, 2896) and Fivizzano's hamlet of the name (node
  1411140437, at (−3920, −1160)), so the HUD's name alone does not tell them apart;
  `map.map-test.ts` checks Aulla's, and its parking by the disc at its point, not by the name.
- **Ceserano's disc leaves its western borgo out.** OSM's Ceserano node (251993868) stands in the
  eastern borgo, 598 m east of the Chiesa di San Bartolommeo, round which the western one stands, so
  the village's 400 m disc takes the eastern borgo alone; the HUD names the western one Ceserano by
  the nearest rim. With Fosdinovo's 24 discs at the 400 m cap, its part's settled buildings stand
  80.8% in a disc ([section 12](#12-trees-spawns-districts-treests-spawnsts-districtsts)).
- **The SP57's hairpin below Ponzanello is the steepest secondary road.** Way 706390974 climbs 16.7%
  over 4 m (the build's summary) and 15.9% over 8 m at (−10485, 217), within the 1.5 × 10% the fit
  may relax a secondary road to plus the 0.1 m rounding (16.25% over 8 m, `map.map-test.ts`), while
  the LiDAR's ground between its vertices 8 m apart there climbs 62%. The SP72's hairpins, issue
  #18's measure, stay within 11.7% (way 706146404 at (−8400, −1596)), under the 15% a primary road
  may reach.
- **The catchments still fill lakes behind the water's dead ends.** Where a stream's mapped water
  stops (a culvert the build drops, [section 3](#3-features-featurests)), its trench ends 100 m
  under the ground and the fill makes it a lake: 65 km of the play area's water, in 2 m samples,
  lies in fill lakes more than 1 m deep, all but 0.75 km of it behind such dead ends, where D8 may
  route the water a short way across the lake ([section
  6](#6-river-carving-and-catchments-waterts-water-areasts-catchmentts)).
- **A road through a house may pass a wall 0.88 m off its centreline.** `clipBuildings` cuts a
  drivable road's corridor of min(w/2, 1.2) m through a footprint unpadded, so the traced walls may
  stand inside it by up to half a raster cell and the trace's tolerance: about 0.88 m from the
  centreline at worst (an estimate; no road meets it today), under the 1 m `map.map-test.ts` keeps
  every drive wall off a drivable road's centreline (every 2 m along it): today such walls stand
  1.0–1.1 m from 28 of Lunigiana's drivable roads and 14 of Cesena's. Padding it as the arch
  corridors are would reshape the houses drawn ([section
  10](#10-collision-walls-wallsts-parapetsts-deck-wallsts)).
- **Re-downloading changes the map.** `pnpm fetch-osm <part>` pulls current OSM edits;
  `data/raw.lock.json` pins the inputs the map is built from.
