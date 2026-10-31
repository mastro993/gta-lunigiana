import assert from "node:assert/strict"
import { test } from "node:test"

import { type Building, MAP } from "../../sim/map/index.ts"
import { buildingsIn } from "../../sim/map/vectors.ts"
import { buildingPiece } from "../buildings.ts"
import { linear, Triangles, type Sink, WaterTriangles } from "../geometry.ts"
import { PALETTE } from "../palette.ts"

const shutters = [linear(PALETTE.shutterGreen), linear(PALETTE.woodBrown)],
  lit = [linear(PALETTE.windowLit), linear(PALETTE.windowAmber)]
const same = (a: ArrayLike<number>, k: number, rgb: readonly [number, number, number]) =>
  a[k] === rgb[0] && a[k + 1] === rgb[1] && a[k + 2] === rgb[2]

/** The buildings whose first corner lies within `reach` m of the spawn (by Monzone station), read from the tiles there. */
const nearSpawn = (reach: number): Array<Building> => {
  const { x, y } = MAP.spawns.player,
    found: Array<Building> = []
  buildingsIn(x - reach, y - reach, x + reach, y + reach, (_i, b) => {
    if (Math.hypot(b.outer[0]! - x, b.outer[1]! - y) <= reach) found.push(b)
  })
  return found
}

/** One building drawn into a fresh sink: its windows (shutters, 1.2 m tall, two triangles each), its glass panes (two triangles each) and the sink. */
const drawn = (b: Building) => {
  const piece = buildingPiece(b)
  const sink: Sink = {
    solid: new Triangles(),
    decal: new Triangles(),
    water: new WaterTriangles(),
    glow: new Triangles(),
    pieces: [],
  }
  piece.draw(() => sink, 0, 0)
  let triangles = 0
  for (let t = 0; t < sink.solid.position.length; t += 9) {
    const p = sink.solid.position,
      height = Math.max(p[t + 1]!, p[t + 4]!, p[t + 7]!) - Math.min(p[t + 1]!, p[t + 4]!, p[t + 7]!)
    if (shutters.some((rgb) => same(sink.solid.color, t, rgb)) && Math.abs(height - 1.2) < 1e-6)
      triangles++
  }
  return { windows: triangles / 2, panes: sink.glow.position.length / 18, sink }
}

/** Kinds nobody lives in, as the map holds them (CTR sheds, garages, barns and building sites; OSM farm outbuildings). */
const OUTBUILDINGS = new Set(["shed", "garage", "barn", "farm_auxiliary", "construction"])

test("about half a home's windows stand open, a lit glass pane over the shutter; the glow layer holds nothing else", () => {
  let windows = 0,
    panes = 0
  for (const b of nearSpawn(400)) {
    if (OUTBUILDINGS.has(b.kind)) continue
    const one = drawn(b)
    windows += one.windows
    panes += one.panes
    for (let v = 0; v < one.sink.glow.color.length; v += 3)
      assert.ok(
        lit.some((rgb) => same(one.sink.glow.color, v, rgb)),
        "lit window colours only",
      )
  }
  assert.ok(windows > 500, `${windows} windows around the station`)
  assert.ok(
    panes / windows > 0.4 && panes / windows < 0.6,
    `${panes} panes over ${windows} windows`,
  )
})

// Regression: sheds and garages standing alone in the fields lit their windows all night like houses.
test("sheds, garages, barns and farm outbuildings keep their shutters and never light a window", () => {
  const seen = new Map<string, number>()
  let windows = 0
  for (const b of nearSpawn(1500)) {
    if (!OUTBUILDINGS.has(b.kind)) continue
    const one = drawn(b)
    assert.equal(one.panes, 0, `${b.kind} ${b.id}: ${one.panes} lit panes`)
    windows += one.windows
    seen.set(b.kind, (seen.get(b.kind) ?? 0) + 1)
  }
  assert.ok(
    windows > 500 &&
      (seen.get("shed") ?? 0) > 100 &&
      (seen.get("garage") ?? 0) > 100 &&
      (seen.get("barn") ?? 0) > 0,
    `${windows} shuttered windows on ${JSON.stringify([...seen])}`,
  )
})
