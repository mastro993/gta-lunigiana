import assert from "node:assert/strict"
import { test } from "node:test"

import { hash01 } from "../../../tools/geometry.ts"
import { lineFor, lineSeconds } from "../../speech/index.ts"
import type { Situation } from "../../speech/types.ts"
import type { HeardPerson, OneShot } from "../../types.ts"
import { cueVoice } from "../people.ts"
import { VOICED } from "../talk.ts"
import {
  animal,
  away,
  FRAME,
  MEADOW,
  type Played,
  person,
  rig,
  seeded,
  SOUTH,
  world,
} from "../testing.ts"

/** Every text `lineFor` gives for `situation`, over many draws. */
const textsOf = (situation: Situation): ReadonlySet<string> => {
  const random = seeded(1)
  return new Set(Array.from({ length: 1000 }, () => lineFor(situation, random).text))
}

type Said = Played & { readonly sound: Extract<OneShot, { readonly kind: "talk" | "yell" }> }
/** The lines played (said and yelled), in the order they start. */
const lines = (plays: ReadonlyArray<Played>): Array<Said> =>
  plays
    .filter((p): p is Said => p.sound.kind === "talk" || p.sound.kind === "yell")
    .sort((a, b) => a.t + a.delay - (b.t + b.delay))

/** Two people `a` and `b` metres from the listener, side by side and facing each other, in `mood`. */
const pair = (
  a: number,
  b: number,
  metres: number,
  mood: HeardPerson["mood"],
): readonly [HeardPerson, HeardPerson] => {
  const pa = away(MEADOW, metres, SOUTH),
    pb = { x: pa.x + 1.2, y: pa.y }
  return [
    person(a, pa, { mood, fx: pb.x, fy: pb.y }),
    person(b, pb, { mood, fx: pa.x, fy: pa.y, female: true }),
  ]
}

test("two people stopped to chat take turns: a greeting each, then alternating lines with a pause between, and a goodbye each as they walk on", () => {
  const director = rig()
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "chat") }), 30 * 60)
  const chat = lines(director.plays)
  assert.ok(chat.length >= 6, `${chat.length} lines in 30 s`)
  assert.ok(
    chat.every((l) => l.sound.kind === "talk"),
    "said, not yelled",
  )
  const greetings = textsOf("greet")
  assert.ok(
    chat.slice(0, 2).every((l) => greetings.has(l.sound.line.text)),
    chat
      .slice(0, 2)
      .map((l) => l.sound.line.text)
      .join(" / "),
  )
  const voices = chat.map((l) => l.sound.speaker.voice)
  assert.ok(voices.every((v) => v === hash01(1) || v === hash01(2)))
  for (let i = 1; i < chat.length; i++) {
    const [last, next] = [chat[i - 1]!, chat[i]!]
    assert.notEqual(next.sound.speaker.voice, last.sound.speaker.voice, "turns alternate")
    const gap =
      next.t + next.delay - (last.t + last.delay + lineSeconds(last.sound.line, last.sound.speaker))
    assert.ok(gap >= 0.2 - FRAME && gap <= 0.9 + 2 * FRAME, `a ${gap.toFixed(2)} s pause`)
  }
  assert.ok(
    chat.some((l) => l.sound.speaker.female) && chat.some((l) => !l.sound.speaker.female),
    "each in their own voice",
  )
  director.plays.length = 0
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "walk") }), 10 * 60)
  const farewells = textsOf("farewell"),
    parting = lines(director.plays)
  assert.equal(parting.length, 2)
  assert.ok(
    parting.every((l) => farewells.has(l.sound.line.text)),
    parting.map((l) => l.sound.line.text).join(" / "),
  )
  assert.notEqual(parting[0]!.sound.speaker.voice, parting[1]!.sound.speaker.voice)
})

// Regression: behind the title card, before the sound starts, a chat greeted silently on one side and opened with one greeting.
test("a chat under way before the sound starts opens with both greetings once it does", () => {
  const director = rig(0)
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "chat") }), 600, 0)
  assert.equal(lines(director.plays).length, 0, "nothing said before the sound starts")
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "chat") }), 10 * 60)
  const chat = lines(director.plays),
    greetings = textsOf("greet")
  assert.ok(
    chat.slice(0, 2).every((l) => greetings.has(l.sound.line.text)),
    chat
      .slice(0, 2)
      .map((l) => l.sound.line.text)
      .join(" / "),
  )
  assert.notEqual(chat[0]!.sound.speaker.voice, chat[1]!.sound.speaker.voice, "one greeting each")
})

