/**
 * The railway's test kit: an inspector of the trains, the service and the crossings as plain data
 * (`TrainWorld`, merged into the sim kit's `world()`), the `noTrains` schedule the kit's `start` ticks
 * before setup so a test's world has no train unless it asks, schedules that place trains, step the
 * railway alone, set the ground's weather and a crossing's phase, AI train drafts, and fixtures found
 * by geometry so they survive a map rebuild.
 *
 * @module rail/testing
 */
import { Clock } from "@typeonce/ritmo"
import type { Keyboard } from "@typeonce/ritmo-browser"
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { wallsAlong } from "../body.ts"
import { segDist2 } from "../collide.ts"
import { footZ, groundZ, roadLevel } from "../map/ground.ts"
import { graph, MAP, type Road } from "../map/index.ts"
import { laneOf, type Step } from "../route.ts"
import {
  bindings,
  CarInput,
  Driving,
  Game,
  LevelCrossings,
  Player,
  Pose,
  type PoseValue,
  RailRng,
  Railway,
  Stolen,
  Train,
  Time,
  TrainMotion,
  TrainRun,
  Weather,
  type WeatherValue,
} from "../schema.ts"
import { type CrossingState } from "./barriers.ts"
import { doorsOf } from "./boarding.ts"
import { APPROACHES, CROSSINGS } from "./crossings.ts"
import { ApplyTrains, Dispatch } from "./dispatch.ts"
import { LINES, linesNear, nextStop, pointAt, stopPoint } from "./lines.ts"
import { trainLength } from "./models.ts"
import { trainDraft, TrainAI } from "./service.ts"
import { Crossings, TrainPhysics } from "./systems.ts"

/** Every train, the service of each line and each crossing's cycle and show, as plain data. */
export const TrainWorld = Game.Inspector(
  "Test/TrainWorld",
  {
    queries: {
      trains: Game.Query({
        selection: {
          train: Game.Query.read(Train),
          motion: Game.Query.read(TrainMotion),
          input: Game.Query.read(CarInput),
          run: Game.Query.optional(TrainRun),
          stolen: Game.Query.optional(Stolen),
        },
      }),
    },
    resources: {
      railway: Game.System.readResource(Railway),
      crossings: Game.System.readResource(LevelCrossings),
      rail: Game.System.readResource(RailRng),
    },
  },
  ({ queries, resources }) => ({
    trains: queries.trains.each().map(({ entity, data }) => ({
      id: entity.id,
      ...data.train.get(),
      ...data.motion.get(),
      input: data.input.get(),
      run: data.run.value(),
      stolen: data.stolen.present,
    })),
    railway: resources.railway.get(),
    crossings: resources.crossings.get(),
    /** The railway's random stream's state. */
    rail: resources.rail.get(),
  }),
)

/** No train service: every line's next train never due, so setup stands none. `start` ticks it before setup unless a test asks for trains. */
export const noTrains = Game.Schedule(
  Game.System(
    "Test/NoTrains",
    { resources: { railway: Game.System.writeResource(Railway) } },
    ({ resources }) => {
      resources.railway.update((service) => service.map((line) => ({ ...line, due: null })))
    },
  ),
)

/** Replaces every train with `trains` (`runtime.tick` it). */
export const placeTrains = (trains: ReadonlyArray<ReturnType<typeof trainDraft>>) =>
  Game.Schedule(
    Game.System(
      "Test/PlaceTrains",
      {
        queries: { trains: Game.Query({ selection: { train: Game.Query.read(Train) } }) },
        commands: Game.System.commands(
          Game.System.despawns(Train),
          Game.System.spawns(Train, TrainMotion, CarInput, TrainRun),
        ),
      },
      ({ queries, commands }) => {
        for (const { entity } of queries.trains.each()) commands.despawn(entity)
        for (const train of trains) commands.spawn(train)
      },
    ),
    Game.Schedule.applyDeferred(),
  )

/**
 * One step of the railway alone: the clock, then the railway's systems in `update`'s order (the crossings, the AI drivers, the
 * trains' motion, the dispatcher). A test of the service where nothing stands near the track runs this instead of the whole
 * step, a hundred times cheaper.
 */
export const railStep = Game.Schedule(
  Clock.system(Game, { name: "Test/AdvanceTime", resource: Time }),
  ApplyTrains,
  Crossings,
  TrainAI,
  TrainPhysics,
  Dispatch,
  Game.Schedule.applyDeferred(),
)

