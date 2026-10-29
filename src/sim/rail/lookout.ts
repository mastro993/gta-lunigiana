/**
 * An AI driver's look-out for what fouls the track ahead (RFI's signal rules, art. 5(e): people on or
 * next to the track call for the whistle; the Italian investigation report on the Caluso crossing crash
 * of 2018, of a driver at Bojano: the urgent brake and the horn together): a person, an animal or a
 * vehicle on its envelope, on its level and off the platforms, within the distance its emergency brake
 * needs, or a vehicle touching its body alongside. On one the driver pulls the emergency brake and
 * sounds the urgent whistle; stopped with it still there, it sounds the horn for `HORN` s, then creeps
 * on at `CREEP` m/s, its nose pushing it off the track and its side scraping past it, until the way is
 * clear. `TrainAI` (./service.ts) runs it.
 *
 * @module rail/lookout
 */
import { Clock } from "@typeonce/ritmo"

import { STEP, type TrainRunValue } from "../schema.ts"
import { foulsAt, type Sighted } from "./bodies.ts"
import { BRAKE_EASE } from "./dynamics.ts"
import { type Line, pointAt } from "./lines.ts"

/** The deceleration the look-out plans the emergency brake on, m/s²: what it gives under snow (254 m from 80 km/h). */
const LOOKOUT_DECEL = 1
/** And this much more track, m: room to spare. */
const LOOKOUT_MARGIN = 20
/** A body this far behind the nose along the track, m, is still ahead of it (its nose touching it). */
const TOUCHING = 1
/**
 * Stopped for something still on the track, the driver sounds the horn until this long after the alarm's last beat (at the
 * stand or before it), then creeps on, s: a whole number of `URGENT_EVERY`, so the horn's alarms keep that beat.
 */
export const HORN = 10
/** Creeping on toward something on the track, a train goes no faster, m/s. */
export const CREEP = 1
/** Held, the driver sounds the urgent whistle again this often, s: a 1.6 s alarm (audio/synth/horns.ts) and a breath. */
const URGENT_EVERY = 2
/** Held, a driver keeps watching what is on the track at least this far ahead, m: where it stopped short of it, and more. */
const HELD_SIGHT = 60

const HORN_STEPS = Clock.steps(Clock.duration(STEP, HORN)),
  URGENT_STEPS = Clock.steps(Clock.duration(STEP, URGENT_EVERY))

/**
 * How far ahead a driver at `v` m/s looks for what fouls the track, m: its emergency stop, begun the brakes' ease time late, and
 * room to spare (334 m from 85 km/h); once `held`, never less than `HELD_SIGHT`, so what it stopped for keeps it held.
 */
export const lookoutReach = (v: number, held = false): number =>
  Math.max(
    (v * v) / (2 * LOOKOUT_DECEL) + Math.abs(v) * BRAKE_EASE + LOOKOUT_MARGIN,
    held ? HELD_SIGHT : 0,
  )

/** Whether any of `bodies` fouls `line`'s envelope (a train `half` m wide either side) ahead of the head at s `head` running `dir`, within `reach` m. */
export const fouledAhead = (
  line: Line,
  head: number,
  dir: 1 | -1,
  reach: number,
  half: number,
  bodies: ReadonlyArray<Sighted>,
): boolean => {
  const nose = pointAt(line, head)
  return bodies.some((body) => {
    // Nearer along the track than straight: one farther straight off than the reach is out of it.
    if ((body.x - nose.x) ** 2 + (body.y - nose.y) ** 2 > (reach + body.long + half) ** 2)
      return false
    const s = foulsAt(line.index, body, half)
    if (s === undefined) return false
    const ahead = (s - head) * dir
    return ahead > -body.long - TOUCHING && ahead <= reach
  })
}

/** A vehicle this near a train's side is touching it, m: the train shoves it along or drags it. */
const SCRAPE = 0.1

/**
 * Whether any of `vehicles` touches the body of a train `half` m wide either side between s `lo` and `hi` on `line` (within
 * `SCRAPE` m of its side, on its level): one it shoves aside or drags along its side, which keeps a held driver creeping on.
 */
export const touchingAlong = (
  line: Line,
  lo: number,
  hi: number,
  half: number,
  vehicles: ReadonlyArray<Sighted>,
): boolean => {
  const mid = pointAt(line, (lo + hi) / 2),
    reach = (hi - lo) / 2 + half + SCRAPE
  return vehicles.some((body) => {
    if ((body.x - mid.x) ** 2 + (body.y - mid.y) ** 2 > (reach + body.long) ** 2) return false
    const s = foulsAt(line.index, body, half, SCRAPE)
    return s !== undefined && s > lo - body.long && s < hi + body.long
  })
}

/**
 * An AI driver's run after its look-out at step `now`, standing or not, the track ahead `fouled` or not, and whether it sounds
 * the urgent whistle (the alarm, 1.6 s long). Running onto something it brakes in an emergency to a stand, the alarm at once
 * and every `URGENT_EVERY` s after; stopped with it still there it stands sounding the horn until `HORN` s after the alarm's
 * last beat, the alarm going on every `URGENT_EVERY` s, then creeps on; the way clear once it stands (or creeps), it runs again.
 * Each alarm sounds `URGENT_EVERY` s or more after the last, however often it is held again: running, braking and creeping,
 * `until` is the step the next one is due from, and sounding the horn its alarms keep that beat.
 */
export const lookout = (
  run: TrainRunValue,
  standing: boolean,
  fouled: boolean,
  now: number,
): { readonly run: TrainRunValue; readonly urgent: boolean } => {
  const due = now >= run.until
  switch (run.state) {
    case "run":
      if (!fouled) return { run, urgent: false }
      return {
        run: { ...run, state: "braking", until: due ? now + URGENT_STEPS : run.until },
        urgent: due,
      }
    case "dwell":
      return { run, urgent: false }
    case "braking":
      if (!standing) return { run: due ? { ...run, until: now + URGENT_STEPS } : run, urgent: due }
      if (!fouled) return { run: { ...run, state: "run" }, urgent: false }
      return {
        run: { ...run, state: "horn", until: (due ? now : run.until - URGENT_STEPS) + HORN_STEPS },
        urgent: due,
      }
    case "horn":
      // The way clear, the next alarm stays due on the horn's beat.
      if (!fouled)
        return {
          run: { ...run, state: "run", until: now + ((run.until - now) % URGENT_STEPS) },
          urgent: false,
        }
      if (!due) return { run, urgent: (run.until - now) % URGENT_STEPS === 0 }
      return { run: { ...run, state: "creep" }, urgent: false }
    case "creep":
      return fouled ? { run, urgent: false } : { run: { ...run, state: "run" }, urgent: false }
  }
}
