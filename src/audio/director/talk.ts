/**
 * Conversations, "The Sims" style: Italian-sounding gibberish with now and then a real word. Two
 * pedestrians the sim has stop to chat (mood `chat`, each facing the other) take turns: a greeting
 * each, then lines, answers and laughs with a short pause between turns, and a goodbye each when the
 * chat ends calmly (not when something breaks it off). People out together (a couple, a parent and
 * child) talk now and then as they walk, in bursts of a few lines. Lines come from `lineFor` and
 * last `lineSeconds`, so a turn starts when the last one is over; only the nearest `VOICED`
 * conversations talking (a party in a lull is not) are heard, the others keep their turns silently.
 *
 * @module audio/director/talk
 */
import { lineFor, lineSeconds } from "../speech/index.ts"
import type { Situation } from "../speech/types.ts"
import type { HeardPerson } from "../types.ts"
import type { Frame } from "./frame.ts"
import { HEIGHT, speechLevel } from "./levels.ts"
import { speakerOf } from "./people.ts"

/** Two chatting people are talking to each other when each faces a point (fx, fy) this near the other, m. */
const PAIRED = 1.5
/** The pause between turns, s: a little longer than the 0–0.3 s of real turn-taking (Stivers et al. 2009), as gibberish never overlaps. TUNED. */
const GAP = [0.2, 0.9] as const
/** At most this many conversations are heard at once, the nearest. */
export const VOICED = 3
/** People out together say `BURST` lines at a time, `LULL` s apart; the first burst comes within `LULL` of setting out. TUNED. */
const BURST = [1, 4] as const,
  LULL = [6, 20] as const
/** After the greetings a turn answers a question, else is a line, an answer or a laugh by these shares (TUNED). */
const TURNS = [
  ["chat", 0.6],
  ["reply", 0.25],
  ["laugh", 0.15],
] as const satisfies ReadonlyArray<readonly [Situation, number]>

interface Conversation {
  /** The two people, the first to speak first; whose turn it is (0 or 1). */
  readonly ids: readonly [number, number]
  /** Out together (walking, no greetings), not stopped to chat. */
  readonly party: boolean
  turn: 0 | 1
  /** Speaker time the next line may start: the last one's end and a pause. */
  next: number
  /** Lines said so far; lines left in a party's burst. */
  said: number
  burst: number
  /** The last line was a question. */
  asked: boolean
  seen: number
}

/** A turn after the greetings: the answer to a question, else a line, an answer or a laugh. */
const turnOf = (c: Conversation, random: () => number): Situation => {
  if (c.asked) return "reply"
  let draw = random()
  return TURNS.find(([, share]) => (draw -= share) < 0)?.[0] ?? "chat"
}

/** `lo`…`hi` drawn with `random`. */
const between = (random: () => number, [lo, hi]: readonly [number, number]): number =>
  lo + (hi - lo) * random()

/** Calm and on their feet: someone who can talk. */
const calm = (p: HeardPerson | undefined, mood: HeardPerson["mood"]): p is HeardPerson =>
  p?.mood === mood && !p.down && !p.dead

/** The pairs talking this frame, by key: those stopped to chat with each other, and people out together, each pair once. */
const pairsOf = (
  people: ReadonlyMap<number, HeardPerson>,
): Map<string, { readonly ids: readonly [number, number]; readonly party: boolean }> => {
  const pairs = new Map<
    string,
    { readonly ids: readonly [number, number]; readonly party: boolean }
  >()
  const chatting = [...people.values()].filter((p) => calm(p, "chat"))
  /** The chatting person nearest the point `p` faces, if near enough. */
  const partnerOf = (p: HeardPerson): HeardPerson | undefined => {
    let best: HeardPerson | undefined,
      nearest = PAIRED
    for (const q of chatting) {
      const d = Math.hypot(q.x - p.fx, q.y - p.fy)
      if (q !== p && d < nearest) [best, nearest] = [q, d]
    }
    return best
  }
  for (const p of chatting) {
    const q = partnerOf(p)
    if (q !== undefined && p.id < q.id && partnerOf(q) === p)
      pairs.set(`${p.id}:${q.id}`, { ids: [p.id, q.id], party: false })
  }
  for (const p of people.values()) {
    const q = p.with === undefined ? undefined : people.get(p.with)
    if (calm(p, "walk") && calm(q, "walk") && q.with === p.id && p.id < q.id)
      pairs.set(`${p.id}:${q.id}`, { ids: [p.id, q.id], party: true })
  }
  return pairs
}

