// Where trains end inside the map, from OSM's train routes: a route=train relation lists its stop
// positions in running order and the ways it runs; its first and last stops are where its trains
// start and end. A stop where some route ends and none stops on its way is a terminus: the line
// reaching it there turns its trains round, where it sits at a piece end (`terminiOf` in
// railway.ts). Aulla Lunigiana has two: the Aulla => Pisa route (21785496) starts at track 4's stop
// 13949044083 and leaves along way 1571417875, and the Pisa => Aulla Lunigiana route (21785495) ends
// at track 5's stop 13949044084, reached along way 1571417857; one station, so one line ends there.
import type { Osm } from "./osm.ts"

/** A stop where OSM's train routes end: the stop position's node and the way their trains reach it along, OSM ids, and its station (the stop's name, else its id). */
export interface RouteEnd {
  readonly node: string
  readonly way: number
  readonly station: string
}

/** Whether a relation member's role names a stop (`stop`, `stop_exit_only`, `stop_entry_only`). */
const isStop = (role: string) => role === "stop" || role.startsWith("stop_")

/** OSM's train routes in `osm`, each the ids of the ways it runs (its members with no role), in its running order. */
export const trainRoutes = (osm: Osm): Array<Array<number>> =>
  [...osm.relations.values()].flatMap(({ tags, members }) =>
    tags.type === "route" && tags.route === "train"
      ? [members.filter((m) => m.type === "way" && m.role === "").map((m) => +m.ref)]
      : [],
  )

/**
 * The termini of OSM's train routes in `osm`: each route's last stop with the way it comes in on (its last way), and its first
 * with the way it leaves along (its first), where that way runs through the stop and no route stops there on its way.
 */
export const routeEnds = (osm: Osm): Array<RouteEnd> => {
  const ends = new Map<string, RouteEnd>(),
    passed = new Set<string>()
  for (const { tags, members } of osm.relations.values()) {
    if (tags.type !== "route" || tags.route !== "train") continue
    const stops = members.filter((m) => m.type === "node" && isStop(m.role)).map((m) => m.ref),
      ways = members.filter((m) => m.type === "way" && m.role === "").map((m) => m.ref)
    for (const stop of stops.slice(1, -1)) passed.add(stop)
    const at = (node: string | undefined, way: string | undefined) => {
      if (node === undefined || way === undefined) return
      if (osm.ways.get(way)?.nds.includes(node) === true)
        ends.set(`${node} ${way}`, {
          node,
          way: +way,
          station: osm.nodes.get(node)?.tags.name ?? node,
        })
    }
    at(stops[0], ways[0])
    if (stops.length > 1) at(stops.at(-1), ways.at(-1))
  }
  return [...ends.values()].filter((end) => !passed.has(end.node))
}
