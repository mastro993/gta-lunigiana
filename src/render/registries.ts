/**
 * The render's node registries for people, animals and vehicles (render/train holds the trains'):
 * the services the render schedule's sync and place systems fill, and `makeRegistries`, which
 * `main.ts` calls to make all four, attaching each node under the scene and freeing what it owns
 * when its entity goes.
 *
 * @module render/registries
 */
import { Descriptor } from "@typeonce/ritmo"
import { NodeRegistry } from "@typeonce/ritmo-render"
import type { Object3D } from "three"

import type { VehicleNode } from "./actors.ts"
import type { AnimalNode } from "./animals.ts"
import type { PersonNode } from "./people.ts"
import type { TrainNode } from "./train.ts"

/** Person nodes, one per entity with a Person. */
export const People =
  Descriptor.Service<NodeRegistry.NodeRegistry<PersonNode>>()("Lunigiana/PeopleNodes")
/** Animal nodes, one per entity with an Animal. */
export const Animals =
  Descriptor.Service<NodeRegistry.NodeRegistry<AnimalNode>>()("Lunigiana/AnimalNodes")
/** Vehicle nodes, one per entity with a Vehicle. */
export const Vehicles =
  Descriptor.Service<NodeRegistry.NodeRegistry<VehicleNode>>()("Lunigiana/VehicleNodes")
/** The four registries, attaching nodes under `parent` and freeing what each owns on detach. */
export const makeRegistries = (parent: Object3D) => {
  const options = {
    attach: (node: Object3D) => parent.add(node),
    detach: (node: Object3D & { readonly dispose: () => void }) => {
      node.removeFromParent()
      node.dispose()
    },
  }
  return {
    people: NodeRegistry.make<PersonNode>(options),
    animals: NodeRegistry.make<AnimalNode>(options),
    vehicles: NodeRegistry.make<VehicleNode>(options),
    trains: NodeRegistry.make<TrainNode>(options),
  }
}
