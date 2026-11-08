# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana
built from open survey data. These are the
project's own words; `docs/` says how each thing behaves.

## Ground

**Ground**:
Where a wheel, a foot or a sound source stands at a point, in metres above sea level: the terrain, a road, a deck, a tunnel floor or a platform, whichever level it is on.
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
