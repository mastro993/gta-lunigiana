/**
 * Road traffic at the level crossings, `TrafficAI`'s rules there as pure functions: a car on a way into
 * a box (`APPROACHES`) stops at its stop line (or at the box entry, once past the line) whenever the box
 * is not open: in the warning only if it can still stop at `STOP_DECEL`, else it clears the box; from
 * the lowering on always, and short of the trains' envelope even where the table has it past its line
 * (a junction inside the box). A car whose body already fouls a line's envelope clears the box. It
 * never drives into a box it could not leave, for want of room past it, nor, toward a closed box, into
 * the junction before the way in unless it fits on that way; and while a box is closed for a train,
 * everyone waiting at it, and the queue behind, waits patiently. A car backing up to get unstuck never
 * backs onto a line's track at a box not open (one that has cleared it and stands in the queue past
 * it). No traffic is brought out near a box, and none turns round beside a line's track.
 *
 * @module rail/roads
 */
import { Clock } from "@typeonce/ritmo"
import { Ops } from "@typeonce/ritmo-math"

import { staticGrid } from "../collide.ts"
import { graph } from "../map/index.ts"
import { endNode, type Lane, laneOf, lanePoint, roadOf, type Step, stepKey } from "../route.ts"
import { STEP } from "../schema.ts"
import { type CrossingState, LOWERING, MARGIN, OPEN, WARNING } from "./barriers.ts"
import { CLEARANCE, type SeenTrain } from "./bodies.ts"
import { APPROACHES, type CrossingBox, CROSSINGS, CROSSINGS_ON } from "./crossings.ts"
import { LINES, linesNear, pointAt } from "./lines.ts"
import { MOVING, spanOf, TRAIN_MODELS, TRAINS, trainLength } from "./models.ts"

/** A car stops for a box in its warning only if it can at this deceleration or gentler, m/s² (else it clears the box); it brakes along it. */
export const STOP_DECEL = 3.5
/** A car already braking stops for a box in its warning if it can at this, m/s²: under the slowest brakes' 6.5. */
const HARD_DECEL = 6
/** How far a train's envelope reaches either side of a line's centreline, m: the widest train's half-width and its `CLEARANCE`. */
const ENVELOPE = Math.max(...TRAIN_MODELS.map((model) => TRAINS[model].width)) / 2 + CLEARANCE
/** A car held for a box stands at least this far outside the envelope, m. */
const ENVELOPE_SLACK = 0.5
/** A line's track this far along it from where it crosses a box is that box's, m. */
const BOX_TRACK = 30
/** A car's heading must take it at least this much nearer a line per metre driven to be driving onto its track. */
const ONTO = 0.05
/** A car stopping for a box stands this far short of its line, m. */
const LINE_SLACK = 0.3
/** Room a car needs past a box, or on the way in past a junction, beyond its own length, m: the cone's gap. */
const ROOM = 2
/** A car holding short of a junction stands this far outside the widest road crossing its way there, m. */
const JUNCTION_CLEAR = 0.5
/** Cars within this of a box entry look for room past the box, m. */
const KEEP_REACH = 30
/** A vehicle slower than this, m/s, takes up room (it is not driving on out of it). */
const SLOW = 2.5
/** Its footprint this near a car's own across the road, m, it is in its lane: what its braking cone keeps clear (`CONE_CLEARANCE`). */
const LANE_CLEAR = 0.15
/**
 * Past a box, one heading the car's way this much farther off is in its lane too, m: how far the box's straight on past its far side
 * may stray from where the car's lane runs (0.37 m on Via Volturno, where the road bends a little past the box) and the car from
 * its lane (0.14 m there), and its braking cone bends with its wheel. One coming the other way, queued at the box in its own lane,
 * never is: it drives through toward the car, and holding for it the two would wait for each other.
 */
