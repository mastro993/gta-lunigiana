import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { isMotorRoad, isTraffic, TILE, tileKey } from "../../sim/map/kinds.ts"
import {
  decodeMap,
  decodeTile,
  type Layer,
  MAP_URL,
  provideMap,
  readMapFile,
  type TileVectors,
  tileUrl,
} from "../../sim/map/packed.ts"
import { pointInRing, segDist2 } from "../geometry.ts"
import { clearance } from "../spawns.ts"

// Cesena's global file, and the tiles round its start: every wall within 50 m of it lives in one of
// them (a wall lives in the tile of its midpoint and reaches at most `walls.reach` from it), and
// every road and building within `vectors.halo` of their squares lies whole in them (on Cesena,
// whose start is by the corner its four tiles share, they are all four). Decoded here: the sim's
// tiles would decode Monzone's global file, which the boot test below must not find loaded.
const map = decodeMap(readMapFile(new URL("cesena.bin", MAP_URL)))
const start = (() => {
  const { x, y } = map.spawns.player,
    r = 50 + map.walls.reach
  const tiles = map.tiles
    .filter(
      ({ i, j }) =>
        i >= Math.floor((x - r) / TILE) &&
        i <= Math.floor((x + r) / TILE) &&
        j >= Math.floor((y - r) / TILE) &&
        j <= Math.floor((y + r) / TILE),
    )
    .map(({ i, j }) => decodeTile(readMapFile(tileUrl(map.name, tileKey(i, j)))))
  /** A layer of the tiles' vectors, each feature once (every tile near it holds it), in the whole map's order, by its index. */
  const merged = <T>(of: (v: TileVectors) => Layer<T>): Array<readonly [number, T]> => {
    const byId = new Map<number, T>()
    for (const t of tiles) {
      const { ids, items } = of(t.vectors)
      ids.forEach((id, k) => byId.set(id, items[k]!))
    }
    return [...byId].sort(([a], [b]) => a - b)
  }
  return {
    walk: tiles.flatMap((t) => Array.from(t.walls.walk)),
    drive: tiles.flatMap((t) => Array.from(t.walls.drive)),
    trees: tiles.flatMap((t) => Array.from(t.trees)),
    roads: merged((v) => v.roads).map(([k, line]) => ({ ...map.roads[k]!, ...line })),
    buildings: merged((v) => v.buildings).map(([, b]) => b),
  }
})()

test("Cesena contains the real city, station, historic centre and connected streets", () => {
  assert.equal(map.origin.lon, 12.2429)
  assert.ok(map.districts.some((district) => district.name === "Cesena"))
  assert.ok(map.districts.every((district) => !/Monzone|Sagro|Equi/.test(district.name)))
  assert.ok(map.pois.some((poi) => poi.name === "Cesena" && poi.kind === "railway=station"))
  assert.ok(map.roads.some((road) => road.name?.includes("Mazzini")))
  // the Rocca Malatestiana, 270–360 m south-west of the start
  assert.ok(start.buildings.some((building) => building.name?.includes("Malatestiana")))
  assert.ok(map.graph.traffic.length > 0 && map.graph.walk.length > 0)
})

test("Cesena starts on clear ground in the centre with cars to steal", () => {
  const { x, y } = map.spawns.player,
    { trees } = start
  assert.ok(Math.hypot(x, y) < 200)
  // With no buildings or roads read round it, the checks below would pass on nothing.
  assert.ok(start.buildings.length > 0, "no buildings round the start")
  assert.ok(
    start.roads.length > 0 && start.roads.every((road) => road.pts.length >= 4),
    "no road lines round the start",
  )
  const containing = start.buildings.find(
    (building) =>
      pointInRing(x, y, building.outer) &&
      !(building.holes ?? []).some((hole) => pointInRing(x, y, hole)),
  )
  assert.equal(containing, undefined, `Player starts inside building ${containing?.id}`)
  const walk = clearance(start.walk, trees)
  assert.ok(walk.circle(x, y, 1.2))
  assert.ok(clearance(start.drive, trees).circle(x, y, 1.2))
  const reachesStreet = start.roads.some((road) => {
    if (!isTraffic(road.cls) || isMotorRoad(road)) return false
    for (let index = 0; index + 3 < road.pts.length; index += 2) {
      const ax = road.pts[index]!,
        ay = road.pts[index + 1]!,
        bx = road.pts[index + 2]!,
        by = road.pts[index + 3]!
      const { d2, t } = segDist2(x, y, ax, ay, bx, by)
      if (d2 > (road.w / 2 + 1.1) ** 2) continue
      const steps = Math.ceil(Math.sqrt(d2) / 0.5)
      if (
        Array.from({ length: steps + 1 }, (_, step) => {
          const fraction = steps === 0 ? 0 : step / steps
          return walk.circle(
            x + (ax + (bx - ax) * t - x) * fraction,
            y + (ay + (by - ay) * t - y) * fraction,
            1.2,
          )
        }).every(Boolean)
      )
        return true
    }
    return false
  })
  assert.ok(reachesStreet, "Player must have an unobstructed walking route to the street")
  assert.ok(map.spawns.parked.some((car) => Math.hypot(car.x - x, car.y - y) < 150))
})

test("Cesena boots the existing simulation, populates it and replays walking deterministically", async () => {
  provideMap(gunzipSync(readFileSync(new URL("../../sim/map/cesena.bin", import.meta.url))))
  const { Keyboard } = await import("@typeonce/ritmo-browser")
  const { bindings, Game, KeyboardInput, makeRuntime, PlayerView, setup, update, Vehicle } =
    await import("../../sim/index.ts")
  const vehicles = Game.Inspector(
    "Test/CesenaVehicles",
    { queries: { vehicles: Game.Query({ selection: { vehicle: Game.Query.read(Vehicle) } }) } },
    ({ queries }) => queries.vehicles.each().length,
  )
  const run = () => {
    const made = makeRuntime({
      seed: 1,
      services: Game.Runtime.services(
        Game.Runtime.service(
          KeyboardInput,
          Keyboard.scripted(bindings, [
            { frame: 0, press: ["up"] },
            { frame: 120, release: ["up"] },
          ]),
        ),
      ),
    })
    assert.ok(made.ok)
    const runtime = made.value
    assert.ok(runtime.tick(setup).ok)
    for (let frame = 0; frame < 180; frame++) assert.ok(runtime.tick(update).ok)
    const saved = runtime.snapshot()
    assert.ok(saved.ok)
    return {
      player: runtime.inspect(PlayerView),
      vehicles: runtime.inspect(vehicles),
      world: saved.value,
    }
  }
  const first = run()
  assert.ok(first.player !== undefined)
  assert.ok(
    Math.hypot(
      first.player.pose.x - map.spawns.player.x,
      first.player.pose.y - map.spawns.player.y,
    ) > 1,
  )
  assert.ok(first.vehicles > 0)
  assert.deepEqual(run(), first)
})
