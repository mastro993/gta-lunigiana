import assert from "node:assert/strict"
import { test } from "node:test"

import { groundZ } from "../../../sim/map/ground.ts"
import { CROSSINGS } from "../../../sim/rail/crossings.ts"
import { LINES, pointAt } from "../../../sim/rail/lines.ts"
import { TRAINS } from "../../../sim/rail/models.ts"
import { RAIL_BRIDGE, RIOLO } from "../../../sim/rail/testing.ts"
import { axesAt, followYaw } from "../../../sim/view.ts"
import { dbToGain, gainToDb, panOf, spreading } from "../../acoustics.ts"
import { heardCrossings, trainRevs } from "../../rail.ts"
import { engineQuiet } from "../../synth/engine.ts"
import { axleOffsets } from "../../synth/rail.ts"
import { seatOf } from "../index.ts"
import { CAPS, echoes, MOST_DB } from "../levels.ts"
import { rollingOf } from "../rail.ts"
import { away, beside, car, HOUSE_WALL, MEADOW, person, rig, train, world } from "../testing.ts"

const LINE = LINES[0]!
/** An open stretch at grade by Equi Terme, straight and clear for 400 m (s 3600–4300). */
const OPEN = 4000
const FAST = 80 / 3.6

test("a train's two power packs are heard from its end cars, the nearer one louder", () => {
  // The rear end car's middle is 9.8 m from the far nose: stand 15 m out beside it.
  const t = train(1, OPEN, { v: FAST, power: 0.8 })
  const director = rig()
  director.hear(world(beside(t.cars.at(-1)!.s, 15), { trains: [t] }))
  const front = director.held().get("engine:1:0"),
    rear = director.held().get("engine:1:1")
  assert.ok(front !== undefined && rear !== undefined)
  assert.ok(front.sound.kind === "engine" && front.sound.model === "atr220")
  assert.ok(
    gainToDb(rear.at.gain) - gainToDb(front.at.gain) > 6,
    `${front.at.gain} ${rear.at.gain}`,
  )
})

test("a train's wheels are a line source: abreast its rear car it rolls about as loud as abreast its middle", () => {
  const t = train(1, OPEN, { v: FAST }),
    middle = t.cars[1]!.s,
    rear = t.cars[2]!.s
  const heard = (s: number) => {
    const director = rig()
    director.hear(world(beside(s, 10), { trains: [t] }))
    return director.held().get("rails:1")!.at.gain
  }
  // A point source at the train's middle would be 6 dB down 18 m along.
  const drop = gainToDb(heard(middle)) - gainToDb(heard(rear))
  assert.ok(Math.abs(drop) < 2, `${drop}`)
  // Under a rail bridge 22 m over the valley a train rolls as far off as its height: as loud as 22 m beside it at grade, far
  // under 1.5 m beside it. Regression: the line's distance was the ground's alone, so under the deck it played 13 dB louder.
  const passing = (at: { readonly x: number; readonly y: number }, s: number) => {
    const director = rig()
    director.hear(world(at, { trains: [train(1, s + 27.8, { v: FAST })] }))
    return gainToDb(director.held().get("rails:1")!.at.gain)
  }
  const under = passing(beside(RAIL_BRIDGE, 0), RAIL_BRIDGE)
  assert.ok(Math.abs(under - passing(beside(OPEN, 22), OPEN)) < 6, `${under}`)
  assert.ok(passing(beside(OPEN, 1.5), OPEN) - under > 10, `${under}`)
  // The voice is given every axle and the joints around them.
  const director = rig()
  director.hear(world(beside(middle, 10), { trains: [t] }))
  const rails = director.held().get("rails:1")!.sound
  assert.ok(rails.kind === "rails" && rails.axles.length === axleOffsets("atr220").length)
  assert.ok(rails.joints.some((s) => s % 36 === 0) && rails.v === FAST)
})

test("a train's brakes squeal braking to a stand, not at speed", () => {
  const director = rig()
  director.hear(world(beside(OPEN, 15), { trains: [train(1, OPEN, { v: 2, brake: 0.6 })] }))
  assert.ok(director.held().has("brakes:1"))
  director.hear(world(beside(OPEN, 15), { trains: [train(1, OPEN, { v: 12, brake: 0.6 })] }))
  assert.equal(director.held().has("brakes:1"), false)
})

