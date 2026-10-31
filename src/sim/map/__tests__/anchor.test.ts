// Lunigiana with its heightmap starting a tile east and north of its anchor, the old first node, as
// a region whose parts all lie east or north of its anchor gives (the L test region's starts 500 m
// east and 6.1 km north of it): the lookups count a point's cell from the anchor (`anchorOf`), so
// they answer to the bit as on Lunigiana itself, which `lookups.ts` reads in a process of its own.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { TILE, tileRange } from "../kinds.ts"
import { editMap } from "./edit-map.ts"

const LOOKUPS = fileURLToPath(new URL("lookups.ts", import.meta.url))
const run = promisify(execFile)

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/**
 * Where the lookups are compared: 400 points within 400 m of Monzone station, and 40 a hair short
 * of a line of the 4 m lattice, where a point measured from another node rounds into the cell
 * before or after.
 */
const POINTS: Array<readonly [number, number]> = []
for (let a = 0; a < 20; a++)
  for (let b = 0; b < 20; b++)
    POINTS.push([STATION.x - 380 + 39.37 * a, STATION.y - 380 + 37.91 * b])
for (let k = 0; k < 20; k++) {
  const x = 4 * Math.round(STATION.x / 4 + k),
    y = 4 * Math.round(STATION.y / 4 + k)
  POINTS.push([x - 1e-13, STATION.y + 1.3 * k], [STATION.x + 1.3 * k, y - 1e-13])
}

editMap((json) => {
  const { cell, cols, rows, x0, y0 } = json.heightmap,
    { maxX, maxY } = json.bounds,
    minX = x0 + TILE,
    minY = y0 + TILE,
    range = tileRange({ minX, minY, maxX, maxY })
  assert.equal(json.heightmap.ax, undefined, "Lunigiana's anchor is its first node")
  return {
    ...json,
    bounds: { minX, minY, maxX, maxY },
    outline: [[minX, minY, maxX, minY, maxX, maxY, minX, maxY]],
    heightmap: {
      ...json.heightmap,
      x0: minX,
      y0: minY,
      cols: cols - TILE / cell,
      rows: rows - TILE / cell,
      ax: x0,
      ay: y0,
    },
    tiles: json.tiles.filter(({ i, j }) => i >= range.i0 && j >= range.j0),
  }
})
const { heightAt, MAP } = await import("../index.ts")
const { terrainZ } = await import("../ground.ts")
const { coverAt } = await import("../cover.ts")

test("a map whose anchor is not its first node: heightAt, terrainZ and coverAt answer to the bit as on the map grown from it", async () => {
  assert.ok(MAP.heightmap.ax! < MAP.heightmap.x0 && MAP.heightmap.ay! < MAP.heightmap.y0)
  const want = JSON.parse(
    (await run(process.execPath, [LOOKUPS, JSON.stringify(POINTS)], { encoding: "utf8" })).stdout,
  ) as ReadonlyArray<readonly [number, number, string]>
  assert.equal(want.length, POINTS.length)
  for (const [k, [x, y]] of POINTS.entries())
    assert.deepEqual([heightAt(x, y), terrainZ(x, y), coverAt(x, y)], want[k], `at ${x}, ${y}`)
})
