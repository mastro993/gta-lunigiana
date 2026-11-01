import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import { Game } from "../index.ts"
import { MAP } from "../map/index.ts"
import { PARKING, pristine } from "../population/parked.ts"
import { PEDESTRIANS, peopleOut, TRAFFIC } from "../systems/populate.ts"
import { start, teleport } from "../testing.ts"
import { VIEW_REACH } from "../view.ts"

test("populate: traffic and pedestrians fill in out of view around a moving player within the limits, and far ones go", () => {
  const { runtime, run, view, world } = start()
  const counts = () => {
    const { vehicles, peds } = world()
    const traffic = vehicles.filter((v) => v.traffic).length
    assert.ok(traffic <= TRAFFIC.max, `${traffic} traffic cars`)
    assert.ok(peds.length <= PEDESTRIANS.max, `${peds.length} pedestrians`)
    return { traffic, peds: peds.length }
  }
  // Regression: pedestrians spawned 53 m away, well inside the driving view. The start's own fill (in setup, before the first
  // frame) is everywhere by design: only what spawns in play must be out of view.
  const seen = new Set([...world().vehicles, ...world().peds].map((body) => body.id))
  const outOfView = () => {
    const me = view()!.pose
    const { vehicles, peds } = world()
    for (const body of [...vehicles, ...peds]) {
      if (seen.has(body.id)) continue
      seen.add(body.id)
      assert.ok(
        Vec2.distance(body, me) >= VIEW_REACH,
        `spawned ${Vec2.distance(body, me).toFixed(1)} m from the player`,
      )
    }
  }
  run(600, (frame) => {
    outOfView()
    if (frame % 30 === 29) counts()
  })
  assert.ok(counts().traffic >= 5, "traffic arrived")
  const out = peopleOut(MAP.spawns.player.x, MAP.spawns.player.y)
  assert.ok(out >= 5 && counts().peds >= out, `pedestrians arrived: ${counts().peds} of ${out}`)
  // The player crosses the village at 20 m/s: what fell behind goes, the caps hold all the way.
  const from = MAP.spawns.player
  for (let leg = 1; leg <= 20; leg++) {
    assert.ok(
      runtime.tick(
        Game.Schedule(teleport({ x: from.x + leg * 20, y: from.y - leg * 12, angle: 0 })),
      ).ok,
    )
    run(60, (frame) => {
      outOfView()
      if (frame % 30 === 29) counts()
    })
  }
  const away = { x: from.x + 400, y: from.y - 240, angle: 0 }
  const after = world()
  assert.ok(
    after.vehicles.filter((v) => v.traffic).every((v) => Vec2.distance(v, away) <= TRAFFIC.despawn),
  )
  assert.ok(after.peds.every((p) => Vec2.distance(p, away) <= PEDESTRIANS.despawn))
  assert.ok(
    after.vehicles
      .filter((v) => v.parked !== undefined && pristine(v.parked, v, v.damage))
      .every((v) => Vec2.distance(v, away) <= PARKING.despawn),
    "untouched parked cars go",
  )
  assert.equal(
    after.vehicles.filter(
      (v) => v.model === "carabinieri" && Vec2.distance(v, away) > PARKING.despawn,
    ).length,
    2,
    "the Carabinieri stay",
  )
})
