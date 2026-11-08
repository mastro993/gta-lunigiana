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

## Standing and rolling

**Footing**:
The ground under a person or an animal, on the level it is on: a bridge's deck, a tunnel's floor, a platform or the ground at grade. On foot it is what they stand on; for the player driving, the ground under the vehicle or train they drive. Every person and animal always has one.
_Avoid_: level (reserved for whether two things meet), standing height, ground (for a body on foot)

**Wheels' ground**:
The ground a vehicle's wheels stand on, on the level it rolls on; the vehicle's counterpart of a footing.
_Avoid_: vehicle level, chassis height
