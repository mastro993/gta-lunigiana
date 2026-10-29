import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, InstancedMesh, Vector3, type Mesh } from "three"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, provideTile, setTileSource } from "../../sim/map/tiles.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { QUARTER } from "../../sim/view.ts"
import { defaultRoute } from "../../tools/playtest-drive.ts"
import { CHUNKS, exactBox, radiiFor, screenDistances, screenRects } from "../chunks.ts"
import { makeCrossings } from "../crossings.ts"
import {
  decalMaterial,
  linear,
  solidMaterial,
  terrainMaterial,
  treeMaterial,
  waterMaterial,
} from "../geometry.ts"
import { terrainY } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { viewAxes } from "../pipeline.ts"
import { glowMaterial } from "../sky/glow.ts"
import { lampsIn } from "../sky/lamps.ts"
import { streamAround } from "../testing.ts"
import { World } from "../world.ts"

/** Every chunk's exact box, as a whole-map build would measure them. */
const boxes = new Float32Array(CHUNKS.x * CHUNKS.y * 6)
for (let key = 0; key < CHUNKS.x * CHUNKS.y; key++) exactBox(boxes, key)
const REACH = 60
const ground = (x: number, y: number) => new Vector3(x, terrainY(x, y), -y)
/** Chunk keys within `radius` screen metres of `focus` for a view turned `yaw`. */
const within = (focus: Vector3, radius: number, yaw = 0): Array<number> => {
  const { right, up } = viewAxes(yaw)
  const rects = screenRects(boxes, right, up, new Float32Array(CHUNKS.x * CHUNKS.y * 4))
  const d = screenDistances(
    rects,
    focus.dot(right),
    focus.dot(up),
    new Float32Array(CHUNKS.x * CHUNKS.y),
  )
  return [...d.keys()].filter((key) => d[key]! <= radius)
}

// First, before any test has drawn a platform, a crossing or a canopy (each built on its first draw).
test("world streaming: making the world and the crossings' nodes reads no map tile: a host has none in memory yet", () => {
  setTileSource(undefined)
  for (const { i, j } of MAP.tiles) dropTile(`${i}_${j}`)
  try {
    const world = new World(new Group()),
      crossings = makeCrossings(new Group())
    const { x, y } = MAP.spawns.player
    world.update(new Vector3(x, 0, -y), 0, REACH, Infinity)
    assert.equal(world.loaded.size, 0)
    assert.ok(world.wanted().size > 0, "it says which tiles it wants")
    crossings.draw(
      CROSSINGS.map(() => ({ phase: "open", since: 0, from: 0, demanded: 0 })),
      0,
    )
    assert.ok(crossings.boxes.every((box) => box === undefined || !box.placed))
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
  }
})

test("world streaming: nearest chunk first on a tight budget, everything in the load radius on a free one", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player,
    focus = ground(x, y)
  world.update(focus, 0, REACH, 0)
  assert.equal(world.loaded.size, 0, "no tile handed over yet: nothing builds")
  for (const key of world.wanted()) world.tileProvided(key)
  world.update(focus, 0, REACH, 0)
  assert.equal(world.loaded.size, 1, "a zero budget still builds one chunk")
  assert.ok(within(focus, 0).includes([...world.loaded.keys()][0]!), "the one under the focus")
  world.update(focus, 0, REACH, Infinity)
  assert.deepEqual(
    [...world.loaded.keys()].sort((a, b) => a - b),
    within(focus, radiiFor(REACH).load),
  )
  assert.equal(
    parent.children.length,
    [...world.loaded.values()].reduce((n, meshes) => n + meshes.length, 0),
  )
})

test("world streaming: a quarter turn of the view builds what the turned view shows", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player,
    focus = ground(x, y),
    { load } = radiiFor(REACH)
  streamAround(world, focus)
  const turned = within(focus, load, QUARTER)
  assert.ok(
    turned.some((key) => !world.loaded.has(key)),
    "the turned view needs chunks the home view did not",
  )
  streamAround(world, focus, QUARTER)
  for (const key of turned) assert.ok(world.loaded.has(key), `chunk ${key} built`)
})

test("world streaming: small moves keep chunks (hysteresis), leaving frees their geometry but not the shared tree shapes", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player
  streamAround(world, ground(x, y))
  const before = new Map(world.loaded)
  // Moving a little past the load radius builds new chunks but drops none.
  streamAround(world, ground(x + 100, y))
  for (const key of before.keys()) assert.ok(world.loaded.has(key), `chunk ${key} kept`)

  const freed = new Set<object>()
  const meshes: Array<Mesh> = [...before.values()].flat()
  const trees = meshes.filter((m): m is InstancedMesh => m instanceof InstancedMesh)
  assert.ok(trees.length > 0, "the spawn area has trees")
  for (const m of meshes) {
    if (m instanceof InstancedMesh) m.addEventListener("dispose", () => freed.add(m))
    else m.geometry.addEventListener("dispose", () => freed.add(m))
  }
  for (const t of trees)
    t.geometry.addEventListener("dispose", () => assert.fail("shared tree shape disposed"))

  world.update(ground(x + 2000, y + 1500), 0, REACH, Infinity)
  for (const key of before.keys()) assert.ok(!world.loaded.has(key), `chunk ${key} dropped`)
  assert.equal(freed.size, meshes.length, "every mesh of every dropped chunk freed")
  assert.ok(meshes.every((m) => m.parent === null))
})

