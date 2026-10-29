import { FAUNA } from "../fauna.ts"
import { Animal, Driving, Game, InWater, Motion, Person, Pose, Rivers } from "../schema.ts"
import { FLOW, specificDischarge } from "../water/flow.ts"
import { waterUnder } from "../water/rivers.ts"
import { type Build, holdOf, personMass, swept } from "../water/swim.ts"

/** A person's build in the water: its height and the hold of its height at BMI 24.5. */
export const personBuild = (height: number): Build => ({
  height,
  hold: holdOf(height, personMass(height)),
})

/** An animal's build in the water: its species' shoulder height and mass, scaled by its size. */
export const animalBuild = (animal: {
  readonly species: keyof typeof FAUNA
  readonly size: number
}): Build => {
  const fauna = FAUNA[animal.species],
    height = fauna.height * animal.size
  return {
    height,
    hold: holdOf(height, fauna.mass * animal.size * animal.size * animal.size),
  }
}

/** Whether a body of `build` at `pose`, in the water or not (`wet`), is in it now at `q` m³/s per km², and swimming. */
const wading = (
  pose: { readonly x: number; readonly y: number },
  wet: { readonly swimming: boolean } | undefined,
  build: Build,
  q: number,
): { readonly swimming: boolean } | undefined => {
  const water = waterUnder(pose.x, pose.y, wet !== undefined, q)
  return water === undefined ? undefined : { swimming: swept(water, build, wet?.swimming ?? false) }
}

/**
 * Who is in the water: every person on foot and every animal standing in a river or stream gets
 * InWater, swimming once it is off its feet (`swept`), and loses it on dry ground or in a vehicle. One in the water
 * stays at the terrain's level under a bridge; one on a deck stays dry.
 */
export const Wade = Game.System(
  "Lunigiana/Wade",
  {
    queries: {
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          person: Game.Query.read(Person),
          wet: Game.Query.optional(InWater),
          driving: Game.Query.optional(Driving),
        },
        with: [Motion],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          animal: Game.Query.read(Animal),
          wet: Game.Query.optional(InWater),
        },
        with: [Motion],
      }),
    },
    resources: { rivers: Game.System.readResource(Rivers) },
    commands: Game.System.commands(Game.System.inserts(InWater), Game.System.removes(InWater)),
  },
  ({ queries, resources, commands }) => {
    const q = specificDischarge(resources.rivers.get(), FLOW)
    for (const { entity, data } of queries.people.each()) {
      const wet = data.wet.value(),
        next = data.driving.present
          ? undefined
          : wading(data.pose.get(), wet, personBuild(data.person.get().height), q)
      if (next === undefined) {
        if (wet !== undefined) commands.remove(entity, InWater)
      } else if (wet?.swimming !== next.swimming) commands.insert(entity, [InWater, next])
    }
    for (const { entity, data } of queries.animals.each()) {
      const wet = data.wet.value(),
        next = wading(data.pose.get(), wet, animalBuild(data.animal.get()), q)
      if (next === undefined) {
        if (wet !== undefined) commands.remove(entity, InWater)
      } else if (wet?.swimming !== next.swimming) commands.insert(entity, [InWater, next])
    }
  },
)
