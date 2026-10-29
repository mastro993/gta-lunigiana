import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { pointInRing, segDist2 } from "../../sim/collide.ts"
import { platformTop } from "../../sim/map/ground.ts"
import { MAP, RAIL_LIFT } from "../../sim/map/index.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { linear, Triangles, type Sink, WaterTriangles } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { lampPieces, streetLamps } from "../sky/lamps.ts"
import { platformLamps, stationPieces } from "../stations.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})
const all = sink()
for (const piece of stationPieces()) piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
const poles = streetLamps().flatMap((lamp, i) => (lamp.kind === "pole" ? [i] : []))
const lamps = lampPieces()
for (const i of poles) lamps[i]!.draw(() => all, 0, 0)

/** The corners of every triangle of `tris` in colour `hex`, three space, three per triangle. */
const cornersOf = (tris: Triangles, hex: number): Array<readonly [number, number, number]> => {
  const [r, g, b] = linear(hex),
    found: Array<readonly [number, number, number]> = []
  for (let t = 0; t < tris.position.length; t += 9)
    if (tris.color[t] === r && tris.color[t + 1] === g && tris.color[t + 2] === b)
      for (const o of [0, 3, 6])
        found.push([tris.position[t + o]!, tris.position[t + o + 1]!, tris.position[t + o + 2]!])
  return found
}
/** The nearest point of any track centreline (a `MAP.rail` piece out of a tunnel) to (x, y), its distance and its rail head's render y. */
const nearestTrack = (
  x: number,
  y: number,
  kinds: (kind: string | undefined) => boolean = () => true,
) => {
  let best = { d: Number.MAX_VALUE, head: 0 }
  for (const rail of MAP.rail) {
    if (rail.tunnel === true || !kinds(rail.kind)) continue
    for (let k = 0; 2 * k + 3 < rail.pts.length; k++) {
      const { d2, t } = segDist2(
        x,
        y,
        rail.pts[2 * k]!,
        rail.pts[2 * k + 1]!,
        rail.pts[2 * k + 2]!,
        rail.pts[2 * k + 3]!,
      )
      if (d2 < best.d ** 2)
        best = {
          d: Math.sqrt(d2),
          head: yOf(rail.z[k]! + (rail.z[k + 1]! - rail.z[k]!) * t + RAIL_LIFT),
        }
    }
  }
  return best
}
const waited = MAP.railway.platforms.filter((p) => p.walkway !== true && p.name !== undefined)

test("platforms: the top follows the rail profile, within 2 cm of the map's platform top (the rail head + 0.25 m) all along", () => {
  const tops = cornersOf(all.solid, PALETTE.asphaltWorn)
  assert.ok(tops.length > 1000, `${tops.length / 3} triangles of platform top`)
  let rise = 0
  for (let i = 0; i < tops.length; i += 3) {
    const x = (tops[i]![0] + tops[i + 1]![0] + tops[i + 2]![0]) / 3,
      z = (tops[i]![2] + tops[i + 1]![2] + tops[i + 2]![2]) / 3,
      h = (tops[i]![1] + tops[i + 1]![1] + tops[i + 2]![1]) / 3
    const top = platformTop(x, -z)
    if (top === undefined) continue
    assert.ok(
      Math.abs(h - yOf(top)) < 0.02,
      `${(h - yOf(top)).toFixed(3)} m off the top at ${x.toFixed(1)}, ${(-z).toFixed(1)}`,
    )
    rise = Math.max(rise, h)
  }
  // Monzone's platforms rise with the line: a flat slab would be wrong by up to about half a metre at one end.
  const monzone = tops
    .filter(([x, , z]) =>
      MAP.railway.platforms.some(
        (p) =>
          p.name?.startsWith("Monzone") === true &&
          pointInRing(x, -z, MAP.areas[p.area]!.rings[0]!),
      ),
    )
    .map(([, y]) => y)
  assert.ok(
    Math.max(...monzone) - Math.min(...monzone) > 0.4,
    "the top rises along Monzone's platforms",
  )
})

test("platforms: a yellow line along the edges beside running track or a loop, on every platform people wait on, and on no walkway", () => {
  const yellow = cornersOf(all.decal, PALETTE.signYellow)
  for (const [x, , z] of yellow) {
    const { d } = nearestTrack(x, -z, (kind) => kind !== "siding")
    assert.ok(d < 2.2 + 0.7, `a yellow line ${d.toFixed(2)} m from the track`)
  }
  for (const p of MAP.railway.platforms) {
    const ring = MAP.areas[p.area]!.rings[0]!
    const on = yellow.filter(([x, , z]) => pointInRing(x, -z, ring)).length
    if (p.walkway === true) assert.equal(on, 0, "no line on a walkway")
    else assert.ok(on >= 30, `${p.name}: ${on / 3} yellow triangles`)
  }
})