test("a chat something breaks off ends without goodbyes", () => {
  const director = rig()
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "chat") }), 5 * 60)
  director.plays.length = 0
  director.hear(world(MEADOW, { people: pair(1, 2, 5, "look") }), 5 * 60)
  assert.equal(lines(director.plays).length, 0)
})

test(`of five chats around, only the nearest ${VOICED} are heard`, () => {
  const director = rig()
  const people = [4, 6, 8, 10, 12].flatMap((metres, i) =>
    pair(10 * i + 1, 10 * i + 2, metres, "chat"),
  )
  director.hear(world(MEADOW, { people }), 30 * 60)
  const speakers = new Set(
    lines(director.plays).map(
      (l) => people.find((p) => hash01(p.id) === l.sound.speaker.voice)!.id,
    ),
  )
  assert.deepEqual(
    [...speakers].sort((a, b) => a - b),
    [1, 2, 11, 12, 21, 22],
  )
})

test("couples quiet between their bursts take no voice from a chat nearby", () => {
  // Was: three walking couples in a lull, nearer than the chat, held all three voices, and the chat said nothing.
  const couple = (a: number, b: number, metres: number) => {
    const [p, q] = pair(a, b, metres, "walk")
    return [
      { ...p, with: b },
      { ...q, with: a },
    ]
  }
  const people = [
    ...couple(1, 2, 4),
    ...couple(11, 12, 6),
    ...couple(21, 22, 8),
    ...pair(31, 32, 10, "chat"),
  ]
  const director = rig()
  director.hear(world(MEADOW, { people }), 30 * 60)
  const chat = lines(director.plays).filter(
    (l) => l.sound.speaker.voice === hash01(31) || l.sound.speaker.voice === hash01(32),
  )
  assert.ok(chat.length >= 8, `the chat said ${chat.length} lines in 30 s`)
})

test("people out together talk now and then as they walk, both of them, with long lulls", () => {
  const director = rig()
  const [a, b] = pair(1, 2, 5, "walk")
  director.hear(
    world(MEADOW, {
      people: [
        { ...a, with: 2 },
        { ...b, with: 1 },
      ],
    }),
    120 * 60,
  )
  const said = lines(director.plays)
  assert.ok(said.length >= 3 && said.length <= 40, `${said.length} lines in 2 min`)
  assert.equal(new Set(said.map((l) => l.sound.speaker.voice)).size, 2)
  // Strangers walking side by side say nothing.
  const strangers = rig()
  strangers.hear(world(MEADOW, { people: pair(1, 2, 5, "walk") }), 60 * 60)
  assert.equal(lines(strangers.plays).length, 0)
})

test("a fright Cry: a child screams, a grown-up screams or yells for help, in their own voice; one cue per person every few seconds", () => {
  const director = rig()
  const kid = person(3, away(MEADOW, 6, SOUTH), { age: "kid", mood: "flee" })
  const adults = Array.from({ length: 12 }, (_, i) =>
    person(100 + i, away(MEADOW, 6 + i * 0.5, SOUTH), { female: i % 2 === 0, mood: "flee" }),
  )
  const everyone = [kid, ...adults]
  // Walking when first heard (one already running is a robbed driver).
  director.hear(world(MEADOW, { people: everyone.map((p) => ({ ...p, mood: "walk" as const })) }))
  const cries = everyone.map(
    (p) => ({ kind: "cry", who: p.id, x: p.x, y: p.y, feeling: "fright" }) as const,
  )
  director.hear(world(MEADOW, { people: everyone, happenings: cries }))
  // The lines start a few a frame.
  director.hear(world(MEADOW, { people: everyone }), 6)
  const screams = director.take("scream"),
    yells = director.take("yell")
  assert.deepEqual(
    screams.find((s) => s.sound.kind === "scream" && s.sound.voice === cueVoice(kid))?.sound,
    { kind: "scream", voice: cueVoice(kid) },
  )
  assert.ok(cueVoice(kid) >= 0.8)
  assert.equal(screams.length + yells.length, everyone.length, "one cue each")
  assert.ok(
    screams.length >= 2 && yells.length >= 4,
    `${screams.length} screams, ${yells.length} yells`,
  )
  const frights = textsOf("fright")
  for (const { sound } of yells) {
    assert.ok(
      sound.kind === "yell" && frights.has(sound.line.text),
      sound.kind === "yell" ? sound.line.text : sound.kind,
    )
    const who = adults.find((p) => hash01(p.id) === sound.speaker.voice)!
    assert.deepEqual(sound.speaker, { voice: hash01(who.id), age: "adult", female: who.female })
  }
  director.hear(world(MEADOW, { people: everyone, happenings: cries }), 60)
  assert.equal(
    director.take("scream").length + director.take("yell").length,
    0,
    "not again within the gap",
  )
})

