/**
 * Level crossings as the map places them: the static boxes `MAP.railway.crossings` describes, with
 * what traffic and the render need of them (the lines crossing each at grade, each approach's stop
 * line, box entry and arm, and the traffic steps leading in). The cycle a box runs is in
 * ./barriers.ts. Static module content, built once at load.
 *
 * @module rail/crossings
 */
import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import { graph, isDrivable, type LevelCrossing, MAP, type Road } from "../map/index.ts"
import { stepKey } from "../route.ts"
import { type CrossedLine, strikeIn } from "./barriers.ts"
import { CHORD, LINES, linesNear, pointAt, speedAt } from "./lines.ts"

/** The road's stop line stands this far from the nearest track centreline, m (3.5–4 m: a waiting car's nose well clear of the train). */
const STOP_CLEAR = 3.75
/** The arm and the box entry stand this far past the stop line, toward the track, m. */
const ARM_AFTER = 1
/** The arm's post stands this far off the carriageway's edge, m. */
const POST_OFF = 0.5
/** The arm lengths there are, m (RFI; the TD96/2 takes 4–8 m arms). */
const ARMS = [4, 5, 6, 7, 8] as const
/** Crossings nearer square than this sine are measured as if at it (a road along the track would put the stop line kilometres off). */
const OBLIQUE = 0.3
/** How far back from a box the approach table walks the traffic edges, m. */
const APPROACH_REACH = 100
/** A line crosses a box where its track passes this near one of the box's nodes, m (each node is a vertex of a rail piece; parallel tracks lie 4 m apart). */
const NODE_REACH = 0.5

/** A point. */
interface Point {
  readonly x: number
  readonly y: number
}

/** One way into a box, along the road: where cars stop, where the box begins, and the arm that closes it. */
export interface Approach {
  /** The heading of a car driving in (rad). */
  readonly heading: number
  /** The stop line's middle and the box entry (the arm's line) on the road's centreline. */
  readonly stop: Point
  readonly entry: Point
  /** The arm's pivot, on the post right of the approach with the red road light, and its length, m; down, it points left across the road. */
  readonly pivot: Point
  readonly arm: number
}

/** A level crossing (`MAP.railway.crossings`, in its order). */
export interface CrossingBox {
  readonly road: number
  readonly x: number
  readonly y: number
  /** Every line crossing the road here at grade, by line (none where only a loop or siding is): a box on track lines share, or over two lines' tracks, closes for each. */
  readonly on: ReadonlyArray<CrossedLine>
  /** A foot crossing: no arms, light or bell. */
  readonly walk: boolean
  /** In from the road's start (along its vertices), and in from its end; none for a foot crossing. */
  readonly approaches: ReadonlyArray<Approach>
}

/** A traffic step leading into a box: distances from the step's start node along the route to the stop line, the box entry and the box's far side, m. */
export interface ApproachStep {
  readonly box: number
  readonly approach: number
  readonly stop: number
  readonly entry: number
  readonly exit: number
}

/** The road's arc length at each vertex. */
const arcOf = (road: Road): ReadonlyArray<number> => {
  const arc = [0]
  for (let k = 1; 2 * k + 1 < road.pts.length; k++)
    arc.push(
      arc[k - 1]! +
        Math.sqrt(
          (road.pts[2 * k]! - road.pts[2 * k - 2]!) ** 2 +
            (road.pts[2 * k + 1]! - road.pts[2 * k - 1]!) ** 2,
        ),
    )
  return arc
}

/** The point at arc length `u` along the road (clamped to it). */
const roadAt = (road: Road, arc: ReadonlyArray<number>, u: number): Point => {
  let k = 0
  while (k + 2 < arc.length && arc[k + 1]! < u) k++
  const t = Math.max(0, Math.min(1, (u - arc[k]!) / Math.max(1e-9, arc[k + 1]! - arc[k]!)))
  return {
    x: road.pts[2 * k]! + (road.pts[2 * k + 2]! - road.pts[2 * k]!) * t,
    y: road.pts[2 * k + 1]! + (road.pts[2 * k + 3]! - road.pts[2 * k + 1]!) * t,
  }
}

/** The arc length of the road's point nearest (x, y). */
const roadAlong = (road: Road, arc: ReadonlyArray<number>, x: number, y: number): number => {
  let best = Number.MAX_VALUE,
    u = 0
  for (let k = 0; k + 1 < arc.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      road.pts[2 * k]!,
      road.pts[2 * k + 1]!,
      road.pts[2 * k + 2]!,
      road.pts[2 * k + 3]!,
    )
    if (d2 < best) [best, u] = [d2, arc[k]! + (arc[k + 1]! - arc[k]!) * t]
  }
  return u
}