test("in a train's cab the ears ride over its rails, on a rail bridge 20 m over the valley too, behind the cab", () => {
  const t = train(1, RAIL_BRIDGE, {}, true),
    cab = beside(RAIL_BRIDGE - 2.5, 0)
  const heard = world(cab, { trains: [t] }, 1)
  const seat = seatOf(heard)
  assert.ok(Math.abs(seat.ground - (t.cab + 1.2)) < 1e-9 && seat.inside === "atr220")
  // Regression: the ears fell to the valley floor under the deck (no vehicle had the listener's id).
  assert.ok(seat.ground - groundZ(cab.x, cab.y) > 15, `${seat.ground - groundZ(cab.x, cab.y)}`)
})

test("the player hears their own train through its cab: its engines from under the end cars, the near one louder, dulled", () => {
  const t = train(1, OPEN, { v: FAST, power: 1 }, true),
    director = rig()
  director.hear(world(beside(OPEN - 2.5, 0), { trains: [t] }, 1))
  const front = director.held().get("engine:1:0")!,
    rear = director.held().get("engine:1:1")!
  assert.ok(front.at.cutoff <= 1200 && rear.at.cutoff <= 1200)
  assert.ok(front.at.gain > rear.at.gain)
  assert.ok(director.held().get("rails:1")!.at.cutoff <= 1200)
})

// Regression: heard through the cab's 24 dB as the 97 dB sources they are outside, compressed by the mix,
// the train's own engines idled 13.8 dB under the wind bed and the cab played 24–25 dB under a car's seat.
test("from its cab the player's own train idles about as loud as a car's own engine idles, over the wind, and runs louder", () => {
  const plays = (held: ReturnType<ReturnType<typeof rig>["held"]>, key: string, quiet: number) =>
    gainToDb(held.get(key)!.at.gain) - quiet
  const seat = rig(),
    panda = car(1, "panda", MEADOW, { mine: true })
  seat.hear(world(MEADOW, { vehicles: [panda] }, 1), 240)
  const carIdle = plays(seat.held(), "engine:1", engineQuiet("panda", panda.rpm, panda.load))
  const cab = (power: number, v: number) => {
    const director = rig()
    director.hear(world(beside(OPEN - 2.5, 0), { trains: [train(1, OPEN, { v, power }, true)] }, 1))
    return director.held()
  }
  const idle = trainRevs(TRAINS.atr220.engine, 0),
    idling = cab(0, 0)
  const packIdle = plays(idling, "engine:1:0", engineQuiet("atr220", idle.rpm, idle.load))
  assert.ok(packIdle > carIdle - 3, `the cab idles at ${packIdle} dB, a car's seat at ${carIdle}`)
  assert.ok(packIdle > plays(idling, "wind", 0) + 3, "the engines over the wind")
  // Under full power the pack plays its nominal: as loud as a car's engine at its redline, dulled by the cab.
  const full = cab(1, FAST).get("engine:1:0")!
  assert.ok(gainToDb(full.at.gain) > packIdle + 6 && full.at.cutoff <= 1200)
})

test("H in a train's cab holds its horn, through the cab; an AI train's whistle 20 m away plays at its cap and echoes", () => {
  const t = train(1, OPEN, {}, true),
    cab = beside(OPEN - 2.5, 0)
  const director = rig()
  director.hear({ ...world(cab, { trains: [t] }, 1), horn: true })
  const horn = director.held().get("trainHorn:1")
  assert.ok(horn !== undefined && horn.at.cutoff <= 1200 && horn.at.gain > 1)
  director.hear(world(cab, { trains: [t] }, 1))
  assert.equal(director.held().has("trainHorn:1"), false)
  // On foot H sounds no train's horn.
  director.hear({ ...world(cab, { trains: [train(1, OPEN)] }), horn: true })
  assert.equal(director.held().has("trainHorn:1"), false)

  const at = away(MEADOW, 20)
  const ai = rig()
  ai.hear(
    world(MEADOW, {
      happenings: [
        { kind: "whistle", train: 9, x: at.x, y: at.y, z: groundZ(at.x, at.y), urgent: true },
      ],
    }),
  )
  const [direct] = ai.take("trainHonk")
  assert.ok(direct?.sound.kind === "trainHonk" && direct.sound.urgent)
  // Regression: 130 dB at 1 m, it played 14 dB over gain 1 from here.
  assert.ok(Math.abs(direct.at.gain - dbToGain(MOST_DB.trainHonk)) < 1e-9, `${direct.at.gain}`)
  assert.ok(echoes(direct.sound))
})

