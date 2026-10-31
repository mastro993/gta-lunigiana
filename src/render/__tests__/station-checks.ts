// The checks stations.test.ts (the stations within 4 km of Monzone station) and
// stations.map-test.ts (all of the map's) share: the platforms, their name boards and lamps, and
// the canopies as drawn.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { pointInRing, segDist2 } from "../../sim/collide.ts"
import { platformTop } from "../../sim/map/ground.ts"
import { MAP, RAIL_LIFT } from "../../sim/map/index.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { boxOver, linear, type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { lampPieces, streetLamps } from "../sky/lamps.ts"
import { platformLamps, stationPieces } from "../stations.ts"

/** How much farther than its platforms a part of the stations draws its pieces and lamps, m (its track reaches twice as far): past every board, lamp and canopy of theirs. */
const MARGIN = 100

/** A part of the map's stations, drawn: what the checks below visit. */
export interface Stations {
  /** The station pieces and pole lamps within `MARGIN` of it, drawn whole into one sink. */
  readonly all: Sink
  /** Its platforms: indices into `MAP.railway.platforms`. */
  readonly platforms: ReadonlyArray<number>
  /** Its stations (those with a platform of its): indices into `MAP.railway.stations`. */
  readonly stations: ReadonlyArray<number>
  /** The track within twice `MARGIN` of it: indices into `MAP.rail`. */
  readonly rail: ReadonlyArray<number>
  /** Whether a lamp at (x, y) is its. */
  readonly holds: (x: number, y: number) => boolean
}

/**
 * The platforms and stations within `reach` m of `spot` (a platform by the first point of its axis;
 * all of the map's with no spot): drawing only the pieces within `MARGIN` farther, a check of them
 * reads only the tiles round them.
 */
