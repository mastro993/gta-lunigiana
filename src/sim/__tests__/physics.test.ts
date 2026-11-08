import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { hullDown, overturned, RIGS, settle, uprightness, wheelsAt } from "../chassis.ts"
import { gearFor } from "../drivetrain.ts"
import type { Ground } from "../dynamics.ts"
import type { Surface } from "../map/surface.ts"
import { advance, rests, settles } from "../systems/physics.ts"
import { drive, DT, flat, forward, type DriveState as State, type Pedals } from "../testing.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../vehicles.ts"

const kmh = (s: State) => forward(s) * 3.6
const full = (): Pedals => ({ throttle: 1, steer: 0, handbrake: false })
/** Holds `speed` with the throttle, steering `steer` from frame 30. */
const holding =
  (speed: number, steer: number) =>
  (frame: number, s: State): Pedals => ({
    throttle: Math.max(-1, Math.min(1, (speed - forward(s)) * 0.5)),
    steer: frame > 30 ? steer : 0,
    handbrake: false,
  })

test("acceleration and top speed come from each engine, gearbox and drag (published: Panda 0–100 km/h 14.2 s, 164 km/h; Giulia 6.6 s, 235 km/h; Ape 37–45 km/h; truck held to 90 km/h)", () => {
  const timed = (model: VehicleModel, mark: number) => {
    let at = -1,
      top = 0
    drive(model, 60 * 120, full, {
      each: (frame, s) => {
        top = Math.max(top, kmh(s))
        if (at < 0 && kmh(s) >= mark) at = frame / 60
      },
    })
    return { at, top }
  }
  const panda = timed("panda", 100),
    giulia = timed("carabinieri", 100),
    ape = timed("ape", 30),
    truck = timed("truck", 50)
  assert.ok(
    panda.at > 11 && panda.at < 15.5 && panda.top > 155 && panda.top < 175,
    `Panda ${JSON.stringify(panda)}`,
  )
  assert.ok(
    giulia.at > 6 && giulia.at < 7.5 && giulia.top > 225 && giulia.top < 250,
    `Giulia ${JSON.stringify(giulia)}`,
  )
  assert.ok(ape.top > 37 && ape.top < 46, `Ape ${JSON.stringify(ape)}`)
  assert.ok(
    truck.at > 12 && truck.at < 18 && Math.abs(truck.top - 90) < 1,
    `truck ${JSON.stringify(truck)}`,
  )
})

test("braking: ABS stops a Panda from 100 km/h in about 40 m without locking a wheel, the Ape's drums lock, and loose ground stops longer", () => {
  const stop = (model: VehicleModel, speed: number, surface: Surface) => {
    let distance = -1,
      locked = 0
    drive(model, 60 * 12, () => ({ throttle: -1, steer: 0, handbrake: false }), {
      speed,
      surface,
      each: (_, s, r) => {
        if (distance < 0) for (const skid of r.skids) locked = Math.max(locked, skid.amount)
        if (distance < 0 && forward(s) < 0.3) distance = s.pose.x
      },
    })
    return { distance, locked }
  }
  const panda = stop("panda", 27.8, "asphalt")
  assert.ok(panda.distance > 36 && panda.distance < 48, `Panda ${JSON.stringify(panda)}`)
  assert.ok(panda.locked <= 0.25, "ABS: at most the faint marks of a wheel held at its limit")
  assert.equal(stop("ape", 11, "asphalt").locked, 1, "the Ape locks its wheels")
  const gravel = stop("panda", 27.8, "gravel"),
    grass = stop("panda", 27.8, "grass")
  assert.ok(
    gravel.distance > panda.distance * 1.3 && grass.distance > gravel.distance,
    `gravel ${gravel.distance} m, grass ${grass.distance} m`,
  )
})

