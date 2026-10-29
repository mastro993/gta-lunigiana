import assert from "node:assert/strict"
import { test } from "node:test"

import { Vector3 } from "three"

import { pointInRing } from "../../sim/collide.ts"
import { coarseHeightAt } from "../../sim/map/coarse.ts"
import { buildingsIn, MAP, treesIn } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, isResidentAt, setTileSource } from "../../sim/map/tiles.ts"
import { topOf } from "../buildings.ts"
import { terrainResident, terrainY, yOf } from "../ground.ts"
import { viewAxes } from "../pipeline.ts"
import { CUT_UNIFORMS } from "../see-through.ts"
import { SeeThrough, sight } from "../sightline.ts"
import { everyTileIn } from "../testing.ts"
import { inCrown } from "../trees.ts"

// Far along a sight line the terrain comes from the coarse grid where no tile is in memory: here every one is.
everyTileIn()

const HOME = viewAxes(0).back
const spawn = MAP.spawns.player
const hidden = (from: Vector3) => sight(from, HOME).hidden

/** Three space at map (x, y), `over` m above the terrain. */
const at = (x: number, y: number, over: number) => new Vector3(x, terrainY(x, y) + over, -y)

/** The first building near the spawn at least 6 m to its ridge, and the point on the ground 2 m past its far wall from the home camera. */
const behindHouse = (() => {
  // Away from the camera on the ground: −back, flattened.
  const away = { x: -HOME.x, y: HOME.z },
    n = Math.hypot(away.x, away.y)
  let found: Vector3 | undefined
  buildingsIn(spawn.x - 80, spawn.y - 80, spawn.x + 80, spawn.y + 80, (i) => {
    const b = MAP.buildings[i]!
    if (found !== undefined || b.holes !== undefined) return
    let cx = 0,
      cy = 0
    const corners = b.outer.length / 2
    for (let k = 0; k < b.outer.length; k += 2) {
      cx += b.outer[k]! / corners
      cy += b.outer[k + 1]! / corners
    }
    if (!pointInRing(cx, cy, b.outer) || topOf(b) - terrainY(cx, cy) < 6) return
    // Walk away from the camera until out of the walls, then 2 m on.
    let s = 0
    while (pointInRing(cx + (away.x / n) * s, cy + (away.y / n) * s, b.outer)) s += 0.25
    const x = cx + (away.x / n) * (s + 2),
      y = cy + (away.y / n) * (s + 2)
    let inside = false
    buildingsIn(x, y, x, y, (j) => (inside ||= pointInRing(x, y, MAP.buildings[j]!.outer)))
    if (!inside) found = at(x, y, 0.4)
  })
  if (found === undefined) throw new Error("no house near the spawn")
  return found
})()

const OPEN = at(spawn.x, spawn.y, 0.4),
  BEHIND = behindHouse

test("a person standing just behind a house, as the home camera sees it, is hidden", () => {
  assert.ok(hidden(behindHouse))
})

test("the player at the spawn, in the street, is not hidden", () => {
  assert.equal(hidden(at(spawn.x, spawn.y, 0.4)), false)
  assert.equal(hidden(at(spawn.x, spawn.y, 1.6)), false)
})

test("a person under a tree's crown is hidden by it", () => {
  // The first tree near the spawn: from its trunk, 1.5 m up (a head under the crown), the line climbs through the crown.
  let tree: readonly [number, number, number, number] | undefined
  treesIn(spawn.x - 300, spawn.y - 300, spawn.x + 300, spawn.y + 300, (x, y, scale, id) => {
    tree ??= [x, y, scale, id]
  })
  assert.ok(tree !== undefined)
  const [x, y, scale] = tree
  assert.ok(inCrown(...tree, x, y, terrainY(x, y) + 3.5 * scale))
  assert.equal(inCrown(...tree, x + 10, y, terrainY(x, y) + 4), false)
  assert.ok(hidden(at(x, y, 1.5)))
})

