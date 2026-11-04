/**
 * People on foot: footsteps on whatever is underfoot (crunching where snow lies on it), at the
 * cadence of their speed, and their voices when they cry out. Steps follow the distance a person
 * actually moved (positions, not velocity), so a teleport or getting out of a car fires no burst;
 * the listener's own steps come from right under the ears; the dead and the knocked down make none.
 *
 * Voices follow the sim's `Cry` events: a fright is a scream (children, and some grown-ups) or a
 * yelled "Aiuto!"/"Attento!", shock, anger and surprise a yelled line for the feeling, in the
 * person's own voice (age, sex and a pitch of their own); shock at a killed animal is pity, not a
 * call for an ambulance. People gathered by a victim ask after them now and then, addressing a
 * man, a woman or a child as they are; by one of their own (a child by its parent, a partner) they
 * grieve or call "Mamma!"/"Papà!". The victim is the body nearest the point they face, and their
 * own are the people last heard walking with them. A pedestrian first heard already running off
 * near the listener (the driver just pulled out of their car) yells after the thief. One cue per
 * person every `CUE_GAP` s; lines render on the main thread, so at most `LINES_PER_FRAME` start in
 * a frame, the nearest first, and the others follow in the next frames.
 *
 * @module audio/director/people
 */
import { facingAt } from "../../sim/map/ground.ts"
import { surfaceAt } from "../../sim/map/surface.ts"
import { snowCoverAt } from "../../sim/sky/local.ts"
import { hash01 } from "../../tools/geometry.ts"
import { EAR_HEIGHT } from "../acoustics.ts"
import { lineFor } from "../speech/index.ts"
import type { Line, Situation, Speaker } from "../speech/types.ts"
import { stepRate, WALK_DB } from "../synth/steps.ts"
import type { HeardAnimal, HeardPerson } from "../types.ts"
import { type Frame, groundAt } from "./frame.ts"
import { HEIGHT, LEVELS, speechLevel } from "./levels.ts"

/** A frame's move longer than this (m) is a jump, not walking. */
const JUMP = 3
/** Running from this speed, m/s (it also sets the dogs off). */
export const RUN = 3.5
/** The cadence of slower movers is taken at this speed, m/s (shuffling). */
const SHUFFLE = 0.5
/** A robbed driver this near the listener (m) yells after them; one voice cue per person per `CUE_GAP` s. */
const THIEF_NEAR = 15,
  CUE_GAP = 4
/** The share of grown-ups who scream in a fright rather than call for help (children always scream). TUNED. */
const SCREAMERS = 0.35
/** Someone gathered by a victim asks after them (or calls for help) about this often, per second. TUNED. */
const HELP_RATE = 1 / 7
/**
 * At most this many lines start in a frame, the nearest first; the others wait, and a wait over `STALE` s drops the line. Each
 * renders on the main thread in milliseconds (≈ 2.5 ms a yell at 48 kHz on a desktop, several times that on a phone), and a death
 * draws a cry from every witness in the same step. TUNED.
 */
const LINES_PER_FRAME = 3,
  STALE = 0.5
/** The body a gatherer or a shocked witness faces lies within this many metres of their point (m): the sim keeps it within 2 m of a body, and a cry's point is where the body was struck a frame before. */
const BODY_NEAR = 4
/** A step crunches in the snow where it covers this much of the ground or more. */
const SNOWY = 0.5

interface Walker {
  x: number
  y: number
  /** Steps due, as a fraction of a stride: one plays at each whole. */
  phase: number
  /** When the last voice cue played. */
  cue: number
  seen: number
  /** The person last heard walking with them. */
  party?: number
}

/** A line a person is to say, waiting for its frame. */
interface Waiting {
  readonly id: number
  readonly situation: Situation
  readonly loud: (line: Line) => boolean
  readonly since: number
}

/** The speech voice of `p`: their age and sex, and a pitch and timbre of their own from their id. */
export const speakerOf = (p: HeardPerson): Speaker => ({
  voice: hash01(p.id),
  age: p.age,
  female: p.female,
})

