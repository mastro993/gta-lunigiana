import assert from "node:assert/strict"
import { test } from "node:test"

import { CLUSTERS, FILLERS, gibberish, lineFor, PHRASES, spell } from "../lines.ts"
import { parseToken, tokenize } from "../phonemes.ts"
import { lineSeconds } from "../plan.ts"
import { seeded } from "../testing.ts"
import type { Line, Situation, Speaker } from "../types.ts"

const SITUATIONS: ReadonlyArray<Situation> = [
  "greet",
  "chat",
  "reply",
  "laugh",
  "farewell",
  "fright",
  "shock",
  "pity",
  "anger",
  "surprise",
  "helpMan",
  "helpWoman",
  "helpKid",
  "grieve",
  "mum",
  "dad",
  "nonna",
  "nonno",
  "thief",
]
const ADULT: Speaker = { voice: 0.5, age: "adult", female: false }
const isVowel = (token: string) => parseToken(token)?.phoneme.manner === "vowel"

/** Every token of `line` parses, it reads as something, and its words are not all pauses. */
const assertValid = (line: Line) => {
  assert.ok(line.text.length > 0)
  assert.ok(
    line.words.some((w) => w.length > 0),
    line.text,
  )
  for (const word of line.words)
    for (const token of word)
      assert.ok(parseToken(token) !== undefined, `"${token}" in ${line.text}`)
}

test("every lexicon word is spelt in known phonemes", () => {
  for (const [, ipa] of FILLERS)
    for (const word of ipa.split(" "))
      for (const token of tokenize(word)) assert.ok(parseToken(token), `${token} in ${ipa}`)
  for (const phrases of Object.values(PHRASES))
    for (const { ipa } of phrases)
      for (const word of ipa.split(" "))
        if (word !== "|")
          for (const token of tokenize(word)) assert.ok(parseToken(token), `${token} in ${ipa}`)
  assert.throws(() => tokenize("aθa"))
})

test("every situation's lines are valid, and the same seed draws the same line", () => {
  for (const situation of SITUATIONS) {
    const random = seeded(1)
    for (let k = 0; k < 60; k++) assertValid(lineFor(situation, random))
    assert.deepEqual(lineFor(situation, seeded(9)), lineFor(situation, seeded(9)))
  }
})

test("cries are real Italian, in their tune", () => {
  const random = seeded(2),
    texts = (situation: Situation) =>
      new Set(Array.from({ length: 80 }, () => lineFor(situation, random).text))
  assert.deepEqual(texts("fright"), new Set(["Aiuto!", "Attento!", "No!"]))
  assert.ok(texts("thief").has("Ladro!"))
  assert.ok(texts("shock").has("Chiamate un'ambulanza!"))
  assert.ok(texts("helpMan").has("Tutto bene?"))
  assert.equal(PHRASES.anger.find((p) => p.text === "Ma sei matto?")?.tune, "ask")
})

test("help fits the victim, grief the bereaved; nobody calls an ambulance for an animal", () => {
  const texts = (situation: Situation) =>
    PHRASES[situation as keyof typeof PHRASES].map((p) => p.text)
  assert.ok(texts("helpMan").includes("Signore, mi sente?"))
  assert.ok(
    texts("helpWoman").includes("Signora, mi sente?") &&
      !texts("helpWoman").some((t) => t.includes("Signore")),
  )
  assert.ok(
    texts("helpKid").includes("Mi senti?") && !texts("helpKid").some((t) => /Signor|sente/.test(t)),
  )
  assert.deepEqual(
    [texts("mum"), texts("dad"), texts("nonna"), texts("nonno")],
    [["Mamma!"], ["Papà!"], ["Nonna!"], ["Nonno!"]],
  )
  assert.ok(
    !texts("grieve").some((t) => texts("helpMan").includes(t)),
    "no stranger's line by one's own",
  )
  assert.ok(
    texts("pity").includes("Povera bestia!") && !texts("pity").some((t) => t.includes("ambulanza")),
  )
})