test("a point under the ground is hidden by the terrain", () => {
  assert.ok(hidden(at(spawn.x, spawn.y, -3)))
})

/** The first road point with no building within 60 m that a hill hides from the home camera, 20–150 m off along the sight line. */
const UNDER_HILL = (() => {
  for (const road of MAP.roads)
    for (let k = 0; k + 1 < road.pts.length; k += 10) {
      const x = road.pts[k]!,
        y = road.pts[k + 1]!,
        { hidden, ground } = sight(at(x, y, 0.4), HOME)
      let near = 0
      buildingsIn(x - 60, y - 60, x + 60, y + 60, () => near++)
      if (hidden && ground >= 20 && ground <= 150 && near === 0) return { x, y, ground }
    }
  throw new Error("no road under a hill")
})()

test("a hill hiding the player: the sight line says how far off it meets the terrain; a house hides with no terrain", () => {
  const { x, y, ground } = UNDER_HILL
  // It meets the terrain within the march's 2 m step of where the line passes under it.
  const p = at(x, y, 0.4),
    under = (t: number) => terrainY(p.x + HOME.x * t, -(p.z + HOME.z * t)) > p.y + HOME.y * t
  assert.ok(under(ground) && !under(ground - 2), `meets it at ${String(ground)} m`)
  assert.equal(sight(behindHouse, HOME).ground, Number.POSITIVE_INFINITY)
})

test("the cut takes the ground from 2 m short of where the hill meets the lower sight line, along the view from the body's middle, and keeps it while shutting", () => {
  const cut = new SeeThrough({ yaw: 0, texelsPerMetre: 8 }, () => true)
  const { x, y } = UNDER_HILL,
    p = at(x, y, 0)
  cut.follow(p.x, p.y, p.z, 1.7, 1)
  const low = sight(at(x, y, 0.4), HOME).ground + (0.4 - 0.85) * HOME.y,
    high = sight(at(x, y, 1.6), HOME).ground + (1.6 - 0.85) * HOME.y
  assert.ok(
    Math.abs(CUT_UNIFORMS.uCutGround.value - (Math.min(low, high) - 2)) < 1e-9,
    String(CUT_UNIFORMS.uCutGround.value),
  )
  const held = CUT_UNIFORMS.uCutGround.value
  cut.follow(OPEN.x, OPEN.y - 0.4, OPEN.z, 1.7, 1.2)
  assert.equal(cut.open, 1, "held open")
  assert.equal(CUT_UNIFORMS.uCutGround.value, held, "the ground cut stays while the cut is held")
  // Behind a house no terrain is cut.
  cut.follow(BEHIND.x, BEHIND.y - 0.4, BEHIND.z, 1.7, 2)
  assert.ok(CUT_UNIFORMS.uCutGround.value >= 1e6)
})

test("the cut eases open over 0.2 s while the player is hidden, holds 0.4 s, then eases shut", () => {
  const cut = new SeeThrough({ yaw: 0, texelsPerMetre: 8 }, () => false)
  const follow = (p: Vector3, now: number) => cut.follow(p.x, p.y - 0.4, p.z, 1.7, now)
  follow(BEHIND, 10)
  assert.equal(cut.open, 0, "nothing has eased yet")
  follow(BEHIND, 10.1)
  assert.ok(Math.abs(cut.open - 0.5) < 1e-9, `half open after 0.1 s: ${cut.open}`)
  follow(BEHIND, 10.3)
  assert.equal(cut.open, 1)
  assert.equal(CUT_UNIFORMS.uCutRadius.value, 54 / 8, "54 texels at 8 texels a metre")
  assert.equal(CUT_UNIFORMS.uCutFeet.value, BEHIND.y - 0.4)
  assert.equal(CUT_UNIFORMS.uCutCentre.value.y, BEHIND.y - 0.4 + 0.85)
  // In the open: held for 0.4 s after it was last hidden, then shut over 0.2 s.
  follow(OPEN, 10.6)
  assert.equal(cut.open, 1, "still held")
  follow(OPEN, 10.75)
  assert.ok(Math.abs(cut.open - 0.25) < 1e-9, `easing shut: ${String(cut.open)}`)
  follow(OPEN, 11.2)
  assert.equal(cut.open, 0)
  assert.equal(CUT_UNIFORMS.uCutRadius.value, 0)
})

