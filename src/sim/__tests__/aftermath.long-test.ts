import assert from "node:assert/strict"
import { test } from "node:test"

import { moodsOver, witnessed } from "./killings.ts"

test("aftermath: nobody who saw a killing makes small talk in the minutes after", () => {
  // Eight witnesses up the street: two who ran off the same way used to stop and chat 40 s later, 48 m from the body.
  const moods = moodsOver(witnessed([0, 3, 6, 9, 12, 16, 20, 26]), 150 * 60)
  for (const [id, seen] of moods) assert.ok(!seen.includes("chat"), `${id}: ${seen.join(" ")}`)
})
