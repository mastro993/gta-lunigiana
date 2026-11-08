# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana built from open survey data. These are the project's own words; `docs/` says how each thing behaves.

## Map build

**Bake**:
A table the map build works out by running the game's own code on the provisional map, because it reads what the game holds only near the player; the provisional map leaves it empty. A bake reads the provisional map and the whole map's vectors, never another bake (the farms' building centres are part of the farms bake).
_Avoid_: derived (the global file's table for readers far from the player, which also holds copies that are not bakes), precompute, cache

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
One packed run of integers after a map file's line, holding one array of the map. A layer may span several sections (a tile's walls: their coordinates, ids and levels).
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

## Standing and rolling

**Footing**:
The ground under a person or an animal, on the level it is on: a bridge's deck, a tunnel's floor, a platform or the ground at grade. On foot it is what they stand on; for the player driving, the ground under the vehicle or train they drive. Every person and animal always has one.
_Avoid_: level (reserved for whether two things meet), standing height, ground (for a body on foot)

**Wheels' ground**:
The ground a vehicle's wheels stand on, on the level it rolls on; the vehicle's counterpart of a footing.
_Avoid_: vehicle level, chassis height

## Tunnels

**Mouth**:
An end of a tunnel's line that no other line in a tunnel goes on from: where a road or the railway enters the hill.
_Avoid_: Portal (that is what stands there), entrance, tunnel end

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

**Covered way**:
A stretch of a tunnel by its mouth under a house standing at the road's level, which leaves that mouth open.
_Avoid_: Arcade, building passage (that is a tunnel through a house)
