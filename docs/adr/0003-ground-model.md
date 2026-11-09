---
status: accepted
---

# One ground model over ground data, in whole decimetres, bit-identical across adapters

The ground rules (the terrain's diagonal split, the junction blend, decks and tunnels kept to the nearest level, the walkers' verges, a road's level) lived in the game's `src/sim/map/ground.ts`, welded to the decoded map, and again in the map build (`meshZ`, `groundOf`, `surfaceAt`) and in a test oracle, and the build's copies had drifted from the game's: the walls under decks were traced on a ground the game never reads. We decided on one ground model, MAP-free, that every caller binds to its ground data through a three-call port (a cell's nodes, what reaches into a 16 m bucket, a road's line near a point), with the model building the buckets and fixing the blend order (road, then vertex). There are two adapters: the tiled game, which keeps residency unobservable, and a whole-data one for the map build, the whole-map check and hand-made test scenes. Every adapter gives the same answer to the bit for the same data.

## Considered options

- **The model owns chunks of plain data** (each tile's terrain window and roads, found by `chunkAt`): the deepest model, but it moves the seam into the tile store and makes the unlisted tiles fill their terrain, a change to streaming in the step meant to move code without changing a bit. Rejected.
- **A wide query port** (the adapter indexes, returns a sorted superset): every adapter carries the ordering rules, held only by a conformance test. Rejected.
- **A `scale` for nodes in metres or decimetres**: it would let the build keep nodes it lowered under a deck to arbitrary values, which the file then rounds, so the build traces on other terrain than it ships. Rejected: nodes are whole decimetres everywhere (the game's `facingAt` divides decimetre differences, so converting changes its bits), and the build floors what it lowers to a decimetre.

## Consequences

- A change to a ground rule changes the game and the next map build alike; baked walls and parapets follow it at the next rebake, never drifting.
- `ground.map-test.ts` compares the two adapters, so it guards the tiling only; the rules are pinned by fast tests on hand-made scenes.
