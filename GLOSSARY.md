# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana built from open survey data. These are the project's own words; `docs/` says how each thing behaves.

## Map build

**Bake**:
A table the map build works out by running the game's own code on the provisional map, because it reads what the game holds only near the player; the provisional map leaves it empty. A bake reads the provisional map and the whole map's vectors, never another bake (the farms' building centres are part of the farms bake).
_Avoid_: derived (the global file's table for readers far from the player, which also holds copies that are not bakes), precompute, cache

**Provisional map**:
The map as cut, with every bake still empty, handed to the game's code during the build so the bakes can run on it.
_Avoid_: draft map, unbaked map, partial map

## Standing and rolling

**Footing**:
The ground under a person or an animal, on the level it is on: a bridge's deck, a tunnel's floor, a platform or the ground at grade. On foot it is what they stand on; for the player driving, the ground under the vehicle or train they drive. Every person and animal always has one.
_Avoid_: level (reserved for whether two things meet), standing height, ground (for a body on foot)

**Wheels' ground**:
The ground a vehicle's wheels stand on, on the level it rolls on; the vehicle's counterpart of a footing.
_Avoid_: vehicle level, chassis height

## Ground

**Ground**:
Where things stand at a point on one of its levels, in metres above sea level: the terrain, a road, a deck, a tunnel floor or a platform. A person's or an animal's is its footing, a vehicle's its wheels' ground.
_Avoid_: Surface (that is the material underfoot), floor, height

**Terrain**:
The land as its mesh is drawn, each 4 m cell split along its south-west to north-east diagonal.
_Avoid_: DEM, heightmap (those are its sources), ground

**Level**:
One of the grounds stacked at a point: the road at grade, a bridge's deck over it, a tunnel's floor under it.
_Avoid_: Layer, storey

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

**Walkers' verge**:
How far either side of a deck or a tunnel's line someone on foot is still on its level.
_Avoid_: Sidewalk, kerb

**Ground model**:
The one set of rules that turns ground data into the ground at a point, for the game, the map build and the tests alike.

**Ground data**:
What the ground model reads: the terrain's nodes, the roads' segments with their profile, lift and walkers' verge, and the platforms.
_Avoid_: Surface source