/** The unit heading of the nearest rail piece at (x, y), over a CHORD m chord. */
const railHeading = (x: number, y: number): Point => {
  let best = Number.MAX_VALUE,
    heading = { x: 1, y: 0 }
  for (const piece of MAP.rail)
    for (let k = 0; 2 * k + 3 < piece.pts.length; k++) {
      const ax = piece.pts[2 * k]!,
        ay = piece.pts[2 * k + 1]!,
        bx = piece.pts[2 * k + 2]!,
        by = piece.pts[2 * k + 3]!
      const { d2 } = segDist2(x, y, ax, ay, bx, by)
      if (d2 >= best) continue
      // Out to CHORD/2 either way along the piece, past short segments.
      let i = k,
        j = k + 1
      const far = (a: number, b: number) =>
        (piece.pts[2 * a]! - piece.pts[2 * b]!) ** 2 +
        (piece.pts[2 * a + 1]! - piece.pts[2 * b + 1]!) ** 2
      while (i > 0 && far(i, j) < CHORD * CHORD) i--
      while (2 * j + 3 < piece.pts.length && far(i, j) < CHORD * CHORD) j++
      const dx = piece.pts[2 * j]! - piece.pts[2 * i]!,
        dy = piece.pts[2 * j + 1]! - piece.pts[2 * i + 1]!,
        d = Math.sqrt(dx * dx + dy * dy)
      best = d2
      heading = { x: dx / d, y: dy / d }
    }
  return heading
}

/** The lines whose track runs through (x, y) at grade, each at its s there: a line on a bridge over the place or in a tunnel under it is not there. */
export const linesAtGrade = (
  x: number,
  y: number,
): ReadonlyArray<{ readonly line: number; readonly s: number }> =>
  linesNear(x, y, NODE_REACH).filter(({ line, s }) => {
    const at = pointAt(LINES[line]!, s)
    return !at.bridge && !at.tunnel
  })

/** The box a level crossing makes, and where its nodes lie along its road (arc lengths, m). */
const boxOf = (crossing: LevelCrossing) => {
  const road = MAP.roads[crossing.road]!,
    arc = arcOf(road)
  const nodes = crossing.nodes.map((n) => {
    const { x, y } = graph.nodes[n]!,
      u = roadAlong(road, arc, x, y)
    const a = roadAt(road, arc, u - CHORD / 2),
      b = roadAt(road, arc, u + CHORD / 2),
      d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
    const along = { x: (b.x - a.x) / d, y: (b.y - a.y) / d },
      rail = railHeading(x, y)
    const sin = Math.max(OBLIQUE, Math.abs(along.x * rail.y - along.y * rail.x))
    return { node: n, x, y, u, along, sin, cos: Math.sqrt(1 - sin * sin) }
  })
  const first = nodes.reduce((a, b) => (b.u < a.u ? b : a)),
    last = nodes.reduce((a, b) => (b.u > a.u ? b : a))
  // The stop line's nearest corner STOP_CLEAR m from the track, measured along the road.
  const clear = (n: (typeof nodes)[number]) => (STOP_CLEAR + (road.w / 2) * n.cos) / n.sin
  const stops = [first.u - clear(first), last.u + clear(last)] as const
  const entries = [stops[0] + ARM_AFTER, stops[1] - ARM_AFTER] as const
  // Each line through a node at grade, once: the carriageway's reach along it from the crossing angle there.
  const on = new Map<number, CrossedLine>()
  for (const node of nodes)
    for (const { line, s } of linesAtGrade(node.x, node.y))
      if (!on.has(line))
        on.set(line, {
          line,
          s,
          half: road.w / 2 / node.sin,
          reach: strikeIn(speedAt(LINES[line]!, s)),
        })
  const walk = !isDrivable(road.cls)
  const arm = ARMS.find((length) => length >= road.w + POST_OFF - 0.3) ?? ARMS.at(-1)!
  const approaches = walk
    ? []
    : ([0, 1] as const).map((side): Approach => {
        const node = side === 0 ? first : last,
          sign = side === 0 ? 1 : -1
        // Straight on from the node along the road's heading there: a stop line can lie past the road's end, in a junction.
        const { x, y } = graph.nodes[node.node]!,
          out = (u: number) => ({
            x: x + node.along.x * (u - node.u),
            y: y + node.along.y * (u - node.u),
          })
        const into = { x: node.along.x * sign, y: node.along.y * sign },
          entry = out(entries[side])
        return {
          heading: Ops.atan2(into.y, into.x),
          stop: out(stops[side]),
          entry,
          pivot: {
            x: entry.x + into.y * (road.w / 2 + POST_OFF),
            y: entry.y - into.x * (road.w / 2 + POST_OFF),
          },
          arm,
        }
      })
  return {
    box: {
      road: crossing.road,
      x: crossing.x,
      y: crossing.y,
      on: [...on.values()].sort((a, b) => a.line - b.line),
      walk,
      approaches,
    } satisfies CrossingBox,
    nodes: crossing.nodes,
    first,
    last,
    entries,
    stops,
  }
}

