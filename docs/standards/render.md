# Render standards

Checks for a change in `src/render`, the camera, the view or the keys, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md):

- **Settled design**: the user chose the look and the controls, so keep them unless the user asks
  for a change: real low-poly 3D rendered at low resolution and upscaled nearest-neighbour, with
  no sprites; an orthographic camera at 30°, for exact 2:1 pixel lines; the home view north-west of
  the player; quarter turns on Q/E, eased over about 1/3 s; driving, a view that follows the car on
  a spring, the road ahead up the screen, and settles on the nearest quarter turn when the player
  gets out (a train is followed as a car is); the sun on its real arc for the game
  date and time, fixed in the sky whichever way the view looks, so turning the view never moves a
  shadow; F or Enter as the
  action key; on a touch screen, every control on the screen (a stick to walk; in a vehicle ◀ ▶
  buttons on the left, hidden in a train, and Gas and Brake on the right, pressing the keys as the
  keyboard does) and
  the game landscape only, turned a quarter when the phone is held upright; while the world hides
  the player, a see-through circle opens round them with a crisp outlined edge (no dither), and
  shuts once they are in sight again.
- **Axes**: Three.js world axes are (east, up, −north), so the map point (x, y) at height h is
  (x, h, −y).
- **Streaming**: a chunk build keeps giving the same result as cutting the same area from a
  whole-map build ([architecture.md](../architecture.md), "Rendering"). A chunk builds only once
  every map tile its build reads is in memory (`src/render/chunk-tiles.ts`), since a read off the
  tiles in memory throws "map tile i_j not loaded": a new piece that reads the ground more than
  50 m from the segments it draws gives that area as its `reads` box (`Piece.reads`). Nothing at
  `World` construction, nor in `makeCrossings`, reads a tile (`world.test.ts` checks both), as the
  host then holds only the start's tiles: build such geometry on the piece's first draw. A new mesh,
  geometry or buffer is disposed when the chunk or node that owns it is dropped: an x-ray proxy once
  leaked GPU memory.
- **Terrain fits**: anything fitted to the terrain samples the whole view, interior included: a
  valley deep inside the frame escapes a fit built on the view's edges (PR #2's shadow box).
- **Lit materials**: a new lit material takes a weather variant (`weatherMaterial` in
  `src/render/sky/surface.ts`, with its own `customProgramCacheKey`) and gets a mesh in
  `src/render/stand-ins.ts`, or `stand-ins.test.ts` fails: a program the warm-up misses compiles
  when the player first meets it, a frame hitch, and an unpatched one is never wet, snowy or
  cloud-shaded. Weather is driven through the shared `SKY_UNIFORMS` cells, never a `#define`
  flipped at run time, which recompiles the program.
- **Lights**: every light is made before the first frame (the sky host's constructor) and driven
  only by colour and intensity, never added, removed or hidden, nor its `castShadow` toggled: the
  light counts are part of every lit program's key, so a change recompiles every program at once.
- **Draw order**: a transparent object takes its `renderOrder` from `DRAW_ORDER` in
  `src/render/order.ts` (tyre marks 0, smoke and the x-ray 1, a wreck's flames and a blast's
  flash 2, a blast's fireball and embers 3, bolts 4, rain and snow 5;
  [architecture.md](../architecture.md), "Shader warm-up and draw order"): three otherwise sorts
  transparents by distance, and their order flips as the camera moves.
- **Performance**: measure in the browser ([playtest.md](playtest.md)) and update
  architecture.md's numbers: first frame, JS heap after GC, chunk build times, and 60 fps with no
  frame over 30 ms.