// Regression (PR #51 review): sim time going back (a restored state) left the last hidden time ahead of `now`, holding the cut open.
test("when sim time goes back, the cut forgets when the player was last hidden", () => {
  const cut = new SeeThrough({ yaw: 0, texelsPerMetre: 8 }, () => false)
  cut.follow(BEHIND.x, BEHIND.y - 0.4, BEHIND.z, 1.7, 100)
  cut.follow(BEHIND.x, BEHIND.y - 0.4, BEHIND.z, 1.7, 100.3)
  assert.equal(cut.open, 1)
  // Back to 50 s, in the open: shut within 0.2 s, not held until 100.7 s.
  cut.follow(OPEN.x, OPEN.y - 0.4, OPEN.z, 1.7, 50)
  cut.follow(OPEN.x, OPEN.y - 0.4, OPEN.z, 1.7, 50.25)
  assert.equal(cut.open, 0)
})

test("under reduced motion the cut opens and shuts at once; with no player it shuts", () => {
  const cut = new SeeThrough({ yaw: 0, texelsPerMetre: 6 }, () => true)
  cut.follow(BEHIND.x, BEHIND.y - 0.4, BEHIND.z, 1.7, 5)
  assert.equal(cut.open, 1)
  assert.equal(CUT_UNIFORMS.uCutRadius.value, 9, "54 texels at 6 texels a metre: wider in a car")
  cut.shut()
  assert.equal(CUT_UNIFORMS.uCutRadius.value, 0)
})

test("past the tiles in memory a sight line reads the coarse grid's terrain, and never a tile that is out", () => {
  // From 150 m (along the line) short of where the line from the spawn toward the home camera leaves the spawn's tile, with
  // every tile out but that one: the buildings and crowns looked for over its first 100 m stand on that tile (in play the host
  // keeps every tile within 600 m), the last 350 m of the 500 m line lie on tiles that are out.
  const dx = HOME.x,
    dy = -HOME.z,
    tile = { i: Math.floor(spawn.x / 2000), j: Math.floor(spawn.y / 2000) }
  const exit = Math.min(
    ...[
      dx > 0 ? (2000 * (tile.i + 1) - spawn.x) / dx : (2000 * tile.i - spawn.x) / dx,
      dy > 0 ? (2000 * (tile.j + 1) - spawn.y) / dy : (2000 * tile.j - spawn.y) / dy,
    ].filter((t) => t > 0),
  )
  const x = spawn.x + dx * (exit - 150),
    y = spawn.y + dy * (exit - 150),
    from = at(x, y, 0.4)
  const end = { x: x + dx * 500, y: y + dy * 500 }
  assert.notDeepEqual(
    [Math.floor(end.x / 2000), Math.floor(end.y / 2000)],
    [tile.i, tile.j],
    "the line ends in another tile",
  )
  setTileSource(undefined)
  try {
    for (const { i, j } of MAP.tiles) if (i !== tile.i || j !== tile.j) dropTile(`${i}_${j}`)
    assert.equal(isResidentAt(end.x, end.y), false)
    // The terrain sampled as the sight line samples it: exact on the tile in memory, the coarse grid's past it.
    let ground = Number.POSITIVE_INFINITY
    for (let t = 1; t <= 500 && ground === Number.POSITIVE_INFINITY; t += 2) {
      const px = x + dx * t,
        py = y + dy * t
      // A cell on the tile's last row or column reads the next tile's nodes too: exact only where all four are in.
      const h = terrainResident(px, py) ? terrainY(px, py) : yOf(coarseHeightAt(px, py))
      if (h > from.y + HOME.y * t) ground = t
    }
    assert.equal(sight(from, HOME).ground, ground)
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
    everyTileIn()
  }
})