test("shock, anger and surprise Cries yell a line for the feeling; the dead cry no more", () => {
  for (const feeling of ["shock", "anger", "surprise"] as const) {
    const director = rig(),
      p = person(5, away(MEADOW, 8, SOUTH), { age: "elder", female: true })
    director.hear(world(MEADOW, { people: [p] }))
    director.hear(
      world(MEADOW, {
        people: [p],
        happenings: [{ kind: "cry", who: 5, x: p.x, y: p.y, feeling }],
      }),
    )
    const [yell] = director.take("yell")
    assert.ok(yell?.sound.kind === "yell" && textsOf(feeling).has(yell.sound.line.text), feeling)
    assert.deepEqual(yell.sound.kind === "yell" && yell.sound.speaker, {
      voice: hash01(5),
      age: "elder",
      female: true,
    })
  }
  const director = rig(),
    dead = person(5, away(MEADOW, 8, SOUTH), { dead: true })
  director.hear(world(MEADOW, { people: [dead] }))
  director.hear(
    world(MEADOW, {
      people: [dead],
      happenings: [{ kind: "cry", who: 5, x: dead.x, y: dead.y, feeling: "shock" }],
    }),
  )
  assert.equal(lines(director.plays).length, 0)
})

test("a pedestrian first heard already running off near the listener yells after the thief; one far off does not", () => {
  const near = rig()
  near.hear(world(MEADOW, { people: [person(6, away(MEADOW, 4, SOUTH), { mood: "flee" })] }), 30)
  const [yell] = near.take("yell")
  assert.ok(yell?.sound.kind === "yell" && textsOf("thief").has(yell.sound.line.text))
  const far = rig()
  far.hear(world(MEADOW, { people: [person(6, away(MEADOW, 40, SOUTH), { mood: "flee" })] }), 30)
  assert.equal(far.take("yell").length, 0)
})

test("people gathered by a victim ask after them now and then", () => {
  const director = rig(),
    victim = person(1, away(MEADOW, 6, SOUTH), { down: true })
  const helper = person(2, away(MEADOW, 8, SOUTH), { mood: "gather", fx: victim.x, fy: victim.y })
  director.hear(world(MEADOW, { people: [victim, helper] }), 30 * 60)
  const said = lines(director.plays),
    help = textsOf("helpMan")
  assert.ok(said.length >= 2 && said.length <= 8, `${said.length} in 30 s`)
  assert.ok(said.every((l) => help.has(l.sound.line.text) && l.sound.speaker.voice === hash01(2)))
})

test("a crowd's cries start a few a frame, the nearest first, and every one is said", () => {
  // Was: every witness's line rendered in the frame of the death, ≈ 3.5 ms each on the main thread.
  const director = rig(),
    body = person(1, away(MEADOW, 4, SOUTH), { dead: true })
  const crowd = Array.from({ length: 12 }, (_, i) =>
    person(10 + i, away(MEADOW, 17 - i, SOUTH), { mood: "shock", fx: body.x, fy: body.y }),
  )
  director.hear(
    world(MEADOW, { people: [body, ...crowd.map((p) => ({ ...p, mood: "walk" as const }))] }),
  )
  director.hear(
    world(MEADOW, {
      people: [body, ...crowd],
      happenings: crowd.map(
        (p) => ({ kind: "cry", who: p.id, x: p.x, y: p.y, feeling: "shock" }) as const,
      ),
    }),
  )
  const first = director.take("yell").map((y) => y.sound.kind === "yell" && y.sound.speaker.voice)
  assert.deepEqual(
    first,
    [21, 20, 19].map((id) => hash01(id)),
    "the three nearest",
  )
  director.hear(world(MEADOW, { people: [body, ...crowd] }), 3)
  assert.equal(director.take("yell").length, 9)
})

