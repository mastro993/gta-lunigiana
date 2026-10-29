import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, InstancedMesh, type Material, Mesh, type Object3D, Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { LOOK } from "../../sim/testing.ts"
import { vehicleNode } from "../actors.ts"
import { makeCrossings } from "../crossings.ts"
import { actorMaterial } from "../geometry.ts"
import { terrainY } from "../ground.ts"
import { PersonNode } from "../people.ts"
import { signalLampMaterials, vehicleLampMaterials } from "../sky/glow.ts"
import { standIns } from "../stand-ins.ts"
import { everyTileIn, streamAround } from "../testing.ts"
import { TrainNode } from "../train.ts"
import { World } from "../world.ts"

/** Every mesh under `root` with its material. */
const meshes = (root: Object3D): Array<Mesh> => {
  const found: Array<Mesh> = []
  root.traverse((o) => {
    if (o instanceof Mesh) found.push(o as Mesh)
  })
  return found
}

test("the stand-ins hold every material the streamed world, the actors, the trains and the crossings draw, trees instanced with instance colours as in a chunk", () => {
  const { group, dispose } = standIns()
  const warmed = new Set<Material>(meshes(group).map((m) => m.material as Material))
  // The world around the spawn (a village, a river, woods) and the Sagro summit; people, a car with its lamps both ways.
  const parent = new Group(),
    world = new World(parent)
  for (const [x, y] of [
    [MAP.spawns.player.x, MAP.spawns.player.y],
    [2364, -5129],
  ] as const)
    streamAround(world, new Vector3(x, terrainY(x, y), -y))
  const car = vehicleNode("panda", 0xb8312b, actorMaterial),
    walker = new PersonNode(LOOK, actorMaterial)
  car.setLamps(true)
  // The player and the car they drive show their x-ray boxes, built the first time they show.
  car.showXray(true)
  walker.showXray(true)
  // A driven train, its leading cab's lamps lit and the trailing cab's dark ones; the crossings, one lit and one dark.
  const train = new TrainNode("atr220", actorMaterial)
  train.setLamps(true)
  train.showXray(true)
  const crossings = new Group()
  // A box shows once the ground under it is in memory.
  everyTileIn()
  makeCrossings(crossings).draw(
    CROSSINGS.map((_, i) => ({
      phase: i % 2 === 0 ? "closed" : "open",
      since: 0,
      from: 1,
      demanded: 0,
    })),
    0,
  )
  const drawn = [
    ...meshes(parent),
    ...meshes(car),
    ...meshes(walker),
    ...meshes(train),
    ...meshes(crossings),
  ]
  assert.ok(drawn.length > 20)
  const lamps = new Set(drawn.map((mesh) => mesh.material))
  assert.ok(
    lamps.has(signalLampMaterials.on) && lamps.has(signalLampMaterials.off),
    "the signal lamps both ways",
  )
  for (const mesh of drawn)
    assert.ok(
      warmed.has(mesh.material as Material),
      `${mesh.name || mesh.type}: its material is warmed up`,
    )
  assert.ok(warmed.has(vehicleLampMaterials.off) && warmed.has(vehicleLampMaterials.on))
  const trees = meshes(group).filter((m) => m instanceof InstancedMesh)
  assert.ok(
    trees.length > 0 && trees.every((t) => t instanceof InstancedMesh && t.instanceColor !== null),
    "instanced with instance colours: the chunks' program",
  )
  assert.ok(meshes(parent).some((m) => m instanceof InstancedMesh && m.instanceColor !== null))
  dispose()
})
