# Grand Theft Auto: Lunigiana

A driving and walking game on a real map of Lunigiana, built from open survey data. These are the project's own words; `docs/` says how each thing behaves.

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