test("stations: nothing they draw stands in a train's way: clear of its half width by 0.15 m from 0.3 m over the rail head to over its roof", () => {
  const half = TRAINS.atr220.width / 2 + 0.15,
    roof = TRAINS.atr220.height + 0.3
  for (let t = 0; t < all.solid.position.length; t += 3) {
    const x = all.solid.position[t]!,
      y = all.solid.position[t + 1]!,
      z = all.solid.position[t + 2]!
    const { d, head } = nearestTrack(x, -z)
    if (y > head + 0.3 && y < head + roof)
      assert.ok(
        d >= half - 1e-6,
        `${d.toFixed(2)} m from a track at ${(y - head).toFixed(2)} m over its rail head (${x.toFixed(1)}, ${(-z).toFixed(1)})`,
      )
  }
})

test("name boards: one RFI-blue board per platform people wait on, standing on it, its words in white", () => {
  const blue = cornersOf(all.solid, PALETTE.rfiBlue)
  // A board is one blue box: 12 triangles.
  assert.equal(blue.length / 36, waited.length)
  for (let b = 0; b < blue.length; b += 36) {
    const box = blue.slice(b, b + 36),
      x = box.reduce((n, [px]) => n + px, 0) / 36,
      y = -box.reduce((n, [, , pz]) => n + pz, 0) / 36
    assert.ok(
      waited.some((p) => pointInRing(x, y, MAP.areas[p.area]!.rings[0]!)),
      `the board at ${x.toFixed(1)}, ${y.toFixed(1)} on a platform`,
    )
    const ground = platformTop(x, y)!
    const low = Math.min(...box.map(([, h]) => h))
    assert.ok(low - yOf(ground) > 2 && low - yOf(ground) < 2.3, "its bottom over head height")
  }
})

test("platform lamps: poles on the platforms people wait on, every platform lit, Equi Terme's too (no street lamp within 60 m of it)", () => {
  const spots = platformLamps()
  for (const p of waited) {
    const [outer, ...holes] = MAP.areas[p.area]!.rings
    const on = spots.filter(
      ({ x, y }) => pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h)),
    )
    assert.ok(on.length >= 2, `${p.name}: ${on.length} lamps`)
  }
  assert.equal(poles.length, spots.length, "every pole lamp is a street lamp")
  const equi = MAP.pois.find((poi) => poi.kind === "railway=station" && poi.name === "Equi Terme")!
  const near = (kind: string) =>
    streetLamps().filter((l) => l.kind === kind && Math.hypot(l.x - equi.x, l.y - equi.y) < 60)
      .length
  assert.equal(near("wall"), 0)
  assert.ok(near("pole") >= 4, `${near("pole")} platform lamps at Equi Terme`)
})

// Regression: which station had which canopy was a table of this map's station names in render code.
test("canopies: one along a station building's track side wherever a platform runs along it (Gragnola's), none elsewhere", () => {
  const corners = cornersOf(all.solid, PALETTE.canopyGrey)
  const along = MAP.railway.stations.filter((station) => {
    const building = MAP.buildings.find((b) => b.style === "station" && b.name === station.name)
    if (building === undefined) return false
    const ring = building.outer
    // Some corner of a canopy meets the building's outline.
    return corners.some(([x, , z]) => {
      for (let k = 0; k < ring.length; k += 2)
        if (
          segDist2(
            x,
            -z,
            ring[k]!,
            ring[k + 1]!,
            ring[(k + 2) % ring.length]!,
            ring[(k + 3) % ring.length]!,
          ).d2 <
          0.05 ** 2
        )
          return true
      return false
    })
  })
  assert.deepEqual(
    along.map((s) => s.name),
    ["Gragnola"],
  )
  // Along its wall, over the walkway round it: its corners over the platform's top, wider than 8 m.
  const xs = corners.map(([x]) => x),
    ys = corners.map(([, , z]) => -z)
  assert.ok(Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys)) > 8)
  assert.ok(
    corners.every(([x, , z]) => Math.hypot(x + 1661, -z - 3261) < 40),
    "at Gragnola",
  )
})

// Regression: a table keyed by two of this map's station names decided which station drew which canopy.
test("no render code names this map's stations: every station is drawn from the map's data alone", () => {
  const root = join(import.meta.dirname, "..")
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.includes("__tests__"),
  )
  for (const file of files) {
    // The code alone: comments may say where a choice was measured.
    const code = readFileSync(join(root, file), "utf8").replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    for (const { name } of MAP.railway.stations)
      assert.ok(!code.includes(`"${name}`) && !code.includes(`${name}:`), `${file} names ${name}`)
  }
})