test("world streaming: the spawn view's chunks glow at night (window panes and lantern glass, one unlit mesh per chunk, no shadows)", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player
  streamAround(world, ground(x, y))
  const glow = [...world.loaded.values()].flatMap((meshes) =>
    meshes.filter((m) => m.material === glowMaterial),
  )
  assert.ok(
    glow.length > 0 && glow.length <= world.loaded.size,
    `${glow.length} glow meshes in ${world.loaded.size} chunks`,
  )
  assert.ok(glow.every((m) => !m.castShadow && !m.receiveShadow))
  // Every lamp within 60 m is in a loaded chunk. A lantern's glass is a box with a top and a bottom
  // (4 level triangles); window panes are upright.
  let lamps = 0
  lampsIn(x - 60, y - 60, x + 60, y + 60, () => lamps++)
  assert.ok(lamps > 0, "street lamps around the station")
  const level = glow.reduce((n, m) => {
    const normal = m.geometry.getAttribute("normal")
    for (let i = 0; i < normal.count; i += 3) if (Math.abs(normal.getY(i)) > 0.99) n++
    return n
  }, 0)
  assert.ok(level / 4 >= lamps, `${level / 4} lantern glasses drawn, ${lamps} lamps within 60 m`)
})

test("world streaming: rivers draw in their own water mesh (no snow on them), roads and rail in the decal one, trees with the swaying material", () => {
  const parent = new Group(),
    world = new World(parent)
  const { x, y } = MAP.spawns.player
  streamAround(world, ground(x, y))
  const meshes = [...world.loaded.values()].flat()
  const colours = (m: Mesh): Set<string> => {
    const c = m.geometry.getAttribute("color"),
      seen = new Set<string>()
    for (let i = 0; i < c.count; i += 3)
      seen.add(`${c.getX(i).toFixed(4)},${c.getY(i).toFixed(4)},${c.getZ(i).toFixed(4)}`)
    return seen
  }
  const water = new Set(
    [PALETTE.waterShallow, PALETTE.waterDeep].map((hex) =>
      linear(hex)
        .map((v) => v.toFixed(4))
        .join(","),
    ),
  )
  const rivers = meshes.filter((m) => m.material === waterMaterial),
    decals = meshes.filter((m) => m.material === decalMaterial)
  assert.ok(
    rivers.length > 0 && decals.length > 0,
    `the Lucido and the roads by the station: ${rivers.length} water, ${decals.length} decal meshes`,
  )
  assert.ok(
    rivers.every((m) => [...colours(m)].every((c) => water.has(c)) && !m.castShadow),
    "the water mesh holds only water",
  )
  assert.ok(
    decals.every((m) => [...colours(m)].every((c) => !water.has(c))),
    "the decal mesh holds no water",
  )
  const trees = meshes.filter((m): m is InstancedMesh => m instanceof InstancedMesh)
  assert.ok(trees.length > 0 && trees.every((m) => m.material === treeMaterial))
  for (const t of trees) {
    const canopy = t.geometry.getAttribute("canopy")
    const values = new Set(Array.from({ length: canopy.count }, (_, i) => canopy.getX(i)))
    assert.deepEqual(
      [...values].sort((a, b) => a - b),
      [0, 1],
      "the trunk stays, the crown sways",
    )
  }
  assert.ok(
    meshes
      .filter(
        (m) =>
          !(m instanceof InstancedMesh) &&
          m.material !== glowMaterial &&
          m.material !== waterMaterial &&
          m.material !== decalMaterial,
      )
      .every((m) => m.material === solidMaterial || m.material === terrainMaterial),
    "buildings in the solid variant, the terrain in its own",
  )
  assert.ok(meshes.some((m) => m.material === terrainMaterial))
})

