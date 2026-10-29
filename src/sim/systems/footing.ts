/**
 * Where bodies on foot stand (`Footing`): each step, before anything moves, every one keeps to the level it was on, the ground
 * where it is nearest its last footing (`footZ`, the decks and tunnels out to their verges), so it walks onto a bridge's deck or
 * into a tunnel along the road, and stays on the track over a road tunnel or under a road bridge. One with none yet (just
 * brought out, or a save from before) takes its way's road where that is a bridge's deck or a tunnel's floor, else the ground at
 * the terrain's level. Getting out of a vehicle, thrown from a wreck and coming back at the start, the player is set on the
 * ground there. The railway's rules read it to tell whether a body is on a train's level.
 *
 * @module systems/footing
 */
import { atGrade, footZ, roadLevel } from "../map/ground.ts"
import { roadOf } from "../route.ts"
import {
  Animal,
  Driving,
  Footing,
  type FootingValue,
  Game,
  Person,
  Pose,
  Route,
  type RouteValue,
} from "../schema.ts"

/** Where a body on foot at (x, y) with no footing stands, m a.s.l.: on `route`'s road when that is lifted (a deck, a tunnel's floor), else at the terrain's level. */
const firstFooting = (x: number, y: number, route?: RouteValue): number => {
  const road = route === undefined ? undefined : roadOf(route.edge)
  return road !== undefined && (road.bridge === true || road.tunnel === true)
    ? roadLevel(road, x, y)
    : atGrade(x, y)
}

/** The ground a body on foot at (x, y) stands on, m a.s.l.: its `footing`, or, with none yet, `firstFooting`. */
export const footingAt = (footing: FootingValue | undefined, x: number, y: number): number =>
  footing?.z ?? firstFooting(x, y)

/** Each step, once getting in and out is applied: every body on foot finds its footing on the level it was on; one with none takes its first. */
export const FindFooting = Game.System(
  "Lunigiana/FindFooting",
  {
    queries: {
      standing: Game.Query({
        selection: { pose: Game.Query.read(Pose), footing: Game.Query.write(Footing) },
        without: [Driving],
      }),
      people: Game.Query({
        selection: { pose: Game.Query.read(Pose), route: Game.Query.optional(Route) },
        with: [Person],
        without: [Footing, Driving],
      }),
      animals: Game.Query({
        selection: { pose: Game.Query.read(Pose) },
        with: [Animal],
        without: [Footing],
      }),
    },
    commands: Game.System.commands(Game.System.inserts(Footing)),
  },
  ({ queries, commands }) => {
    for (const { data } of queries.standing.each()) {
      const { x, y } = data.pose.get(),
        was = data.footing.get().z,
        z = footZ(x, y, was)
      if (z !== was) data.footing.set({ z })
    }
    for (const { entity, data } of queries.people.each()) {
      const { x, y } = data.pose.get()
      commands.insert(entity, [Footing, { z: firstFooting(x, y, data.route.value()) }])
    }
    for (const { entity, data } of queries.animals.each()) {
      const { x, y } = data.pose.get()
      commands.insert(entity, [Footing, { z: firstFooting(x, y) }])
    }
  },
)
