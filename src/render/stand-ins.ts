/**
 * Stand-ins for the shader warm-up: one tiny mesh per material the streamed world and the actors
 * draw, built the way the real meshes are (vertex colours; trees instanced with instance colours; a
 * car with its x-ray box and its lamps on and off; the signal lamps a train and a crossing light), so
 * `PixelView.compile` builds every program before the first frame. The first view need not hold a
 * river, a tree, a lit car or a train: wherever the player goes later, nothing compiles mid-game. The
 * effects (marks, smoke, rain, snow, bolts, the level crossings' arms and lights) are in the scene
 * from the start and compile with it.
 *
 * @module render/stand-ins
 */
import { BufferGeometry, Float32BufferAttribute, Group, type InstancedMesh, Mesh } from "three"

import { VehicleNode } from "./actors.ts"
import { bloodMaterial } from "./blood.ts"
import {
  actorMaterial,
  decalMaterial,
  solidMaterial,
  terrainMaterial,
  treeMaterial,
  waterMaterial,
} from "./geometry.ts"
import {
  cabinLightMaterial,
  glowMaterial,
  signalLampMaterials,
  vehicleLampMaterials,
} from "./sky/glow.ts"
import { treeMeshes } from "./trees.ts"

/** One triangle with the attributes every world mesh has: position, normal and colour (linear, three channels). */
const triangle = (): BufferGeometry =>
  new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0, -0.1], 3))
    .setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    .setAttribute("color", new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3))

/** The stand-ins, under one group to compile (never drawn: the group is not added to the scene), and how to free them. */
export const standIns = (): { readonly group: Group; readonly dispose: () => void } => {
  const shape = triangle(),
    group = new Group()
  const car = new VehicleNode("panda", 0xffffff, shape, actorMaterial)
  car.showXray(true) // x-ray boxes are built the first time they show
  // One broadleaf at the origin: an InstancedMesh with instance colours, as every chunk's trees are.
  const trees: Array<InstancedMesh> = treeMeshes(
    { broadleaf: [0, 0, 1, 1], conifer: [] },
    treeMaterial,
  )
  group.add(
    ...[
      solidMaterial,
      terrainMaterial,
      decalMaterial,
      waterMaterial,
      glowMaterial,
      vehicleLampMaterials.on,
      signalLampMaterials.on,
      signalLampMaterials.off,
      cabinLightMaterial,
      bloodMaterial,
    ].map((material) => new Mesh(shape, material)),
    car,
    ...trees,
  )
  return {
    group,
    dispose: () => {
      shape.dispose()
      car.dispose()
      for (const tree of trees) tree.dispose()
    },
  }
}