const PATH_SLACK = 0.5
/** Drivers wait at a closed box patiently for this long after it began to close, s, and then only while a train moves in its strike-in. */
export const PATIENT_FOR = 120
/** A car within this of a box's middle and heading toward it counts as queued for it (the queue spilling back past the tabled ways in), m. */
const QUEUE_REACH = 60
/** Heading within this cosine of the way to the box counts as toward it. */
const TOWARD = 0.5
/** The boxes in QUEUE_REACH m cells: a car queued back, or a spawn, looks only at those near it, however many the railway has. */
const boxGrid = staticGrid(
  CROSSINGS.length,
  (i) => [CROSSINGS[i]!.x, CROSSINGS[i]!.y, CROSSINGS[i]!.x, CROSSINGS[i]!.y],
  QUEUE_REACH,
)
/** No traffic is brought out within this of a box's middle, m. */
export const SPAWN_CLEAR = 15

const PATIENT_STEPS = Clock.steps(Clock.duration(STEP, PATIENT_FOR)),
  WARNING_STEPS = Clock.steps(Clock.duration(STEP, WARNING)),
  LOWERING_STEPS = Clock.steps(Clock.duration(STEP, LOWERING))

/** A box ahead of a car: which and from which side, and the car's middle's distances along its way to the stop line, the entry and the far side, and to the junction the way in starts at, if the car is short of it (m). */
interface BoxAhead {
  readonly box: number
  readonly approach: number
  readonly stop: number
  readonly entry: number
  readonly exit: number
  readonly junction?: {
    readonly at: number
    readonly lane: Lane
    readonly stop: number
    readonly hold: number
  }
}

const trafficSet: ReadonlySet<number> = new Set(graph.trafficEdges)
/** How far short of a junction's node a car arriving on `from` toward `to` holds, m: the widest other road's half-width and JUNCTION_CLEAR; undefined where the node is no junction (it only carries the road on). */
const holdShort = (node: number, from: number, to: number): number | undefined => {
  const others = graph.adjacency[node]!.filter((e) => trafficSet.has(e) && e !== from && e !== to)
  if (others.length === 0) return undefined
  return Math.max(...others.map((e) => roadOf(e).w / 2)) + JUNCTION_CLEAR
}

/** The box a car on `route` (at `along` m down `lane`), going on to `next`, drives into: from this step, or the next one. */
const boxAhead = (route: Step, next: Step, lane: Lane, along: number): BoxAhead | undefined => {
  const here = APPROACHES.get(stepKey(route))
  if (here !== undefined)
    return {
      ...here,
      stop: here.stop - along,
      entry: here.entry - along,
      exit: here.exit - along,
    }
  const there = APPROACHES.get(stepKey(next))
  if (there === undefined) return undefined
  const to = lane.length - along,
    hold = holdShort(endNode(route.edge, route.forward), route.edge, next.edge)
  return {
    ...there,
    stop: to + there.stop,
    entry: to + there.entry,
    exit: to + there.exit,
    ...(hold === undefined
      ? {}
      : { junction: { at: to, lane: laneOf(next.edge, next.forward), stop: there.stop, hold } }),
  }
}

/** A box's closure's age at `now`, steps: from the start of its warning (an estimate once its arms came down again from part-way up). */
const closureAge = (state: CrossingState, now: number): number =>
  now -
  state.since +
  (state.phase === "lowering"
    ? WARNING_STEPS
    : state.phase === "closed"
      ? WARNING_STEPS + LOWERING_STEPS
      : 0)

/**
 * Whether those held at a box in `state` at step `now` wait patiently: from its warning for PATIENT_FOR s, while its arms rise, and
 * while a train moves within its strike-in (`busy`).
 */
export const patientAt = (state: CrossingState, now: number, busy: boolean): boolean =>
  state.phase !== "open" &&
  (state.phase === "raising" || closureAge(state, now) < PATIENT_STEPS || busy)