test("help fits the victim: a stranger asks after a man, a woman or a child as they are; nobody talks to an empty spot", () => {
  const ask = (victim: Partial<HeardPerson> | undefined) => {
    // Near the listener: a line said (not yelled) is masked by the meadow's wind from ≈ 8 m.
    const director = rig(),
      at = away(MEADOW, 3, SOUTH),
      helper = person(2, away(MEADOW, 2, SOUTH), { mood: "gather", fx: at.x, fy: at.y })
    director.hear(
      world(MEADOW, {
        people:
          victim === undefined ? [helper] : [person(1, at, { dead: true, ...victim }), helper],
      }),
      60 * 60,
    )
    return new Set(lines(director.plays).map((l) => l.sound.line.text))
  }
  for (const [victim, situation] of [
    [{}, "helpMan"],
    [{ female: true }, "helpWoman"],
    [{ age: "kid" }, "helpKid"],
    [{ age: "elder", female: true }, "helpWoman"],
  ] as const) {
    const said = ask(victim)
    assert.ok(
      said.size >= 2 && [...said].every((t) => textsOf(situation).has(t)),
      `${situation}: ${[...said].join(" / ")}`,
    )
  }
  assert.equal(ask(undefined).size, 0)
})

test("by one of their own, people grieve: a child calls its mother or father, a partner never asks a stranger's questions", () => {
  const vigil = (mourner: Partial<HeardPerson>, victim: Partial<HeardPerson>) => {
    const director = rig(),
      at = away(MEADOW, 3, SOUTH),
      by = away(MEADOW, 2, SOUTH)
    // Heard walking together first, then the victim lies dead and the other stays by them.
    director.hear(
      world(MEADOW, {
        people: [person(1, at, { ...victim, with: 2 }), person(2, by, { ...mourner, with: 1 })],
      }),
    )
    director.hear(
      world(MEADOW, {
        people: [
          person(1, at, { ...victim, dead: true }),
          person(2, by, { ...mourner, mood: "gather", fx: at.x, fy: at.y }),
        ],
      }),
      60 * 60,
    )
    return new Set(lines(director.plays).map((l) => l.sound.line.text))
  }
  assert.deepEqual(vigil({ age: "kid" }, { female: true }), new Set(["Mamma!"]))
  assert.deepEqual(vigil({ age: "kid" }, { female: false }), new Set(["Papà!"]))
  // A grandparent minds the kids one family in four: a child by its dead grandmother calls her, not its mother.
  assert.deepEqual(vigil({ age: "kid" }, { age: "elder", female: true }), new Set(["Nonna!"]))
  assert.deepEqual(vigil({ age: "kid" }, { age: "elder", female: false }), new Set(["Nonno!"]))
  const partner = vigil({ female: true }, {})
  assert.ok(
    partner.size >= 2 && [...partner].every((t) => textsOf("grieve").has(t)),
    [...partner].join(" / "),
  )
})

test("shock at a killed animal is pity: nobody calls an ambulance for a cat", () => {
  const director = rig(),
    cat = animal(9, "cat", away(MEADOW, 4, SOUTH), { dead: true }),
    p = person(5, away(MEADOW, 2, SOUTH), { female: true })
  const shocked = { ...p, mood: "shock" as const, fx: cat.x, fy: cat.y }
  director.hear(world(MEADOW, { people: [p], animals: [cat] }))
  // A shock now and then, past the gap between one person's cues.
  for (let k = 0; k < 30; k++) {
    director.hear(
      world(MEADOW, {
        people: [shocked],
        animals: [cat],
        happenings: [{ kind: "cry", who: p.id, x: p.x, y: p.y, feeling: "shock" }],
      }),
    )
    director.hear(world(MEADOW, { people: [shocked], animals: [cat] }), 5 * 60)
  }
  const said = lines(director.plays).map((l) => l.sound.line.text)
  assert.equal(said.length, 30)
  assert.ok(
    said.every((t) => textsOf("pity").has(t)) && said.includes("Povera bestia!"),
    [...new Set(said)].join(" / "),
  )
})

test("a fatal hit on a person thuds with no groan; a person who lives groans after the thud", () => {
  for (const fatal of [true, false]) {
    const director = rig(),
      p = person(7, away(MEADOW, 6, SOUTH), { down: !fatal, dead: fatal })
    director.hear(
      world(MEADOW, {
        people: [p],
        happenings: [
          {
            kind: "impact",
            hit: "person",
            x: p.x,
            y: p.y,
            speed: 12,
            mass: 1,
            car: 1,
            other: 7,
            fatal,
            body: { model: "panda", zone: "front" },
          },
        ],
      }),
    )
    assert.equal(director.take("thud").length, 1)
    assert.equal(director.take("groan").length, fatal ? 0 : 1, fatal ? "killed" : "hurt")
  }
})