export const stationsNear = (
  spot?: { readonly x: number; readonly y: number },
  reach = Infinity,
): Stations => {
  const holds = (x: number, y: number) =>
    spot === undefined || Math.hypot(x - spot.x, y - spot.y) <= reach
  const within = (margin: number) => (pts: ReadonlyArray<number>) => {
    if (spot === undefined) return true
    const [minX, minY, maxX, maxY] = boxOver(pts)
    return (
      Math.hypot(
        Math.max(minX - spot.x, 0, spot.x - maxX),
        Math.max(minY - spot.y, 0, spot.y - maxY),
      ) <=
      reach + margin
    )
  }
  const all: Sink = {
    solid: new Triangles(),
    decal: new Triangles(),
    water: new WaterTriangles(),
    glow: new Triangles(),
    pieces: [],
  }
  for (const piece of stationPieces().filter((p) => within(MARGIN)(p.pts)))
    piece.draw(() => all, 0, Math.max(0, piece.pts.length / 2 - 2))
  const lamps = lampPieces()
  for (const [i, lamp] of streetLamps().entries())
    if (lamp.kind === "pole" && within(MARGIN)([lamp.x, lamp.y])) lamps[i]!.draw(() => all, 0, 0)
  const platforms = [...MAP.railway.platforms.keys()].filter((p) => {
    const { axis } = MAP.railway.platforms[p]!
    return holds(axis[0]!, axis[1]!)
  })
  return {
    all,
    platforms,
    stations: [...MAP.railway.stations.keys()].filter((s) =>
      platforms.some((p) => MAP.railway.platforms[p]!.name === MAP.railway.stations[s]!.name),
    ),
    rail: [...MAP.rail.keys()].filter((i) => within(2 * MARGIN)(MAP.rail[i]!.pts)),
    holds,
  }
}

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
/** The nearest point of any of `track`'s centrelines (`MAP.rail` pieces out of a tunnel) to (x, y), its distance and its rail head's render y. */
const nearestTrack = (
  track: ReadonlyArray<number>,
  x: number,
  y: number,
  kinds: (kind: string | undefined) => boolean = () => true,
) => {
  let best = { d: Number.MAX_VALUE, head: 0 }
  for (const i of track) {
    const rail = MAP.rail[i]!
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
/** Its platforms people wait on. */
const waitedOf = ({ platforms }: Stations) =>
  platforms
    .map((p) => MAP.railway.platforms[p]!)
    .filter((p) => p.walkway !== true && p.name !== undefined)

/** The platforms' tops follow the rail profile, within 2 cm of the map's platform top (the rail head + 0.25 m), and rise along Monzone's. */
export const checkTops = ({ all }: Stations): void => {
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
  const rings = MAP.railway.platforms
    .filter((p) => p.name?.startsWith("Monzone") === true)
    .map((p) => MAP.areas[p.area]!.rings[0]!)
  const monzone = tops
    .filter(([x, , z]) => rings.some((ring) => pointInRing(x, -z, ring)))
    .map(([, y]) => y)
  assert.ok(
    Math.max(...monzone) - Math.min(...monzone) > 0.4,
    "the top rises along Monzone's platforms",
  )
}

/** A yellow line along the edges beside running track or a loop, on each of its platforms people wait on, and on none of its walkways. */
export const checkYellowLines = (part: Stations): void => {
  const yellow = cornersOf(part.all.decal, PALETTE.signYellow)
  for (const [x, , z] of yellow) {
    const { d } = nearestTrack(part.rail, x, -z, (kind) => kind !== "siding")
    assert.ok(d < 2.2 + 0.7, `a yellow line ${d.toFixed(2)} m from the track`)
  }
  for (const p of part.platforms.map((i) => MAP.railway.platforms[i]!)) {
    const ring = MAP.areas[p.area]!.rings[0]!
    const on = yellow.filter(([x, , z]) => pointInRing(x, -z, ring)).length
    if (p.walkway === true) assert.equal(on, 0, "no line on a walkway")
    else assert.ok(on >= 30, `${p.name}: ${on / 3} yellow triangles`)
  }
}

/** Nothing they draw stands in a train's way: clear of its half width by 0.15 m from 0.3 m over the rail head to over its roof. */
export const checkTrainsClear = ({ all, rail }: Stations): void => {
  const half = TRAINS.atr220.width / 2 + 0.15,
    roof = TRAINS.atr220.height + 0.3
  for (let t = 0; t < all.solid.position.length; t += 3) {
    const x = all.solid.position[t]!,
      y = all.solid.position[t + 1]!,
      z = all.solid.position[t + 2]!
    const { d, head } = nearestTrack(rail, x, -z)
    if (y > head + 0.3 && y < head + roof)
      assert.ok(
        d >= half - 1e-6,
        `${d.toFixed(2)} m from a track at ${(y - head).toFixed(2)} m over its rail head (${x.toFixed(1)}, ${(-z).toFixed(1)})`,
      )
  }
}

/** One RFI-blue board on each of its platforms people wait on, every board drawn on one, its bottom over head height. */
export const checkBoards = (part: Stations): void => {
  const blue = cornersOf(part.all.solid, PALETTE.rfiBlue),
    waited = MAP.railway.platforms.filter((p) => p.walkway !== true && p.name !== undefined),
    boards = new Map<number, number>()
  // A board is one blue box: 12 triangles.
  for (let b = 0; b < blue.length; b += 36) {
    const box = blue.slice(b, b + 36),
      x = box.reduce((n, [px]) => n + px, 0) / 36,
      y = -box.reduce((n, [, , pz]) => n + pz, 0) / 36
    const on = waited.findIndex((p) => pointInRing(x, y, MAP.areas[p.area]!.rings[0]!))
    assert.ok(on >= 0, `the board at ${x.toFixed(1)}, ${y.toFixed(1)} on a platform`)
    boards.set(on, (boards.get(on) ?? 0) + 1)
    const ground = platformTop(x, y)!
    const low = Math.min(...box.map(([, h]) => h))
    assert.ok(low - yOf(ground) > 2 && low - yOf(ground) < 2.3, "its bottom over head height")
  }
  for (const p of waitedOf(part))
    assert.equal(boards.get(waited.indexOf(p)), 1, `${p.name}: one board`)
}

/** Lamp poles on each of its platforms people wait on, every one lit, Equi Terme's too (no street lamp within 60 m of it). */
export const checkPlatformLamps = (part: Stations): void => {
  const spots = platformLamps()
  for (const p of waitedOf(part)) {
    const [outer, ...holes] = MAP.areas[p.area]!.rings
    const on = spots.filter(
      ({ x, y }) => pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h)),
    )
    assert.ok(on.length >= 2, `${p.name}: ${on.length} lamps`)
  }
  assert.equal(
    streetLamps().filter((lamp) => lamp.kind === "pole" && part.holds(lamp.x, lamp.y)).length,
    spots.filter(({ x, y }) => part.holds(x, y)).length,
    "every pole lamp is a street lamp",
  )
  const equi = MAP.pois.find((poi) => poi.kind === "railway=station" && poi.name === "Equi Terme")!
  const near = (kind: string) =>
    streetLamps().filter((l) => l.kind === kind && Math.hypot(l.x - equi.x, l.y - equi.y) < 60)
      .length
  assert.equal(near("wall"), 0)
  assert.ok(near("pole") >= 4, `${near("pole")} platform lamps at Equi Terme`)
}

/** Of its stations, a canopy along the building's track side only where a platform runs along it (Gragnola's). */
export const checkCanopies = ({ all, stations }: Stations): void => {
  const corners = cornersOf(all.solid, PALETTE.canopyGrey)
  const along = stations
    .map((s) => MAP.railway.stations[s]!)
    .filter((station) => {
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
}

/** No render code names any of its stations: each is drawn from the map's data alone. */
export const checkNoStationNamed = ({ stations }: Stations): void => {
  const root = join(import.meta.dirname, "..")
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.includes("__tests__"),
  )
  for (const file of files) {
    // The code alone: comments may say where a choice was measured.
    const code = readFileSync(join(root, file), "utf8").replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    for (const { name } of stations.map((s) => MAP.railway.stations[s]!))
      assert.ok(!code.includes(`"${name}`) && !code.includes(`${name}:`), `${file} names ${name}`)
  }
}