/** For each box (`CROSSINGS`), whether one of `trains` moves within its strike-in on a line crossing it (or on it). */
export const busyBoxes = (trains: ReadonlyArray<SeenTrain>): ReadonlyArray<boolean> => {
  const busy = CROSSINGS.map(() => false)
  for (const { motion, model } of trains) {
    if (Math.abs(motion.v) <= MOVING) continue
    const { lo, hi } = spanOf(motion.s, motion.facing, trainLength(model))
    for (const { box, at } of CROSSINGS_ON[motion.line] ?? [])
      busy[box] ||= Math.max(lo - at.s, at.s - hi, 0) <= at.reach + at.half + MARGIN
  }
  return busy
}

/** A vehicle as the crossing rules see it: its middle and heading, half its length and width, and its speed (m, rad, m/s). */
export interface Occupant {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly long: number
  readonly wide: number
  readonly speed: number
}

/** A traffic car meeting the crossings: its id, middle and heading, speed along it, length and width, lane offset, its way (this step, the next, its lane and how far down it), the road's grip and whether it brakes already. */
export interface CrossingCar {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly speed: number
  readonly length: number
  readonly width: number
  readonly side: number
  readonly route: Step
  readonly next: Step
  readonly lane: Lane
  readonly along: number
  readonly grip: number
  readonly braking: boolean
}

/**
 * Whether a slow vehicle stands in `car`'s lane between 0 and `to` m along a heading of (hx, hy) from (x, y), one heading that way
 * `slack` m farther off it too: the nearest such stretch's start, or undefined.
 */
const taken = (
  car: CrossingCar,
  others: ReadonlyArray<Occupant>,
  x: number,
  y: number,
  hx: number,
  hy: number,
  to: number,
  slack = 0,
): number | undefined => {
  let first: number | undefined
  for (const o of others) {
    if (o.id === car.id || Math.abs(o.speed) >= SLOW) continue
    const rx = o.x - x,
      ry = o.y - y,
      ca = Math.abs(Ops.cos(o.angle) * hx + Ops.sin(o.angle) * hy),
      sa = Math.sqrt(Math.max(0, 1 - ca * ca))
    const along = rx * hx + ry * hy,
      across = rx * hy - ry * hx,
      reach = ca * o.long + sa * o.wide,
      wide = sa * o.long + ca * o.wide
    if (along + reach <= 0 || along - reach >= to) continue
    const clear = LANE_CLEAR + (Ops.cos(o.angle) * hx + Ops.sin(o.angle) * hy > 0 ? slack : 0)
    if (Math.abs(across - car.side) - wide >= car.width / 2 + clear) continue
    first = Math.min(first ?? Number.MAX_VALUE, along - reach)
  }
  return first
}

/** The fastest a car may go to stand `gap` m short of a line on road keeping `grip`: on a STOP_DECEL curve, then the cone's law, 0.8 m/s per m. */
const stopSpeed = (gap: number, grip: number): number =>
  Math.max(0, Math.min(Math.sqrt(2 * STOP_DECEL * grip * Math.max(0, gap)), gap * 0.8 * grip))

/**
 * How `car`'s body stands to the lines crossing `box` at grade: whether it fouls a train's envelope there, and how far it may
 * still drive on along its heading before it comes within ENVELOPE_SLACK m of one, m (`Number.MAX_VALUE` when it is not driving
 * onto any): what the approach table gets wrong where a junction lies in the box.
 */
