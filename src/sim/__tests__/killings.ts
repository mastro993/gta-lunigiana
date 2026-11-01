/**
 * A killing witnessed in the street and the moods that follow, as the aftermath tests stage them, shared by `aftermath.test.ts` and `aftermath.long-test.ts`.
 *
 * @module sim/__tests__/killings
 */
import assert from "node:assert/strict"

import type { Mood } from "../index.ts"
import { ALONE, away, LANE, seeded, spot, VERGE, walker } from "../scene.ts"
import { rolling } from "../testing.ts"

/** Seeds tried for a scene that needs the dice to kill (a car at 25 m/s kills 87 % of the time). */
export const SEEDS = [1, 2, 3, 4, 5, 6]

/** A witness's mood: looking on where they stand, for good. */
export const STANDING = { mood: "look", until: 100_000 } as const

/**
 * The first seed's run of `cast` in which a car kills the pedestrian staged first (or the child, when `child`) and hits nobody
 * else, run to the impact.
 */
export const killing = (cast: () => Parameters<typeof seeded>[1][1], child = false) => {
  for (const seed of SEEDS) {
    const scene = seeded(seed, [away, cast()], ALONE)
    const peds = scene.world().peds,
      victim = (child ? peds.find((p) => p.look.age === "kid")! : peds[0]!).id
    const others = peds.map((p) => p.id).filter((id) => id !== victim)
    for (
      let frame = 0;
      frame < 300 && !scene.heard.impacts.some((i) => i.hit === "person");
      frame++
    )
      scene.run(1)
    const hits = scene.heard.impacts.filter((i) => i.hit === "person")
    if (hits.length === 1 && hits[0]!.other === victim && hits[0]!.fatal === true)
      return { ...scene, victim, others }
  }
  assert.fail("no seed killed the victim alone")
}

/** Each pedestrian's moods in order, while `frames` run. */
export const moodsOver = (scene: ReturnType<typeof killing>, frames: number) => {
  const moods = new Map<number, Array<Mood>>(scene.others.map((id) => [id, []]))
  scene.run(frames, () => {
    for (const p of scene.world().peds)
      if (moods.has(p.id) && moods.get(p.id)!.at(-1) !== p.mood) moods.get(p.id)!.push(p.mood)
  })
  return moods
}

/** A car at 25 m/s kills a walker in its lane 10 m ahead; witnesses stand on the far verge `ups` m up the street from them. */
export const witnessed = (ups: ReadonlyArray<number>) =>
  killing(() => ({
    cars: [rolling("panda", spot(0, LANE), 25, 0.3)],
    peds: [
      walker(10, { side: LANE / VERGE, back: true }),
      ...ups.map((up) => walker(10 + up, { side: -1, back: true, ...STANDING })),
    ],
  }))