test("cornering: a car held at full lock turns at about its grip and stays on its wheels; the laden truck tips over flung into a full-lock turn fast, the Ape into a handbrake turn at its top speed", () => {
  for (const model of ["panda", "carabinieri"] as const)
    for (const speed of [8, 12, 18, 26]) {
      let lowest = 1,
        lateral = 0
      drive(model, 300, holding(speed, 1), {
        speed,
        each: (frame, s) => {
          lowest = Math.min(lowest, uprightness(s.chassis))
          if (frame === 299) lateral = (Ops.hypot(s.motion.vx, s.motion.vy) * s.motion.spin) / 9.81
        },
      })
      assert.ok(lowest > 0.98, `${model} at ${speed} m/s stays on its wheels: ${lowest}`)
      assert.ok(lateral > 0.6 && lateral < 1.1, `${model} at ${speed} m/s: ${lateral.toFixed(2)} g`)
    }
  assert.ok(
    !overturned(drive("truck", 300, holding(8, 1), { speed: 8 }).chassis),
    "the truck at 8 m/s stays up",
  )
  for (let speed = 16; speed <= 25; speed++)
    assert.ok(
      overturned(drive("truck", 300, holding(speed, 1), { speed }).chassis),
      `the truck at ${speed} m/s tips over`,
    )
  // Held at full lock the Ape keeps its wheels at every speed it reaches on the flat; a handbrake turn at the top of them rolls it.
  for (const speed of [4, 8, 11])
    assert.ok(
      !overturned(drive("ape", 300, holding(speed, 1), { speed }).chassis),
      `the Ape at ${speed} m/s stays up`,
    )
  const yanked = drive(
    "ape",
    240,
    (frame) => ({ throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 }),
    { speed: 11.5 },
  )
  assert.ok(overturned(yanked.chassis), "the Ape thrown into a handbrake turn at 11.5 m/s")
})

test("rollover thresholds follow the wheels' footprint: the Ape's three wheels and the laden truck's high marble tip first", () => {
  const tipping = Object.fromEntries(VEHICLE_MODELS.map((m) => [m, RIGS[m].tipping]))
  assert.ok(
    tipping.ape! < tipping.truck! &&
      tipping.truck! < tipping.panda! &&
      tipping.panda! < tipping.carabinieri!,
    JSON.stringify(tipping),
  )
  assert.ok(
    Math.abs(tipping.panda! - 0.725 / 0.56) < 1e-9,
    "a four-wheeler: half its track over its centre of mass's height",
  )
})

test("steering: at walking pace full lock turns the centre of mass round each model's turning radius", () => {
  for (const model of VEHICLE_MODELS) {
    let minX = 0,
      maxX = 0
    drive(model, 60 * 12, holding(2, 1), {
      speed: 2,
      each: (frame, s) => {
        if (frame < 120) return
        minX = Math.min(minX, s.pose.x)
        maxX = Math.max(maxX, s.pose.x)
      },
    })
    const radius = (maxX - minX) / 2
    assert.ok(
      Math.abs(radius - VEHICLES[model].turnRadius) < 0.25 * VEHICLES[model].turnRadius,
      `${model}: ${radius.toFixed(2)} m`,
    )
  }
})

test("slopes: the handbrake, or the driver's foot on the brake with no pedal, holds a vehicle on a 20% slope; too little throttle, it rolls back", () => {
  for (const model of VEHICLE_MODELS)
    for (const handbrake of [true, false]) {
      const held = drive(model, 600, () => ({ throttle: 0, steer: 0, handbrake }), {
        ground: (x) => 100 + 0.2 * x,
      })
      assert.ok(
        Ops.hypot(held.pose.x, held.pose.y) < 0.15,
        `${model} (handbrake ${handbrake}) crept ${Ops.hypot(held.pose.x, held.pose.y)} m`,
      )
    }
  // The Ape's 1.8 kW at a whisper of throttle cannot hold 20%.
  const ape = drive("ape", 180, () => ({ throttle: 0.05, steer: 0, handbrake: false }), {
    ground: (x) => 100 + 0.2 * x,
  })
  assert.ok(forward(ape) < -0.3, `rolls back at ${forward(ape)} m/s`)
})

test("surfaces: full throttle from rest spins a Panda's front wheels on gravel, not on asphalt; it climbs 15% on asphalt and barely creeps up it on grass", () => {
  const spinning = (surface: Surface) => {
    let frames = 0
    drive("panda", 120, full, {
      surface,
      each: (_, __, r) => {
        if (r.skids.some((skid) => skid.amount > 0.5)) frames++
      },
    })
    return frames
  }
  assert.equal(spinning("asphalt"), 0)
  assert.ok(spinning("gravel") > 60, "gravel")
  const climb = (surface: Surface) =>
    forward(drive("panda", 600, full, { surface, ground: (x) => 100 + 0.15 * x }))
  assert.ok(climb("asphalt") > 12, `asphalt ${climb("asphalt")} m/s`)
  assert.ok(climb("grass") < 2, `grass ${climb("grass")} m/s`)
})

test("handbrake: at 15 m/s the locked rear wheels slide and the car swings round", () => {
  let sliding = 0
  const end = drive(
    "panda",
    120,
    (frame) => ({ throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 }),
    {
      speed: 15,
      each: (_, __, r) => {
        if (
          r.skids.filter((skid, i) => !RIGS.panda.wheels[i]!.steered && skid.amount === 1)
            .length === 2
        )
          sliding++
      },
    },
  )
  assert.ok(sliding > 60, `${sliding} frames with both rear wheels sliding`)
  assert.ok(end.pose.angle > Math.PI / 2, `turned ${end.pose.angle} rad`)
})