/** The conversations part of the director: every pair talking, whose turn it is and when. */
export const makeTalk = () => {
  const conversations = new Map<string, Conversation>()
  let frames = 0

  return {
    hear: (frame: Frame): void => {
      const { heard, ears, now, random, live } = frame
      // Before the sound starts (behind the title card) nobody is heard, so no chat begins: one under way opens when it does.
      if (!live) return
      frames++
      const people = new Map(heard.people.map((p) => [p.id, p]))
      for (const [key, { ids, party }] of pairsOf(people)) {
        const known = conversations.get(key)
        if (known !== undefined) {
          known.seen = frames
          continue
        }
        // Either may greet first; people out together start talking a while after they come into earshot.
        const first = random() < 0.5
        conversations.set(key, {
          ids: first ? ids : [ids[1], ids[0]],
          party,
          turn: 0,
          next: party ? now + between(random, LULL) : now,
          said: 0,
          burst: 0,
          asked: false,
          seen: frames,
        })
      }
      const distance = (c: Conversation) =>
        Math.min(
          ...c.ids.map((id) => {
            const p = people.get(id)
            return p === undefined ? Infinity : Math.hypot(p.x - ears.x, p.y - ears.y)
          }),
        )
      // A party in a lull says nothing, so it holds no voice: only those talking or due to are ranked.
      const talking = [...conversations.values()].filter(
        (c) => !c.party || c.burst > 0 || now >= c.next,
      )
      const voiced = new Set(talking.sort((a, b) => distance(a) - distance(b)).slice(0, VOICED))

      /** Conversation `c`'s next turn, `after` s from now: `situation` in the voice of whoever's turn it is. */
      const speak = (c: Conversation, situation: Situation, after = 0) => {
        const p = people.get(c.ids[c.turn])
        if (p === undefined) return
        const speaker = speakerOf(p),
          line = lineFor(situation, random)
        if (voiced.has(c)) {
          const at = { x: p.x, y: p.y, z: p.z + HEIGHT.person }
          frame.play(
            { kind: "talk", speaker, line },
            frame.path(`person:${p.id}`, at, speechLevel("talk", speaker)),
            after,
          )
        }
        c.next = now + after + lineSeconds(line, speaker) + between(random, GAP)
        c.turn = c.turn === 0 ? 1 : 0
        c.said++
        c.asked = line.tune === "ask"
      }

      for (const [key, c] of conversations) {
        if (c.seen !== frames) {
          conversations.delete(key)
          // A chat that ends calmly, both walking on, ends in goodbyes: the second once the first is said.
          if (!c.party && c.ids.every((id) => calm(people.get(id), "walk"))) {
            speak(c, "farewell", Math.max(0, c.next - now))
            speak(c, "farewell", c.next - now)
          }
          continue
        }
        if (now < c.next) continue
        if (c.party) {
          // A lull just ended: a burst of lines opens with one, and after its last comes the next lull.
          if (c.burst === 0) {
            c.burst = Math.round(between(random, BURST))
            speak(c, "chat")
          } else speak(c, turnOf(c, random))
          if (--c.burst === 0) c.next += between(random, LULL)
        } else speak(c, c.said < 2 ? "greet" : turnOf(c, random))
      }
    },
  }
}
