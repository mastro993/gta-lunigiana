import assert from "node:assert/strict"
import { test } from "node:test"

import { groundZ, terrainZ } from "../../../sim/map/ground.ts"
import { treesIn } from "../../../sim/map/index.ts"
import { surfaceAt } from "../../../sim/map/surface.ts"
import { VEHICLES, type VehicleModel } from "../../../sim/vehicles.ts"
import { followYaw, QUARTER, screenAxes } from "../../../sim/view.ts"
import { hash01 } from "../../../tools/geometry.ts"
import { AMBIENT_DB, CABIN, dbToGain, gainToDb, SPEED_OF_SOUND } from "../../acoustics.ts"
import { skyAt } from "../../index.ts"
import { bells, streetAt, wallAt } from "../../places.ts"
import { stepRate } from "../../synth/steps.ts"
import type { Happening, Zone } from "../../types.ts"
import { MOST_DB, TOWERS, windDb } from "../levels.ts"
import {
  at as clock,
  away,
  BANK,
  BEHIND,
  BELFRY,
  car,
  EAST_FLANK,
  FRAME,
  FULL,
  GRAGNOLA,
  HILLSIDE,
  HOUSE_WALL,
  MEADOW,
  OPEN,
  PANDA,
  person,
  RIDGE,
  rig,
  SCREEN_RIGHT,
  SOUTH,
  SPAWN,
  STATION,
  STREET,
  UNDER_BRIDGE,
  wallHit,
  WEST_FLANK,
  world,
} from "../testing.ts"

test("a running car 30 m away on screen-right is heard there; 2 km away it is not (proximity)", () => {
  const near = rig()
  near.hear(world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 30))] }))
  const engine = near.held().get("engine:1")
  assert.ok(engine !== undefined && engine.at.gain > 0 && engine.at.pan > 0)
  const far = rig()
  far.hear(world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 2000))] }))
  assert.equal(far.held().has("engine:1"), false)
})

test("the stereo image turns with the view: a car ahead of the home seat's screen is heard on the right after a quarter turn left, and dead ahead of the driving view in the middle", () => {
  const pan = (yaw: number, ahead = screenAxes(0).up) => {
    const director = rig(),
      heard = world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 30, ahead))] })
    director.hear({ ...heard, listener: { ...heard.listener, yaw } })
    return director.held().get("engine:1")!.at.pan
  }
  assert.ok(
    Math.abs(pan(0)) < 1e-9 && pan(QUARTER) > 0.8 && pan(-QUARTER) < -0.8,
    `${pan(0)} ${pan(QUARTER)} ${pan(-QUARTER)}`,
  )
  const heading = 0.3
  const centred = pan(followYaw(heading), { x: Math.cos(heading), y: Math.sin(heading) })
  assert.ok(Math.abs(centred) < 1e-9, `${centred}`)
})

test("a car at full load 300 m across the open meadow is heard; 400 m away behind Monte San Giorgio it is not", () => {
  const open = rig()
  open.hear(world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 300, SOUTH), FULL)] }))
  assert.equal(open.held().has("engine:1"), true)
  const behind = rig()
  behind.hear(world(WEST_FLANK, { vehicles: [car(1, "panda", EAST_FLANK, FULL)] }))
  assert.equal(behind.held().has("engine:1"), false)
})

test("an engine plays the sim's revs, load, damage and misfires, with a variant of its model's sound drawn from its id", () => {
  const director = rig()
  director.hear(
    world(MEADOW, {
      vehicles: [
        car(41, "truck", away(MEADOW, 30), { rpm: 1800, load: 0.6, damage: 0.8, misfire: true }),
      ],
    }),
  )
  assert.deepEqual(director.held().get("engine:41")?.sound, {
    kind: "engine",
    model: "truck",
    rpm: 1800,
    load: 0.6,
    inside: false,
    variant: hash01(41),
    damage: 0.8,
    misfire: true,
  })
})

// Regression: masking and the caps counted every engine at full load, so an idling car 50 m away outranked one revving 100 m away.
test("engines rank by their load: one revving 100 m away keeps its voice over eight idling 40–54 m away", () => {
  const director = rig()
  const idling = Array.from({ length: 8 }, (_, i) =>
    car(i + 1, "panda", away(MEADOW, 40 + 2 * i, SOUTH)),
  )
  director.hear(
    world(MEADOW, { vehicles: [...idling, car(9, "panda", away(MEADOW, 100, SOUTH), FULL)] }),
  )
  const engines = [...director.held().keys()].filter((key) => key.startsWith("engine:"))
  assert.ok(
    engines.length === 8 && engines.includes("engine:9") && !engines.includes("engine:8"),
    engines.join(),
  )
})