/** Sets level crossing `box`'s cycle to `state` (`runtime.tick` it). */
export const setCrossing = (box: number, state: CrossingState) =>
  Game.Schedule(
    Game.System(
      "Test/SetCrossing",
      { resources: { crossings: Game.System.writeResource(LevelCrossings) } },
      ({ resources }) =>
        resources.crossings.update((states) => states.map((was, i) => (i === box ? state : was))),
    ),
  )

/** Sets the weather's ground: `wet` (0…1) everywhere, or snow over the whole map (`runtime.tick` it). */
export const groundTo = (ground: { readonly wet?: number; readonly snow?: boolean }) =>
  Game.Schedule(
    Game.System(
      "Test/Ground",
      { resources: { weather: Game.System.writeResource(Weather) } },
      ({ resources }) =>
        resources.weather.update((weather): WeatherValue => ({
          ...weather,
          wet: ground.wet ?? weather.wet,
          snowLine: ground.snow === true ? -1000 : weather.snowLine,
        })),
    ),
  )

/** The line through Monzone: the one whose stations pass nearest the player's start. */
export const MONZONE = (() => {
  const start = MAP.spawns.player
  const stations = MAP.railway.stations.map((station, index) => ({ station, index }))
  const near = (s: (typeof stations)[number]) => {
    const line = LINES[s.station.line]!,
      mid = (s.station.s0 + s.station.s1) / 2
    const k = line.s.findIndex((at) => at >= mid)
    return Vec2.distanceSquared(start, { x: line.x[k]!, y: line.y[k]! })
  }
  const { station, index } = stations.reduce((a, b) => (near(b) < near(a) ? b : a))
  return { ...station, station: index }
})()
/** Where a box crosses `line`: its s there, the carriageway's half-width along it and its strike-in. */
export const crossedBy = (box: number, line: number) =>
  CROSSINGS[box]!.on.find((at) => at.line === line)!
/** Monzone's level crossing: the road box on its line nearest its platforms (Via Riolo, 81 m from the start). */
export const RIOLO = (() => {
  const mid = (MONZONE.s0 + MONZONE.s1) / 2
  const near = (index: number) => Math.abs(crossedBy(index, MONZONE.line).s - mid)
  return CROSSINGS.flatMap((box, index) =>
    !box.walk && box.on.some((at) => at.line === MONZONE.line) ? [index] : [],
  ).reduce((a, b) => (near(b) < near(a) ? b : a))
})()

/** Where an ATR 220 running `dir` stops at the station `station` (an index into `MAP.railway.stations`), m of s. */
export const stopOf = (station: number, dir: 1 | -1) =>
  stopPoint(MAP.railway.stations[station]!, dir, trainLength("atr220"))

/** An ATR 220 AI train on Monzone's line with its nose at s, running `dir` at `v` m/s along it: running to its next stop, or dwelling there until step `until`. */
export const aiTrain = (s: number, dir: 1 | -1, v = 0, until?: number) => {
  const line = LINES[MONZONE.line]!,
    length = trainLength("atr220")
  return trainDraft(
    "atr220",
    { line: line.index, s, facing: dir, v: dir * v },
    until === undefined
      ? { dir, stop: nextStop(line, s, dir, length), state: "run", until: 0 }
      : { dir, stop: nextStop(line, s - dir * 5, dir, length), state: "dwell", until },
  )
}

/**
 * The way into level crossing `box` from its side `approach`: the tabled traffic step farthest back (`step`, from node `from`)
 * and its distance to the stop line from there, and the traffic step leading into `from` most nearly in line with it (`before`).
 */
export const wayInto = (box: number, approach: number) => {
  const [key, way] = [...APPROACHES.entries()]
    .filter(([, a]) => a.box === box && a.approach === approach)
    .reduce((a, b) => (b[1].stop > a[1].stop ? b : a))
  const step: Step = { edge: key >> 1, forward: (key & 1) === 1 },
    lane = laneOf(step.edge, step.forward),
    { a, b } = graph.edges[step.edge]!,
    from = step.forward ? a : b
  const traffic = new Set(graph.trafficEdges)
  const before = graph.adjacency[from]!.filter((e) => e !== step.edge && traffic.has(e))
    .map((e): Step => ({ edge: e, forward: graph.edges[e]!.b === from }))
    .reduce((p, q) => {
      const lp = laneOf(p.edge, p.forward),
        lq = laneOf(q.edge, q.forward)
      return lq.dx * lane.dx + lq.dy * lane.dy > lp.dx * lane.dx + lp.dy * lane.dy ? q : p
    })
  return { step, from, stop: way.stop, before }
}

