# The map

`pnpm map` runs `src/tools/build-map.ts`. It turns the pinned inputs in `data/raw` into
`src/sim/map/monzone.bin`, the default Lunigiana map (6.7 MB, see
[File format](#file-format)). The build is deterministic (gunzipped, its output is the same bytes
on every machine; the gzipped file is byte-identical with the same Node build, while another zlib
or OS writes other compressed bytes) and takes about 10 s. It prints a lap time per stage, the
rail's fit to the CTR per piece ([section 4](#4-the-rail-on-the-ctr)), each platform
([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)), and a summary: counts, the rail
on the CTR (OSM's offset from it, the shipped residual, the level crossings' slides, the bridge
ends slid, the culverts, the at-grade track cut into the CTR's bridges and the rail bed), the
railway (its lines, stations, level-crossing boxes and the verges pulled in off the track), the
steepest grade per road class, and the size of each part of the file.
Inputs and attribution are in the [README](../README.md).

`src/sim/map/kinds.ts` holds the vocabulary that the build and the game share: road classes and
their default widths, where people walk and cars drive across them (`vergeOf`, `laneOffset`),
building styles, area kinds, rail kinds (`RAIL_KINDS`), the rail head over the bed (`RAIL_LIFT`)
and the tree-trunk size. It imports no data, so the build can use it before `monzone.bin` exists.

## Cesena

Cesena is a separate experimental city-centre map; it loads instead of Lunigiana, not alongside it.
The pipeline below describes Lunigiana unless a Cesena difference is noted here.

- **Selection**: the title card links to `?map=cesena`; an omitted `map` selects Lunigiana.
  `src/maps.ts` validates the name before download, and the boot host updates the title and credits.
  Switching maps reloads the page and starts a fresh world. The links preserve an explicit seed.
- **Extent**: `region.ts` centres Cesena at latitude 44.1391, longitude 12.2429, with local bounds
  of -2000 to 2000 m on both axes. This covers a 4 by 4 km city-centre area, not the whole comune.
- **Accepted sources**: OpenStreetMap (ODbL) supplies roads, buildings, water, land use and names.
  `pnpm fetch-osm --region cesena` pins a separate `data/raw/cesena.osm.gz` with the same API
  fetcher, which splits a box the API refuses as too large. Regione Emilia-Romagna's
  [DTM 5x5 - ultima edizione](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/altimetria/layer-2)
  is accepted under the catalogue's CC BY 4.0 licence. `pnpm fetch-rer --region cesena` checks that
  licence and requests WCS coverage `DTM5X5_RDN32_RMD` as an EPSG:4326 GeoTIFF. The pinned
  `data/raw/cesena/source.json` records the request and raster SHA-256. `loadGeoDtm` rejects
  incorrect CRS, incomplete coverage and invalid or missing heights instead of inventing terrain.
- **Excluded sources**: the Tuscany CTR, LiDAR and UCS inputs do not cover Cesena and are not
  reused there. No other terrain, building or imagery source is included for Cesena.
- **Build**: `pnpm map --region cesena` writes only `src/sim/map/cesena.bin`, using the same
  profiles, collision, road graph, parking and packed format as Lunigiana. The source terrain has
  5 m cells; resampling onto the game's 4 m grid does not make it a finer survey.
- **Rail**: the shared railway pipeline uses Cesena's OSM tracks and platforms, with no Tuscany
  survey tracks or Gragnola-specific layout corrections. The bundled Cesena map is rebuilt when
  the shared packed format changes, so both regional maps use the same decoder.
- **Features**: secondary roads and main-road links use the existing tertiary class; cycleways
  are walkable paths. OSM building height tags are used where present, otherwise existing default
  heights apply. Road widths use class defaults. The Savio's width is the median of perpendicular
  cross-sections through its OSM bank polygons, not the mountain-stream fallback. Neighbourhood
  labels come from OSM place nodes, without Monzone's hand-placed districts or stone cores.
- **Start**: the player starts beside a central street in the connected traffic network, outside
  buildings with an open walk-clear route to the street. Police and station parking use Cesena's
  mapped Carabinieri headquarters and railway station.
- **Checks**: `src/tools/__tests__/cesena.test.ts` checks landmarks, connected networks, the outdoor spawn,
  nearby cars, measured river widths and deterministic simulation startup. Run `pnpm check` after
  a build. Preview the map with
  `node src/tools/preview-map.ts 0.3 -2000,-2000,2000,2000 .research/cesena-preview.png --region cesena`.
  Repeat builds must have identical decompressed hashes, as for Lunigiana.

## Pipeline

### 1. Sources (`osm.ts`, `ctr.ts`, `ctr-rail.ts`, `shp.ts`, `ucs.ts`, `crs.ts`)

- **OSM**: `data/raw/lunigiana.osm.gz`, written by `pnpm fetch-osm` (`src/tools/fetch-osm.ts`): the
  play area plus 100 m, asked for whole and split in four wherever the `/map` call answers HTTP 400
  (over 50 000 nodes in a box), each quarter in turn, then every multipolygon relation with a
  land-use, natural, building, leisure or amenity tag fetched whole (`/relation/<id>/full`), because
  most of a forest's member ways lie outside the play area.
  Elements are merged by id and written sorted. A regex reader parses the XML into nodes, ways
  and relations, and assembles multipolygon rings from member ways (unclosed chains are dropped).
  OSM gives the road network and its names, water, rail, land use, barriers, POIs and place names.
- **CTR**: Regione Toscana's Carta Tecnica Regionale 1:2000, 2019 flight, the 25 sheets that map
  ground in the play area (23D11–15, 23D18–21, 23D26–31, 23D34–37, 23D43, 23D46, 23D47, 23D53–55),
  listed in `data/parts/lucido.json` ([Adding a part](#adding-a-part)).
  `shp.ts` reads the shapefiles; `crs.ts` converts their EPSG:6707 (RDN2008 / UTM 32N)
  coordinates. The CTR gives the buildings with their surveyed eave elevations, the road surfaces
  with their street names, and the area each sheet maps (`ctr.ts`). The 2019 sheets map the
  villages and the settled valley floors (Vinca, Tenerano, Ugliancaldo and the Solco quarries
  included), about 11% of the play area; the mountains between them are unmapped. A sheet with no
  garages or road surfaces has no `AGE` or `AVI` layer.
- **CTR rail** (`ctr-rail.ts`): the same CTR's railway layers, in the 9 sheets the line crosses
  (23D11, 23D15, 23D19, 23D27–30, 23D35, 23D36). The rail the map draws stands on these track
  centrelines, and the tracks only the CTR has come from them
  ([section 4](#4-the-rail-on-the-ctr)).
  - `VLI` code `0117`: one centreline per track, switches not drawn (a diverging track ends
    beside the through track), none inside tunnels; 31 records, 34 lines. `ctr-rail.ts` chains
    them into tracks: two ends within 1.0 m whose headings run on within 10° join, nearest first,
    at their midpoint. Of the 12 joints, 11 match exactly (sheet edges, and splits within a
    sheet); the Monzone siding's ends at the 23D35/23D36 edge lie 0.465 m apart. Two collinear
    gaps stay open: 3.5 m between the two parts of one 23D27 line at (−1355, 1436), and 8.3 m
    under the road bridge at (2350, 982). The lines are cut out of the `AFE` tunnel polygons (the
    23D30 line runs 52 m into the Ugliancaldo tunnel) and clipped to the play area (the
    Minucciano yard lies east of it): 14 tracks, 8 201 m.

    | Where | Tracks, m |
    |---|---|
    | Gragnola, y 2930–3380 (1 035 m) | the east through track (447 of a 2 486 m track from (−1355, 1438) to y 3725, where the sheets stop mapping), the west loop (404), the stub to the south beside the loop (184) |
    | Monzone, x −830 to −380 (887 m) | the line (610 of 1 888 m from the Aiola tunnel to the Terma tunnel), the siding west of the station (278) |
    | Equi Terme, x 1700–2100 (1 001 m) | the line (398 of 1 625 m from the Onda tunnel to the road bridge), the second track in two pieces (142 and 163, apart at x 1868–1901 in front of the building), two yard sidings (124, 174) |
    | open line (5 278 m) | the rest of those three tracks (2 038, 1 279 and 1 228 m), 52 m at y 1383–1434 north of the Terma tunnel, 182 m between the Aiola and Onda tunnels, 201 m from the road bridge to the Ugliancaldo tunnel, 298 m from its east portal to the east edge |

  - `AFE` code `0140`, the ballast bed (codebook: "sede di trasporto su ferro"), by `Sede`: 060
    at grade (42 polygons in the 9 sheets), 063 on bridges (`Livello` 102; 26, 25 of them in the
    play area; the track on them is a bridge, [section 4](#4-the-rail-on-the-ctr)), 054 in tunnels
    (7, 6 in the play area), 061 at the level crossings (4, the same boxes as `AGE` `0122`).
  - `AGE` code `0141`, station platforms (codebook: "marciapiede di stazione ferroviaria"): 5 in
    the play area, 2 each at Gragnola and Monzone and one at Equi Terme. The map's platforms are
    cut from them ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)).
  - `AGE` code `0122`, the level-crossing areas: 4, one on each road crossing (Via Riolo, Viale 20
    Settembre, Via Castel dell'Aquila over both tracks, Via Nuova). No platform reaches into one,
    and the build checks that each holds a level-crossing node and that no node near one lies
    outside it ([section 4](#4-the-rail-on-the-ctr)).

  The codebook ("Tavola dei contenuti … 1:2000, livello 4.2", November 2011) gives `0140` and
  `0141` in its text; its code table for `0117` and `0122` is in fonts that do not extract, so
  those two are read from the geometry (the `0117` lines follow OSM's rail within 0.7 m at the
  median; the `0122` polygons sit on OSM's level-crossing nodes).
- **LiDAR**: Regione Toscana's 1 m digital terrain model, in EPSG:3003 (Monte Mario / Gauss-Boaga
  west): the 2010 flight (47 tiles) first, then the 2012 flight (19 tiles) for the Carrara side of
  the ridge and Monte Sagro, which 2010 flew only in part, in the order `data/parts/lucido.json`
  lists them.
  `crs.ts` converts with the EPSG:1660 datum shift plus a residual of (−0.4, +0.5) m, fitted by
  matching the 2010 surface model to the 2019 CTR building outlines. The MATTM 2008 flight (lot 006)
  adds nothing here and is CC BY-SA, so it is not used.
- **10 m DTM**: the 0.65 km² neither flight covers (two patches on the slopes south of Tenerano,
  one in the Sagro quarries) come from Regione Toscana's 10 m DTM of the province of Massa-Carrara
  (derived from the CTR 1:10 000, CC BY 3.0 IT), bent onto the LiDAR: the LiDAR − DTM residual on
  the cells around each patch (−47 to +20 m around the biggest) is spread over it by inverse
  squared distance, so the patch meets the LiDAR without a step.
- **Land cover**: Regione Toscana's "Uso e copertura del suolo" 1:10 000, 2019 (UCS, CC BY 4.0,
  0.5 ha minimum unit), from its WFS. OSM maps the woods and the quarries well but only about a
  fifth of the Apuans' bare rock and half their pastures, so `ucs.ts` adds the open covers: quarries
  (UCS 131), natural pastures (321), heath and scrub (322), bare rock and cliffs (332) and sparse
  vegetation (333). Woods, fields and towns stay OSM's.
- **The Aulella's catchment**: one published figure, the 208 km² ARPAL's Annali Idrologici 2017
  (part II) give the Soliera gauge, taken as a fact (as the rivers' calibration takes the gauge's
  flows, [water.md](water.md#sources)); no ARPAL data is shipped.

- **Verification only, never data**: the AGEA 2022 orthophoto (Regione Toscana's OFC WMS, "©
  AGEA, licenza d'uso concessa a Regione Toscana"), read by eye to settle Gragnola's track layout
  ([section 4](#4-the-rail-on-the-ctr)); RFI's station pages (rfi.it/it/stazioni: Gragnola,
  Monzone-Monte dei Bianchi-Isolano, Equi Terme), read for the tracks in use and that no platform
  on the line is raised to 55 cm (the platforms' height,
  [section 9](#9-the-railway-railwayts-platformsts-rail-clearts)).

`pnpm fetch-rt` (`src/tools/fetch-rt.ts`) downloads the CTR sheets, the LiDAR tiles, the 10 m DTM
and the land cover. The sheets, tiles and DTM it downloads are listed in the part's manifest,
`data/parts/lucido.json` (`manifest.ts`: `ctr`, `lidar`, `dtm10`); a cell of the mosaic keeps the
first tile's value, so the order of the `lidar` list is the priority. It copies the shapefile layers
the build reads (`AED`, `AGE`, `AVI`, `AZR`, `AFE`) to `data/raw/rt/ctr`, and of `VLI` (42 MB over
the 25 sheets, mostly contour lines) only the `0117` track centrelines (29 KB, 9 KB gzipped),
through `subsetShp` in `shp.ts`, which renumbers the records and rewrites the file length, bounding
box, z range and record count. It mosaics the LiDAR into `data/raw/rt/dtm.bin` + `dtm.json`: cropped
to the play area plus 32 m, averaged to 2 m cells (the game grid is 4 m), stored as int16 decimetres
with each row delta-coded and deflated (15 MB). It writes the kept land-cover polygons, in EPSG:3003
to the decimetre, to `data/raw/rt/ucs.json.gz` (`crs.ts` has the inverse transform); the WFS box is
padded by 500 m, because the server's box filter sometimes drops features near its edge. `pnpm
fetch-rt ctr` fetches the CTR sheets alone (28 s with the downloads, 1.5 s from the cache), leaving
the LiDAR and the land cover, which comes from a live service and would move the map, as they are. A
file whose unpacked bytes equal the new ones is not rewritten, so another zlib never churns a pinned
file, and a cached archive folder with no files left in it (macOS purges the temporary directory's
files but keeps its folders) is fetched again. Requests name only the project in their `User-Agent`.

### 2. Projection and play area (`geometry.ts`)

Equirectangular around `ORIGIN` (lat 44.16175, lon 10.13; defined in `src/sim/map/kinds.ts` and
written into the map file as `MAP.origin`, which the sky reads through `place()`), with
`M_PER_DEG` = 111115.37 m per degree of latitude and 79987.94 m per degree of longitude. x = east,
y = north, in metres, rounded to 0.1 m. The play area `BOUNDS` is x
−2900…4900 m, y −6100…3900 m (7.8 × 10 km; lat 44.1069–44.1968, lon 10.0937–10.1913): the whole
catchment of the Lucido, ridge to ridge, from its mouth in the Aulella below Gragnola up both
branches. Up the Vinca branch: the SP59, Vinca and its valley to Foce di Vinca, the Garnerone and
Foce di Giovo, with Monte Sagro, Monte Borla and their quarries on the ridge. Up the Equi branch:
Equi Terme, the Solco di Equi and its quarries, Pizzo d'Uccello and Ugliancaldo. West of the Lucido:
Tenerano and the SP10, Viano, Pieve di Viano, Colognola, Campiglione and Vezzanello; Monzone, Aiola,
Codiponte and Casciana in the middle. Being a rectangle, the area also takes in some of the Aulella
side (Argigliano), the Bardine side and the Carrara side of the ridge (Campocecina). Lines are
clipped with Liang–Barsky and rings with Sutherland–Hodgman. `PARTS` in `region.ts` names this
rectangle part `lucido`, for `fetch-rt` and the part tools ([Adding a part](#adding-a-part)).

### 3. Features (`features.ts`)

- **Roads**: OSM highway classes `tertiary`, `unclassified`, `residential`, `service`, `track`,
  `path` and `steps`, plus four values folded into them: `primary` (the SR445 della Garfagnana
  through Gragnola and Codiponte, a two-lane valley road) is `tertiary`, `living_street` is
  `residential`, `footway` and `pedestrian` are `path`. A highway way tagged `area=yes` is a
  square, not a road (a pedestrian square becomes a `paved` area). Other highway values are
  skipped. The ways keep `oneway`, `bridge`, `tunnel`, `layer`, `maxheight` and private access.
  - Width, surface and name come from the CTR road surfaces (`fitRoads` in `ctr.ts`). Every 4 m
    along a drivable road (skipping 6 m at each end), a station on a surface measures the surface
    across the centreline. Stations with more than 10 m on either side (squares, car parks) are
    skipped. A road with at least half its stations, and three or more, on a surface takes the
    median width (clamped to 3–12 m) and asphalt or dirt by most stations. It takes the street
    name most stations share (the CTR's upper-case toponym, cased like "Via Castel dell'Aquila"
    and "Via XX Settembre") when the same holds for its stations inside the area the sheets map,
    so a road that runs on into the unmapped mountains keeps the name of its village stretch (Via
    di Ugliancaldo). OSM names stay, and so do specific OSM surfaces (cobblestone, gravel). Roads
    the CTR does not cover keep their class width (6.5, 5, 4.5, 3.5, 3, 1.5 and 2 m).
  - Roads still unnamed take a street name from `addr:street` votes (the nearest road to most
    addresses with that name).
- **Water**: every `waterway` except culverts, with a water width, a gravel-bed half-width and a
  depth, measured on the 2010 orthophoto:

  | Water | Width | Bed half-width | Depth |
  |---|---|---|---|
  | Torrente Aulella (25–35 m gravel bed at Gragnola, a wooded 10 m channel at Codiponte) | 12 m | 13 m | 2.5 m |
  | Torrente Lucido, river part (Monzone to Gragnola) | 14 m | 11 m | 2.5 m |
  | Torrente Lucido (Vinca branch) and Torrente Caldanella (from Equi), ways averaging under 500 m of ground | 8 m | 5 m | 1.5 m |
  | other named streams, and the Lucido above Vinca | 4 m | 3 m | 1 m |
  | unnamed streams | 2 m | 3 m | 1 m |

  A way's class comes from its mean LiDAR ground over its vertices, so water is extracted once the
  terrain is loaded. The Vinca branch shows 6–11 m of open marble gravel below 250 m and 4–6 m up to
  400 m; from 500 m its bed is under closed canopy. Its way from the source under the Garnerone down
  to Vinca (mean 826 m) is a beech-wood gully with 3–6 m windows of bed, so it gets 4 m. The
  Caldanella runs 15–16 m between walls at Equi and 5–9 m of boulders down to Monzone. The Solco di
  Equi (dry, 5–7 m of gravel in the gorge) and the other named streams keep 4 m. Other rivers would
  be 2.5 m deep with the stream widths.
- **Rail**: `railway=rail` (the Lucca–Aulla line), with bridges and tunnels, moved onto the
  CTR's tracks next ([section 4](#4-the-rail-on-the-ctr)).
- **Buildings**: the CTR's wherever its sheets map the ground, OSM's elsewhere (an OSM building
  is dropped when its centroid lies in a mapped area).
  - CTR buildings are the `AED` volumetric units plus garages and ruins from `AGE`. Each unit is
    one building: a terrace of houses becomes one building per house, each with its own height
    and roof. Not buildings here: overhangs, canopies, tents, porticoes, loggias and
    semi-basements. The CTR code gives a kind and, for churches, towers, the station and
    industrial buildings, a fixed style.
  - Height: the surveyed eave elevation (`Qt_grmax`) minus the lowest ground under the footprint
    (see `z0` below), when that comes to 1.5–45 m. Otherwise, and for garages and ruins (no
    elevations), a default by kind (house 6 m, shed 2.5 m, garage 2.6 m, ruin 2.5 m...). The
    CTR's ground elevation is not used: it disagrees with the LiDAR on a quarter of the units.
  - A CTR building inside an OSM footprint takes that building's name, and its style when the
    CTR only says "building" (the bell tower of San Prospero is an OSM tower) and surveyed no
    fixed-style unit inside the same footprint: where the CTR maps the church itself, the other
    units in an OSM church outline are the houses around it (Tenerano, Vinca, Viano).
  - OSM buildings (outside the CTR's area, about 610 of them: mountain huts, quarry sheds, the
    Carrara side): height is the `height` tag clamped
    to 2.5–22 m, otherwise 6 m (ruins 2.5 m). Style comes from the tags: `ruin`, `church`,
    `tower`, `station`, `industrial`.
  - Generic buildings are `stone` inside the historic cores (`STONE_CORES`, discs traced on the
    2010 orthophoto: the dense blocks around the church or castle) and `plaster` elsewhere. The
    cores are Monzone Alto, Aiola, the Castellaccio, Gragnola's borgo by the Lucido and the
    Castello dell'Aquila, Equi Terme's old village under the church, Viano, Pieve di Viano,
    Campiglione, Vezzanello, Colognola, Terma, Isolano, La Rocca di Monzone, Monte dei Bianchi,
    Mezzana, Fazzano, La Giunca-Mozzano, Folegnano, the borgo west of Pian del Molino, Cortila,
    La Traggiara, Codiponte's borgo south of the Aulella, Casciana, Vinca's borgo around
    Sant'Andrea and its upper street, Tenerano's ring, Ugliancaldo's castle ring and its borgo down
    the ridge to Sant'Andrea, and Argigliano's borgo below Santa Maria. The newer houses along the
    main roads (Molina di Equi, Pian del Molino, the SR445 in Gragnola) are plaster.
  - Plaster and stone buildings within 25 m of each other form a hamlet; a hamlet of up to 200
    buildings takes its majority style, so it never splits at a core radius. Bigger clusters
    (Gragnola, Codiponte, Mezzana, Equi Terme) keep the core split, but each terrace block
    (buildings within 6 m) takes its own majority style. `tint` 0–3 comes from a hash of the id.
- **Areas**: landuse, leisure, amenity, railway platform, historic ruins, grassland and wood
  polygons, mapped to `AREA_KINDS`, plus pedestrian squares as `paved`. OSM's platforms only stand
  where the CTR's sheets map no ground; elsewhere the CTR's replace them
  ([section 9](#9-the-railway-railwayts-platformsts-rail-clearts)): all three of OSM's here.
  Mountain covers: `landuse=quarry` is `quarry`, `natural=bare_rock`/`rock` is `rock`,
  `natural=scree`/`shingle` is `scree` (mostly ravaneti, the quarries' marble waste),
  `natural=scrub`/`heath` is `scrub`, and `natural=fell`, `landuse=meadow`/`grass` are `grassland`.
  The UCS land cover adds its quarries, rock (`rock`), sparse vegetation (`sparse`), pastures
  (`grassland`) and heath (`scrub`). The CTR's asphalt road surfaces are added as `paved` areas:
  squares, lay-bys and station forecourts.
- **Barriers**: `barrier=wall`, `barrier=guard_rail` and `natural=cliff` lines. Walls and cliffs
  are opened wherever a road (not a tunnel) comes within w/2 of them (`openBarriers` in
  `walls.ts`): OSM draws cliffs across the paths that climb through them and garden walls up to
  the centreline. Guard rails run along their road and stay whole.
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
  and part order. OSM lies 0.68 m from the CTR at the median, 2.71 m at p90 and 5.27 m at most
  (way 140780332, between Monzone and the Terma tunnel).
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

- **Unmatched runs** between two matched ones (the four tunnels, the 190 m north of the Terma
  tunnel the CTR leaves out): OSM's vertices move by the displacement interpolated between the
  matched ends, then a smoothing spline replaces them. Resampled every 5 m, it keeps the run's
  ends and, through anchor points 5 and 10 m into the CTR tracks, their headings; where it bends
  tighter than 320 m it is solved again with those bends weighted up (30 rounds at most). OSM draws
  the curved tunnels with few vertices: a 16° bend at the Terma tunnel's north portal, and the Aiola
  tunnel straight though the CTR enters it at 26° and leaves it at 51°. Smoothed, the Terma tunnel
  is 225.0 m long (OSM 219.2 m, FLA 227.1 m) and lies inside the CTR's tunnel bed (`AFE` `Sede`
  054) for 71% of the length the bed maps (OSM's 0%), the Aiola tunnel for 45% (OSM's 16%); they
  stray up to 18 and 17 m from OSM's lines, the open track north of the Terma tunnel 4.2 m. Towards
  a chain end (the 214 m to the north edge past the sheets) no survey says where the track bends,
  so OSM's line keeps its shape, moved as its last matched sample (1.8 m), its end on the edge: a
  spline there bent a 20° kink 6 m off OSM in a test with no CTR at all. OSM's 4.5° vertex at
  (−1837.3, 3865.3) stays.
- **Bridges keep what they span** (`rail-spans.ts`): moving a bridge sideways by d
  slides each crossing along it by d·cot θ. A river or road that was under a bridge stays under
  it, and the bridge reaches past it as far as the cells the at-grade track beyond cannot take: a
  wide stream's protected bed (w ≥ 4 m: w/2 + 1 m) and a tertiary road's core (rank 0,
  [section 7](#7-road-and-rail-profiles-profilests-terraints-rail-levelsts): w/2 + 2.3 m), each
  plus a cell's diagonal (5.7 m, the farthest a corner of a cell the track runs through lies off
  it). A bridge end that falls short slides along the track: 9 ends, among them the Aulella
  bridge 261445433's north end by 13.9 m (OSM ended it 3.1 m inside the river, and the track
  beyond hung 8.2 m over the river's carve) and both ends of the Via Provinciale bridge 83729869
  by 5.7 and 11.0 m (the tertiary under it left 4.5 m of track 5.1 m over its carved core).
- **The CTR's bridges**: where the CTR maps the ballast on a bridge (`AFE` `Sede`
  063) and OSM draws the track at grade, the piece is cut at the polygon's edges (vertices
  `afe:<way>:<n>`; a stretch under 2 m joins its neighbour) and the stretch inside is a bridge: 24
  stretches, 308.9 m with the underpasses' below, among them 41.8 m over the Fosso di Rubiana,
  which hung 12 m over the stream at grade, the whole 38.4 m of way 700698462 by Equi Terme and
  22.0 m south of Gragnola at (−1223, 2130). A stream under one runs under the bridge: only
  797861191 and 797865913 still cross at-grade track, each sharing a culvert vertex with it
  (797865758 keeps OSM's own, now on a CTR bridge). A level crossing inside such a polygon stops
  the build (none is).
- **Over an underpass's mouth** (`underpasses` in `rail-spans.ts`): where the track
  crosses a drivable road's tunnel within reach of one of its mouths, a square about the crossing
  joins the CTR's bridge polygons, reaching the road's core half width plus a cell's diagonal
  (w/2 + 2.3 m + 5.7 m) across its centreline either way, so the track is a bridge there: at
  grade, the track's own cells (rank 1 beats a residential road) and its bed held the mouth's grid
  nodes at the rail's level. Over the residential underpass 698940836 at s 6324.6 the CTR's track
  runs 1.8 m south of OSM's: OSM's had buried both its mouths 5.1–5.5 m under the bank, the CTR's
  only the south one, 5.4 m, so a car drove in at the open north mouth, met the bank and was thrown
  about 80 m up. Its 3.5 m CTR bridge piece, east of the road, grows to 20.7 m, and the track
  underpass 696231810 at s 4777.6 (one mouth 5.0 m under) gets 19.4 m;
  both tunnels now open at both mouths at their floors' level (`map/__tests__/rail.test.ts`). A
  path's tunnel gets none: the build cuts no path's mouth.
- **No short segments**: a vertex no other line or piece shares (OSM's other
  vertices only carried its drawing) is dropped where it lies under 2 m from a kept neighbour,
  unless that moves the line more than 0.25 m. On the 0.1 m grid a short segment's heading is
  noise: a 9.4° turn on a 0.54 m segment at (−1055.4, 917.8), ±6–7° zig-zags on 1.1 m segments at
  the Ugliancaldo tunnel's west portal. The line's sharpest vertex turn is now 5.5°, the CTR's own
  at (−1253.1, 2271.8); 3 rail segments under 2 m are left, each between two shared vertices.
- **The build checks** that every shared id survives and that the shipped (rounded) line keeps to
  the surveyed track on the matched at-grade and bridge samples: median 0.02 m, p90 0.04 m, at
  most 0.15 m, where the line cuts the corner of the CTR's 7° kink at the Via Castel dell'Aquila
  crossing (its two vertices stood within 2 m of the crossing node); it throws over 0.2, 0.5 and
  1 m. It prints both figures per piece. It also checks the CTR's level-crossing polygons (`AGE`
  `0122`): each holds a crossing node, and no node within 10 m of one lies outside
  it (the five road nodes lie 1.4–3.0 m inside). The running line is 10 911 m long.
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

- **Tracks meet only at piece ends** (`splitAtJunctions` in `rail-graph.ts`):
  last, every piece is cut at each inner vertex another track shares by id (a switch, two tracks
  crossing), keeping its way's id, so `Rail.id` is not unique. The running track's 73 pieces (36
  of OSM's, cut at the CTR's bridges and over the underpasses) become 75 at Gragnola's two
  switches; the loop is cut in two
  at the stub's.

### 5. Heightmap (`terrain.ts`)

The LiDAR terrain is sampled through the projection (computed exactly on a 50 m lattice,
bilinear in between). Each node of the 4 m grid over the bounds (1951 × 2501 nodes) is the mean
of a 5 × 5 m square of samples. This grid is carved and flattened by the next steps; profiles and water sample the untouched terrain (the "ground"). Elevations run from 147 m
(the Aulella below Gragnola) to 1799 m (the north-west ridge of Monte Grondilice).

### 6. River carving and catchments (`water.ts`, `catchment.ts`)

- The water surface is sampled every 2 m at ground − depth/2. It is made monotone downstream and
  continuous at confluences: a tributary's tail is lowered (by at most 0.25 extra slope) or ponded
  up to the level of the water it joins. The Lucido meets the Aulella below Gragnola.
- Before the carving, the catchment upstream of every water sample is measured (`catchment.ts`):
  the samples are burned 100 m under their own surface into a copy of the grid, which is filled so
  every node drains (priority-flood with an epsilon, Barnes et al. 2014; the grid's edge is the
  outlet), each node routed to its steepest lower neighbour (D8), and the 4 m cells accumulated
  downstream. Each piece starts with what the pieces ending where it begins bring (shared among the arms of a
  fork), and a sample
  keeps the most its own burned nodes gather within a node of it (D8 cuts a bend's corner past a
  node), never less than upstream; nodes within two of another water's are left out, and a piece's
  last sample keeps what came down to it (D8 may route the water a tail joins through it). The
  Torrente Aulella takes 161 km² from beyond the bounds, which hold only its left bank: the Soliera
  gauge's 208 km² (ARPAL), less the Lucido's 47 at its mouth. It takes about 1 s.
- The bed is carved into the grid: depth/2 below the surface inside w/2, a gravel slope out to the
  bed width, then a one-cell bank back to the terrain.

### 7. Road and rail profiles (`profiles.ts`, `terrain.ts`, `rail-levels.ts`)

- Pieces are chained through nodes where exactly two ends meet. Each chain is resampled every 4 m
  from the ground and smoothed with a moving average. Bridges and tunnels are straight between
  their ends, and each end takes the ground 4 m out of it when that is nearer the line's level (a
  tunnel's the lower, a bridge's the higher): at the Ugliancaldo tunnel's west portal the terrain
  model climbs 3.6 m up the hill's face, and the rail's 2.5% grade limit carried 1.2–1.6 m of it
  600 m along the line past Equi Terme; a bridge end on the slope of the Lucido's bank pulled
  Monzone's line 0.7 m under the ground.
- Within each pass, the next chain profiled is the longest one that touches a node an earlier
  chain already set, else the longest left. Elevations spread along the network from where it is
  pinned, so a short link is not pinned at both ends by chains fitted apart (a lane in Codiponte
  between two levels got a 93% straight line that way).
- The profile is then fitted to a grade limit through hard pins: elevations already set at
  shared nodes by earlier chains, and rail clearance bounds. The fit is the midpoint of the two
  grade envelopes, so cut and fill split evenly.
- Where the fit strays more than 4 m from the smoothed ground, the grade limit within 60 m is
  raised in 10% steps, up to 1.5× the class limit.

| Pass (in order) | Grade limit | Smoothing half-window | Rank |
|---|---|---|---|
| rail | 2.5% | 100 m | 1 |
| tertiary (with the SR445) | 10% | 20 m | 0 |
| unclassified, residential | 15% | 20 m | 2 |
| service, track | 20% | 20 m | 3 |
| tracks only the CTR has (written after every road) | the nearest running track's level | – | 4 |

- Each profile is written into the grid: the core (max(w/2 + 0.3 + 2, 3) m, half a 4 m cell past
  the carriageway's edge) takes the road elevation, and the next 8 m blend back to the terrain. A
  core that stopped at w/2 + 0.5 left the outer node of most cells the carriageway's edge crossed
  on the hillside, so the drawn road leaned across with it: under a Panda in its lane more than
  10% at 3.5% of 40,000 sampled positions and more than 20% at 1.2%, enough to roll an Ape over.
  With the wider core those shares are 1.1% and 0.5%, mostly at junctions and road ends. A core a
  whole cell wider (0.9%, 0.4%) cut road banks steep enough to paint as rock 2.5% more often (0.9%
  with this one), and a bank steeper than bare rock (50°) echoes: 17 of the 23 asphalt points of
  a 25 m grid over Monzone hear one (the spawn an echo 312 m away, 1.8 s, off a bank beside a
  road). The wider core also buries more of the narrow streams (under 4 m wide, which
  roads may write over): with a core a cell wider, 664 m of stream ran more than 1 m under the
  terrain against 474 m before, and houses on a bank above a road lost up to 8 m of base (above
  the SR445 near (50, −290)). At junctions the lower rank keeps the cell, so tertiary beats rail and
  rail beats the rest.
- The tracks only the CTR has take, point by point, the elevation of the nearest running track
  (the old yards lie level with the line; Equi's sidings are 17 m from it), set right after the
  rail pass so a road crossing one is pinned to it there. They are written last (rank 4), into
  cells no road took.
- Grid nodes inside the wider streams (w ≥ 4 m) are protected: no road writes them. Bridges and
  tunnels write nothing. Paths and steps are not profiled.
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
  stood 0.46 m in the deck, and now clears it by 1.14 m. The rail stays at least 3 m above a river
  it bridges (w ≥ 4 m); over narrower streams, under the CTR's short bridges, it keeps its level
  and the water dips under the deck ([section 8](#8-water-under-decks-waterts)). A rail tunnel
  passes under everything: the 3.2 km of the line's tunnel from Equi Terme to Argigliano run under
  the streams on the hillside. The rail's output keeps the profile samples where its elevation
  bends by more than 0.03 m (roads: 0.25 m), so the line drawn and driven follows the grid it was
  written into: 823 vertices, 19.0 KB of the JSON line (223 vertices before the CTR).
- The bed against the LiDAR (every 2 m of at-grade line, leaving out the 4 m+ gaps of streams):
  0.26 m off at the mean, 0.10 m at the median and 0.86 m at p90, 432 m of the line more than 1 m
  off (before these rules: 1.18, 0.87 and 2.77 m, 2 932 m). Its grade changes by at most 3.4% over
  20 m (a vertical curve of about 590 m), at 4 places by more than 2% (42 before).
- **Rail bed** (`rail-bed.ts`): once the grid is rounded to 0.1 m, each stretch of at-grade rail
  centreline inside a cell caps that cell's four corners at the stretch's lower rail elevation
  plus 0.05 m, floored to 0.1 m, so no interpolation of the cell (bilinear, or the drawn mesh's
  triangles) stands more than 0.05 m over the rail, and raises them to its higher rail elevation
  less 0.5 m, unless a road's core (ranks 0, 2, 3) or a wide stream's protected bed holds them.
  Within 6 m of a level crossing the road decides. The terrain stood up to 0.84 m over the rail by
  Via Riolo, where two tertiary roads (rank 0) keep the cells beside the line; a corner of a cell
  the line clips lies up to 5.7 m off it, outside the profile's 4.3 m core, and one stood 7 m
  under the track in the Aulella's carve north of its bridge. The pass lowers 2 050 nodes, 25 of
  them by more than 0.3 m: 4.0 m on the slope of the cutting west of Equi Terme at (920, 756), a
  corner 4.7 m from the centreline, 1.5 m at the Ugliancaldo tunnel's east portal, up to 1.3 m by
  Via Riolo. 4 of those 25 lie under a carriageway (up to 0.8 m, under the tertiary 183923158
  beside the line by Via Riolo): there the road's ribbon stands over lower terrain at its edge. It
  raises 43 nodes, 27 of them by more than 1 m, none under a carriageway: up to 11.4 m at (16,
  368), the abutment of the rail bridge 140780349 over Via delle Cave and the Lucido, which the
  river's carve (its gravel bed, outside the protected water) had cut 11.3 m under the LiDAR.
- A bridge or tunnel no profiled chain covers (paths, steps) is a straight line between its ends.
  Under the rail both ends keep the road clearance, as in a profiled tunnel (the pedestrian
  underpass at Equi Terme station).

### 8. Water under decks (`water.ts`)

Bridges keep 2.5 m of clearance over the water: the surface is capped there, settled again
downstream, and re-carved outside road cores. At-grade road crossings imply a culvert, where the
water dips 0.3 m below the road (the two fords over the Aulella, at and below Codiponte, are
such crossings). Water left perched more than 1 m above the terrain (streams that end at a road cut)
drops to the terrain, except inside a wider channel it flows into, and there only while it still
runs downhill: a stream dropped into a river's carved bed never steps back up. The grid is then
rounded to 0.1 m and stored as integer decimetres.

### 9. The railway (`railway.ts`, `platforms.ts`, `rail-clear.ts`)

Once the rail is profiled and its bed laid, the build reads the railway off the shipped (rounded)
rail, so the game finds the same arc lengths in `MAP.rail` (`MAP.railway`).

- **Lines** (`findLines` in `rail-graph.ts`): the rail is a graph whose
  junctions are piece ends ([section 4](#4-the-rail-on-the-ctr)). A terminal is a dead end on the
  map's edge, where the track runs on beyond it. From each terminal a walk goes on at every
  junction the way that turns least (under 60°, headings taken over 5 m: a single 0.3 m end
  segment turns up to 12° on the 0.1 m grid, more than a turnout diverges) and never takes a piece
  twice; a walk that ends at another terminal is a line, and of two between one pair of terminals
  the one turning less in all. A dead end inside the map (a siding's buffer) is no terminal, and a
  ring with no way off the map gives no line. Each line runs the way most of its length was drawn.
  One line here: the Lucca–Aulla line's 75 pieces, 10,910.9 m from the east edge at (4900,
  3609.4) to the north edge at (−1859.6, 3900), every piece in its OSM direction; 3 757.6 m in
  tunnels, 1 181.6 m on bridges. Its speed limits are OSM's `maxspeed`, pieces with one limit
  merged: 85 km/h to Equi Terme's stop (s 4162.2), 80 to Gragnola's track-2 stop (s 10199.1), 85
  on to the north edge.
- **Kinds** (`kindsOf`): a piece on no line is a `siding` when it leads only to dead ends (pieces
  with an end no other track shares, other than on a line, are taken away until none is left), else
  a `loop`: Gragnola's track 1 (two pieces) is the one loop; its stub, Monzone's siding and Equi
  Terme's five pieces are sidings. OSM's `service` tags play no part, so an OSM passing loop or
  siding gets its kind the same way.
- **Platforms** (`platforms.ts`): each CTR `0141` polygon (OSM's `railway=platform`
  where the sheets map no ground) is rasterised at 0.05 m and keeps the cells 1.60 m or more from
  every track centreline out of the tunnels (the ATR 220 is 2.883 m wide), 0.5 m or more past the
  edge of every at-grade carriageway, outside the CTR's level-crossing areas, and no more than 1 m
  under the platform's top (Gragnola's polygon wraps the station building, whose forecourt side
  lies 2 m under the track). Each piece left is traced, simplified to 0.06 m and rounded to the
  0.1 m grid point that keeps those clearances; the shipped rings stand 1.63–1.69 m from the
  nearest track. A piece narrower than 1.2 m, or with tracks under 6 m apart on both sides of
  most of it, is a rail-level walkway, not a platform: Gragnola's strip between tracks 1 and 2
  (4.3–5.0 m apart; 1.74 m wide once clipped). Equi Terme's island platform lies between tracks
  7.1–7.6 m apart and stays one. A platform's top follows the rail head of the line beside it plus
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

- **Stations** (`stationsOf`): per line and station name, the extent along the line of that
  station's platforms within 2.5 m of it and of its station and stop nodes within 5 m, on the side
  of the biggest of those platforms: Equi Terme at s 4103.7–4239.3 (left of the line, which runs
  west there), Monzone-Monte dei Bianchi-Isolano at 6675.7–6779.4 (right, the building's side) and
  Gragnola at 10093.9–10240.0 (left: track 2 trains call along the walkway).
- **Level crossings** (`crossingBoxes`): every vertex a rail piece shares with a road, grouped
  into one box with the others on that road within 10 m, with its graph node (the graph keeps each
  vertex id's node, `buildGraph`'s `ids`) and the line's s at the node on the line: Equi Terme's
  foot crossing (s 4097.7), Via Riolo (6579.8), Viale 20 Settembre (9818.3), Via Castel dell'Aquila
  over both Gragnola tracks (10271.9, two nodes 2.1 m apart) and Via Nuova (10518.1).
- **Clearance** (`rail-clear.ts`): outside the crossing boxes (within 15 m of a
  box's nodes, on its road or within its verges: the crossing road's lanes and verges come within
  2.8 m of the track up to 12.4 m away, Viale 20 Settembre crossing at a slant) and the platforms,
  no walk verge or traffic lane comes within 2.8 m of an at-grade running-track centreline at its
  level (within 2 m of the rail's bed): the ATR 220's half-width, a person's radius (0.35 m) and 1 m
  between them. A road whose verge would is given a narrower one (`verge`, both sides, 0.05 m
  clear); a lane that would stops the build (none does). Two of the three narrowed verges lie
  inside their carriageway, along the whole road: Piazza della Liberazione's walkers go 0.12 m
  inside its edge for its 44 m, Via Riolo's 0.12 m for its 182 m.

  | Road | Nearest its verge came | Verge (was) |
  |---|---|---|
  | Piazza della Liberazione (700763267, service, 7 m), beside Monzone station | 1.93 m | 3.38 m (4.30) |
  | Via Riolo (183923158, tertiary, 4.8 m), along the line from its level crossing | 1.94 m | 2.28 m (3.20) |
  | Piazza Paolo Sist (140780559, 12 m), by the same crossing | 2.76 m | 6.63 m (6.80) |

The stage takes about 0.55 s, most of it rasterising the platforms.

### 10. Collision walls (`walls.ts`)

Walls are segments of at most 16 m. Blocked 4 m cells are traced with marching squares and
simplified (Douglas–Peucker, 1.5 m tolerance). Slopes use a 12 m baseline, so shorter steps
(terrace walls, road cuts) stop no one. Steep cells are majority-filtered (3 × 3) so the walls
follow slopes, not single-cell bumps.

| Wall source | `walk` | `shore` | `drive` |
|---|---|---|---|
| Water cells (within max(w/2, 2) m of the centreline) | no | yes, except on any road or a steep cell | no |
| Slope | > 35°, except on any road | no | > 25°, except within w/2 + 1.5 m of a drivable road |
| Building outlines | yes | no | yes |
| `wall`, `cliff` barriers | yes | no | yes |
| `guard_rail` barriers | no | no | yes |
| Map bounds | yes | no | yes |
| Road-exit caps (4 m inside, where drivable roads leave the area) | no | no | yes |
| Bridge parapets (w/2 + 0.25 m each side of a drivable bridge's deck, where `lines.ts` draws them; open where any other road, tunnels included, crosses under, joins or carries on) | no | no | yes |

Water stops neither feet nor wheels: the player wades and swims, and vehicles float
([water.md](water.md)). The shore walls are the water's edge: the game joins them to the walk walls
for where people and animals spawn, and to the drive walls for the AI drivers' lanes and the
vehicle spawns (`wallsNear`'s `land` and `traffic`). The build still keeps the spawns
and traffic's dead ends clear of the water: it checks them against the walk walls with the shore
and against the drive walls with the water's cells open where a drivable road crosses, as the drive
walls held them before, and stores neither of those.

- Road buffers are padded by half a cell plus the simplification tolerance, so no traced wall
  comes within w/2 of a centreline. The carved banks of the wider streams skip the slope test:
  they are the way out of the water.
- Where a drivable road (not a tunnel) runs through or along a footprint, the house gives way:
  OSM centrelines and CTR footprints disagree by a metre or two, and none of these roads is
  tagged as a passage. `clipBuildings` cuts a corridor of min(w/2, 1.2) m half-width out of the
  footprint (rasterised at 0.2 m and traced like the walls), so the house drawn and its walls are
  one outline. A footprint cut in two becomes two buildings with the same id; slivers under
  4 m² are dropped. Clipped houses lose their hip roof.
- Tunnels, paths and steps under arches only open such a corridor in the walls: the house is
  drawn whole, the passage stays open and the interior stays closed.
- Tree trunks are not stored as walls. `wallsNear` indexes the trees as points and adds a 0.5 m
  square (`pushTrunk`, `TRUNK` in `kinds.ts`) around each tree a query reaches.

### 11. Road graph (`graph.ts`)

Nodes come from shared OSM node ids (clip points get their own), and edges are split to at most
25 m. Where a road leaves the play area, its end is pulled back 8 m, past the exit cap. `traffic`
is the largest connected component of `tertiary`, `unclassified`, `residential` and `service`
edges (the SR445 and living streets included), minus private roads, dead-end tunnel spurs, and
dead-end tips with no room for a car to turn (a 2.3 m circle clear of drive walls and trunks:
lanes that end between houses); tracks are drivable by the player but get no AI traffic. `walk`
is the largest connected component of every edge except tunnels. The build keeps each vertex
id's node (`ids`), so the level-crossing boxes name their nodes without matching coordinates.

### 12. Trees, spawns, districts (`spawns.ts`, `districts.ts`)

- **Trees**: a jittered lattice at one tree per 50 m² inside forest areas. Trees stay out of other
  areas, buildings (plus 2 m), roads (w/2 + 2 m), stream beds and the rail, its loops and
  sidings included (6 m). Sparse trees
  also line the banks of the wider streams. No cap: about 1 012 000 trees, positions rounded to 1 m
  (at most one tree per spot) and a scale of 0.8–1.3 (1.7 MB of the gzipped map file). Placement
  uses a fixed hash, not a random generator.
- **Player spawn**: the Via Cesare Battisti sidewalk nearest the Carabinieri station, with 1.3 m
  clear of walk and drive walls. Cesena uses a central street in its connected traffic network.
  The final rounded position must lie outside every building footprint and have a walk-clear
  route to its street centreline, sampled at intervals no greater than 0.5 m. Wall distance alone
  can accept a point deep inside a building, leaving the player trapped.
- **Parked spots**: one per 8 buildings (797) on the right kerb of tertiary, unclassified and
  residential roads (not bridges or tunnels), at least 12 m from junctions and 9 m from each other,
  with two or more buildings within 40 m, off every carriageway (tunnels included), clear of walls,
  with the car's box at least 2.8 m from at-grade running track (the clearance rule) and 1.94 m from
  a loop or siding (a train's half-width, 1.44 m, plus 0.5 m: a spot by OSM's Gragnola loop stood
  1.4 m from it; measured from the car's centre, the rule kept a spot at (−1645.2, 3301.1) whose
  side stood 2.02 m from Gragnola's through track), and none within 20 m (in a straight line, so
  along any road too) of a level-crossing node: the Codice della Strada (art. 158) bans stopping "in
  corrispondenza o in prossimità dei passaggi a livello". That rule took three spots, 14.7–19.4 m
  from Via Nuova, Via Riolo and Viale 20 Settembre; others took their place. The two nearest the
  Carabinieri station come first (the sim parks their cars there); the rest are drawn in hash order
  from every village's candidates, so each village gets its share. Car parks within 150 m of Monzone
  station add up to 6 nose-in spots each (805 spots in all). The sim decides how many cars to park
  on them.
- **Districts** (`districts.ts`): 14 hand-placed discs (name, centre, radius) for Monzone's
  station, streets and hill clusters, then a disc per OSM `village` and `hamlet` node outside
  them (26: Gragnola, Equi Terme, Viano, Vinca, Tenerano, Ugliancaldo...), then 35 hand-placed
  landmark discs for the unpopulated mountains (Monte Sagro, Pizzo d'Uccello, Foce di Vinca, Cava
  Cattani, Capanna Garnerone..., and the quarries of the Carrara side): peaks, saddles and huts on
  their OSM nodes, quarries on their pits, localities and ridges centred by hand on the slope they
  name. None overlaps a village disc. A `locality` (a named
  hillside or field, like I Pianelli above Equi Terme) gets none: it would claim the village's
  station and spa. Each building outside Monzone's discs goes to the nearest place node within
  600 m; the place's disc is centred on its node and covers 90% of those buildings plus 10 m,
  clamped to 80–400 m. `districtAt` picks the disc the point is relatively closest to, or the
  nearest rim outside every disc.

## File format

`monzone.bin` is gzip (level 9) of one JSON line, a newline, then five packed sections. The game
loads it as one asset: the browser host downloads and gunzips it and hands the bytes to
`provideMap` (`src/sim/map/packed.ts`) before anything imports the map module; Node (the tests, the
tools, `ritmo-devtools lint`) reads it from disk. It is 6.7 MB, 28.4 MB gunzipped. Gzipped on its
own, the JSON line is 1.5 MB, the heightmap 2.8 MB, the walls 0.7 MB and the trees 1.7 MB. The
base64 JSON it replaced was 36 MB, 14.4 MB gzipped.

`MonzoneMapJson` in `src/sim/map/index.ts` is the schema of the JSON line, `MonzoneMap` the decoded
map the game reads (the railway's types, `Railway` and its parts, in `src/sim/map/railway.ts`).
Polylines and rings are flat `[x0, y0, x1, y1, ...]` arrays. Rings are open: outer rings
counter-clockwise, holes clockwise.

| Field | Contents |
|---|---|
| `version` | `2` (`MAP_VERSION` in `packed.ts`; `decodeMap` throws on any other, so a stale file says so: 2 added `railway` and `verge`) |
| `origin`, `mPerDeg` | projection origin (lat, lon) and metres per degree |
| `bounds` | play area `minX`, `minY`, `maxX`, `maxY` (m) |
| `heightmap` | `cell` (4 m), `cols`, `rows`, `x0`, `y0`; the nodes (integer decimetres, row-major, row 0 = south) are the first packed section |
| `roads` | `id`, `cls`, `name?`, `ref?`, `w`, `surface`, `oneway?`, `bridge?`, `tunnel?`, `layer?`, `verge?` (where people walk, m from the centreline on either side, on the three roads pulled in off the railway; else w/2 + 0.8 m, 0.3 m on paths, steps and tracks), `pts`, `z` (surface elevation per vertex) |
| `buildings` | `id` (OSM id, or negative for the CTR), `kind`, `name?`, `h` (wall height above `z0`), `z0` (lowest ground under the footprint), `style`, `ruins?`, `tint`, `outer`, `holes?` |
| `water` | `id`, `kind` (`river` or `stream`), `name?`, `w` (the water's width), `bed` (the gravel bed's half-width), `depth` (the bed is carved `depth`/2 under `z`), `pts`, `z` (the built water surface per vertex), `area` (the catchment upstream of each vertex, km²) |
| `rail` | `id` (OSM way, negative for a track only the CTR has; not unique: the pieces cut from one way at its switches and the CTR's bridges share it), `kind?` (none on a line; off the lines `loop` or `siding`, from the topology), `bridge?`, `tunnel?`, `pts`, `z` (the bed under the sleepers per vertex, the rail head `RAIL_LIFT` 0.12 m higher, where the rails are drawn; at grade, more than 6 m from a level crossing, the terrain is at most 0.05 m higher and 0.5 m lower, but beside a lower road along the line). Tracks meet only at piece ends; no polyline repeats a vertex |
| `railway` | `lines`: `{ pieces: [{ rail, rev }], maxspeed: [[from s, to s, km/h]] }`, each a path of running pieces (`rail` indexes `MAP.rail`, walked backwards when `rev`) from terminal (a dead end on the map's edge) to terminal, consecutive pieces sharing an end vertex, s in m from its first vertex; `stations`: `{ name, line, s0, s1, side }` (side 1 right of the line's direction, −1 left), by line and s0; `crossings`: `{ road, nodes, x, y, line, s }` (`road` indexes `MAP.roads`, `nodes` the graph's nodes, `line` −1 and `s` −1 where only a loop or siding is crossed); `platforms`: `{ area, walkway?, name?, axis, top }` (`area` indexes `MAP.areas`, `axis` the line's centreline along it, `top` per axis vertex in m a.s.l.) |
| `areas` | `kind` (one of `AREA_KINDS`), `name?`, `rings` (outer first, then holes); the platforms (`platform`) and walkways (`paved`) last |
| `barriers` | `kind` (`wall`, `guard_rail`, `cliff`), `pts` |
| `pois` | `id`, `kind` (`key=value` or `area:<kind>`), `name?`, `x`, `y` |
| `districts` | `name`, `x`, `y`, `r` |
| `graph` | `xy` (node coordinates), `edges` (flat `a, b, roadIndex` triples), `traffic`, `walk` (edge indices) |
| `walls` | `walk`, `shore`, `drive`: segment counts; the `ax, ay, bx, by` segments are the second, third and fourth packed sections |
| `trees` | tree count; the `x, y, scale` triples are the last packed section |
| `spawns` | `player` and `parked`: `{ x, y, angle }` |

The packed sections follow the newline in file order: heightmap, walk walls, shore walls, drive walls, trees
(`packMap` in `src/tools/pack.ts` encodes, `decodeMap` in `src/sim/map/packed.ts` decodes; the
build throws if a value does not fit). Each holds n integers as the zigzag-coded difference
(0, −1, 1, −2... stored as 0, 1, 2, 3...) from the value `stride` places back, split into byte
planes: the low byte of every value, then the next byte of every value. Neighbours differ little
and like bytes sit together, which is what gzip compresses best.

| Section | Integers | Bytes | Stride |
|---|---|---|---|
| heightmap | decimetres (int16), each row delta-coded from its first node | 2 | `cols`: the node to the south |
| walls | decimetres from a point 100 m south-west of the bounds' corner | 4 | 2: the previous x or y |
| trees | whole metres from the same corner (trees stand on whole metres), the scale in hundredths | 2 | 3: the previous tree |

Decoding is exact: the same numbers a one-decimal JSON array would give.

Profiled roads and rail carry extra points where the elevation bends between OSM vertices (dips
under the rail, crests). Graph edges run a → b in the OSM way direction, so a `oneway` road may
only be driven from a to b. Game code reads the map through `src/sim/map/index.ts`: `MAP`,
`graph`, `heightAt`, `wallsNear`, `districtAt`, `roadClassOf` and `buildingStyleOf`, plus two
broad phases the sim and the audio host share: `buildingsIn` over the building boxes
(`buildingBoxes`, indexed like `MAP.buildings`) and `treesIn` over the trees. `platformTop` in
`src/sim/map/ground.ts` gives a platform's top at a point (its axis's nearest point), and `groundZ`
stands people on it (or on the terrain, where that is higher). It never reads the file itself.

## Checks and tools

`src/sim/map/__tests__/map.test.ts` checks the built map in about 4 s: heightmap coverage, spawns
clear of walls and off traffic lanes (with parking in each village the map was widened for: Equi
Terme, Gragnola, Colognola, Campiglione, Viano, Vinca, Ugliancaldo and Tenerano), no walls on roads,
no drivable road inside a footprint, closed building interiors, one traffic component reaching the
station, Monzone Alto and each of those villages, grades within 1.5× the class limits (a track
shortcut pinned at both ends by the bends of one quarry road may only be the straight line between
them), bridge and underpass clearances (a road bridge 5.4 m or more over the rail's bed), no perched
water, the Lucido's widths, catchments growing downstream with no jump at a tributary's mouth (the
Lucido's 47 km² at its mouth, the Aulella's 208 leaving the map), no walk or drive wall in a wide
river and shore walls by it, and valid names, classes, styles, area kinds and districts (each of
those villages is its own HUD name, Equi Terme's station and spa included, and Monte Sagro and Pizzo
d'Uccello name themselves; CTR street names cased like "Via XX Settembre" and "Via Castel
dell'Aquila"). Run `pnpm test` after every `pnpm map`. `src/sim/map/__tests__/packed.test.ts`
round-trips a small map through `packMap` and `decodeMap` (negative values, the widest 2-byte
deltas, an empty section, a newline inside a name) and checks that a value or delta too big for its
section, or a file of another version, throws. `src/tools/__tests__/shp.test.ts` subsets a synthetic
shapefile with `subsetShp` and reads it back, `src/tools/__tests__/ctr-rail.test.ts` checks the
track chaining, the tunnel cut and the clip on synthetic lines and reads synthetic CTR rail layers
(`shapefile.ts` beside them writes those). `src/sim/map/__tests__/rail.test.ts` checks the rail in
the built map: the running line is one chain from the north edge to the east edge (10.85–10.95 km),
its loop (two pieces) ending on it and Gragnola's loop the track by the station building, every kind
one of `RAIL_KINDS`; at grade, the rail meets roads and water only at vertices they share, level
with the road (Via Riolo, Viale 20 Settembre, Via Castel dell'Aquila twice, Via Nuova, and Equi
Terme's foot crossing); no rail, road or water polyline repeats a vertex, and a rail segment under
1.85 m joins two shared vertices; no terrain stands more than 0.05 m over at-grade track more than 6
m from a level crossing, nor more than 1 m under it but beside a lower road running along it (within
30°, its core within one cell); no 40 m chord of the running line curves tighter than 250 m (the
line's tightest curves are 300 m; chords under 40 m see the CTR's own drawing, 193 m at 20 m); and a
parked car's box keeps 2.8 m from at-grade running track and 1.94 m from a loop or siding. On the
map before the rail moved onto the CTR the chain, crossing, terrain-over-track and parked-car checks
fail; the curve check fails without the spline's reweighting (249 m at the Terma tunnel's south
portal); on the map before the switches, the bridges and the parked cars were mended the repeated
vertex (Gragnola's loop at the stub's switch), the ground (8.2 m under the track north of the
Aulella bridge) and the parked car (2.02 m) fail. In `src/tools/__tests__`, `rail-match.test.ts`
checks the matching (a run keeps to its track past a nearer parallel one, tunnels and track ends
stay unmatched), the simplification, the smoothing spline, `insertOn` giving its id to a vertex
already there and `pruneShort`; `conflate.test.ts` conflates a synthetic line with a tunnel, a level
crossing, a culvert, a loop and a siding crossed by roads, the half-segment guard, Gragnola-style
swaps, a line no CTR maps (kept as OSM has it) and the CTR's crossing polygons; `rail-spans.test.ts`
slides a bridge end to keep its river (and its margin), adds a culvert, leaves a stream under a CTR
bridge alone and cuts at-grade track into the CTR's bridges; `rail-graph.test.ts` cuts a piece at a
switch, finds a line straight through turnouts past a passing loop, a yard and a spur, takes
junction headings over 5 m, and finds no line on a ring, with each piece's kind;
`rail-levels.test.ts` bounds the rail over a tagged and an untagged underpass, under a road bridge,
at a level crossing (no pin) and over a river and a stream; `profiles.test.ts` levels a tunnel's
portals and a bridge's ends with the ground outside them; `rail-bed.test.ts` lowers a grid under a
line, raises the corners far under it but a kept one, and levels a siding on the line beside it;
`spawns.test.ts` parks cars off running track, off a siding and away from a level crossing;
`platforms.test.ts` clips a platform off a track, a road and a crossing area, makes a strip between
close tracks and a narrow one walkways, and leaves out the ground far under a platform's top;
`railway.test.ts` checks the speed limits, crossing boxes and stations; `rail-clear.test.ts` narrows
a verge beside a track, leaves one at another level, in a box or on a platform alone, and throws for
a lane. `src/sim/map/__tests__/railway.test.ts` checks `MAP.railway`: each line runs terminal to
terminal, its pieces sharing their end vertices bit-identically, every running piece on one (today
the one line, east edge to north edge); the speed limits cover it, 80 km/h from Equi Terme's stop to
Gragnola's; the three stations lie along their platforms, a platform within 4 m of the line's side
at each one's middle; each crossing box's nodes are vertices of its road and of the rail, the line's
s on one of them, and every vertex an at-grade road shares with at-grade rail is in a box; the
platforms stand 1.55 m or more from every track and 0.44 m or more past every carriageway's edge
(0.5 m less the rings' 0.06 m simplification), their top the rail head plus 0.25 m (Gragnola's
walkway 0.02 m) and `groundZ` on them their top or the terrain where that is higher; the line's
grade changes by under 4% over 20 m, and under 2% through a level crossing (the map before the fixes
changed it 4.1% at s 6269). `src/sim/map/__tests__/clearance.test.ts` checks the clearance rule on
the verges people walk (`walkSide`) and the lanes cars drive (`laneSide`), and that no parked car
stands within 20 m of a crossing node; on a map built without the narrowed verges and the parking
rule, both fail (Piazza Paolo Sist at 2.75 m and Via Riolo at 1.92 m, a car 19.4 m from Viale 20
Settembre).

The part tools ([Adding a part](#adding-a-part)) are checked offline in `src/tools/__tests__`:
`cartoteca.test.ts` parses GML and GetFeatureInfo answers trimmed from real ones (a hole, a
multipolygon written as one `ms:GEOMETRY` per polygon, a tile in lots 004 and 006) and keeps
`insidePoints` inside a wedge, a footprint with a hole and one under 100 m tall;
`dtm-mosaic.test.ts` pins `lucido`'s crop to the formula `fetch-rt` used before parts and reads a
synthetic grid; `net.test.ts` serves a local HTTP server to check the `User-Agent`, the retry of a
5xx (after 2 s, so the file takes 2.2 s), the immediate 4xx and `overpass` moving on from a 504 or
an answer with a top-level remark (a server timeout) but not from a tag named `remark`;
`manifest.test.ts` pins `lucido`'s 25 sheets, 66 tiles (47 of 2010 before 19 of 2012) and one 10 m
DTM; `pick-sheets.test.ts`, `pick-lidar.test.ts` and `pick-diff.test.ts` check the area rule, first
wins and the holes on synthetic grids; `footprint.test.ts` the outline of an L, clusters, a road
that leaves and comes back, one that runs off the query box (unresolved) and a mistyped flag;
`fetch-osm.test.ts` the split on HTTP 400 with a fake server; `coverage-grid.test.ts` and
`coverage.test.ts` first wins, the tally, ring assembly, no picks, and a WFS error answer never
cached; `ortho.test.ts` and `ortho-wms.test.ts` the pixel mapping, tiles, licences (an unlisted
sibling flight is look only) and an error answer for capabilities; `playtest.test.ts` the spot
script and, on a fake Chrome, a command's own timeout and the socket closed when a tab cannot open;
`map-diff.test.ts` each category's change on small maps and a key it does not compare;
`geometry.test.ts` `clipRing` to a box.

`node src/tools/preview-map.ts [pxPerM=1] [minX,minY,maxX,maxY] [out.png]` draws a top-down PNG of
the built map (the running line dark, loops and sidings purple, rail bridges with a pale deck,
platforms pale, walkways sandy, level-crossing nodes white). It writes `.research/map-preview.png`
by default.

## Adding a part

The map grows one part at a time (issue #3 holds the extent, the order of the parts and the
runbook each part follows). A part is a key in `PARTS` (`src/tools/region.ts`) with its rectangles
in local metres, on 100 m multiples; today's map is part `lucido`. Its sources are its manifest,
`data/parts/<part>.json`. The tools below scope a part and check it. `rt-index`, `coverage` and
`footprint-check` write their scratch in `.research/<part>/` (gitignored), `ortho` in
`.research/ortho/` unless given a file, `playtest` in the folder it is given; every request names
only the project in its `User-Agent` (`net.ts`), and the tools print paths relative to the
repository. Measured on `lucido` on 2026-10-29.

- **`pnpm footprint-check <part> [--refresh]`** (`footprint-check.ts`, geometry in `footprint.ts`)
  checks what the part's edges cut through: one Overpass query over the part's box + 1 km (place
  nodes, building centres, highway ways; cached in `footprint-osm.json`). It reports the places
  within 300 m of an edge, clusters of 5 or more buildings linked at 50 m with a member within 300 m
  of one, and the roads that leave the part and come back (ways join at shared nodes, so a road
  split into several ways counts); paths and steps are notes, not findings. An edge along another
  part's rectangle is a seam and never a finding. A road whose way out runs to within 50 m of the
  query box's edge without coming back is listed as unresolved: the 1 km pad is how deep the check
  sees. It writes `footprint.json`. `lucido`: 32 places, 23 clusters (Argigliano, 188 buildings, is
  cut 2 m inside the east edge), 16 drivable re-entries (the SR445 runs 780 m outside the north
  edge), 15 path notes, 7 unresolved roads (the SR445 north, the SP10 west) and 2 paths; 99 s with
  the query, 0.2 s cached.
- **`pnpm rt-index <part>`** (`rt-index.ts`, readers in `cartoteca.ts`) lists the cartoteca over
  the part's EPSG:3003 box + 500 m: WFS GetFeature on `rt_cartoteca.ctr2k` (sheet frames by year),
  `lidar2k` (the tiles' data footprints by lot), `dbt.2k` and `lidar2k_DSM_autocorrelazione_2021`.
  The index has no archive names, so it asks a text/html GetFeatureInfo inside each tile's own
  footprint (`insidePoints`: the widest inside spans first, clear of the 50–70 m band below the
  north edge where the server answers nothing, up to 16 points, because the server's footprints do
  not match the WFS's to the metre) for the MD5-suffixed DTM archive and the owner, whose licence
  the answer states (RT: CC BY 4.0; MATTM: CC BY-SA 3.0 IT). It HEADs every 2019 sheet, DTM tile
  and DSM element and writes `index.json`. `lucido`: 102 CTR frames (30 of 2019), 99 LiDAR tiles (54
  of lot 004, 25 of 005, 20 of MATTM's 006), 7 DBT blocks, 15 DSM elements, all archives named and
  answering 200, in 14 s.
- **`pnpm pick-sheets <part> [--write]`** keeps the 2019 sheets whose mapped area (`AZR`), clipped
  to the part's rectangles, covers a positive area, and lists the frames that meet the part with
  only older sheets. Without `--write` it prints the difference from the manifest's `ctr`; with it,
  it stores them sorted by name. `lucido`: the 25 sheets of the manifest (8.66 km² of `AZR` in the
  78 km² play area); the 5 dropped (23D02, 23D04–07) lie wholly north of it, and 24 frames meet it
  with only 1987, 1993 or 2009 sheets (22D02–15 of 2009 on the Carrara side).
- **`pnpm pick-lidar <part> [--lots 004,005] [--write]`** replays `fetch-rt`'s first-wins mosaic
  (`dtm-mosaic.ts`, the same crop and reader) on a one-byte mask: RT's tiles of the named lots, in
  lot order then by sheet, each kept when it writes a cell no earlier tile wrote, over the crop
  `fetch-rt` mosaics (the EPSG:3003 box round the part's rectangles, an L's notch included, until
  issue #7). MATTM's lots are skipped, with their licence. It reports each tile's area and the holes
  left for the 10 m DTM, and without `--write` the difference from the manifest's `lidar`. `lucido`
  (19 s, 565 MB): the manifest's 66 tiles; holes 654 734 m² in 5 pieces, the largest 361 141 m²,
  exactly the cells `fetch-rt` fills from the 10 m DTM. PR #2 had found its 65 tiles with a
  GetFeatureInfo grid 640 m apart, which missed `22d14` of lot 004, a 98 m wide 2010 sliver below
  Picco di Navola (19 518 m² in the crop, local x 3843–3943, y −5750…−5473) that `pick-lidar` added:
  506 heightmap nodes moved there, 474 of them under 0.5 m and none on average, up to 8.4 m on the
  steep rock face, where the 2010 and 2012 flights classify the ground differently. The `dtm10` list
  is written by hand, from the provinces the holes lie in.
- **`pnpm coverage <part> [--refresh]`** (`coverage.ts`, raster in `coverage-grid.ts`) tallies, per
  comune (OSM `admin_level=8` boundaries), the part's area mapped by the manifest's 2019 sheets, by
  each LiDAR lot (the index footprints in manifest order, first wins) and by no LiDAR, and the UCS
  2019 woods (311–313, 324) against OSM's forest, on 10 m cells; it stops when the manifest holds no
  picks yet. It prints the markdown table for the PR and writes `coverage.md` and `coverage.png`.
  `lucido`: 6 comuni (Fivizzano 50.62 km²); CTR 11.1%, lot 004 78.6%, lot 005 20.5%, no LiDAR 0.66
  km² (0.7% over the mosaic's holes: the footprints' slivers and the 10 m cells); OSM marks 92.7% of
  the 54.69 km² of UCS woods as forest.
- **`pnpm ortho <x0>,<y0>,<x1>,<y1> [layer] [out.svg] [--px <m>] [--refresh]`** (`ortho.ts`,
  `ortho-wms.ts`) draws a Regione Toscana orthophoto crop (WMS GetMap in EPSG:4326, which maps
  linearly onto the local frame; 0.5 m a pixel by default, tiled past 4096 px) with the built map's
  building outlines, the `STONE_CORES` discs and each stream's water width and bed over it, for
  placing the hand tables. The outlines sit within 1.8 m of the roofs on the 2010 flight
  (`rt_ofc.2k10`, the default) and 3.6 m on 2021's, in varying directions: roof lean. Its licence
  table follows the layers' metadata: a layer is traceable only when its abstract names Regione
  Toscana (or IGM-RT) as the owner and it links an RT record granting CC BY, as the 1954 flight
  (`10k54`) does. AGEA's flights (`rt_ofc.10k13` and `5k25` among them), Blom's (`10k07`,
  `2k11.aulla`), IGM-RT's 1960s flights (`10k63`, `10k65`, `10k68`) and the layers without an RT
  record (`10k88`, `2k06`, `5k12`) are look only, never traced, and so is any layer the table does
  not list (only band variants such as `.nir` or `.grey.rt` take their flight's row); the tool warns
  and marks the image.
- **`pnpm playtest shots|heap`** (`playtest.ts`) drives a headless Chrome already running
  ([docs/standards/playtest.md](standards/playtest.md)) in a tab of its own: `shots <url> <outdir>
  <name>:<x>,<y>[,<texels/m>] … [map]` pins the view on each spot (dev builds only: it needs
  `window.gta`) and writes a PNG each, `map` the full map; `heap <url>` prints the first frame (the
  card's "Press any key"), the slowest and p99 frame and the JS heap after a forced GC. `lucido`,
  production build: first frame 0.91–0.98 s, slowest frame 16.8 ms, heap 250 MB (array buffers
  included); dev build 1.01 s and 274 MB.
- **`pnpm map-diff <a.bin> <b.bin>`** (`map-diff.ts`, `diff-lists.ts`) prints, category by
  category, what differs between two built maps: heightmap nodes (count, largest and RMS
  difference, their box), walls, trees, roads, buildings, water, rail, areas and the rest, matched
  by id or as multisets, so order never counts, and any key it does not know as its own block. It
  compares two builds of one format version (`decodeMap` refuses another) and exits 0 for "no
  differences", 1 when they differ and 2 on bad arguments or a file it cannot read. Two builds of
  `lucido`: no differences, 0.4 s.

Until issue #7 builds the map tile by tile, only `lucido` is fetched and built: `pnpm fetch-osm`
and `pnpm map` cover the Lunigiana region's bounds (`BOUNDS`; `--region cesena` builds the separate
Cesena map instead, and the part tools refuse it), and `pnpm fetch-rt` reads one part's manifest and
stops when `PARTS` holds more than one (a second part would widen the mosaic's crop over the land
between them, all of it holes for the 10 m DTM) or the manifest lists more than one 10 m DTM.

## Known data limitations

- **The terrain is 4 m.** The LiDAR resolves 1 m (stored at 2 m), but the game grid averages it
  over 4 m cells: terrace walls, steps and narrow road benches are smoothed into slopes. Slopes
  come from a 12 m baseline. The LiDAR is from 2010 (2012 on the Carrara side), so earthworks
  since then are missing: the quarry floors of the Sagro and Solco basins have moved since, and
  the OSM and UCS quarry outlines (2019–2026) do not match the terrain cut there. The datum
  residual is fitted on the 2010 flight; the 2012 tiles agree with it within about 0.2 m of
  elevation, but their horizontal fit is not checked (no CTR buildings stand there). The three
  10 m DTM patches (south of Tenerano, Cava Bardiglio) are smooth: the 1:10 000 map they come
  from misses the small relief.
- **The rail is the CTR's where the CTR maps it, and OSM disagrees at Gragnola.** OSM draws
  Gragnola's loop on the east track, its "main" way crossing over to the west track inside the
  station and a south switch at (−1674.0, 3189.9); the map follows the CTR, the orthophoto and
  RFI's track use instead ([section 4](#4-the-rail-on-the-ctr)), so OSM's loop ways and that switch
  are not used. Where the CTR has no line (the tunnels, the 190 m north of the Terma tunnel), the
  track is OSM's, moved and smoothed: the tunnels' axes are estimates; the 214 m to the north edge
  are OSM's drawing, moved 1.8 m. The CTR draws curves with a vertex every 12–21 m turning
  2–5.5°, so the running line has kinks a train's cars feel (193 m over 20 m chords at (−1253,
  2271)). The CTR is from 2019: Monzone's and Equi Terme's old sidings may since have been lifted.
  The Via Castel dell'Aquila track-2 crossing slides 1.60 m of a 3.26 m road segment, 0.03 m inside
  the half-segment guard, so an OSM edit there can stop the build. Where a road runs beside the
  line above it (Via Riolo), the rail bed leaves the road's ribbon up to 0.8 m over the terrain at
  its edge.
- **The 4 m grid holds one level where a road runs beside the line below it.** By the Aiola
  tunnel's west portal the tertiary 542115787 runs 5.4 m beside the line and 6 m below it, south of
  Gragnola the Via Provinciale 9.6 m off and 6.7 m below: the road's core keeps the cells, so 26 m
  of track stands up to 5.7 m over the drawn ground there and 1 m at (−1248.6, 2001.7). The
  retaining walls between them are for the render to draw.
- **The rail's level is the LiDAR's, smoothed under a 2.5% grade limit.** The CTR's track lines
  carry no heights. The bed lies within 0.10 m of the LiDAR at the median and 0.86 m at p90
  ([section 7](#7-road-and-rail-profiles-profilests-terraints-rail-levelsts)); where the ground is
  steeper than the limit allows or bends within the 100 m smoothing it stays off: 1.1 m under the
  ground west of Equi Terme (s 4250–4500), 0.89 m along Monzone's station (s 6750–7000), 1.3 m
  south of Gragnola (s 9500–9750), 0.75 m either side of the Terma tunnel, and up to 2.5 m over it
  on the 214 m to the north edge, where the Aulella bridge holds it 3 m over the river. The short
  bridges the CTR maps over ditches keep the line's level, under 3 m over their streams.
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
  one across the line counts towards its extent, not its side.
- **A narrowed verge holds along its whole road.** `verge` is one value per road, both sides:
  Via Riolo's 2.28 m keeps its walkers 0.12 m inside the carriageway's edge for all its 182 m, and
  Piazza della Liberazione's 3.38 m 0.12 m inside for all its 44 m, not only along the line.
- **Roads are profiled, not copied.** Road surfaces follow the LiDAR within 0.5 m on Monzone's
  provincial roads (90th percentile), but the steep lanes of the hill villages are steeper than
  the 15% class limit and are fitted up to 3 m off the terrain there. Bridges come from the OSM
  tags: the LiDAR terrain has no decks.
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
- **The CTR is from 2019** and maps only the villages and the settled valleys; OSM fills the rest
  (about 610 buildings: huts, quarry sheds, the Carrara side). Road widths fall back to the class width where the CTR has no road surface (parts
  of the SR445 keep 6.5 m), and a surface that spans several streets lends its name to all of them.
- **Facade styles are a judgement.** The stone cores are discs traced by eye on the orthophoto;
  many old houses in the cores are plastered in reality, and a whole hamlet of up to 200
  buildings takes one style.
- **River widths are one value per river.** The Aulella's 12 m water and 26 m bed fit Gragnola
  better than the wooded channel at Codiponte; the gravel bars of the Lucido at Pian del Molino
  are wider than its 22 m bed. The Vinca branch below Vinca is one OSM way, so its 8 m fits the
  valley floor below the SP59 bridge but not the 3–6 m gorge just below Vinca. The LiDAR still
  shapes the banks.
- **Land cover is 1:10 000.** The UCS polygons (0.5 ha minimum) generalise the edge between rock,
  pasture and wood; tree species are not mapped tree by tree (conifers are a flat 3% of the woods,
  their share in the UCS woodland around the valley).
- **Some names only exist on addresses.** The vote can pick the wrong piece of road. Culverted
  waterways are dropped; at-grade crossings imply a culvert instead.
- **Re-downloading changes the map.** `pnpm fetch-osm` pulls current OSM edits; `data/raw` is the
  source of truth.