// Regression: the squeal came from sideways speed and no tyre voice was held under 1 m/s, so a standing burnout was silent.
test("tyres play the sim's skids: a standing burnout squeals on the skidding wheel's surface; a car in the air rolls silently", () => {
  const director = rig(),
    at = away(MEADOW, 10, SOUTH)
  const tyres = () => director.held().get("tyres:1")?.sound
  director.hear(
    world(MEADOW, {
      vehicles: [
        car(1, "panda", at, { ...FULL, skid: { amount: 1, slip: 8, surface: "asphalt" } }),
      ],
    }),
  )
  assert.deepEqual(tyres(), {
    kind: "tyres",
    speed: 0,
    skid: 1,
    slip: 8,
    surface: "asphalt",
    heavy: false,
  })
  // A frame with no sim step reports no skid: the last one holds for 50 ms, then the tyres fall silent (standing, nothing rolls).
  director.hear(world(MEADOW, { vehicles: [car(1, "panda", at, FULL)] }))
  assert.deepEqual(tyres(), {
    kind: "tyres",
    speed: 0,
    skid: 1,
    slip: 8,
    surface: "asphalt",
    heavy: false,
  })
  director.hear(world(MEADOW, { vehicles: [car(1, "panda", at, FULL)] }), 3)
  assert.equal(tyres(), undefined)
  director.hear(world(MEADOW, { vehicles: [car(1, "panda", at, { vx: 20 })] }))
  assert.deepEqual(tyres(), {
    kind: "tyres",
    speed: 20,
    skid: 0,
    slip: 0,
    surface: surfaceAt(at.x, at.y),
    heavy: false,
  })
  director.hear(world(MEADOW, { vehicles: [car(1, "panda", at, { vx: 20, wheelsDown: false })] }))
  assert.equal(tyres(), undefined)
})

test("a vehicle is heard where its body is: a car 10 m up in the air 3 m away is heard farther off", () => {
  const director = rig(),
    at = away(MEADOW, 3, SOUTH)
  const gain = (lift: number) => {
    director.hear(
      world(MEADOW, {
        vehicles: [
          car(1, "panda", at, { ...FULL, z: groundZ(at.x, at.y) + VEHICLES.panda.cg + lift }),
        ],
      }),
    )
    return director.held().get("engine:1")!.at.gain
  }
  assert.ok(gain(0) > gain(10) * dbToGain(6), `${gain(0)} vs ${gain(10)}`)
})

test("a hard landing crashes against the ground's own material, not the nearest wall's: the road on paving, earth off it; sliding on the roof grinds it", () => {
  const ground = (at: { readonly x: number; readonly y: number }, speed: number, zone: Zone) => {
    const director = rig()
    const hit: Happening = {
      kind: "impact",
      hit: "ground",
      x: at.x,
      y: at.y,
      speed,
      mass: PANDA,
      car: 1,
      face: zone === "side" ? "roof" : "under",
      body: { model: "panda", zone },
    }
    director.hear(
      world(at, {
        vehicles: [car(1, "panda", at, { vx: 8, wheelsDown: false })],
        happenings: [hit],
      }),
      3,
    )
    const [crash] = director.take("crash"),
      scrape = director.held().get("scrape:1")?.sound
    return crash?.sound.kind === "crash"
      ? [crash.sound.against, crash.sound.body.zone, crash.sound.surface]
      : scrape?.kind === "scrape"
        ? scrape.material
        : undefined
  }
  assert.deepEqual(ground(HOUSE_WALL, 8, "under"), [
    { kind: "wall", material: "road" },
    "under",
    "stone",
  ])
  assert.deepEqual(ground(away(MEADOW, 10, SOUTH), 8, "under"), [
    { kind: "wall", material: "earth" },
    "under",
    "grass",
  ])
  // Beside a trunk on the wooded ridge, which a wall hit there would strike.
  let tree: { readonly x: number; readonly y: number } | undefined
  treesIn(RIDGE.x - 5, RIDGE.y - 5, RIDGE.x + 5, RIDGE.y + 5, (x, y) => void (tree ??= { x, y }))
  assert.ok(tree !== undefined, "a tree on the ridge")
  const trunk = { x: tree.x + 0.55, y: tree.y },
    under = surfaceAt(trunk.x, trunk.y)
  assert.equal(wallAt(trunk.x, trunk.y), "tree")
  assert.deepEqual(ground(trunk, 8, "under"), [
    { kind: "wall", material: under === "asphalt" || under === "stone" ? "road" : "earth" },
    "under",
    under,
  ])
  // A body down on the ground, with no hit at all: the physics reports none for a slide.
  const slide = (at: { readonly x: number; readonly y: number }, vx: number) => {
    const director = rig()
    director.hear(
      world(at, { vehicles: [car(1, "panda", at, { vx, wheelsDown: false, hullDown: true })] }),
      3,
    )
    const scrape = director.held().get("scrape:1")?.sound
    return scrape?.kind === "scrape" ? scrape.material : undefined
  }
  assert.equal(slide(HOUSE_WALL, 8), "road")
  assert.equal(slide(away(MEADOW, 10, SOUTH), 8), "earth")
  assert.equal(slide(HOUSE_WALL, 1), undefined, "too slow to grind")
})