test("animals call on their own: cows moo now and then, pigs grunt often, cats meow seldom; a fleeing one does not", () => {
  const director = rig()
  const herd = [
    animal(1, "cow", away(MEADOW, 15, SOUTH)),
    animal(2, "pig", away(MEADOW, 10, SOUTH)),
    animal(3, "cat", away(MEADOW, 5, SOUTH)),
  ]
  director.hear(world(MEADOW, { animals: herd }), 240 * 60)
  const [moos, grunts, meows] = [
    director.take("moo").length,
    director.take("grunt").length,
    director.take("meow").length,
  ]
  assert.ok(moos >= 2 && moos <= 14, `${moos} moos in 4 min`)
  assert.ok(grunts >= 20 && grunts <= 70, `${grunts} grunts in 4 min`)
  assert.ok(meows >= 1 && meows <= 10, `${meows} meows in 4 min`)
  director.hear(
    world(MEADOW, { animals: herd.map((a) => ({ ...a, mood: "flee" as const })) }),
    60 * 60,
  )
  // The birds in the wood beside the meadow sing on.
  assert.deepEqual(
    (["moo", "grunt", "meow"] as const).map((voice) => director.take(voice).length),
    [0, 0, 0],
  )
})

test("an animal's Cry is its species' voice: a dog barks in anger and yelps in fright, a pig squeals, a cow moos, a cat hisses or meows", () => {
  const expect = [
    ["dog", "anger", ["bark"]],
    ["dog", "fright", ["yelp"]],
    ["pig", "fright", ["squeal"]],
    ["cow", "surprise", ["moo"]],
    ["cat", "fright", ["hiss", "meow"]],
  ] as const
  for (const [species, feeling, kinds] of expect) {
    const director = rig(),
      a = animal(9, species, away(MEADOW, 6, SOUTH), { mood: "flee" })
    director.hear(world(MEADOW, { animals: [a] }))
    director.hear(
      world(MEADOW, {
        animals: [a],
        happenings: [{ kind: "cry", who: 9, x: a.x, y: a.y, feeling }],
      }),
    )
    assert.deepEqual(
      director.plays.map((p) => (kinds as ReadonlyArray<string>).includes(p.sound.kind)),
      [true],
      `${species} ${feeling}`,
    )
  }
})

// Regression: every animal Cry in a frame rendered its call on the main thread at once (a crash by a pen: five squeals in one frame).
test("a frame starts at most two animal calls, the nearest first; the rest start in the frames after", () => {
  const director = rig(),
    pigs = [1, 2, 3, 4, 5].map((id) =>
      animal(id, "pig", away(MEADOW, 4 + id, SOUTH), { mood: "flee" }),
    )
  director.hear(world(MEADOW, { animals: pigs }))
  director.take("grunt")
  director.hear(
    world(MEADOW, {
      animals: pigs,
      happenings: pigs.map((p) => ({
        kind: "cry" as const,
        who: p.id,
        x: p.x,
        y: p.y,
        feeling: "fright" as const,
      })),
    }),
  )
  const first = director.take("squeal")
  assert.equal(first.length, 2, "two start in the frame of the cries")
  director.hear(world(MEADOW, { animals: pigs }), 3)
  const rest = director.take("squeal")
  assert.equal(rest.length, 3, "the rest in the next frames")
  // The nearest are the loudest.
  assert.ok(
    Math.min(...first.map((p) => p.at.gain)) >= Math.max(...rest.map((p) => p.at.gain)),
    "the nearest first",
  )
})

test("an animal struck and alive cries in pain after the thud (a cat yowls); one killed is silent", () => {
  for (const fatal of [false, true]) {
    const director = rig(),
      cat = animal(9, "cat", away(MEADOW, 6, SOUTH), { down: !fatal, dead: fatal })
    director.hear(world(MEADOW, { animals: [cat] }))
    director.hear(
      world(MEADOW, {
        animals: [cat],
        happenings: [
          {
            kind: "impact",
            hit: "animal",
            x: cat.x,
            y: cat.y,
            speed: 9,
            mass: 1,
            car: 1,
            other: 9,
            fatal,
            body: { model: "panda", zone: "front" },
          },
        ],
      }),
    )
    assert.equal(director.take("thud").length, 1)
    assert.deepEqual(
      director.take("meow").map((p) => p.sound),
      fatal ? [] : [{ kind: "meow", size: 1, yowl: true }],
    )
  }
})