// Regression: played at the box's centre, Via Riolo's bell came 15.6 dB over its level at the posts there and ducked the whole
// mix 8.8 dB on every stroke.
test("a level crossing's bell is no louder at its box's centre than at its arms' posts, where its bells stand", () => {
  const box = CROSSINGS[RIOLO]!,
    ringing = heardCrossings(
      CROSSINGS.map(() => ({ phase: "warning" as const, since: 0, from: 0, demanded: 0 })),
      10,
    ).filter((c) => c.id === RIOLO)
  const at = (p: { readonly x: number; readonly y: number }) => {
    const director = rig()
    director.hear(world(p, { crossings: ringing }))
    return gainToDb(director.held().get(`plBell:${RIOLO}`)!.at.gain)
  }
  const posts = ringing[0]!.posts,
    centre = at(box),
    out = at(away(box, posts))
  assert.ok(posts > 3, `its posts ${posts.toFixed(1)} m out`)
  assert.ok(
    centre - out < 1.5,
    `centre ${centre.toFixed(1)} dB, ${posts.toFixed(1)} m out ${out.toFixed(1)} dB`,
  )
  assert.ok(at(away(box, 3 * posts)) < out - 6, "and fades beyond them")
})

test("a level crossing's bell rings from its box while it says so, one voice per box, two at most", () => {
  const box = (id: number, metres: number, ringing = true) => ({
    id,
    ...away(MEADOW, metres),
    posts: 5,
    ringing,
  })
  const director = rig()
  director.hear(world(MEADOW, { crossings: [box(0, 30)] }))
  const bell = director.held().get("plBell:0")
  assert.ok(bell?.sound.kind === "plBell" && bell.at.pan > 0)
  director.hear(world(MEADOW, { crossings: [box(0, 30, false)] }))
  assert.equal(director.held().has("plBell:0"), false)
  director.hear(world(MEADOW, { crossings: [box(0, 30), box(1, 40), box(2, -50)] }))
  assert.equal(
    [...director.held().keys()].filter((k) => k.startsWith("plBell")).length,
    CAPS.plBell,
  )
})

// Regression: the wind bed blew in the bore as loud as the own wheels, and they lost 4.5 dB to the ground
// effect, the path's ends both under the terrain.
test("riding through a tunnel no wind, rain or crickets play, and the own wheels roll as loud as in the open", () => {
  const ride = (s: number) => {
    const director = rig()
    director.hear(
      world(beside(s - 2.5, 0), { trains: [train(1, s, { v: FAST, power: 1 }, true)] }, 1),
    )
    return director.held()
  }
  const bore = ride(1900),
    open = ride(OPEN)
  assert.ok(open.has("wind"))
  assert.deepEqual(
    ["wind", "rain", "roof", "crickets"].filter((k) => bore.has(k)),
    [],
  )
  const wheels = (held: typeof bore) => gainToDb(held.get("rails:1")!.at.gain)
  assert.ok(Math.abs(wheels(bore) - wheels(open)) < 0.5, `${wheels(bore)} ${wheels(open)}`)
})

// Regression: a train wholly in a tunnel radiated its whole length from one portal, and none of it while a
// car was in the open, so the wheels jumped 2.4–2.8 dB as its last car went in, and fell 9–16 dB as its nose left a short tunnel.
test("a train's wheels roll on with no jump as its cars pass into and out of a tunnel's portals", () => {
  for (const tunnel of LINE.tunnels.filter((t) => t.to - t.from < 300))
    for (const portal of [tunnel.from, tunnel.to])
      for (const off of [20, 40, 60]) {
        const ears = { ...beside(portal - 15, off), vx: 0, vy: 0, right: { x: 1, y: 0 } }
        const z = groundZ(ears.x, ears.y) + 1.6
        let last: number | undefined
        for (let s = portal - 20; s <= portal + 80; s += FAST / 60) {
          const rolling = rollingOf({ ...ears, z }, train(1, s, { v: FAST }))
          const { source } = rolling!,
            r = Math.hypot(source.x - ears.x, source.y - ears.y, source.z - z)
          const level = rolling!.level.db - rolling!.loss - spreading(r, rolling!.level.rMin)
          if (last !== undefined)
            assert.ok(
              Math.abs(level - last) < 1,
              `${(level - last).toFixed(2)} dB at s ${s.toFixed(1)}, ${off} m off the portal at ${portal}`,
            )
          last = level
        }
      }
})