// Regression: the director looked the ground up on the deck above a car under a bridge, while the sim's tyres use the car's own level.
test("under a bridge a car's tyres roll on the riverbed's gravel and a landing there crashes on earth", () => {
  const at = UNDER_BRIDGE,
    z = terrainZ(at.x, at.y) + VEHICLES.panda.cg
  assert.equal(surfaceAt(at.x, at.y), "asphalt", "the deck 16 m up")
  const director = rig()
  director.hear(world(away(at, 20), { vehicles: [car(1, "panda", at, { z, vx: 6 })] }))
  const tyres = director.held().get("tyres:1")?.sound
  assert.equal(tyres?.kind === "tyres" ? tyres.surface : undefined, "gravel")
  const hit: Happening = {
    kind: "impact",
    hit: "ground",
    x: at.x,
    y: at.y,
    speed: 8,
    mass: PANDA,
    car: 1,
    face: "under",
    body: { model: "panda", zone: "under" },
  }
  const deck = rig()
  deck.hear(
    world(away(at, 20), { vehicles: [car(1, "panda", at, { z, vx: 6 })], happenings: [hit] }),
  )
  const [crash] = deck.take("crash")
  assert.deepEqual(
    crash?.sound.kind === "crash" ? [crash.sound.against, crash.sound.surface] : undefined,
    [{ kind: "wall", material: "earth" }, "gravel"],
  )
})

test("cresting a hump bottoms the suspension out with a clunk, a step or two of it heard once; only a hard landing crashes", () => {
  const director = rig(),
    at = away(MEADOW, 10, SOUTH)
  const land = (speeds: ReadonlyArray<number>, frames = 1) =>
    director.hear(
      world(MEADOW, {
        vehicles: [car(1, "panda", at, { vx: 15 })],
        happenings: speeds.map((speed): Happening => ({
          kind: "impact",
          hit: "ground",
          x: at.x,
          y: at.y,
          speed,
          mass: PANDA,
          car: 1,
          face: "under",
          body: { model: "panda", zone: "under" },
        })),
      }),
      frames,
    )
  land([3])
  land([2.4])
  land([1])
  const [clunk, ...more] = director.take("clunk")
  assert.ok(
    clunk?.sound.kind === "clunk" && clunk.sound.speed === 3 && more.length === 0,
    JSON.stringify(director.plays),
  )
  assert.equal(director.held().has("scrape:1"), false, "the wheels touching down do not grind")
  land([], 7)
  land([9])
  assert.deepEqual([director.take("clunk").length, director.take("crash").length], [0, 1])
})

test("a building between the listener and a car 30 m away muffles it: lower gain and cutoff", () => {
  const director = rig()
  director.hear(world(STREET, { vehicles: [car(1, "panda", BEHIND), car(2, "panda", OPEN)] }))
  const behind = director.held().get("engine:1")!.at,
    open = director.held().get("engine:2")!.at
  // Being a metre farther (uphill) is worth under a decibel; the roof takes 15 dB and leaves the diffraction lowpass.
  assert.ok(
    behind.gain < open.gain * dbToGain(-10) && behind.cutoff <= 2800,
    `${behind.gain} < ${open.gain}, ${behind.cutoff} Hz`,
  )
})

test("an approaching car is shifted up, a receding one down", () => {
  const cents = (speed: number) => {
    const director = rig()
    // 50 m screen-right, driving along screen-left (towards the listener) at `speed`.
    director.hear(
      world(MEADOW, {
        vehicles: [
          car(1, "panda", away(MEADOW, 50), {
            vx: -speed * SCREEN_RIGHT.x,
            vy: -speed * SCREEN_RIGHT.y,
          }),
        ],
      }),
    )
    return director.held().get("engine:1")!.at.cents
  }
  assert.ok(cents(20) > 0)
  assert.ok(cents(-20) < 0)
})