test("jumps: off a 30% kicker into a 2 m drop at 10 m/s every model leaves the ground and lands on its wheels, the landing a ground hit on its underbody", () => {
  const kicker: Ground = (x) => (x < 30 ? 100 : x < 34 ? 100 + (x - 30) * 0.3 : 99.2)
  for (const model of VEHICLE_MODELS) {
    let flying = 0,
      longest = 0,
      landing = 0
    const end = drive(
      model,
      360,
      (frame, s) =>
        frame < 120 ? holding(10, 0)(frame, s) : { throttle: 0, steer: 0, handbrake: false },
      {
        speed: 10,
        ground: kicker,
        each: (_, __, r) => {
          flying = r.grounded === 0 ? flying + 1 : 0
          longest = Math.max(longest, flying)
          if (r.hit?.face === "under") landing = Math.max(landing, r.hit.speed)
        },
      },
    )
    assert.ok(longest > 20, `${model} airborne ${longest} frames`)
    assert.ok(landing > 3, `${model} landed at ${landing} m/s`)
    assert.ok(uprightness(end.chassis) > 0.95, `${model} on its wheels`)
  }
})

test("overturned: a car on its roof rests there and its wheels drive nothing", () => {
  const roof = drive("panda", 600, full, { chassis: { roll: Math.PI, z: 101.2 } })
  assert.ok(overturned(roof.chassis))
  assert.ok(
    Ops.hypot(roof.pose.x, roof.pose.y) < 0.05,
    `moved ${Ops.hypot(roof.pose.x, roof.pose.y)} m`,
  )
  assert.ok(
    Math.abs(roof.chassis.z - 100 - (VEHICLES.panda.height - VEHICLES.panda.cg)) < 0.05,
    `resting at ${roof.chassis.z} m`,
  )
  assert.ok(
    [
      roof.motion.vx,
      roof.motion.vy,
      roof.chassis.vz,
      roof.chassis.rollRate,
      roof.chassis.pitchRate,
    ].every((v) => Math.abs(v) < 0.05),
    "at rest: the physics lets it sleep",
  )
})

// Regression: the body's corners looked up their ground at their own height, so inside a tunnel the roof met the hillside above and
// threw the car 16 m into the air at the portal.
test("tunnels: a car drives in under the hillside and stays on the tunnel's floor", () => {
  // From x = 30 a tunnel: its floor at 100 m, the hillside 3.5 m over it; the ground nearest the asked height wins, as `groundZ` does.
  const tunnel: Ground = (x, _y, near) =>
    x < 30 ? 100 : near === undefined || Math.abs(near - 103.5) < Math.abs(near - 100) ? 103.5 : 100
  for (const model of VEHICLE_MODELS) {
    let worst = 0,
      hits = 0
    drive(model, 300, holding(8, 0), {
      speed: 8,
      ground: tunnel,
      each: (_, s, r) => {
        worst = Math.max(worst, Math.abs(s.chassis.z - 100 - VEHICLES[model].cg))
        if (r.hit !== undefined) hits++
      },
    })
    assert.ok(worst < 0.15 && hits === 0, `${model}: ${worst} m off the floor, ${hits} ground hits`)
  }
})

// Regression: pitch and roll grew without bound, so a car that rolled all the way round read roll 2π (an AI driver "leaning" for ever),
// and one that flipped end over end drove tail first.
test("tumbling: a full roll reads roll 0, and a car flipped end over end drives nose first", () => {
  const rolled = drive("panda", 1, () => ({ throttle: 0, steer: 0, handbrake: true }), {
    chassis: { roll: 2 * Math.PI },
  })
  assert.ok(Math.abs(rolled.chassis.roll) < 0.01, `roll ${rolled.chassis.roll}`)
  const flipped = drive(
    "panda",
    120,
    (frame) => ({ throttle: frame > 10 ? 1 : 0, steer: 0, handbrake: false }),
    { chassis: { pitch: Math.PI, roll: Math.PI } },
  )
  assert.ok(
    Math.abs(flipped.chassis.pitch) < 0.1 && Math.abs(flipped.chassis.roll) < 0.1,
    `pitch ${flipped.chassis.pitch}, roll ${flipped.chassis.roll}`,
  )
  assert.ok(forward(flipped) > 2, `drives nose first: ${forward(flipped)} m/s`)
})

