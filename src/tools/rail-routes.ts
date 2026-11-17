// Where trains end inside the map, from OSM's train routes: a route=train relation lists its stop
// positions in running order and the ways it runs; its first and last stops are where its trains
// start and end. A stop where some route ends and none stops on its way is a terminus: the line
// reaching it there turns its trains round, where it sits at a piece end (`terminiOf` in
// railway.ts). Aulla Lunigiana's track 4 is the one the Lucca–Aulla line ends at: the Aulla => Pisa
// route (21785496) starts at its stop 13949044083 and leaves along way 1571417875. The Pisa =>
// Aulla Lunigiana route (21785495) ends at track 5's stop, which sits at no piece end.
import type { Osm } from "./osm.ts"

/** A stop where OSM's train routes end: the stop position's node and the way their trains reach it along, OSM ids. */
export interface RouteEnd {
  readonly node: string
  readonly way: number
}

/** Whether a relation member's role names a stop (`stop`, `stop_exit_only`, `stop_entry_only`). */
const isStop = (role: string) => role === "stop" || role.startsWith("stop_")

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
        ends.set(`${node} ${way}`, { node, way: +way })
    }
    at(stops[0], ways[0])
    if (stops.length > 1) at(stops.at(-1), ways.at(-1))
  }
  return [...ends.values()].filter((end) => !passed.has(end.node))
}