/**
 * The non-verbal cues' `voice` (scream, groan) of `p`: the lower half of 0…1 is a man's, the upper a woman's; a child's
 * sits at the top, the highest of them.
 */
export const cueVoice = (p: HeardPerson): number => {
  const v = hash01(p.id)
  return p.age === "kid" ? 0.8 + 0.2 * v : p.female ? 0.5 + 0.5 * v : 0.5 * v
}

/** Where `p`'s voice and steps come from. */
const mouthOf = (p: HeardPerson) => ({ x: p.x, y: p.y, z: groundAt(p.x, p.y) + HEIGHT.person })

/** A line called out to others (yelled), not said to someone near. */
const calledOut = (line: Line): boolean => line.tune === "call" || line.tune === "exclaim"

/** Whether a Poisson process of `rate` per second fires in `dt`. */
const fires = (random: () => number, rate: number, dt: number): boolean =>
  random() < 1 - Math.exp(-rate * dt)

/** Whether `body` is an animal's. */
const isAnimal = (body: HeardPerson | HeardAnimal): body is HeardAnimal => "species" in body

/** The people part of the director, with a step phase and the last cue of everyone in earshot, and the lines waiting to start. */
export const makePeople = () => {
  const walkers = new Map<number, Walker>()
  let waiting: Array<Waiting> = []
  let frames = 0

  /** Whether `p` and `q` are out together, as last heard: one walks with the other, or both with the same leader. */
  const kin = (p: HeardPerson, q: HeardPerson): boolean => {
    const a = walkers.get(p.id)?.party,
      b = walkers.get(q.id)?.party
    return a === q.id || b === p.id || (a !== undefined && a === b)
  }

  return {
    hear: (frame: Frame): void => {
      const { heard, ears, now } = frame
      frames++
      /** `p` screams now, or cries out a line for `situation` once its frame comes, yelled unless `loud` says otherwise of it: at most once per `CUE_GAP` s. */
      const cue = (
        p: HeardPerson,
        walker: Walker,
        situation: Situation | "scream",
        loud: (line: Line) => boolean = () => true,
      ) => {
        if (now - walker.cue < CUE_GAP) return
        walker.cue = now
        if (situation === "scream")
          frame.play(
            { kind: "scream", voice: cueVoice(p) },
            frame.path(`person:${p.id}`, mouthOf(p), LEVELS.scream),
          )
        else waiting.push({ id: p.id, situation, loud, since: now })
      }
      /** The body nearest the point `p` faces, a person's or an animal's, down or dead, if one lies near it. */
      const bodyBy = (p: HeardPerson): HeardPerson | HeardAnimal | undefined => {
        let best: HeardPerson | HeardAnimal | undefined,
          nearest = BODY_NEAR
        for (const body of [...heard.people, ...heard.animals]) {
          const d = Math.hypot(body.x - p.fx, body.y - p.fy)
          if (body !== p && (body.down || body.dead) && d < nearest) [best, nearest] = [body, d]
        }
        return best
      }
      /**
       * What `p`, gathered by `victim`, says to them: a stranger asks after a man, a woman or a child; one of their own grieves, a
       * child calls its mother or father, or its grandmother or grandfather (who mind the kids one family in four).
       */
      const helpFor = (p: HeardPerson, victim: HeardPerson): Situation => {
        // Only a victim's own child gathers by them: the sim sends no child to a stranger.
        if (p.age === "kid") {
          if (victim.age === "kid") return "grieve"
          return victim.age === "elder"
            ? victim.female
              ? "nonna"
              : "nonno"
            : victim.female
              ? "mum"
              : "dad"
        }
        if (kin(p, victim)) return "grieve"
        return victim.age === "kid" ? "helpKid" : victim.female ? "helpWoman" : "helpMan"
      }
      /** What `p` cries in `feeling`: shock at a killed animal is pity, at one of their own grief. */
      const cryFor = (p: HeardPerson, feeling: Situation): Situation => {
        if (feeling !== "shock") return feeling
        const body = bodyBy(p)
        return body === undefined
          ? feeling
          : isAnimal(body)
            ? "pity"
            : kin(p, body)
              ? "grieve"
              : feeling
      }
      const byId = new Map<number, HeardPerson>()
      for (const p of heard.people) {
        byId.set(p.id, p)
        const walker = walkers.get(p.id)
        if (walker === undefined) {
          const fresh: Walker = {
            x: p.x,
            y: p.y,
            phase: 0,
            cue: -Infinity,
            seen: frames,
            ...(p.with === undefined ? {} : { party: p.with }),
          }
          walkers.set(p.id, fresh)
          // Already running off when first heard: the driver just pulled out of their car.
          if (p.mood === "flee" && !p.dead && Math.hypot(p.x - ears.x, p.y - ears.y) < THIEF_NEAR)
            cue(p, fresh, "thief")
          continue
        }
        const moved = Math.hypot(p.x - walker.x, p.y - walker.y)
        walker.x = p.x
        walker.y = p.y
        walker.seen = frames
        if (p.with !== undefined) walker.party = p.with
        // "Tutto bene?" said to the victim, "Chiamate un'ambulanza!" called out to everyone; nothing to a victim who got up and left.
        if (p.mood === "gather" && !p.down && !p.dead && fires(frame.random, HELP_RATE, frame.dt)) {
          const victim = bodyBy(p)
          if (victim !== undefined && !isAnimal(victim))
            cue(p, walker, helpFor(p, victim), calledOut)
        }
        if (p.down || p.dead || moved > JUMP) continue
        const speed = Math.hypot(p.vx, p.vy)
        walker.phase += (moved * stepRate(speed)) / Math.max(SHUFFLE, speed)
        if (walker.phase < 1) continue
        walker.phase %= 1
        const run = speed > RUN,
          z = p.player ? ears.z - EAR_HEIGHT : groundAt(p.x, p.y)
        const at = p.player ? { x: ears.x, y: ears.y, z } : { x: p.x, y: p.y, z: z + HEIGHT.person }
        const sound = {
          kind: "step",
          surface: surfaceAt(p.x, p.y),
          run,
          snow: snowCoverAt(heard.weather.snowLine, p.x, p.y, z, facingAt) >= SNOWY,
        } as const
        frame.play(
          sound,
          frame.path(p.player ? undefined : `person:${p.id}`, at, LEVELS.step, {
            quiet: run ? 0 : WALK_DB,
          }),
        )
      }
      for (const h of heard.happenings) {
        if (h.kind !== "cry") continue
        const p = byId.get(h.who),
          walker = walkers.get(h.who)
        if (p === undefined || walker === undefined || p.dead) continue
        const screams = h.feeling === "fright" && (p.age === "kid" || hash01(p.id, 2) < SCREAMERS)
        cue(p, walker, screams ? "scream" : cryFor(p, h.feeling))
      }
      // The nearest lines start this frame; the rest wait while their speaker is still heard and alive.
      const distance = (w: Waiting) => {
        const p = byId.get(w.id)
        return p === undefined ? Infinity : Math.hypot(p.x - ears.x, p.y - ears.y)
      }
      const due = waiting
        .filter((w) => now - w.since <= STALE && byId.get(w.id)?.dead === false)
        .sort((a, b) => distance(a) - distance(b))
      for (const { id, situation, loud } of due.slice(0, LINES_PER_FRAME)) {
        const p = byId.get(id)!,
          speaker = speakerOf(p),
          line = lineFor(situation, frame.random),
          kind = loud(line) ? "yell" : "talk"
        frame.play(
          { kind, speaker, line },
          frame.path(`person:${id}`, mouthOf(p), speechLevel(kind, speaker)),
        )
      }
      waiting = due.slice(LINES_PER_FRAME)
      // Gone (despawned, or the listener in a car): a person seen again starts afresh.
      for (const [id, walker] of walkers) if (walker.seen !== frames) walkers.delete(id)
    },
  }
}