test("a pedestrian walking (or running) 5 m away steps at that pace's cadence; 40 m away nothing is heard", () => {
  const steps = (metres: number, speed = 2.2) => {
    const director = rig()
    const start = away(MEADOW, metres, SOUTH)
    for (let i = 0; i <= 180; i++)
      director.hear(
        world(MEADOW, {
          people: [person(9, { x: start.x + speed * i * FRAME, y: start.y }, { vx: speed })],
        }),
      )
    return director.take("step").length
  }
  for (const speed of [2.2, 5])
    assert.ok(
      Math.abs(steps(5, speed) - 3 * stepRate(speed)) <= 1,
      `${steps(5, speed)} steps in 3 s at ${speed} m/s`,
    )
  assert.equal(steps(40), 0)
})

test("a wall impact at 10 m/s crashes; 300 m away it arrives after its travel time, 30 m away at once", () => {
  const crash = (metres: number) => {
    const director = rig()
    const at = away(MEADOW, metres, SOUTH)
    director.hear(world(MEADOW, { vehicles: [car(1, "panda", at)], happenings: [wallHit(at, 10)] }))
    return director.take("crash")
  }
  const [far] = crash(300)
  assert.ok(
    far !== undefined && Math.abs(far.delay - 300 / SPEED_OF_SOUND) < 0.02,
    `${far?.delay} s`,
  )
  assert.equal(crash(30)[0]?.delay, 0)
})

test("a wall hit split over two steps crashes once, a 1.5× harder one at once again; soft contacts of a moving car grind for 0.2 s", () => {
  const director = rig()
  const at = away(MEADOW, 10, SOUTH)
  const step = (speeds: ReadonlyArray<number>, frames = 1, vx = 8) =>
    director.hear(
      world(MEADOW, {
        vehicles: [car(1, "panda", at, { vx })],
        happenings: speeds.map((speed) => wallHit(at, speed)),
      }),
      frames,
    )
  step([7.1])
  step([4.4])
  step([9])
  assert.equal(director.take("crash").length, 1, "the tail, and a hit not 1.5× harder")
  step([11])
  assert.equal(director.take("crash").length, 1, "a harder hit")
  step([], 7)
  step([3])
  assert.equal(director.take("crash").length, 1, "a new hit after 0.1 s")
  step([0.3])
  assert.equal(director.held().has("scrape:1"), true)
  step([], 13)
  assert.equal(director.held().has("scrape:1"), false, "0.2 s after the last contact")
  step([0.3], 1, 0)
  assert.equal(
    director.held().has("scrape:1"),
    false,
    "pressed against the wall, not moving along it",
  )
  assert.equal(director.take("crash").length, 0)
})

test("a crash into a house wall knows its masonry and the cobbles under it, a scrape along it the masonry; out on the meadow both are earth", () => {
  const hits = (at: { readonly x: number; readonly y: number }) => {
    const director = rig()
    director.hear(
      world(at, { vehicles: [car(1, "panda", at, { vx: 8 })], happenings: [wallHit(at, 10)] }),
    )
    director.hear(
      world(at, { vehicles: [car(1, "panda", at, { vx: 8 })], happenings: [wallHit(at, 0.5)] }),
      7,
    )
    const [crash] = director.take("crash"),
      scrape = director.held().get("scrape:1")?.sound
    return [
      crash?.sound.kind === "crash" ? [crash.sound.against, crash.sound.surface] : undefined,
      scrape?.kind === "scrape" ? scrape.material : undefined,
    ]
  }
  assert.deepEqual(hits(HOUSE_WALL), [[{ kind: "wall", material: "masonry" }, "stone"], "masonry"])
  assert.deepEqual(hits(away(MEADOW, 10, SOUTH)), [
    [{ kind: "wall", material: "earth" }, "grass"],
    "earth",
  ])
})

test("a car crash is the Impact's from either car: its body first, the other the one it hit", () => {
  const crash = (listener: number | undefined) => {
    const director = rig()
    const at = away(MEADOW, 3, SOUTH)
    const hit: Happening = {
      kind: "impact",
      hit: "car",
      x: at.x,
      y: at.y,
      speed: 10,
      mass: 1 / (1000 / VEHICLES.truck.mass + 1 / PANDA),
      car: 1,
      other: 2,
      body: { model: "truck", zone: "front" },
      otherBody: { model: "panda", zone: "rear" },
    }
    director.hear(
      world(
        MEADOW,
        {
          vehicles: [car(1, "truck", at), car(2, "panda", at, { mine: listener === 2 })],
          happenings: [hit],
        },
        listener,
      ),
    )
    const [played] = director.take("crash")
    return played?.sound.kind === "crash" ? [played.sound.body, played.sound.against] : undefined
  }
  const truckFirst = [
    { model: "truck", zone: "front", worn: 0 },
    { kind: "car", body: { model: "panda", zone: "rear", worn: 0 } },
  ]
  assert.deepEqual(crash(undefined), truckFirst)
  assert.deepEqual(crash(2), truckFirst, "sitting in the Panda")
})

