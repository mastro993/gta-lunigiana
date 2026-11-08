/**
 * The animals' voices: cows mooing, pigs grunting and cats meowing now and then on their own, and
 * every animal crying out when the sim says it does (its `Cry`): a dog barks in anger and yelps in
 * fright, a cat hisses or meows, a pig squeals, a cow moos. Struck by a vehicle and still alive, it
 * cries in pain (a dog's yelps, a cat's yowl, a pig's squeal, a cow's moo); the thud is the
 * vehicle part's. One call per animal every `CALL_GAP` s; a call renders on the main thread the first time it plays, so at
 * most `CALLS_PER_FRAME` start in a frame, the nearest first, and one left waiting over `STALE` s is dropped.
 *
 * @module audio/director/animals
 */
import type { Feeling } from "../../sim/schema.ts"
import { animalQuiet, type AnimalCall } from "../synth/animals.ts"
import type { HeardAnimal, OneShot } from "../types.ts"
import type { Frame } from "./frame.ts"
import { LEVELS, MOUTH } from "./levels.ts"

/** One call per animal at most this often, s: a Cry right after a call (or a hit's pain) does not stack another. */
const CALL_GAP = 1.5
/** At most this many calls start in a frame, the nearest first (a crash by a pen frightens five pigs at once); a wait over STALE s drops one. */
const CALLS_PER_FRAME = 2,
  STALE = 0.5
/** A dog this size or more (× a 25 kg dog) barks deep; smaller, a small dog's yap. */
const BIG_DOG = 0.95

/** An animal's voice: its calls, and a dog's bark. */
type Call = AnimalCall | Extract<OneShot, { readonly kind: "bark" }>

/** What `a` says in `feeling`. */
const cryOf = (a: HeardAnimal, feeling: Feeling, random: () => number): Call => {
  const { size } = a
  switch (a.species) {
    case "dog":
      return feeling === "fright" ? { kind: "yelp", size } : { kind: "bark", big: size >= BIG_DOG }
    case "cat":
      return feeling === "fright" && random() < 0.5
        ? { kind: "hiss", size }
        : { kind: "meow", size, yowl: false }
    case "pig":
      return feeling === "fright" ? { kind: "squeal", size } : { kind: "grunt", size }
    case "cow":
      return { kind: "moo", size }
  }
}

/** What `a` cries when struck and still alive. */
const painOf = (a: HeardAnimal): AnimalCall => {
  const { size } = a
  switch (a.species) {
    case "dog":
      return { kind: "yelp", size }
    case "cat":
      return { kind: "meow", size, yowl: true }
    case "pig":
      return { kind: "squeal", size }
    case "cow":
      return { kind: "moo", size }
  }
}

/**
 * The call `a` makes on its own, and how often on average while it is calm, s (TUNED): a cow moos, a pig grunts as it roots
 * about, a cat meows; a dog barks only at something (the sim's Cry, and the farm dogs of the world part).
 */
const ownOf = (
  a: HeardAnimal,
): { readonly sound: AnimalCall; readonly every: number } | undefined => {
  const { size } = a
  switch (a.species) {
    case "cow":
      return { sound: { kind: "moo", size }, every: 40 }
    case "pig":
      return { sound: { kind: "grunt", size }, every: 6 }
    case "cat":
      return { sound: { kind: "meow", size, yowl: false }, every: 60 }
    case "dog":
      return undefined
  }
}

/** Whether a Poisson process of `rate` per second fires in `dt`. */
const fires = (random: () => number, rate: number, dt: number): boolean =>
  random() < 1 - Math.exp(-rate * dt)

/** A call an animal is to make, waiting for its frame. */
interface Waiting {
  readonly id: number
  readonly sound: Call
  readonly since: number
}

/** The animals part of the director, with each animal's last call and the calls waiting to start. */
export const makeAnimals = () => {
  const last = new Map<number, { at: number; seen: number }>()
  let waiting: Array<Waiting> = []
  let frames = 0

  return {
    hear: (frame: Frame): void => {
      const { heard, ears, now, dt, random } = frame
      frames++
      const byId = new Map<number, HeardAnimal>()
      /** `a` is to call `sound`, unless it called within `CALL_GAP` s. */
      const call = (a: HeardAnimal, sound: Call) => {
        const memory = last.get(a.id)
        if (memory === undefined || now - memory.at < CALL_GAP) return
        memory.at = now
        waiting.push({ id: a.id, sound, since: now })
      }
      for (const a of heard.animals) {
        byId.set(a.id, a)
        const memory = last.get(a.id)
        if (memory === undefined) last.set(a.id, { at: -Infinity, seen: frames })
        else memory.seen = frames
        const own = ownOf(a)
        if (
          own !== undefined &&
          !a.down &&
          !a.dead &&
          a.mood !== "flee" &&
          fires(random, 1 / own.every, dt)
        )
          call(a, own.sound)
      }
      for (const h of heard.happenings) {
        if (h.kind === "cry") {
          const a = byId.get(h.who)
          if (a !== undefined && !a.dead) call(a, cryOf(a, h.feeling, random))
        } else if (
          h.kind === "impact" &&
          h.hit === "animal" &&
          h.fatal !== true &&
          h.other !== undefined
        ) {
          const a = byId.get(h.other)
          if (a !== undefined) call(a, painOf(a))
        }
      }
      // The nearest calls start this frame; the rest wait while their animal is still heard and alive.
      const distance = (w: Waiting) => {
        const a = byId.get(w.id)!
        return Math.hypot(a.x - ears.x, a.y - ears.y)
      }
      const due = waiting
        .filter((w) => now - w.since <= STALE && byId.get(w.id)?.dead === false)
        .sort((a, b) => distance(a) - distance(b))
      for (const { id, sound } of due.slice(0, CALLS_PER_FRAME)) {
        const a = byId.get(id)!,
          quiet = sound.kind === "bark" ? 0 : animalQuiet(sound)
        frame.play(
          sound,
          frame.path(
            `animal:${a.id}`,
            { x: a.x, y: a.y, z: a.z + MOUTH[a.species] },
            LEVELS[sound.kind],
            { quiet },
          ),
        )
      }
      waiting = due.slice(CALLS_PER_FRAME)
      for (const [id, memory] of last) if (memory.seen !== frames) last.delete(id)
    },
  }
}
