import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { crossesAny, wallsAlong } from "../body.ts"
import { lanePoint, roadOf, walkIndex, walkSide } from "../route.ts"
import { ALONE, away, KID, lane, LANE, seeded, spot, VERGE, walker } from "../scene.ts"
import { pedestrian } from "../spawning.ts"
import { BATTISTI, LOOK, rolling, walkClear } from "../testing.ts"
import { killing, moodsOver, SEEDS, STANDING, witnessed } from "./killings.ts"

test("aftermath: the witnesses nearest a killing jump back from the car, then take in the death: shocked, crying out", () => {
  const scene = witnessed([0, 3])
  const moods = moodsOver(scene, 900)
  for (const id of scene.others) {
    assert.ok(moods.get(id)!.includes("shock"), `${id}: ${moods.get(id)!.join(" ")}`)
    assert.ok(
      scene.heard.cries.some((c) => c.who === id && c.feeling === "shock"),
      `${id} cried out in shock`,
    )
  }
})

test("aftermath: a witness who only heard a death through a house never goes to stand by the body", () => {
  // Spots 9–12 m from where the victim falls, walkable, with a wall in between.
  const fall = lanePoint(lane, 9, LANE),
    hidden: Array<{ x: number; y: number; angle: number }> = []
  for (let r = 9; r <= 12 && hidden.length < 3; r += 1)
    for (let k = 0; k < 72 && hidden.length < 3; k++) {
      const p = {
        x: fall.x + r * Ops.cos((k / 72) * 2 * Math.PI),
        y: fall.y + r * Ops.sin((k / 72) * 2 * Math.PI),
        angle: 0,
      }
      if (
        walkClear(p) &&
        crossesAny(wallsAlong("walk", fall.x, fall.y, p.x - fall.x, p.y - fall.y, 0), fall, p)
      )
        hidden.push(p)
    }
  assert.equal(hidden.length, 3, "three spots behind a wall")
  let shocked = 0
  for (const seed of SEEDS) {
    const scene = seeded(
      seed,
      [
        away,
        {
          cars: [rolling("panda", spot(0, LANE), 30, 0.3)],
          peds: [
            walker(8, { side: LANE / VERGE, back: true }),
            ...hidden.map((p) => {
              const edge = walkIndex.nearest(p.x, p.y)
              return pedestrian(
                LOOK,
                p,
                { edge, forward: true, side: walkSide(roadOf(edge)) },
                { ...STANDING, fx: 0, fy: 0 },
              )
            }),
          ],
        },
      ],
      ALONE,
    )
    const ids = new Set(
      scene
        .world()
        .peds.slice(1)
        .map((p) => p.id),
    )
    scene.run(600, () => {
      for (const p of scene.world().peds) {
        if (!ids.has(p.id)) continue
        assert.notEqual(p.mood, "gather", "a body out of sight")
        if (p.mood === "shock") shocked++
      }
    })
  }
  assert.ok(shocked > 0, "they heard it")
})

test("aftermath: after a knockdown nobody goes to stand by the spot: the victim is up and away before anyone gets there", () => {
  // A car at 4.4 m/s knocks a walker down (too slow to kill); a dozen people on the far verge 4–15 m from it, about to walk on.
  const victim = pedestrian(
    LOOK,
    spot(3.6, LANE),
    { ...BATTISTI, side: LANE },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  const watchers = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((up) =>
    walker(3.6 + up, { side: -1, back: true, mood: "look", until: 30 }),
  )
  const scene = seeded(
    1,
    [away, { cars: [rolling("panda", spot(0, LANE), 4.4, 0)], peds: [victim, ...watchers] }],
    ALONE,
  )
  const ids = scene
      .world()
      .peds.slice(1)
      .map((p) => p.id),
    looked = new Set<number>()
  scene.run(25 * 60, () => {
    for (const p of scene.world().peds) {
      if (!ids.includes(p.id)) continue
      assert.notEqual(p.mood, "gather")
      if (p.mood === "look") looked.add(p.id)
    }
  })
  const hit = scene.heard.impacts.find((i) => i.hit === "person")
  assert.equal(hit?.fatal, false, "knocked down")
  assert.ok(looked.size > ids.length / 2, `${looked.size} looked`)
})

test("aftermath: a mother whose child a car kills beside her jumps back, then stays by the body in shock", () => {
  // She walks the lane's edge toward the car, her child on the lane side of her, in the car's path.
  const scene = killing(() => {
    const back = { ...BATTISTI, forward: !BATTISTI.forward, side: -VERGE }
    const walk = { mood: "walk", until: 0, fx: 0, fy: 0 } as const
    const kid = pedestrian(KID, spot(30.4, 2.2, true), back, walk)
    const mother = pedestrian({ ...LOOK, female: true }, spot(30, 3.4, true), back, walk)
    return {
      cars: [rolling("panda", spot(0, LANE), 25, 0.3)],
      parties: [{ leader: mother, people: [{ draft: kid, side: -1.2, back: 0.4 }] }],
    }
  }, true)
  const [mother] = scene.others,
    child = scene.victim
  let farthest = 0
  scene.run(60 * 60, (frame) => {
    if (frame < 10 * 60) return
    const [m, k] = [mother, child].map((id) => scene.world().peds.find((p) => p.id === id)!)
    farthest = Math.max(farthest, Vec2.distance(m!, k!))
  })
  assert.ok(farthest < 3, `she strayed ${farthest.toFixed(1)} m from the body`)
  assert.ok(
    scene.heard.cries.some((c) => c.who === mother && c.feeling === "shock"),
    "in shock",
  )
})