test("a train deep in the long tunnel is not heard through 440 m of hill; one in a short tunnel is heard from its portal, not through the hill over it", () => {
  const deep = 1900,
    over = pointAt(LINE, deep)
  const director = rig()
  director.hear(world(over, { trains: [train(1, deep, { v: FAST, power: 1 })] }))
  // Regression: through the hill its wheels and engines were only 15 dB down.
  assert.deepEqual(
    [...director.held().keys()].filter((k) => /^(engine:1:|rails:1|brakes:1)/.test(k)),
    [],
  )

  // Over the middle of the 271 m tunnel past Equi Terme, 37 m of rock over it: the train wholly in the tunnel, its nose 60 m on
  // toward +s, each car heard at its nearer portal.
  const tunnel = LINE.tunnels.find((t) => t.to - t.from > 250 && t.to - t.from < 300)!,
    middle = (tunnel.from + tunnel.to) / 2
  const t = train(1, middle + 60, { v: FAST, power: 1 }),
    top = pointAt(LINE, middle)
  // A view whose screen-right runs along the line, so the portals sit hard left and right of the ears.
  const yaw = followYaw(top.angle + Math.PI / 2),
    right = axesAt(yaw).right
  assert.ok(right.x * Math.cos(top.angle) + right.y * Math.sin(top.angle) > 0.99)
  const short = rig(),
    heard = world(top, { trains: [t] })
  short.hear({ ...heard, listener: { ...heard.listener, yaw } })
  const rails = short.held().get("rails:1")
  assert.ok(rails !== undefined, "heard")
  const portals = [tunnel.from, tunnel.to].map((s) => {
    const p = pointAt(LINE, s)
    return panOf(p.x - top.x, p.y - top.y, right)
  })
  assert.ok(Math.abs(Math.abs(rails.at.pan) - 0.85) < 0.05, `${rails.at.pan} ${portals}`)
  // Its cab's power pack, 85 m from the nearer portal, through it: quieter than straight through the 37 m of rock over it.
  const open = rig()
  open.hear({
    ...heard,
    trains: [{ ...t, cars: t.cars.map((car) => ({ ...car, tunnel: false })) }],
    listener: { ...heard.listener, yaw },
  })
  const through = gainToDb(open.held().get("engine:1:0")!.at.gain),
    portal = gainToDb(short.held().get("engine:1:0")?.at.gain ?? 0)
  assert.ok(portal < through - 3, `${portal} ${through}`)
})

// Regression: rewritten as the car's own wall hit, the crash lost the train, so the player driving it heard
// it through the cab at −2.6 dB with a 1.2 kHz lowpass, where their own car's crash plays open at the cap.
test("a car the player's own train strikes crashes and grinds along it as the player's own hit: open, the crash at its cap", () => {
  const t = train(1, OPEN, { v: FAST }, true),
    cab = beside(OPEN - 2.5, 0),
    at = beside(OPEN - 1, 1.6)
  const hit = (speed: number) => ({
    kind: "impact" as const,
    hit: "wall" as const,
    x: at.x,
    y: at.y,
    speed,
    mass: 1,
    car: 7,
    other: 1,
    material: "sheet" as const,
    body: { model: "panda" as const, zone: "side" as const },
  })
  const director = rig()
  director.hear(world(cab, { trains: [t], happenings: [hit(20)] }, 1))
  const [crash] = director.take("crash")
  assert.ok(crash?.at.cutoff === 20000, `${crash?.at.cutoff}`)
  assert.ok(Math.abs(crash.at.gain - dbToGain(MOST_DB.crash)) < 1e-9, `${crash.at.gain}`)
  // Dragged along beside the train it grinds, a soft contact a step, heard as the player's own car's scrape.
  const dragged = car(7, "panda", at, { vx: FAST, vy: 0 })
  director.hear(world(cab, { trains: [t], vehicles: [dragged], happenings: [hit(1)] }, 1))
  assert.equal(director.held().get("scrape:7")?.at.cutoff, 20000)
})

test("a vehicle's crash into a train rings its steel, not the wall beside it; a person a train strikes thuds and groans", () => {
  const director = rig()
  director.hear(
    world(away(HOUSE_WALL, 10), {
      happenings: [
        {
          kind: "impact",
          hit: "wall",
          x: HOUSE_WALL.x,
          y: HOUSE_WALL.y,
          speed: 10,
          mass: 1.015,
          car: 1,
          material: "sheet",
          body: { model: "panda", zone: "front" },
        },
      ],
    }),
  )
  const [crash] = director.take("crash")
  assert.ok(
    crash?.sound.kind === "crash" &&
      crash.sound.against.kind === "wall" &&
      crash.sound.against.material === "sheet",
  )
  const at = away(MEADOW, 10),
    hurt = rig()
  hurt.hear(
    world(MEADOW, {
      people: [person(5, at, { down: true })],
      happenings: [
        { kind: "impact", hit: "person", x: at.x, y: at.y, speed: 15, mass: 108, car: 1, other: 5 },
      ],
    }),
  )
  assert.equal(hurt.take("thud").length, 1)
  assert.equal(hurt.take("groan").length, 1)
})
