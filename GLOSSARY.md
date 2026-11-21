# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana built from open survey data. These are the project's own words; `docs/` says how each thing behaves.

## Map build

**Bake**:
A table the map build works out by running the game's own code on the provisional map, because it reads what the game holds only near the player; the provisional map leaves it empty. A bake reads the provisional map and the whole map's vectors, never another bake (the farms' building centres are part of the farms bake).
_Avoid_: derived (the global file's table for readers far from the player, which also holds copies that are not bakes), precompute, cache

**Landing**:
Where a bake's value goes in the map: a key of the global map or of one of its records (`derived.mouths`), or, for the water's floors alone, the water pieces in the tiles. The provisional map holds each landing's empty value.
_Avoid_: target, destination, slot

**Provisional map**:
The map as cut, with every bake still empty, handed to the game's code during the build so the bakes can run on it.
_Avoid_: draft map, unbaked map, partial map

## Map access

**Listed tile**:
A tile the map has a tile file for. A region whose parts make an L lists none in the notch.
_Avoid_: tile on the map, existing tile

**Map source**:
Where one run of the game, a test or a tool gets its map files: the global file, once, before the map is read, and any listed tile a lookup needs that is not resident. A run has one map, chosen before anything reads it. It may come from the disk, the download, the provisional map or an edited map.
_Avoid_: loader, provider, store, map backend

**Resident tile**:
A listed tile that the host has handed over and not yet let go. Which tiles are resident is the host's business alone: no answer the game gives depends on it.
_Avoid_: loaded tile, cached tile, streamed tile

## Map files

**Map file**:
One of the files a built map ships as: the global file or a tile file.
_Avoid_: bin, map blob

**Global file**:
The map file holding everything sparse and topological (roads' attributes, the graph, the railway, the tile list, the baked tables) and the coarse grid, read once at load.
_Avoid_: main file, index file

**Tile file**:
The map file of one tile: its square's dense layers and the vectors round it, read as the player nears it.
_Avoid_: tile (alone, when the file and not the square is meant), chunk

**Line**:
The JSON line that opens a map file: what is sparse in it, and how many values each of its sections holds.
_Avoid_: header, JSON header

**Section**:
One packed run of integers after a map file's line, holding one array of the map, one field of a baked table's entries (the parked spots' flags), or every xy array of a tile's vectors. A layer may span several sections (a tile's walls: their coordinates, ids and levels).
_Avoid_: part (a part is a piece of a region), chunk, layer, block

**Layout**:
The ordered list of sections one kind of map file holds after its line, each with how many bytes a value takes.
_Avoid_: schema, file order, spec

**Format version**:
The number a map file carries saying how its line and sections are laid out; the game refuses a file of any other.
_Avoid_: map version, schema version

**Upgrader**:
What reads a map file one format version back as one of today's, so two builds either side of a format change can be compared.
_Avoid_: migration, converter

## Ground

**Ground**:
Where things stand at a point on one of its levels, in metres above sea level: the terrain, a road, a deck, a tunnel floor or a platform. A person's or an animal's is its footing, a vehicle's its wheels' ground.
_Avoid_: Surface (that is the material underfoot), floor, height

**Terrain**:
The land as its mesh is drawn, each 4 m cell split along its south-west to north-east diagonal.
_Avoid_: DEM, heightmap (those are its sources), ground

**At grade**:
On the level of the terrain: a road that is neither a bridge nor a tunnel, or the ground with no deck or tunnel taken into account.
_Avoid_: Ground level, flat

**Deck**:
The level a bridge carries, its road's or its track's top.
_Avoid_: Bridge (the whole structure), span

**Tunnel floor**:
The level a tunnel carries, under the terrain.

**Platform**:
A station platform or rail-level walkway whose top is ground.

**Profile**:
A road's or a track's elevation along its line, one value per vertex.
_Avoid_: Z, elevation line

**Lift**:
How far a road's surface stands over its profile, by road class.

**Drape**:
How a road's ribbon at grade is drawn on its road's surface where the terrain would stand through it between its corners: cut along the terrain's folds, each piece on the surface (`drape`); a painted line lies on its ribbon as drawn the same way (`layOver`).
_Avoid_: Conform, project, snap

**Walkers' verge**:
How far either side of a deck or a tunnel's line someone on foot is still on its level.
_Avoid_: Sidewalk, kerb

**Approach**:
The way at grade that leads onto a deck or into a tunnel and meets it at its level: a road's, and since issue #19 a path's or steps', which closes its offset from the terrain at its class's grade from the deck's level until it meets the ground.
_Avoid_: Ramp (a motorway or trunk link), access, lead-in

**Twin carriageways**:
Two carriageways of one road, each its own oneway way, that overlap in plan: they keep within 1.5 m of each other's level where they overlap (`TWINS`).
_Avoid_: Dual road, double road, parallel roads

**Twin track**:
A track running beside another of its kind (both on bridges, both in tunnels or both at grade) on one formation, no gap over 6 m between the tracks lying from one to the other, whatever their headings (farther apart, within 15° of parallel and parting by a 2:3 bank): the one fitted later keeps to the other's level.
_Avoid_: Double track, parallel line

**Knot**:
A sample of a deck's profile where its shipped line bends to keep to its twin track, or one of the deck's ends: the deck runs straight from knot to knot.
_Avoid_: Vertex (OSM's), bend (any change of grade)

**Ground model**:
The one set of rules that turns ground data into the ground at a point, for the game, the map build and the tests alike.

**Ground data**:
What the ground model reads: the terrain's nodes, the roads' segments with their profile, lift and walkers' verge, and the platforms.
_Avoid_: Surface source

## Standing and rolling

**Footing**:
The ground under a person or an animal, on the level it is on: a bridge's deck, a tunnel's floor, a platform or the ground at grade. On foot it is what they stand on; swimming, where its feet hang in the water, 0.7 of its height under the surface and never under the bed; for the player driving, the ground under the vehicle or train they drive. Every person and animal always has one.
_Avoid_: level (reserved for whether two things meet), standing height, ground (for a body on foot)

**Wheels' ground**:
The ground a vehicle's wheels stand on, on the level it rolls on; the vehicle's counterpart of a footing.
_Avoid_: vehicle level, chassis height

## Meeting

**Level**:
The height a body or a wall is judged at when it meets another, m a.s.l.: a person's or an animal's footing, a vehicle's wheels' ground (pitched), a train car's rail head, a wall's own. Bridges, underpasses and tunnels put several levels over one point of the map.
_Avoid_: height, z, elevation, floor

**On one level**:
Two levels standing within 2 m of each other. Bodies meet, and a wall stops a body, only on one level.
_Avoid_: same height, same floor, level with

**Meet**:
What two bodies on one level can do at a point: touch, see or scare each other, get in. Bodies not on one level pass as if the other were not there.
_Avoid_: collide (only one kind of meeting), interact

**Point level**:
A level taken as one height over the whole body: a person's, an animal's, a train car's, a wall's.

**Pitched level**:
A road vehicle's level: its wheels' ground under its middle, rising or falling along its axis with its pitch, so its two ends can stand metres apart on a steep lane.

**Level toward a point**:
A road vehicle's level as read toward a point: along its pitch out to its bumpers, and past a bumper rolled on over the ground along its heading, as its wheels would find their way onto a deck or into a tunnel. Never read sideways: the ground beside a vehicle is not what it stands on.

## Tunnels

**Mouth**:
An end of a tunnel's line that no other line in a tunnel goes on from or runs through: where a road or the railway enters the hill.
_Avoid_: Portal (that is what stands there), entrance, tunnel end

**Hill's face**:
The slope the terrain model reads over a cutting before a tunnel's mouth, where the ground falls away along the line more steeply than any pass's grade limit (20%): a rail tunnel's mouth takes the ground at its foot, unless the ground past the foot climbs back by half the face's height (a gully's floor, crossed on a bank).
_Avoid_: Head wall (that is what stands there), cutting

**Portal**:
The arched face wall and its throat that stand at a mouth the hill rises high enough over.
_Avoid_: Mouth, arch

**Head wall**:
An underpass's plain face wall over a flat-lintelled opening, with its throat behind it, at a mouth under a bank too low for a portal.
_Avoid_: Portal, low portal

**Open mouth**:
A mouth where neither a portal nor a head wall stands.
_Avoid_: Bare mouth, missing portal

**Throat**:
The lined box a portal or a head wall runs back into the hill, until the hill stands over it.
_Avoid_: Box (alone), gallery, lining

**Bore**:
A road tunnel's cross-section and the dark walls along it through the hill.
_Avoid_: Tube, tunnel walls

**Stand back**:
A portal set into its tunnel along the line, away from its mouth, to keep clear of the roads round it.
_Avoid_: recess

**Buried mouth**:
A mouth where the map's ground already stands the bore's clear height over the road, its ramp not in the ground, which leaves that mouth open.
_Avoid_: Sunken mouth, underground portal

**Covered way**:
A stretch of a tunnel by its mouth under a house standing at the road's level, which leaves that mouth open.
_Avoid_: Arcade, building passage (that is a tunnel through a house)

## Water

**Sea**:
The still water at 0 m seaward of the coastline, an area kind of its own (`sea`): a water, as a lake is, cut into sea pieces, with no tide, waves or current.
_Avoid_: Ocean, sea area (that is one of its pieces)

**Sea piece**:
A connected piece of the sea within one tile's square cut to the map's bounds (a tile may hold more than one), a water area at 0 m: the sea is its pieces, one water, so a swimmer in one heads for the coast in any of them.
_Avoid_: Sea tile, sea polygon

**Coastline**:
OpenStreetMap's `natural=coastline` ways chained into lines, the land on their left: what the build closes the sea pieces from and the terrain's sea step fills from.
_Avoid_: Coast (a sea piece's shore edges), shoreline

**Coast**:
A sea piece's edges that are its shore, an islet's included: every edge but the cuts along a tile's side or the map's bounds, where the sea goes on, and the closures across a river's or a lake's mouth, where the water goes on into the river (`coastOf`).
_Avoid_: Coastline (that is OSM's line the build closes the pieces from), shore edge

**Shore line**:
The coastline less each segment that closes a river or a lake across its mouth (`shoreLines`): what the sea floor rises to, so a river's mouth holds no sill.
_Avoid_: Shore (the water's edge walls), coast

**Sea step**:
The terrain chain's step that fills, at 0 m, the cells seaward of a part's coastline and the empty shore within 150 m of them, after Liguria's DTM and before Emilia-Romagna's (`sea-fill.ts`).
_Avoid_: Sea fill, sea mask

**Sea floor**:
The ground under the sea, which the map build carves every sea node down to (`seaFloor`), from the isobaths and the shoreface profile.
_Avoid_: Seabed, bed (a river's), bathymetry (the survey it is read from)

**Isobath**:
A survey's contour line of the sea floor at one depth: Regione Liguria's are a metre of depth apart.
_Avoid_: Depth line, contour

**Shoreface profile**:
The sea floor's depth by the distance from the shore line, read where no isobath is near (`PROFILE` in `sea-floor.ts`), and as the shore line's own depth.
_Avoid_: Shelf (the issue's EMODnet constants, the profile's far end), beach profile

**Beach material**:
What a beach is drawn and driven as: `sand`, `pebble` or `rock`, by Liguria's Spiagge where it covers half the beach, else by OSM's `surface`, else sand (`beachKind`).
_Avoid_: Beach type, surface (that is OSM's tag, or what a foot or a tyre is on)

**Pier deck**:
A pier's stretch over the water: a path on a deck 1 m over the water's level, its ends on dry ground at the ground there (`pierDeck`). Its stretch on dry ground is a path at grade.
_Avoid_: Jetty, boardwalk

**Breakwater barrier**:
A breakwater's or a groyne's outline (`breakwater`): a wall that stops vehicles alone, as a guard rail does, round rock raised 1.5 m over the sea.
_Avoid_: Mole, groyne wall

**Held by the sea**:
A river whose bed lies under the sea's level standing at it (0 m) rather than at its bed plus its flow's depth, as at its mouth at low flow.
_Avoid_: Backwater, tide

**Sea share**:
How much of the sea's look a water vertex takes (`sea`, `seaShare`): the sea's whole; a river held by the sea by how far the sea holds its own waterway's bed, none to 0.5 m and whole from 1.2 m; a lake or an inland river none.
_Avoid_: Salinity, estuary blend, sea flag

## Railway

**Terminal**:
An end of a railway line (`LINES`) on the play area's outline, where the track runs on beyond it: trains enter and leave the map there, along its run-out.
_Avoid_: Terminus (a terminal inside the map), end station

**Terminus**:
An end of a railway line inside the map, at a stop where OSM's train routes start or end and none stops on its way: the line's trains dwell there and turn round, their driver changing ends. One station's termini end one line from a terminal.
_Avoid_: Terminal (on the outline), dead end, head station

**Buffer stop**:
The beam and red board across the track at a terminus, where a driven train stops dead; the drawn run's end past a terminal holds an unseen one.
_Avoid_: Bumper, end block