test("what broke stays broken: a car's second crash on the same zone carries how hard the first one crushed it, another zone none", () => {
  const director = rig()
  const at = away(MEADOW, 10, SOUTH)
  const hit = (speed: number, zone: Zone) => {
    director.hear(
      world(MEADOW, {
        vehicles: [car(1, "panda", at, { vx: 8 })],
        happenings: [wallHit(at, speed, 1, zone)],
      }),
      10,
    )
    const [played] = director.take("crash")
    return played?.sound.kind === "crash" ? played.sound.body.worn : undefined
  }
  assert.equal(hit(8, "side"), 0)
  const first = hit(6, "side")
  // An earth bank takes 70 % of the crush: the car's barrier-equivalent speed is 8·√0.3.
  assert.ok(first !== undefined && Math.abs(first - 8 * Math.sqrt(0.43 / 1.43)) < 0.01, `${first}`)
  assert.equal(hit(12, "side"), first, "the hardest so far")
  assert.equal(hit(6, "front"), 0)
})

// Regression: a wall crash read its debris surface at the contact point, on the house front (here its grass verge), not on the street the car stands on.
test("a wall crash's debris lands on the ground under the car, not on the house front it hit", () => {
  const director = rig(),
    car0 = { x: -399.7, y: 435.5 },
    front = { x: -399.7, y: 433.3 }
  director.hear(
    world(car0, { vehicles: [car(1, "panda", car0, { vx: 8 })], happenings: [wallHit(front, 10)] }),
  )
  const [played] = director.take("crash")
  assert.ok(
    played?.sound.kind === "crash" &&
      played.sound.surface === "asphalt" &&
      played.sound.against.kind === "wall" &&
      played.sound.against.material === "masonry",
  )
})

test("a scrape keeps its wall's material through a brief other contact (a tree along a bank), and switches once the new one has lasted 0.25 s", () => {
  const director = rig(),
    at = away(MEADOW, 10, SOUTH)
  const rub = (wall: { readonly x: number; readonly y: number }, frames: number) => {
    director.hear(
      world(MEADOW, {
        vehicles: [car(1, "panda", at, { vx: 8 })],
        happenings: [wallHit(wall, 0.5)],
      }),
      frames,
    )
    const held = director.held().get("scrape:1")?.sound
    return held?.kind === "scrape" ? held.material : undefined
  }
  assert.equal(rub(HOUSE_WALL, 3), "masonry")
  assert.equal(rub(at, 5), "masonry", "earth for 5 frames")
  assert.equal(rub(HOUSE_WALL, 3), "masonry")
  assert.equal(rub(at, 20), "earth", "earth for a third of a second")
})

// Regression: on foot, a wall hit's missing `other` matched the missing car the listener sits in, so every wall crash was "their own".
test("a wall crash heard on foot is not the listener's own: the building in the way muffles it", () => {
  const crash = (at: { readonly x: number; readonly y: number }) => {
    const director = rig()
    director.hear(world(STREET, { vehicles: [car(1, "panda", at)], happenings: [wallHit(at, 10)] }))
    return director.take("crash")[0]!
  }
  const behind = crash(BEHIND),
    open = crash(OPEN)
  assert.ok(behind.at.gain < open.at.gain * dbToGain(-10), `${behind.at.gain} < ${open.at.gain}`)
})

test("a 2 m/s bump plays quieter than a 20 m/s crash, so masking culls it nearer: both at full gain 150 m away, only the crash 1.2 km away", () => {
  const gains = (metres: number) =>
    [2, 20].map((speed) => {
      const director = rig()
      director.hear(world(MEADOW, { happenings: [wallHit(away(MEADOW, metres, SOUTH), speed)] }))
      return director.take("crash")[0]?.at.gain
    })
  const [bump, crash] = gains(150)
  assert.ok(bump !== undefined && bump === crash, `${bump} vs ${crash}`)
  const [far, heavy] = gains(1200)
  assert.ok(far === undefined && heavy !== undefined && heavy > 0, `${far} vs ${heavy}`)
})