test("world streaming: the railway in its layers: a crossing's panel, rails and stop lines in the decal mesh, its housings and the ballast bed in the solid one; a platform's yellow line a decal, its name board solid", () => {
  const has = (meshes: ReadonlyArray<Mesh>, hex: number) => {
    // The meshes hold 32-bit colours.
    const [r, g, b] = linear(hex).map(Math.fround) as [number, number, number]
    return meshes.some((m) => {
      const c = m.geometry.getAttribute("color")
      for (let i = 0; i < c.count; i += 3)
        if (c.getX(i) === r && c.getY(i) === g && c.getZ(i) === b) return true
      return false
    })
  }
  const riolo = MAP.railway.crossings.find((c) => MAP.roads[c.road]!.name === "Via Riolo")!
  for (const [at, decals, solids] of [
    [
      riolo,
      [PALETTE.crossingPanel, PALETTE.railHead, PALETTE.marbleWhite, PALETTE.railSteel],
      [PALETTE.barrierWhite, PALETTE.signalBlack, PALETTE.ballast],
    ],
    [
      MAP.pois.find((p) => p.kind === "railway=stop" && p.name === "Gragnola")!,
      [PALETTE.signYellow],
      [PALETTE.rfiBlue, PALETTE.kerb, PALETTE.canopyGrey],
    ],
  ] as const) {
    const world = new World(new Group())
    streamAround(world, ground(at.x, at.y))
    const meshes = [...world.loaded.values()].flat()
    for (const hex of decals)
      assert.ok(
        has(
          meshes.filter((m) => m.material === decalMaterial),
          hex,
        ),
        `decal ${hex.toString(16)}`,
      )
    for (const hex of solids)
      assert.ok(
        has(
          meshes.filter((m) => m.material === solidMaterial),
          hex,
        ),
        `solid ${hex.toString(16)}`,
      )
  }
})

test("world streaming: a chunk builds only once every tile its build reads is in, and goes when one of them goes", () => {
  // Round the origin, where four tiles meet by Monzone's station.
  const focus = ground(0, 0),
    { load } = radiiFor(REACH)
  const world = new World(new Group())
  world.update(focus, 0, REACH, Infinity)
  const wanted = [...world.wanted()]
  assert.deepEqual(wanted.toSorted(), ["-1_-1", "-1_0", "0_-1", "0_0"])
  // Every tile but one in, that one out of memory and nowhere to read it from: a build reading it throws.
  const out = "0_0"
  for (const key of wanted) if (key !== out) world.tileProvided(key)
  setTileSource(undefined)
  dropTile(out)
  try {
    world.update(focus, 0, REACH, Infinity)
    const partial = [...world.loaded.keys()]
    assert.ok(partial.length > 0, "the chunks that read only the tiles in build")
    assert.ok(partial.length < within(focus, load).length, "the ones that read the tile out do not")
    // In again: the rest build, and the world is the one a host with every tile in streams.
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
    provideTile(readMapFile(tileUrl(MAP.name, out)))
    world.tileProvided(out)
    world.update(focus, 0, REACH, Infinity)
    assert.deepEqual(
      [...world.loaded.keys()].toSorted((a, b) => a - b),
      within(focus, load),
    )
    // Out again: the chunks that read it go, the others stay.
    world.tileDropped(out)
    dropTile(out)
    assert.deepEqual(
      [...world.loaded.keys()].toSorted((a, b) => a - b),
      partial.toSorted((a, b) => a - b),
    )
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
  }
})

// Regression (review of #5): chunks wholly behind the camera's near plane still asked for their tiles, so on mountain roads
// the follow camera swung tiles 1.5–2.5 km behind it in and out of the stream again and again.
test("world streaming: the tiles only chunks behind the camera's near plane read are not wanted, and what builds stays the same", () => {
  const route = defaultRoute()
  const ruled = new World(new Group()),
    every = new World(new Group())
  // The same World with the near-plane rule off: every chunk in reach on the screen asks for its tiles.
  ;(every as unknown as { behind: () => boolean }).behind = () => false
  let trimmed = 0,
    samples = 0
  for (let k = 0; k < route.length; k += 80) {
    const x = route[k]!,
      y = route[k + 1]!,
      focus = new Vector3(x, terrainY(x, y), -y)
    for (let q = 0; q < 4; q++, samples++) {
      const yaw = q * QUARTER
      for (const world of [ruled, every]) world.update(focus, yaw, 210, 0)
      const wanted = new Set(ruled.wanted())
      assert.ok(
        [...wanted].every((t) => every.wanted().has(t)),
        "the rule only leaves tiles out",
      )
      if (every.wanted().size > wanted.size) trimmed++
      // With the same tiles in, both build the same chunks: the rule changes what is fetched, never what is drawn.
      for (const t of every.wanted()) for (const world of [ruled, every]) world.tileProvided(t)
      for (const world of [ruled, every]) world.update(focus, yaw, 210, Infinity)
      assert.deepEqual(
        [...ruled.loaded.keys()].sort((a, b) => a - b),
        [...every.loaded.keys()].sort((a, b) => a - b),
      )
    }
  }
  assert.ok(trimmed >= samples / 4, `${trimmed} of ${samples} views left a tile out`)
})
