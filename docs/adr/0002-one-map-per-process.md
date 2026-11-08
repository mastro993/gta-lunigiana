---
status: accepted
---

# One map per process; `MAP` stays a module constant

The game, every test and every tool read the map through module-level constants: `MAP` itself and
what the lookups derive from it once (the heightmap's anchor in `src/sim/map/index.ts`, the tile
slots in `src/sim/map/tiles.ts`), which the sim's hot path reads on every call. We kept that
singleton and made "one map per process, chosen before any map module loads" a rule of the map
source (`src/sim/map/source.ts`). A process names its map before the map is decoded, and handing one
over after that throws. Nothing needs two maps in one process: `node --test` runs each test file in
a process of its own, and `map-diff` decodes the two builds' files without providing either.

## Considered options

- **A map instance passed to its readers**: two maps could share one process, but every reader of
  `MAP` and of the lookups (the sim, the renderer, the audio, the HUD) would take it as an argument
  or a field, and the hot path's constants would become property loads. Rejected: nothing needs it.

## Consequences

- A test picks its map with a side-effect import on its first line, or, when the map may not be
  built, by providing it before a dynamic import of the map modules. The browser host provides the
  downloaded global file before its own dynamic imports.
