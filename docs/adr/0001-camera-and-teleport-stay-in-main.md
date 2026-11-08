---
status: accepted (2026-11-08)
---

# The camera and the teleport sequence stay in main.ts

The host's camera composition in `draw` (the cut past `CUT_BEYOND`, the look-ahead, the eased
focus and elevation, the zoom easing) and the tile wait and teleport sequence in `follow` (the
respawn gate, the clear spot, the send, forgetting the goal) stay in `src/main.ts`, not in a
camera-rig or travel-gate module. Each such module would have one caller and an interface about
as wide as its body, and the parts that hold the logic are already tested modules: `swingView`,
`followYaw`, `zoomFor`, the tile stream behind `TileStreamHost` (`src/stream.ts`) and `clearSpot`.
Neither function has had a bug of its own: the one camera bug, #93 (the camera on a bridge deck
after a jump under it), was in the ground lookup, and its check reads `PlayerView.z`, which a
camera-rig test would not have reached. Revisit when a bug lands in the cut, the easing or the
zoom, when a second camera mode arrives, or once a module resolving each body's level makes the
camera's eased elevation redundant.
