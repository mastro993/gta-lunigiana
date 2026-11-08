# Grand Theft Auto: Lunigiana

A driving and walking game on a real map of Lunigiana, built from open survey data. These are the
project's own words; `docs/` says how each thing behaves.

## Map access

**Listed tile**:
A tile the map has a tile file for. A region whose parts make an L lists none in the notch.
_Avoid_: tile on the map, existing tile

**Map source**:
Where one run of the game, a test or a tool gets its map files: the global file, once, before the
map is read, and any listed tile a lookup needs that is not resident. A run has one map, chosen
before anything reads it. It may come from the disk, the download, the build's cut or an edited map.
_Avoid_: loader, provider, store, map backend

**Resident tile**:
A listed tile that the host has handed over and not yet let go. Which tiles are resident is the
host's business alone: no answer the game gives depends on it.
_Avoid_: loaded tile, cached tile, streamed tile