test("a hard crash answers off a rock face, later, fainter and dry in the open; in a street only the open share of it; a soft one does not", () => {
  const crash = (spot: { readonly x: number; readonly y: number }, speed: number, metres = 10) => {
    const director = rig()
    const at = away(spot, metres, SOUTH)
    director.hear(
      world(spot, { vehicles: [car(1, "panda", at)], happenings: [wallHit(at, speed)] }),
    )
    return director.take("crash")
  }
  const [direct, ...echoes] = crash(WEST_FLANK, 10)
  assert.ok(
    echoes.length > 0 &&
      echoes.every(
        (e) => e.delay > direct!.delay + 0.1 && e.at.gain < direct!.at.gain / 2 && e.at.wet === 0,
      ),
    `${echoes.length} echoes`,
  )
  // From 100 m the direct sound has spread as far as the echo off the face 40 m away: that echo plays the face's own loss under it, times the open share
  // (at 15 m/s: a softer crash plays under its nominal, and masking culls that echo).
  const [walled, ...hidden] = crash(BELFRY, 15, 100),
    open = 1 - streetAt(BELFRY.x, BELFRY.y),
    most = dbToGain(-10) * open
  assert.ok(open < 0.5 && hidden.length > 0, `${hidden.length} echoes, ${open} open`)
  assert.ok(Math.abs(hidden[0]!.at.gain / walled!.at.gain - most) < 1e-9)
  assert.ok(
    hidden.every((e) => e.at.gain / walled!.at.gain < most + 1e-9 && e.at.wet === walled!.at.wet),
  )
  assert.equal(crash(WEST_FLANK, 4).length, 1)
})

test("the reverb follows the surroundings: a honk in the open meadow plays dry, in Gragnola's walled centre wet; the beds stay dry", () => {
  const honk = (spot: { readonly x: number; readonly y: number }) => {
    const director = rig()
    const at = away(spot, 10, SOUTH)
    director.hear(
      world(spot, { happenings: [{ kind: "honk", car: 1, model: "panda", x: at.x, y: at.y }] }),
    )
    assert.equal(director.held().get("wind")?.at.wet, 0)
    return director.take("honk")
  }
  const open = honk(MEADOW),
    walled = honk(GRAGNOLA)
  assert.ok(open.length === 1 && open[0]!.at.wet === 0, JSON.stringify(open))
  assert.ok(walled.length > 0 && walled[0]!.at.wet > 1, JSON.stringify(walled))
})

test("inside the Panda its own crash plays open, at most MOST_DB.crash over gain 1, but its street tail and its echoes come back through the cabin like a crash 3 m away", () => {
  const crash = (spot: { readonly x: number; readonly y: number }, own: boolean, dir = SOUTH) => {
    const director = rig(),
      other = away(spot, 3, dir),
      at = own ? spot : other
    const vehicles = [car(5, "panda", spot, { mine: true }), car(2, "panda", other)]
    director.hear(world(spot, { vehicles, happenings: [wallHit(at, 10, own ? 5 : 2)] }, 5))
    return director.take("crash")
  }
  const [own] = crash(GRAGNOLA, true),
    [outside] = crash(GRAGNOLA, false)
  // Regression: it came about 25 dB over gain 1, and the master limiter, taking 20 dB off the hit, gave the sub-hits back as loud as it.
  assert.equal(own!.at.gain, dbToGain(MOST_DB.crash))
  assert.ok(
    own!.at.cutoff === 20000 &&
      outside!.at.cutoff <= CABIN.panda.cutoff &&
      own!.at.wet < outside!.at.wet,
    `${JSON.stringify(own!.at)} against ${JSON.stringify(outside!.at)}`,
  )
  // A like crash, into the same wall on the same ground, so its echoes are as loud: in Monzone Alto's street 3 m south is a stone
  // wall, 4.5 dB louder than the own crash's bank, and the cabin's floor lets through a faint echo of it the bank's crash lacks.
  for (const [spot, dir] of [
    [WEST_FLANK, SOUTH],
    [BELFRY, { x: -1, y: 0 }],
  ] as const) {
    const [direct, ...echoes] = crash(spot, true, dir),
      [alike, ...outsides] = crash(spot, false, dir)
    assert.deepEqual(alike!.sound, direct!.sound)
    assert.ok(echoes.length > 0 && echoes.length === outsides.length, `${echoes.length} echoes`)
    echoes.forEach((echo, i) => {
      const like = outsides[i]!.at
      assert.ok(
        echo.at.gain <= direct!.at.gain * dbToGain(-10 - CABIN.panda.loss) &&
          echo.at.cutoff <= CABIN.panda.cutoff,
        JSON.stringify(echo.at),
      )
      assert.ok(
        Math.abs(gainToDb(echo.at.gain / like.gain)) < 1 &&
          Math.abs(echo.at.wet - like.wet) <= like.wet / 4,
        `${JSON.stringify(echo.at)} against ${JSON.stringify(like)}`,
      )
    })
  }
})

test("before the audio context runs nothing is measured or played, but who sits where is still tracked", () => {
  const director = rig(0)
  director.hear(world(MEADOW, { people: [person(1, MEADOW, { player: true })] }), 1, 0)
  director.hear(world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })] }, 5), 30, 0)
  assert.equal(director.plays.length, 0)
  director.hear(world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })] }, 5), 60)
  assert.equal(director.take("door").length, 0, "no doors replayed once it runs")
  assert.equal(director.held().has("engine:5"), true)
})