// Regression: the body's corners pushed straight up, so a car lying on its roof or side never slid down any slope.
test("a car on its roof slides down a slope steeper than its sliding friction (0.6) and stays on a gentler one", () => {
  const onRoof = (grade: number) => {
    const tilt = Ops.atan(grade),
      top = VEHICLES.panda.height - VEHICLES.panda.cg
    return drive("panda", 600, () => ({ throttle: 0, steer: 0, handbrake: true }), {
      ground: (x) => 100 + grade * x,
      chassis: { roll: Math.PI, pitch: tilt, z: 100 + top / Ops.cos(tilt) + 0.02 },
    }).pose.x
  }
  assert.ok(onRoof(0.7) < -5, `70%: ${onRoof(0.7)} m`)
  assert.ok(onRoof(0.3) > -0.5, `30%: ${onRoof(0.3)} m`)
})

// Regression: hullDown counted a corner within 5 cm of the ground as down, so the Giulia's bump stops (5 cm under its clearance) ground.
test("wheelsAt: every model settled on level ground at 100 m has its wheels' ground there", () => {
  for (const model of VEHICLE_MODELS)
    assert.equal(
      wheelsAt(
        VEHICLES[model],
        settle(model, { x: 0, y: 0, angle: 0 }, () => 100),
      ),
      100,
    )
})

test("hullDown: a Giulia on its bump stops over a hump or landing from 0.4 m keeps its body off the ground; one on its roof has it down", () => {
  const ground: Ground = (x) => (x > 12 && x < 13 ? 100.12 : 100)
  // Its corners come within 2.6 cm of the ground from 0.4 m; from 0.6 m they touch, and the belly grinds.
  for (const drop of [0, 0.4]) {
    let down = 0,
      bottomed = 0
    drive("carabinieri", 120, () => ({ throttle: 0, steer: 0, handbrake: false }), {
      speed: drop === 0 ? 8 : 10,
      ground: drop === 0 ? ground : flat,
      chassis: { z: 100 + VEHICLES.carabinieri.cg + drop },
      each: (_, s, r) => {
        if (hullDown("carabinieri", s.pose, s.chassis, drop === 0 ? ground : flat)) down++
        if (r.hit?.face === "under") bottomed++
      },
    })
    assert.equal(down, 0, `dropped ${drop} m (${bottomed} steps bottomed out)`)
  }
  const top = VEHICLES.carabinieri.height - VEHICLES.carabinieri.cg
  const roof = drive("carabinieri", 60, () => ({ throttle: 0, steer: 0, handbrake: false }), {
    chassis: { roll: Math.PI, pitch: 0, z: 100 + top },
  })
  assert.equal(hullDown("carabinieri", roof.pose, roof.chassis, flat), true)
})

// Regression: a corner by a deck's edge measured the drop past it as a slope, so a car on its roof slid off a bridge into the river.
test("a car on its roof by the edge of a 6 m deck, every corner on it, stays on the deck", () => {
  const top = VEHICLES.panda.height - VEHICLES.panda.cg
  // The deck's middle 2.13 m to the right: its left edge 4.5 cm past the car's, nearer than the corners' slope samples reach.
  const deck: Ground = (_, y) => (Math.abs(y + 2.13) <= 3 ? 110 : 100)
  const end = drive("panda", 600, () => ({ throttle: 0, steer: 0, handbrake: true }), {
    ground: deck,
    chassis: { roll: Math.PI, pitch: 0, z: 110 + top + 0.02 },
  })
  assert.ok(
    Math.abs(end.pose.y) < 0.1 && end.chassis.z > 110,
    `at y ${end.pose.y}, z ${end.chassis.z}`,
  )
})

// Regression: a corner on a face steeper than the step test's reach read it as flat ground, and its push out of the face launched the car.
test("a car driven into a 400% bank stops against it rather than being thrown into the air", () => {
  for (const grade of [4, 8]) {
    const bank: Ground = (x) => 100 + grade * Math.max(0, x - 5)
    let rise = 0
    drive("panda", 120, () => ({ throttle: 0, steer: 0, handbrake: false }), {
      speed: 12,
      ground: bank,
      each: (_, s) => {
        rise = Math.max(rise, s.chassis.z - bank(s.pose.x, s.pose.y) - VEHICLES.panda.cg)
      },
    })
    assert.ok(rise < 1, `${grade * 100}%: ${rise} m up`)
  }
})

