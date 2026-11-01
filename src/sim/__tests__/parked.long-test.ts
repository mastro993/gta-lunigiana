import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import { MAP } from "../map/index.ts"
import { CARABINIERI, PARKED, PARKING, pristine } from "../population/parked.ts"
import { TRAFFIC } from "../systems/populate.ts"
import { VIEW_REACH } from "../view.ts"
import { go, inFirst, outFrom, spotPose, START, VILLAGES } from "./parking.ts"

test("parking: driving across the map, every village has traffic and parked cars once the player nears it, new ones come out of view, and the vehicles stay within 200 parked and 10 traffic", () => {
  const game = inFirst()
  const seen = new Set(game.world().vehicles.map((v) => v.id))
  const check = () => {
    const me = game.view()!.pose,
      { vehicles } = game.world()
    const traffic = vehicles.filter((v) => v.traffic).length
    assert.ok(traffic <= TRAFFIC.max, `${traffic} traffic cars`)
    assert.ok(vehicles.length - traffic <= PARKED, `${vehicles.length - traffic} parked`)
    for (const v of vehicles) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      assert.ok(
        Vec2.distance(v, me) >= VIEW_REACH,
        `a ${v.model} came ${Vec2.distance(v, me).toFixed(1)} m from the player`,
      )
    }
  }
  let from: Vec2.Vec2 = START
  for (const name of VILLAGES) {
    const village = MAP.districts.find((d) => d.name === name)!
    // From 400 m out, 50 m every half second, on the way from the last village.
    for (let m = 400; m >= 0; m -= 50) go(game, outFrom(village, from, m), 30, check)
    game.run(60, check)
    const { vehicles } = game.world()
    assert.ok(
      vehicles.some((v) => v.parked !== undefined && Vec2.distance(v, village) <= PARKING.fill[1]),
      `parked cars in ${name}`,
    )
    assert.ok(
      vehicles.some((v) => v.traffic && Vec2.distance(v, village) <= TRAFFIC.despawn),
      `traffic in ${name}`,
    )
    assert.ok(
      vehicles
        .filter((v) => v.parked !== undefined && pristine(v.parked, v, v.damage))
        .every((v) => Vec2.distance(v, village) <= PARKING.despawn),
      `in ${name}, every untouched parked car is within ${PARKING.despawn} m`,
    )
    from = village
  }
  const carabinieri = game.world().vehicles.filter((v) => v.model === "carabinieri")
  assert.deepEqual(
    carabinieri.map((v) => [v.x, v.y]),
    CARABINIERI.map((i) => [spotPose(i).x, spotPose(i).y]),
    "the Carabinieri stay at their station",
  )
})