test("inside a closed car an outside engine is cut to the cabin's lowpass; the open Ape lets more in", () => {
  const outside = (model: VehicleModel) => {
    const director = rig()
    director.hear(
      world(
        MEADOW,
        { vehicles: [car(1, model, MEADOW, { mine: true }), car(2, "truck", away(MEADOW, 30))] },
        1,
      ),
    )
    return director.held().get("engine:2")!.at
  }
  const panda = outside("panda"),
    ape = outside("ape")
  assert.ok(panda.cutoff <= 1400)
  assert.ok(ape.gain > panda.gain)
})

test("getting into a parked car: doors and the starter, the engine after it cranks; a running car: doors only; getting out: doors, engine off", () => {
  const director = rig()
  director.hear(world(MEADOW, { people: [person(1, MEADOW, { player: true })] }))
  director.hear(world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })] }, 5))
  assert.deepEqual(
    director.take("door").map((p) => [(p.sound as { open: boolean }).open, p.delay]),
    [
      [true, 0],
      [false, 0.7],
    ],
  )
  assert.equal(director.take("ignition").length, 1)
  assert.equal(director.held().has("engine:5"), false, "still cranking")
  director.hear(world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })] }, 5), 60)
  assert.equal(director.held().has("engine:5"), true)

  const carjack = rig()
  carjack.hear(
    world(MEADOW, {
      vehicles: [car(6, "panda", away(MEADOW, 2))],
      people: [person(1, MEADOW, { player: true })],
    }),
  )
  carjack.hear(world(MEADOW, { vehicles: [car(6, "panda", MEADOW, { mine: true })] }, 6))
  assert.equal(carjack.take("door").length, 2)
  assert.equal(carjack.take("ignition").length, 0)
  assert.equal(carjack.held().has("engine:6"), true)
  carjack.hear(world(MEADOW, { people: [person(1, away(MEADOW, 1.5), { player: true })] }))
  assert.equal(carjack.take("door").length, 2)
  assert.equal(carjack.held().has("engine:6"), false)
})

// Regression: the ears stayed 1.6 m over the ground while the car they sat in flew, so its own siren faded with the height.
test("the listener's own siren sounds the same in the air as on the ground: the ears ride in the car", () => {
  const gain = (lift: number) => {
    const director = rig(),
      z = groundZ(MEADOW.x, MEADOW.y) + VEHICLES.carabinieri.cg + lift
    director.hear(
      world(
        MEADOW,
        { vehicles: [car(7, "carabinieri", MEADOW, { mine: true, z })], horn: true },
        7,
      ),
    )
    return gainToDb(director.held().get("siren:7")!.at.gain)
  }
  for (const lift of [5, 20])
    assert.ok(
      Math.abs(gain(lift) - gain(0)) < 0.5,
      `${lift} m up: ${gain(lift)} dB against ${gain(0)} on the ground`,
    )
})

test("in the Carabinieri car a horn press toggles the siren; in the Panda the horn sounds while the key is held", () => {
  const director = rig()
  const giulia = (horn: boolean) =>
    director.hear(
      world(MEADOW, { vehicles: [car(7, "carabinieri", MEADOW, { mine: true })], horn }, 7),
    )
  const sirens = [false, true, true, false, true].map((horn) => {
    giulia(horn)
    return director.held().has("siren:7")
  })
  assert.deepEqual(sirens, [false, true, true, true, false])
  assert.equal(director.held().has("horn:7"), false)

  const panda = rig()
  const horns = [false, true, true, false].map((horn) => {
    panda.hear(world(MEADOW, { vehicles: [car(8, "panda", MEADOW, { mine: true })], horn }, 8))
    return panda.held().get("horn:8")?.at
  })
  assert.deepEqual(
    horns.map((at) => at !== undefined),
    [false, true, true, false],
  )
  // The horn sits in the grille, outside the cabin: the driver hears it through the whole body.
  assert.equal(horns[1]!.cutoff, CABIN.panda.cutoff)
})

