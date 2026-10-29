import assert from "node:assert/strict"
import { test } from "node:test"

import { buildingsIn, heightAt, MAP } from "../../sim/map/index.ts"
import { pathDifference } from "../occlusion.ts"
import { residentMap } from "../testing.ts"

// The whole map in memory, as around the player in the game: every path reads the exact terrain.
residentMap()

/** A point `up` m above the ground at (x, y). */
const at = (x: number, y: number, up = 1.6) => ({ x, y, z: heightAt(x, y) + up })

test("an open, flat meadow hides nothing", () => {
  assert.equal(pathDifference(at(-329, 1078), at(-269, 1078)), 0)
})

test("the 30 m church tower of Monzone Alto shadows the street behind it, but not from above its roof", () => {
  assert.ok(pathDifference(at(-20, -326), at(30, -326)) > 10)
  assert.equal(pathDifference(at(-20, -326, 200), at(30, -326, 200)), 0)
})

test("a bell at the top of the 30 m tower rings out over its own walls", () => {
  // Monzone Alto's church tower, the tallest building of its block (the map's tallest stand elsewhere).
  const block: Array<number> = []
  buildingsIn(-20, -340, 30, -310, (i) => block.push(i))
  const tower = block.map((i) => MAP.buildings[i]!).reduce((a, b) => (b.h > a.h ? b : a))
  assert.ok(tower.kind === "church" && tower.h > 29, `${tower.kind} ${tower.h} m`)
  const xs = tower.outer.filter((_, k) => k % 2 === 0),
    ys = tower.outer.filter((_, k) => k % 2 === 1)
  const bell = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: tower.z0 + tower.h,
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4,
      below = { x: bell.x + 50 * Math.cos(a), y: bell.y + 50 * Math.sin(a), z: bell.z - 5 }
    assert.equal(pathDifference(bell, below), 0, `towards ${45 * k}°`)
    assert.equal(pathDifference(below, bell), 0, `from ${45 * k}°`)
  }
})

test("Monte San Giorgio stands between its two flanks, with no building on the way", () => {
  const west = at(785.7, -563.4),
    east = at(1185.7, -563.4)
  let buildings = 0
  buildingsIn(west.x, west.y, east.x, east.y, () => buildings++)
  assert.equal(buildings, 0)
  assert.ok(pathDifference(west, east) > 10)
  assert.equal(pathDifference(west, west), 0)
})