// Regression: a vehicle slept on its first still step, so one that stopped on a bank its brakes could not hold froze there.
test("sleep: a vehicle settles only after two still steps, and never while it gathers speed", () => {
  const rates = { vz: 0, pitchRate: 0, rollRate: 0 }
  assert.equal(
    settles({ vx: 0.3, vy: 0 }, { vx: 0.01, vy: 0, spin: 0 }, rates),
    false,
    "the first still step",
  )
  assert.equal(
    settles({ vx: 0.01, vy: 0 }, { vx: 0.012, vy: 0, spin: 0 }, rates),
    true,
    "two still steps",
  )
  assert.equal(
    settles({ vx: 0.001, vy: 0 }, { vx: 0.03, vy: 0, spin: 0 }, rates),
    false,
    "gathering speed",
  )
  assert.equal(
    settles({ vx: 0.01, vy: 0 }, { vx: 0.01, vy: 0, spin: 0 }, { ...rates, rollRate: 0.2 }),
    false,
    "still rocking",
  )
})

// Regression: a car coasting up a bank its brakes could not hold fell asleep where its speed crossed zero, and hung there for good.
test("sleep: a car coasting up a 50% grass bank stops and slides back down; on 50% asphalt its brakes hold it and it sleeps", () => {
  const ramp: Ground = (x) => 100 + 0.5 * x
  const coast = (surface: Surface, speed: number) => {
    let state: State = {
      pose: { x: 0, y: 0, angle: 0 },
      motion: { vx: speed, vy: 0, spin: 0 },
      chassis: {
        ...settle("panda", { x: 0, y: 0, angle: 0 }, ramp),
        gear: gearFor(VEHICLES.panda, speed),
      },
    }
    const idle = { throttle: 0, steer: 0, handbrake: false }
    for (let frame = 0; frame < 900; frame++) {
      const { body, steer, gearbox } = advance("panda", state, idle, frame, DT, ramp, () => surface)
      const next = {
        pose: { x: body.x, y: body.y, angle: body.angle },
        motion: { vx: body.vx, vy: body.vy, spin: body.spin },
        chassis: {
          z: body.z,
          vz: body.vz,
          pitch: body.pitch,
          pitchRate: body.pitchRate,
          roll: body.roll,
          rollRate: body.rollRate,
          steer,
          ...gearbox,
        },
      }
      // VehiclePhysics's sleep test, wall-free.
      if (
        settles(state.motion, next.motion, next.chassis) &&
        rests("panda", next, idle, frame, DT, ramp, () => surface)
      )
        return { slept: true, x: next.pose.x }
      state = next
    }
    return { slept: false, x: state.pose.x }
  }
  for (const speed of [1.5, 3.5, 7, 11.5]) {
    const grass = coast("grass", speed)
    assert.ok(!grass.slept || grass.x < 0, `grass from ${speed} m/s: asleep at x ${grass.x}`)
  }
  assert.equal(coast("asphalt", 8).slept, true, "asphalt holds")
})

// Regression: the body's friction on the ground lets a car on its roof creep a few mm/s downhill, and the rest trial read that as a slide.
test("sleep: a car on its roof on a 10–30% slope its sliding friction holds goes to sleep", () => {
  const idle = { throttle: 0, steer: 0, handbrake: false },
    top = VEHICLES.panda.height - VEHICLES.panda.cg
  for (const grade of [0.1, 0.2, 0.3]) {
    const ramp: Ground = (x) => 100 + grade * x,
      tilt = Ops.atan(grade)
    let state: State = {
      pose: { x: 0, y: 0, angle: 0 },
      motion: { vx: 0, vy: 0, spin: 0 },
      chassis: {
        ...settle("panda", { x: 0, y: 0, angle: 0 }, ramp),
        roll: Math.PI,
        pitch: tilt,
        z: 100 + top / Ops.cos(tilt),
      },
    }
    let slept: number | undefined
    for (let frame = 0; frame < 300 && slept === undefined; frame++) {
      const { body, steer, gearbox } = advance("panda", state, idle, frame, DT, ramp)
      const next = {
        pose: { x: body.x, y: body.y, angle: body.angle },
        motion: { vx: body.vx, vy: body.vy, spin: body.spin },
        chassis: {
          z: body.z,
          vz: body.vz,
          pitch: body.pitch,
          pitchRate: body.pitchRate,
          roll: body.roll,
          rollRate: body.rollRate,
          steer,
          ...gearbox,
        },
      }
      if (
        settles(state.motion, next.motion, next.chassis) &&
        rests("panda", next, idle, frame, DT, ramp)
      )
        slept = frame
      state = next
    }
    assert.ok(slept !== undefined, `${grade * 100}%: still awake after 5 s, ${state.pose.x} m down`)
  }
})