test("bells strike the game clock's hours by day: at 15:00 the nearby tower three times 2.5 s apart, once a day; not on the half hour, nor 22:00–06:00", () => {
  /** `seconds` at `spot` at `hour`:`minute` on day `days`: when each pitch's loudest strokes reach the ears (echoes are fainter). */
  const ring = (
    director: ReturnType<typeof rig>,
    spot: { readonly x: number; readonly y: number },
    hour: number,
    minute = 0,
    days = 0,
    seconds = 15,
  ) => {
    director.hear(world(spot, { sky: skyAt(clock(hour, minute, days)) }), seconds * 60)
    const rung = Map.groupBy(director.take("bell"), (p) =>
      p.sound.kind === "bell" ? p.sound.pitch : 0,
    )
    return new Map(
      [...rung].map(([pitch, plays]) => {
        const loudest = Math.max(...plays.map((p) => p.at.gain))
        return [
          pitch,
          plays.filter((p) => p.at.gain === loudest).map((p) => p.t + p.delay),
        ] as const
      }),
    )
  }
  const director = rig()
  const tower = bells.reduce((a, b) =>
    Math.hypot(b.x - BELFRY.x, b.y - BELFRY.y) < Math.hypot(a.x - BELFRY.x, a.y - BELFRY.y) ? b : a,
  )
  const [a, b, c, ...more] = ring(director, BELFRY, 15).get(tower.pitch) ?? []
  assert.ok(
    more.length === 0 && Math.abs(b! - a! - 2.5) < 1e-6 && Math.abs(c! - b! - 2.5) < 1e-6,
    `${[a, b, c, ...more]}`,
  )
  assert.equal(ring(director, BELFRY, 15).size, 0, "the same hour again")
  assert.equal(ring(director, BELFRY, 15, 30).size, 0, "the half hour")
  assert.equal(ring(director, BELFRY, 15, 0, 1).get(tower.pitch)?.length, 3, "the next day's 15:00")
  assert.equal(ring(director, BELFRY, 23).size, 0, "the night's silence")
  // Its edges: 22:00 and 06:00 would strike 10 and 6 times, within 30 s.
  assert.equal(ring(director, BELFRY, 22, 0, 0, 30).size, 0, "22:00 is silent")
  assert.equal(ring(director, BELFRY, 6, 0, 0, 30).size, 0, "06:00 is silent")
  assert.equal(ring(director, BELFRY, 7, 0, 0, 30).get(tower.pitch)?.length, 7, "07:00 rings")
  assert.equal(ring(director, BELFRY, 21, 0, 0, 30).get(tower.pitch)?.length, 9, "21:00 rings")
  // Eleven towers are in earshot of the woods above Isolano.
  const towers = ring(rig(), HILLSIDE, 15).size
  assert.ok(towers > 0 && towers <= TOWERS, `${towers} towers rang`)
})

test("by the Torrente Lucido at Monzone station a water voice plays; on a dry ridge none", () => {
  const station = rig()
  station.hear(world(STATION))
  assert.ok([...station.held().keys()].some((key) => key.startsWith("water:")))
  const ridge = rig()
  ridge.hear(world(RIDGE))
  assert.ok(![...ridge.held().values()].some(({ sound }) => sound.kind === "water"))
})

test("the valley is never silent: in Monzone's sheltered street the wind blows at the rural background; the Lucido 15 m away in the clear plays near full, far louder and brighter than behind the houses, where it still plays (a river never masks itself)", () => {
  const street = rig()
  street.hear(world(SPAWN), 2)
  const wind = street.held().get("wind")?.sound
  assert.ok(
    wind?.kind === "wind" && windDb(wind.strength) >= AMBIENT_DB - 1e-9,
    `strength ${JSON.stringify(wind)}`,
  )
  const bank = rig()
  bank.hear(world(BANK), 2)
  const near = bank.held().get("water:Torrente Lucido")!.at,
    behind = street.held().get("water:Torrente Lucido")!.at
  assert.ok(
    near.gain > dbToGain(-6) && near.gain > behind.gain * dbToGain(15),
    `${near.gain} vs ${behind.gain}`,
  )
  assert.ok(near.cutoff > 2 * behind.cutoff, `${near.cutoff} vs ${behind.cutoff} Hz`)
})

test("twenty running cars around: only the eight loudest, nearest engines play, and near-equals do not swap", () => {
  const director = rig()
  // Every 10 m to the south; the ninth at `ninth` m.
  const cars = (ninth: number) =>
    Array.from({ length: 20 }, (_, i) =>
      car(i + 1, "panda", away(MEADOW, i === 8 ? ninth : 10 * (i + 1), SOUTH)),
    )
  const engines = () =>
    [...director.held().keys()].filter((key) => key.startsWith("engine:")).sort()
  const nearest = Array.from({ length: 8 }, (_, i) => `engine:${i + 1}`).sort()
  director.hear(world(MEADOW, { vehicles: cars(90) }))
  assert.deepEqual(engines(), nearest)
  director.hear(world(MEADOW, { vehicles: cars(75) }))
  assert.deepEqual(
    engines(),
    nearest,
    "the ninth a little nearer than the eighth: the eighth keeps its voice",
  )
  director.hear(world(MEADOW, { vehicles: cars(40) }))
  assert.deepEqual(engines(), [...nearest.filter((key) => key !== "engine:8"), "engine:9"].sort())
})