/** The map's level crossings' boxes, built once. */
const BUILT = MAP.railway.crossings.map(boxOf)

/** Every level crossing, indexed like `MAP.railway.crossings` and the `LevelCrossings` resource. */
export const CROSSINGS: ReadonlyArray<CrossingBox> = BUILT.map(({ box }) => box)

/** Per line (like `LINES`), the boxes it crosses at grade, by s: each one's index into `CROSSINGS` and where the line crosses it. */
export const CROSSINGS_ON: ReadonlyArray<
  ReadonlyArray<{ readonly box: number; readonly at: CrossedLine }>
> = LINES.map((line) =>
  CROSSINGS.flatMap((box, i) =>
    box.on.filter((at) => at.line === line.index).map((at) => ({ box: i, at })),
  ).sort((a, b) => a.at.s - b.at.s),
)

const trafficSet: ReadonlySet<number> = new Set(graph.trafficEdges)
const trafficDegree = (node: number) =>
  graph.adjacency[node]!.filter((e) => trafficSet.has(e)).length

/** The traffic steps leading into each of `boxes` (built by `boxOf`): see `approachesOf`. */
const approachesFrom = (
  boxes: ReadonlyArray<ReturnType<typeof boxOf>>,
): ReadonlyMap<number, ApproachStep> => {
  const table = new Map<number, ApproachStep>()
  const boxNodes: ReadonlySet<number> = new Set(boxes.flatMap(({ nodes }) => nodes))
  for (const [box, { box: crossing, nodes, first, last, entries, stops }] of boxes.entries()) {
    if (crossing.walk) continue
    const inside = new Set(nodes),
      road = MAP.roads[crossing.road]!,
      arc = arcOf(road)
    for (const approach of [0, 1] as const) {
      const near = approach === 0 ? first : last,
        sign = approach === 0 ? 1 : -1
      // Distances from the near node to the stop line, the entry and the far side, along the way in.
      const toStop = (near.u - stops[approach]) * sign,
        toEntry = (near.u - entries[approach]) * sign,
        toExit = (entries[1 - approach]! - near.u) * sign
      let node = near.node,
        back = 0
      const seen = new Set<number>([node])
      for (;;) {
        // Out of the box along its road on the approach's side, then on along the chain.
        const edge = graph.adjacency[node]!.find((e) => {
          const { a, b, road: on } = graph.edges[e]!
          const other = a === node ? b : a
          if (!trafficSet.has(e) || seen.has(other) || inside.has(other)) return false
          if (node !== near.node) return true
          const { x, y } = graph.nodes[other]!
          return on === crossing.road && (roadAlong(road, arc, x, y) - near.u) * sign < 0
        })
        if (edge === undefined) break
        const { a, b, length } = graph.edges[edge]!
        const from = a === node ? b : a
        back += length
        table.set(stepKey({ edge, forward: a === from }), {
          box,
          approach,
          stop: back - toStop,
          entry: back - toEntry,
          exit: back + toExit,
        })
        seen.add(from)
        node = from
        // Beyond another box's node, traffic meets that box first.
        if (back >= APPROACH_REACH || trafficDegree(from) !== 2 || boxNodes.has(from)) break
      }
    }
    // Between the box's own nodes: already past the stop line and the entry, short of the far side.
    for (const n of inside)
      for (const edge of graph.adjacency[n]!) {
        const { a, b } = graph.edges[edge]!
        if (!trafficSet.has(edge) || !inside.has(a) || !inside.has(b)) continue
        for (const forward of [true, false]) {
          const from = graph.nodes[forward ? a : b]!,
            to = graph.nodes[forward ? b : a]!
          const u = roadAlong(road, arc, from.x, from.y),
            approach = roadAlong(road, arc, to.x, to.y) > u ? 0 : 1,
            sign = approach === 0 ? 1 : -1
          table.set(stepKey({ edge, forward }), {
            box,
            approach,
            stop: (stops[approach] - u) * sign,
            entry: (entries[approach] - u) * sign,
            exit: (entries[1 - approach]! - u) * sign,
          })
        }
      }
  }
  return table
}

/**
 * The traffic steps leading into each box `crossings` make (a map's records, in their order), keyed by
 * `stepKey`: walked back from the box's nodes over traffic edges, on through nodes where the road only
 * carries on, to the first junction, another box or `APPROACH_REACH` m; and the steps between a box's
 * own nodes. A step leads into the box it reaches first.
 */
export const approachesOf = (
  crossings: ReadonlyArray<LevelCrossing>,
): ReadonlyMap<number, ApproachStep> => approachesFrom(crossings.map(boxOf))

/** The traffic steps leading into each of the map's boxes (`approachesOf` its records). */
export const APPROACHES: ReadonlyMap<number, ApproachStep> = approachesFrom(BUILT)