/** A keyboard a test plays as it goes (`start`'s `keys`): keys held until let go, and taps that press a key for one step. */
export const liveKeys = () => {
  type Key = keyof typeof bindings
  const held = new Set<Key>(),
    pressed = new Set<Key>(),
    released = new Set<Key>()
  return {
    hold: (...keys: Array<Key>) => {
      for (const key of keys) {
        if (!held.has(key)) pressed.add(key)
        held.add(key)
      }
    },
    release: (...keys: Array<Key>) => {
      for (const key of keys) if (held.delete(key)) released.add(key)
    },
    tap: (...keys: Array<Key>) => {
      for (const key of keys) pressed.add(key)
    },
    snapshot: (): Keyboard.Snapshot<typeof bindings> => {
      const state = (key: Key) => ({
        held: held.has(key),
        pressed: pressed.has(key),
        released: released.has(key) && !held.has(key),
      })
      const actions = Object.fromEntries(
        Object.keys(bindings).map((key) => [key, state(key as Key)]),
      ) as Keyboard.Snapshot<typeof bindings>["actions"]
      const snapshot = { actions, vectors: {}, used: held.size > 0 || pressed.size > 0 }
      pressed.clear()
      released.clear()
      return snapshot
    },
  }
}

/** Seats the player in the first train's active cab, driving it (`runtime.tick` it): to start aboard where nobody could get in, on a bridge or in a tunnel. */
export const aboard = Game.Schedule(
  Game.System(
    "Test/Aboard",
    {
      queries: {
        player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
        trains: Game.Query({ selection: { train: Game.Query.read(Train) }, with: [CarInput] }),
      },
      commands: Game.System.commands(Game.System.inserts(Driving)),
    },
    ({ queries, commands }) => {
      const [train] = queries.trains.each()
      if (train === undefined) return
      for (const { entity } of queries.player.each())
        commands.insert(entity, [Driving, { vehicle: Game.Entity.handle(train.entity, CarInput) }])
    },
  ),
  Game.Schedule.applyDeferred(),
)

/** Where someone stands to board an ATR 220 standing on Monzone's line with its nose at s, its cab facing `facing`: `out` m out from its `end` cab's door on `side` of the line (as a station's: +1 right of +s), facing the door. */
export const atDoor = (s: number, facing: 1 | -1, end: 0 | 1, side: 1 | -1, out = 1): PoseValue => {
  const line = LINES[MONZONE.line]!,
    motion = { line: line.index, s, prev: s, v: 0, facing, power: 0, brake: 0 }
  const door = doorsOf(line, motion, "atr220").find((d) => d.end === end && d.side === side)!,
    { angle } = pointAt(line, door.s)
  const nx = Ops.sin(angle) * side,
    ny = -Ops.cos(angle) * side
  return { x: door.x + nx * out, y: door.y + ny * out, angle: Ops.atan2(-ny, -nx) }
}

/** The bridges of Monzone's line: each run of bridge segments, from s to s. */
const BRIDGES = (() => {
  const line = LINES[MONZONE.line]!,
    spans: Array<{ from: number; to: number }> = []
  for (let k = 0; k < line.level.length; k++) {
    if (line.level[k] !== 1) continue
    const last = spans.at(-1)
    if (last !== undefined && last.to === line.s[k]) last.to = line.s[k + 1]!
    else spans.push({ from: line.s[k]!, to: line.s[k + 1]! })
  }
  return spans
})()
/** How far the rail head at s on Monzone's line stands over the map's ground `off` m to its right (left when negative), m. */
const overGround = (s: number, off = 0) => {
  const at = pointAt(LINES[MONZONE.line]!, s)
  return at.z - groundZ(at.x + Ops.sin(at.angle) * off, at.y - Ops.cos(at.angle) * off)
}
/** Monzone's line's highest bridge: the s of the middle of its bridge at least 20 m long whose rail head stands farthest over the map's ground (which has no rail decks). */
export const RAIL_BRIDGE = BRIDGES.filter((span) => span.to - span.from >= 20)
  .map((span) => (span.from + span.to) / 2)
  .reduce((a, b) => (overGround(b) > overGround(a) ? b : a))