const toTrack = (
  car: Pick<CrossingCar, "x" | "y" | "angle" | "length" | "width">,
  box: CrossingBox,
): { readonly fouls: boolean; readonly room: number } => {
  const fx = Ops.cos(car.angle),
    fy = Ops.sin(car.angle),
    long = car.length / 2,
    wide = car.width / 2
  let fouls = false,
    room = Number.MAX_VALUE
  const near = linesNear(car.x, car.y, ENVELOPE + long + BOX_TRACK)
  for (const on of box.on) {
    const at = near.find((p) => p.line === on.line)
    if (at === undefined || Math.abs(at.s - on.s) > BOX_TRACK) continue
    const track = pointAt(LINES[on.line]!, at.s),
      turn = car.angle - track.angle
    // Its footprint's reach across the track, and its edge's clearance from the envelope.
    const clear =
      at.distance - Math.abs(Ops.sin(turn)) * long - Math.abs(Ops.cos(turn)) * wide - ENVELOPE
    if (clear <= 0) {
      fouls = true
      continue
    }
    // The left of +s; how much nearer the centreline each metre along its heading takes it.
    const nx = -Ops.sin(track.angle),
      ny = Ops.cos(track.angle),
      side = (car.x - track.x) * nx + (car.y - track.y) * ny >= 0 ? 1 : -1,
      onto = -(fx * nx + fy * ny) * side
    if (onto > ONTO) room = Math.min(room, (clear - ENVELOPE_SLACK) / onto)
  }
  return { fouls, room }
}

/**
 * What the crossings ask of `car` this step, the boxes in `states` at step `now` (`busy`: a train moving in each one's strike-in),
 * with the vehicles `others` about: the fastest it may go (`Number.MAX_VALUE` when no box binds) and whether it waits patiently
 * (its stuck count frozen).
 */
export const atCrossings = (
  car: CrossingCar,
  others: ReadonlyArray<Occupant>,
  states: ReadonlyArray<CrossingState>,
  busy: ReadonlyArray<boolean>,
  now: number,
): { readonly limit: number; readonly patient: boolean } => {
  const waits = (i: number) => patientAt(states[i] ?? OPEN, now, busy[i] === true)
  const ahead = boxAhead(car.route, car.next, car.lane, car.along)
  if (ahead === undefined) {
    // Queued back past the tabled ways in: near a box that holds traffic, heading for it.
    const fx = Ops.cos(car.angle),
      fy = Ops.sin(car.angle)
    let patient = false
    boxGrid(
      car.x - QUEUE_REACH,
      car.y - QUEUE_REACH,
      car.x + QUEUE_REACH,
      car.y + QUEUE_REACH,
      (i) => {
        const box = CROSSINGS[i]!,
          dx = box.x - car.x,
          dy = box.y - car.y,
          d = Math.sqrt(dx * dx + dy * dy)
        patient ||= !box.walk && d < QUEUE_REACH && dx * fx + dy * fy > TOWARD * d && waits(i)
      },
    )
    return { limit: Number.MAX_VALUE, patient }
  }
  const box = CROSSINGS[ahead.box]!,
    state = states[ahead.box] ?? OPEN,
    open = state.phase === "open",
    half = car.length / 2
  // On a line's track already: it clears the box.
  const { fouls, room } = toTrack(car, box)
  if (fouls) return { limit: Number.MAX_VALUE, patient: false }
  const toStop = ahead.stop - half,
    toEntry = ahead.entry - half,
    past = toEntry <= 0
  // Whether it can stand `gap` m short of a line braking at `decel` (one standing there already can, however near).
  const can = (gap: number, decel: number) =>
    Math.max(0, car.speed) ** 2 <= 2 * decel * car.grip * Math.max(0, gap)
  // Short of its line (or the entry, past the line), and never into the envelope.
  let gap = Math.min(past ? Number.MAX_VALUE : (toStop > 0 ? toStop : toEntry) - LINE_SLACK, room),
    hold = false
  // In the warning one that cannot stop gently clears the box, as one past its entry does; from the lowering on nobody drives on.
  if (!open)
    hold = state.phase !== "warning" || (!past && can(gap, car.braking ? HARD_DECEL : STOP_DECEL))
  // Keep clear: no room past the box's far side for the car and the gap behind what stands there in its lane, as the box's
  // straight on finds it there, give or take PATH_SLACK. Too near its line to stop there, it stops short of the envelope.
  if (!hold && toEntry < KEEP_REACH) {
    const far = box.approaches[1 - ahead.approach]!.entry,
      heading = box.approaches[ahead.approach]!.heading
    const past = car.length + ROOM,
      blocked =
        taken(car, others, far.x, far.y, Ops.cos(heading), Ops.sin(heading), past, PATH_SLACK) !==
        undefined
    if (blocked) {
      hold = true
      if (!can(gap, HARD_DECEL)) gap = room
    }
  }
  // Toward a box not open through a junction: only when it fits on the way in, behind the queue there; else short of the junction.
  const { junction } = ahead
  if (!open && junction !== undefined && toStop > 0 && junction.at - half > 0) {
    const { lane } = junction
    const queue = taken(car, others, lane.x, lane.y, lane.dx, lane.dy, junction.stop)
    if (queue !== undefined && queue < car.length + ROOM) {
      gap = junction.at - half - junction.hold
      hold = can(gap, HARD_DECEL) || hold
    }
  }
  return {
    limit: hold ? stopSpeed(gap, car.grip) : Number.MAX_VALUE,
    patient: !open && waits(ahead.box),
  }
}

