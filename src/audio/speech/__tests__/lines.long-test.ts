import assert from "node:assert/strict"
import { test } from "node:test"

import { gibberish, spell } from "../lines.ts"
import { seeded } from "../testing.ts"

test("gibberish never spells an Italian profanity or slur", () => {
  // Was: about 1 word in 5,000 was one ("cazzo", "culo", "porco", "frocio"…).
  const random = seeded(42)
  const banned =
    /cazz|froc|merd|^cul|fica|figa|troi|putt|stronz|porc|dio|mona|negr|minchi|cogli|zoccol|bastard|terron|checc|mignott|cagn|fott|vaff|ncul|suca|tett|^sega/
  for (let k = 0; k < 200000; k++) {
    const word = spell(gibberish(random)).normalize("NFD").replaceAll(/\p{M}/gu, "")
    if (banned.test(word)) assert.fail(`"${word}" after ${k} words`)
  }
})