/** Monzone's line's longest low bridge (over a stream): the s of the middle of the longest bridge whose ground beside it, 2 m out either side, is within 1 m of the rail head. */
export const LOW_BRIDGE = (() => {
  const { from, to } = BRIDGES.filter((span) =>
    [2, -2].every((off) => Math.abs(overGround((span.from + span.to) / 2, off)) < 1),
  ).reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  return (from + to) / 2
})()
/** Just inside a tunnel of Monzone's line: the s 3 m in from a portal where the map's ground 2 m out either side is within 1 m of the rail head (a cutting's floor, not the hill above). */
export const TUNNEL_MOUTH = LINES[MONZONE.line]!.tunnels.flatMap((t) => [
  t.from + 3,
  t.to - 3,
]).find((s) => [2, -2].every((off) => Math.abs(overGround(s, off)) < 1))!
/** Where Monzone's line runs at grade under a road bridge: the first s (by the metre) whose ground on foot 2 m out either side is a deck more than 2 m over the rail head. */
export const UNDER_ROAD = (() => {
  const line = LINES[MONZONE.line]!
  for (let s = 0; s < line.length; s++) {
    const at = pointAt(line, s)
    if (at.bridge || at.tunnel) continue
    const over = (off: number) =>
      footZ(at.x + Ops.sin(at.angle) * off, at.y - Ops.cos(at.angle) * off) - at.z > 2
    if (over(2) && over(-2)) return s
  }
  throw new Error("no road bridge over the line")
})()

/** Where Monzone's line runs at grade over a road tunnel (an underpass): the first s (by the metre) whose ground on foot with no height to go by, on the centreline, is a tunnel's floor more than 2 m under the rail head. */
export const OVER_ROAD = (() => {
  const line = LINES[MONZONE.line]!
  for (let s = 0; s < line.length; s++) {
    const at = pointAt(line, s)
    if (!at.bridge && !at.tunnel && at.z - footZ(at.x, at.y) > 2) return s
  }
  throw new Error("no road tunnel under the line")
})()

/** The nearest drive wall to (x, y) within `reach` m, its distance, m; `reach` when none is nearer. */
const wallOff = (x: number, y: number, reach: number): number => {
  let near = reach
  for (const wall of wallsAlong("drive", x, y, 0, 0, reach))
    near = Math.min(near, Math.sqrt(segDist2(x, y, wall.ax, wall.ay, wall.bx, wall.by).d2))
  return near
}
/**
 * Where Monzone's line runs at grade beside a wall: the starts of the first two stretches, each at least 20 m long by the metre
 * and 60 m or more from every station and level crossing, whose nearest drive wall stands 3.3–5 m off the centreline. A car the
 * train shoves off the track there stays pinned against its side by the wall.
 */
export const BESIDE_WALL = (() => {
  const line = LINES[MONZONE.line]!
  const clear = (s: number) =>
    !MAP.railway.stations.some(
      (st) => st.line === line.index && s > st.s0 - 60 && s < st.s1 + 60,
    ) &&
    !CROSSINGS.some((box) => box.on.some((on) => on.line === line.index && Math.abs(on.s - s) < 60))
  const found: Array<number> = []
  let from = -1
  for (let s = 0; s < line.length && found.length < 2; s++) {
    const at = pointAt(line, s),
      off = at.bridge || at.tunnel || !clear(s) ? 0 : wallOff(at.x, at.y, 6)
    if (off < 3.3 || off > 5) from = -1
    else if (from < 0) from = s
    else if (s - from === 20) found.push(from)
  }
  if (found.length < 2) throw new Error("no two walls beside the line")
  return found as [number, number]
})()

/** A road's polyline as points. */
const pointsOf = (road: Road) =>
  Array.from({ length: road.pts.length / 2 }, (_, k) => ({
    x: road.pts[2 * k]!,
    y: road.pts[2 * k + 1]!,
  }))