/**
 * How far `car` may back up before its body comes within ENVELOPE_SLACK m of a line's envelope at a box not open in `states`, m
 * (`Number.MAX_VALUE` when it backs onto none): one that has cleared a box and stands in the queue past it, stuck there, never backs
 * onto the track behind it while the arms are down. One already on a track is left to clear the box.
 */
export const backRoom = (
  car: Pick<CrossingCar, "x" | "y" | "angle" | "length" | "width">,
  states: ReadonlyArray<CrossingState>,
): number => {
  const backing = { ...car, angle: car.angle + Math.PI }
  let room = Number.MAX_VALUE
  boxGrid(
    car.x - QUEUE_REACH,
    car.y - QUEUE_REACH,
    car.x + QUEUE_REACH,
    car.y + QUEUE_REACH,
    (i) => {
      const box = CROSSINGS[i]!
      if (box.walk || (states[i] ?? OPEN).phase === "open") return
      const at = toTrack(backing, box)
      if (!at.fouls) room = Math.min(room, at.room)
    },
  )
  return room
}

/** A car turning round sweeps this far from its lane, m: a Panda's turning circle and its body. */
const TURN_SWEEP = 12
/** The traffic edges within TURN_SWEEP m of a line's track at grade (sampled every 4 m along them). */
const besideTrack: ReadonlySet<number> = new Set(
  graph.trafficEdges.filter((edge) => {
    const lane = laneOf(edge, true)
    for (let u = 0; u < lane.length + 4; u += 4) {
      const { x, y } = lanePoint(lane, Math.min(u, lane.length), 0)
      const near = linesNear(x, y, TURN_SWEEP)
      if (
        near.some(
          ({ line, s }) => !pointAt(LINES[line]!, s).bridge && !pointAt(LINES[line]!, s).tunnel,
        )
      )
        return true
    }
    return false
  }),
)

/**
 * Whether a car turning round on traffic edge `edge` would sweep over a line's track at grade: it backs up there, never turns (and
 * never backs onto the track at a box not open, `backRoom`).
 */
export const nearTrack = (edge: number): boolean => besideTrack.has(edge)

/** Whether (x, y) lies within `SPAWN_CLEAR` m of a level crossing: no traffic is brought out there. */
export const nearCrossing = (x: number, y: number): boolean => {
  let near = false
  boxGrid(x - SPAWN_CLEAR, y - SPAWN_CLEAR, x + SPAWN_CLEAR, y + SPAWN_CLEAR, (i) => {
    near ||= (CROSSINGS[i]!.x - x) ** 2 + (CROSSINGS[i]!.y - y) ** 2 < SPAWN_CLEAR ** 2
  })
  return near
}