test("chat lines last 1–3 s and mix ≈ 15 % real fillers into gibberish", () => {
  const random = seeded(4),
    real = new Set(FILLERS.flatMap(([, ipa]) => ipa.split(" ")))
  let words = 0,
    fillers = 0
  for (let k = 0; k < 300; k++) {
    const line = lineFor("chat", random),
      seconds = lineSeconds(line, ADULT)
    assert.ok(seconds >= 1 && seconds <= 3, `${line.text}: ${seconds.toFixed(2)} s`)
    for (const word of line.words) {
      if (word.length === 0) continue
      words++
      if (real.has(word.join(""))) fillers++
    }
  }
  // Counted in words (a filler may be two), so the share runs a little over the 15 % of draws.
  const share = fillers / words
  assert.ok(share > 0.1 && share < 0.25, `filler share ${share.toFixed(3)}`)
})

test("replies are shorter than chat, and some open on an answer", () => {
  const random = seeded(5),
    replies = Array.from({ length: 200 }, () => lineFor("reply", random))
  for (const line of replies) assert.ok(lineSeconds(line, ADULT) <= 1.8 + 1e-9, line.text)
  assert.ok(replies.some((line) => /^(Sì|No|Eh|Beh|Mah|Certo|Infatti|Boh|Eh già),/.test(line.text)))
})

test("gibberish follows Italian phonotactics", () => {
  const random = seeded(6),
    onsets = new Set(CLUSTERS)
  for (let k = 0; k < 3000; k++) {
    const word = gibberish(random),
      bare = word.map((t) => t.replace("ˈ", "").replace("ː", ""))
    // Ends in a vowel; at most one stress, on a vowel; /ɛ ɔ/ only stressed.
    assert.ok(isVowel(word.at(-1)!), word.join(""))
    assert.ok(word.filter((t) => t.startsWith("ˈ")).length <= 1, word.join(""))
    for (const t of word)
      if (t === "ɛ" || t === "ɔ") assert.fail(`unstressed open mid vowel in ${word.join("")}`)
    assert.ok(!/wu|ji/.test(bare.join("")), word.join(""))
    word.forEach((t, i) => {
      assert.ok(parseToken(t), t)
      // Geminates only between vowels.
      if (t.endsWith("ː"))
        assert.ok(isVowel(word[i - 1] ?? "") && isVowel(word[i + 1] ?? ""), word.join(""))
    })
    // Consonant runs: a word-initial onset cluster, or a coda (n m r l s) before an onset; never three.
    let run: Array<string> = [],
      at = 0
    const check = () => {
      if (run.length < 2) return
      assert.ok(run.length === 2, word.join(""))
      if (at === 0) assert.ok(onsets.has(run.join("")), `onset ${run.join("")} in ${word.join("")}`)
      else
        assert.ok(
          ["n", "m", "r", "l", "s"].includes(run[0]!),
          `coda ${run.join("")} in ${word.join("")}`,
        )
    }
    bare.forEach((symbol, i) => {
      if (isVowel(symbol)) {
        check()
        run = []
        at = i + 1
      } else run.push(symbol)
    })
    // /m/ as a coda only before a labial.
    bare.forEach((symbol, i) => {
      if (symbol === "m" && !isVowel(bare[i + 1] ?? "a"))
        assert.ok(["p", "b"].includes(bare[i + 1]!), word.join(""))
    })
  }
})

test("gibberish is spelt the Italian way", () => {
  assert.equal(spell(["k", "ˈa", "sː", "a"]), "cassa")
  assert.equal(spell(["tʃ", "ˈa", "o"]), "ciao")
  assert.equal(spell(["g", "ˈɛ", "tː", "o"]), "ghetto")
  assert.equal(spell(["f", "ˈi", "ʎː", "o"]), "figlio")
  assert.equal(spell(["p", "e", "r", "ˈɔ"]), "però")
  assert.equal(spell(["k", "w", "ˈa", "n", "d", "o"]), "quando")
  assert.equal(spell(["p", "ˈɛ", "ʃː", "e"]), "pesce")
  assert.equal(spell(["l", "ˈa", "ɲː", "a"]), "lagna")
  assert.equal(spell(["p", "j", "ˈa", "tsː", "a"]), "piazza")
  assert.equal(spell(["k", "ˈa", "z", "a"]), "casa")
})

test("a laugh is 3–6 breathy calls on one vowel", () => {
  const random = seeded(7)
  for (let k = 0; k < 40; k++) {
    const line = lineFor("laugh", random)
    assert.equal(line.tune, "laugh")
    assert.ok(line.words.length >= 3 && line.words.length <= 6)
    assert.equal(new Set(line.words.map((w) => w.join(""))).size, 1)
    assert.equal(line.words[0]![0], "h")
  }
})