/** `walk`'s points every `step` m along it, its last one included. */
const along = (walk: ReadonlyArray<Vec2.Vec2>, step: number): Array<Vec2.Vec2> => [
  ...walk.slice(1).flatMap((to, k) => {
    const from = walk[k]!,
      n = Math.max(1, Math.ceil(Vec2.distance(from, to) / step))
    return Array.from({ length: n }, (_, i) => Vec2.lerp(from, to, i / n))
  }),
  walk.at(-1)!,
]
/** The last `length` m of `walk`. */
const lastOf = (walk: ReadonlyArray<Vec2.Vec2>, length: number): Array<Vec2.Vec2> => {
  const out = [walk.at(-1)!]
  let left = length
  for (let k = walk.length - 2; k >= 0 && left > 0; k--) {
    const d = Vec2.distance(walk[k]!, walk[k + 1]!)
    out.unshift(d <= left ? walk[k]! : Vec2.lerp(walk[k + 1]!, walk[k]!, left / d))
    left -= d
  }
  return out
}
/**
 * The way on foot down a road into a level crossing on Monzone's line: the last 50 m along a road box's road, every 0.25 m, to
 * the box's centre, from the side where its road at grade stands highest over the rail head there; with the box and its s.
 */
export const DOWN_TO_BOX = (() => {
  const line = LINES[MONZONE.line]!
  return CROSSINGS.flatMap((box, index) => {
    const on = box.on.find((at) => at.line === line.index)
    if (box.walk || on === undefined) return []
    const pts = pointsOf(MAP.roads[box.road]!),
      k = pts.reduce((a, p, i) => (Vec2.distance(p, box) < Vec2.distance(pts[a]!, box) ? i : a), 0)
    const rail = pointAt(line, on.s).z,
      centre = { x: box.x, y: box.y }
    return [
      [...pts.slice(0, k), centre],
      [...pts.slice(k + 1).reverse(), centre],
    ].map((walk) => {
      const way = along(lastOf(walk, 50), 0.25)
      return { box: index, s: on.s, way, fall: footZ(way[0]!.x, way[0]!.y) - rail }
    })
  }).reduce((a, b) => (b.fall > a.fall ? b : a))
})()

/**
 * Every way on foot into a road tunnel under Monzone's line, at grade or on the bridge over a tunnel's mouth: from 15 m out along
 * a road at grade through one of its mouths at its floor's level (one per mouth), through that mouth, to its point nearest the
 * track where it passes under it (the rail head more than 2 m over its floor), every 0.05 m; with that tunnel's road and the
 * track's s over that point.
 */
export const UNDERPASS_WAYS = (() => {
  const line = LINES[MONZONE.line]!
  return MAP.roads.flatMap((road) => {
    if (road.tunnel !== true) return []
    const pts = pointsOf(road)
    // Its point nearest the centreline, segment by segment, where the track runs over it at grade.
    let under: { k: number; p: Vec2.Vec2; s: number; d: number } | undefined
    pts.slice(1).forEach((_, k) => {
      for (const p of along([pts[k]!, pts[k + 1]!], 0.05)) {
        const near = linesNear(p.x, p.y, 2).find((n) => n.line === line.index)
        if (near === undefined || (under !== undefined && near.distance >= under.d)) continue
        const at = pointAt(line, near.s)
        if (!at.tunnel && at.z - roadLevel(road, p.x, p.y) > 2)
          under = { k, p, s: near.s, d: near.distance }
      }
    })
    if (under === undefined) return []
    const { k, p, s } = under
    return ([0, pts.length - 1] as const).flatMap((end) => {
      const mouth = pts[end]!
      // A road at grade with a vertex at the mouth, at the floor's level there: the walk in along it, ending at that vertex.
      const into = MAP.roads.flatMap((o) => {
        if (o === road || o.tunnel === true || o.bridge === true) return []
        const points = pointsOf(o),
          i = points.findIndex(
            (q, j) => Vec2.distance(q, mouth) < 0.5 && Math.abs(o.z[j]! - road.z[end]!) < 0.5,
          )
        return i < 0 ? [] : [i > 0 ? points.slice(0, i + 1) : points.reverse()]
      })[0]
      if (into === undefined) return []
      const inside = end === 0 ? [...pts.slice(0, k + 1), p] : [...pts.slice(k + 1).reverse(), p]
      return [{ road, walk: along([...lastOf(into, 15), ...inside.slice(1)], 0.05), s }]
    })
  })
})()
