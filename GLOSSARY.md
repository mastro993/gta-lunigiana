# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana
built from open survey data. These are the
project's own words; `docs/` says how each thing behaves.

## Map build

**Bake**:
A table the map build works out by running the game's own code on the provisional map, because it
reads what the game holds only near the player; the provisional map leaves it empty. A bake reads
the provisional map and the whole map's vectors, never another bake.
_Avoid_: derived (the global file's table for readers far from the player, which also holds copies
that are not bakes), precompute, cache

**Provisional map**:
The map as cut, with every bake still empty, handed to the game's code during the build so the
bakes can run on it.
_Avoid_: draft map, unbaked map, partial map
