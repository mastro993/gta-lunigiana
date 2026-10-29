import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { overturned, settle, uprightness } from "../chassis.ts"
import { UNDAMAGED } from "../damage.ts"
import type { Ground } from "../dynamics.ts"
import {
  clampKnob,
  DEFAULT_HANDLING,
  HANDLING,
  HANDLING_KEYS,
  HANDLING_PRESETS,
  type HandlingKey,
  type HandlingValue,
  PRESET_IDS,
  presetOf,
  REAL_HANDLING,
} from "../handling.ts"
import type { Surface } from "../map/surface.ts"
import {
  CarInput,
  Chassis,
  Damage,
  Game,
  Motion,
  Pose,
  PrevPose,
  SetHandling,
  Vehicle,
} from "../schema.ts"
import type { GroundWeather } from "../sky/local.ts"
import { drive, forward, jsonSave, ON_BATTISTI, rolling, start } from "../testing.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"

/** `REAL_HANDLING` with `knobs` changed. */
const With = (knobs: Partial<Record<HandlingKey, number>>) => ({ ...REAL_HANDLING, ...knobs })
const coast = { throttle: 0, steer: 0, handbrake: false }
const full = { throttle: 1, steer: 0, handbrake: false }

/** Metres a `model` takes to stop from `speed` m/s on `surface` (dry, or as wet and snowy as `weather`) with the pedal floored backwards. */
const stopping = (
  model: VehicleModel,
  speed: number,
  surface: Surface,
  knobs: Partial<Record<HandlingKey, number>>,
  weather?: GroundWeather,
) => {
  let stopped: number | undefined
  drive(model, 600, () => ({ throttle: -1, steer: 0, handbrake: false }), {
    speed,
    surface,
    weather,
    handling: With(knobs),
    each: (_, s) => {
      if (stopped === undefined && forward(s) <= 0.1) stopped = s.pose.x
    },
  })
  return stopped ?? Infinity
}

test("knobs: each has a group, a name, a description of its effect, a range holding its real value, and a step", () => {
  assert.deepEqual(
    [...HANDLING_KEYS].sort(),
    Object.keys(REAL_HANDLING).sort(),
    "a real value for every knob",
  )
  for (const key of HANDLING_KEYS) {
    const { group, label, description, kind, min, max, step } = HANDLING[key]
    assert.ok(group.length > 0 && label.length > 0, key)
    assert.ok(
      description.length >= 60 && description.endsWith("."),
      `${key}: describe what changing it does`,
    )
    assert.ok(
      min <= REAL_HANDLING[key] && REAL_HANDLING[key] <= max && step > 0,
      `${key}: the real value inside its range`,
    )
    assert.equal(
      clampKnob(key, DEFAULT_HANDLING[key]),
      DEFAULT_HANDLING[key],
      `${key}: the default inside its range`,
    )
    if (kind === "switch") assert.deepEqual([min, max, step], [0, 1, 1], key)
  }
})

test("presets: simulation is the real data, a new game starts on balanced, and each preset is a valid set of knobs it is known by", () => {
  assert.deepEqual(HANDLING_PRESETS.simulation.values, REAL_HANDLING)
  assert.deepEqual(start().world().handling, HANDLING_PRESETS.balanced.values)
  assert.equal(DEFAULT_HANDLING.looseGround, 0.5)
  for (const id of PRESET_IDS) {
    const { label, description, values } = HANDLING_PRESETS[id]
    assert.ok(label.length > 0 && description.length >= 60, id)
    for (const key of HANDLING_KEYS)
      assert.equal(clampKnob(key, values[key]), values[key], `${id}: ${key} in range`)
    assert.equal(presetOf(values), id)
  }
  assert.equal(presetOf(With({ grip: 1.05 })), undefined, "a knob set by hand is no preset")
})

/** Whether `model` rolls over driven at `kmh` under `handling`: holding the speed at full lock, or in a handbrake turn. */
const rolls = (
  model: VehicleModel,
  kmh: number,
  handling: HandlingValue,
  how: "lock" | "handbrake",
) => {
  const v = kmh / 3.6
  let over = false
  drive(
    model,
    how === "lock" ? 600 : 240,
    (frame, s) =>
      how === "lock"
        ? {
            throttle: Math.max(-1, Math.min(1, (v - forward(s)) * 0.5)),
            steer: frame > 30 ? 1 : 0,
            handbrake: false,
          }
        : { throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 },
    {
      speed: v,
      handling,
      each: (_, s) => {
        over ||= overturned(s.chassis)
      },
    },
  )
  return over
}

test("presets: from simulation to arcade a Panda accelerates harder and stops shorter, on gravel most of all", () => {
  const zeroTo100 = (handling: HandlingValue) => {
    let at = Infinity
    drive("panda", 1200, () => full, {
      handling,
      each: (frame, s) => {
        if (at === Infinity && forward(s) >= 100 / 3.6) at = frame
      },
    })
    return at
  }
  const {
    simulation: { values: sim },
    balanced: { values: balanced },
    arcade: { values: arcade },
  } = HANDLING_PRESETS
  assert.ok(zeroTo100(arcade) < zeroTo100(balanced) && zeroTo100(balanced) < zeroTo100(sim))
  const gravel = (handling: HandlingValue) => stopping("panda", 100 / 3.6, "gravel", handling)
  assert.ok(
    gravel(arcade) < gravel(balanced) && gravel(balanced) < gravel(sim) * 0.75,
    `${gravel(sim)}, ${gravel(balanced)}, ${gravel(arcade)} m`,
  )
})

test("presets: in simulation the Ape and the truck roll over in sharp turns; balanced keeps the cars upright but the Ape still tips in a hard handbrake turn; arcade tips nothing", () => {
  const { simulation, balanced, arcade } = HANDLING_PRESETS
  assert.equal(rolls("ape", 42, simulation.values, "handbrake"), true)
  assert.equal(rolls("truck", 70, simulation.values, "lock"), true)
  for (const model of ["panda", "carabinieri"] as const)
    for (const kmh of [30, 60, 90]) {
      assert.equal(
        rolls(model, kmh, balanced.values, "lock") ||
          rolls(model, kmh, balanced.values, "handbrake"),
        false,
        `balanced ${model} at ${kmh} km/h`,
      )
    }
  assert.equal(rolls("ape", 42, balanced.values, "handbrake"), true, "the Ape near its top speed")
  assert.equal(
    rolls("truck", 88, balanced.values, "lock"),
    true,
    "the laden truck at full lock just under its limiter",
  )
  for (const model of ["panda", "carabinieri", "ape", "truck"] as const)
    for (const kmh of [30, 45, 60, 90]) {
      assert.equal(
        rolls(model, kmh, arcade.values, "lock") || rolls(model, kmh, arcade.values, "handbrake"),
        false,
        `arcade ${model} at ${kmh} km/h`,
      )
    }
})

test("knobs: a value is kept inside its knob's range, a switch is on or off, and a non-number is dropped", () => {
  assert.equal(clampKnob("grip", 5), HANDLING.grip.max)
  assert.equal(clampKnob("grip", -1), HANDLING.grip.min)
  assert.equal(clampKnob("grip", 1.3), 1.3)
  assert.equal(clampKnob("abs", 0.7), 1)
  assert.equal(clampKnob("abs", 0.2), 0)
  assert.equal(clampKnob("power", Number.NaN), undefined)
  assert.equal(clampKnob("power", Infinity), undefined)
})

test("grip: more grip stops a Panda shorter on gravel", () => {
  const real = stopping("panda", 100 / 3.6, "gravel", {}),
    more = stopping("panda", 100 / 3.6, "gravel", { grip: 1.5 })
  assert.ok(more < real * 0.8, `${more} m against ${real} m`)
})

test("grip: at ×1.5 a Panda held at full lock at 10 m/s rolls over; halving the weight transfer keeps it upright", () => {
  const tips = (knobs: Partial<Record<HandlingKey, number>>) => {
    let over = false
    drive(
      "panda",
      300,
      (frame, s) => ({
        throttle: Math.max(-1, Math.min(1, (10 - forward(s)) * 0.5)),
        steer: frame > 30 ? 1 : 0,
        handbrake: false,
      }),
      {
        speed: 10,
        handling: With(knobs),
        each: (_, s) => {
          over ||= overturned(s.chassis)
        },
      },
    )
    return over
  }
  assert.equal(tips({}), false, "real: it stays up")
  assert.equal(tips({ grip: 1.5 }), true)
  assert.equal(tips({ grip: 1.5, weightTransfer: 0.5 }), false)
})

test("weather grip loss: a Panda braking from 50 km/h stops about 1.3 times further on a wet road and 3 times on packed snow; at 0 the weather changes nothing", () => {
  const kmh50 = 50 / 3.6,
    wet = { wet: 1, snow: 0 },
    snow = { wet: 0, snow: 1 }
  const dry = stopping("panda", kmh50, "asphalt", {})
  const ratio = (weather: GroundWeather, knobs: Partial<Record<HandlingKey, number>> = {}) =>
    stopping("panda", kmh50, "asphalt", knobs, weather) / stopping("panda", kmh50, "asphalt", knobs)
  // ABS holds the tyres near their peak: the distance goes about as 1 / the peak friction (0.72 wet, 0.27 on snow), less what rolling and the air take.
  assert.ok(ratio(wet) > 1.25 && ratio(wet) < 1.45, `wet: ×${ratio(wet)} of ${dry} m`)
  assert.ok(ratio(snow) > 2.7 && ratio(snow) < 3.7, `snow: ×${ratio(snow)}`)
  assert.ok(
    ratio(wet, { weatherGrip: 0.6 }) < ratio(wet) &&
      ratio(snow, { weatherGrip: 0.6 }) < ratio(snow) / 1.5,
    "balanced's share loses less",
  )
  assert.equal(stopping("panda", kmh50, "asphalt", { weatherGrip: 0 }, wet), dry)
  assert.equal(stopping("panda", kmh50, "asphalt", { weatherGrip: 0 }, snow), dry)
  assert.equal(
    stopping("panda", kmh50, "asphalt", {}, { wet: 0, snow: 0 }),
    dry,
    "dry ground is dry",
  )
})

test("off-road grip loss: at 0 a Panda climbs a 15% grass bank as on asphalt", () => {
  const bank: Ground = (x) => 100 + 0.15 * x
  const climb = (looseGround: number) =>
    forward(
      drive("panda", 600, () => full, {
        ground: bank,
        surface: "grass",
        handling: With({ looseGround }),
      }),
    )
  assert.ok(climb(1) < 2, `real: ${climb(1)} m/s`)
  assert.ok(climb(0) > 12, `none: ${climb(0)} m/s`)
})

test("engine power: doubled, a Panda floored from 20 m/s is faster 5 s on", () => {
  const after = (power: number) =>
    forward(drive("panda", 300, () => full, { speed: 20, handling: With({ power }) }))
  assert.ok(after(2) > after(1) + 3, `${after(2)} against ${after(1)} m/s`)
})

test("brake power: halved, a Panda stops longer from 100 km/h", () => {
  const real = stopping("panda", 100 / 3.6, "asphalt", {}),
    weak = stopping("panda", 100 / 3.6, "asphalt", { brakes: 0.5 })
  assert.ok(weak > real * 1.5, `${weak} m against ${real} m`)
})

test("air drag: without it a Panda coasting from 30 m/s keeps more speed", () => {
  const after = (drag: number) =>
    forward(drive("panda", 300, () => coast, { speed: 30, handling: With({ drag }) }))
  assert.ok(after(0) > after(1) + 1, `${after(0)} against ${after(1)} m/s`)
})

test("ABS on every vehicle: the Ape brakes hard without locking its wheels", () => {
  const locked = (abs: number) => {
    let frames = 0
    drive("ape", 120, () => ({ throttle: -1, steer: 0, handbrake: false }), {
      speed: 11,
      handling: With({ abs }),
      each: (_, __, r) => {
        if (r.skids.some((skid) => skid.amount === 1)) frames++
      },
    })
    return frames
  }
  assert.ok(locked(0) > 10, `real: ${locked(0)} locked frames`)
  assert.equal(locked(1), 0)
})

test("traction control on every vehicle: a Panda floored on gravel does not spin its wheels", () => {
  const spinning = (traction: number) => {
    let frames = 0
    drive("panda", 120, () => full, {
      surface: "gravel",
      handling: With({ traction }),
      each: (_, __, r) => {
        if (r.skids.some((skid) => skid.amount > 0.5)) frames++
      },
    })
    return frames
  }
  assert.ok(spinning(0) > 60, `real: ${spinning(0)} frames`)
  assert.equal(spinning(1), 0)
})

test("steering at speed: doubled, a Panda at 20 m/s turns its wheels further", () => {
  const lock = (steering: number) =>
    drive("panda", 60, () => ({ throttle: 0, steer: 1, handbrake: false }), {
      speed: 20,
      handling: With({ steering }),
    }).chassis.steer
  assert.ok(lock(2) > lock(1) * 1.5, `${lock(2)} against ${lock(1)} rad`)
})

// Design: the steering's lock at speed follows the grip the weather leaves; no test reached physics passing it on.
test("weather grip loss: at 15 m/s a Panda turns its wheels less on a wet road and much less on snow; at 0 the weather changes nothing", () => {
  const lock = (weather?: GroundWeather, knobs: Partial<Record<HandlingKey, number>> = {}) =>
    drive("panda", 30, () => ({ throttle: 0, steer: 1, handbrake: false }), {
      speed: 15,
      weather,
      handling: With(knobs),
    }).chassis.steer
  const dry = lock(),
    wet = { wet: 1, snow: 0 },
    snow = { wet: 0, snow: 1 }
  assert.ok(
    lock(wet) < dry * 0.95 && lock(snow) < dry * 0.75,
    `wet ×${lock(wet) / dry}, snow ×${lock(snow) / dry} of ${dry} rad`,
  )
  assert.equal(lock(wet, { weatherGrip: 0 }), dry)
  assert.equal(lock(snow, { weatherGrip: 0 }), dry)
})

test("steering speed: doubled, the wheels turn twice as far in the first steps", () => {
  const turned = (steeringRate: number) =>
    drive("panda", 5, () => ({ throttle: 0, steer: 1, handbrake: false }), {
      handling: With({ steeringRate }),
    }).chassis.steer
  assert.ok(Math.abs(turned(2) - 2 * turned(1)) < 1e-9, `${turned(2)} against ${turned(1)} rad`)
})

test("weight transfer: at 0 an Ape's handbrake turn at 11.5 m/s no longer tips it over", () => {
  const tips = (weightTransfer: number) => {
    let over = false
    drive(
      "ape",
      240,
      (frame) => ({ throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 }),
      {
        speed: 11.5,
        handling: With({ weightTransfer }),
        each: (_, s) => {
          over ||= overturned(s.chassis)
        },
      },
    )
    return over
  }
  assert.equal(tips(1), true, "real: it tips")
  assert.equal(tips(0), false)
})

test("anti-roll bars: stiffer, a Panda leans less in a steady corner", () => {
  const lean = (antiRoll: number) =>
    Math.abs(
      drive(
        "panda",
        180,
        (frame, s) => ({
          throttle: Math.max(-1, Math.min(1, (14 - forward(s)) * 0.5)),
          steer: frame > 30 ? 0.6 : 0,
          handbrake: false,
        }),
        {
          speed: 14,
          handling: With({ antiRoll }),
        },
      ).chassis.roll,
    )
  assert.ok(lean(3) < lean(1) * 0.8, `${lean(3)} against ${lean(1)} rad`)
})

test("suspension stiffness: stiffer, a Panda braking hard from 20 m/s dives less", () => {
  const dive = (stiffness: number) => {
    let most = 0
    drive("panda", 90, () => ({ throttle: -1, steer: 0, handbrake: false }), {
      speed: 20,
      handling: With({ stiffness }),
      each: (_, s) => {
        most = Math.max(most, Math.abs(s.chassis.pitch))
      },
    })
    return most
  }
  assert.ok(dive(2) < dive(1) * 0.8, `${dive(2)} against ${dive(1)} rad`)
})

test("suspension damping: doubled, a Panda dropped 0.3 m stops bouncing sooner", () => {
  const bounce = (damping: number) => {
    let moving = 0
    drive("panda", 120, () => coast, {
      chassis: { z: 100 + 0.56 + 0.3 },
      handling: With({ damping }),
      each: (frame, s) => {
        if (frame >= 40) moving += Math.abs(s.chassis.vz)
      },
    })
    return moving
  }
  assert.ok(bounce(2) < bounce(1) * 0.6, `${bounce(2)} against ${bounce(1)}`)
})

test("SetHandling: the request sets its knob in range for every vehicle the physics moves, and a save keeps it", () => {
  // A car braking from 15 m/s along Via Cesare Battisti, with the brakes as they are or halved.
  const stops = (brakes?: number) => {
    const { runtime, run, world } = start(
      [],
      [ON_BATTISTI, { cars: [rolling("panda", ON_BATTISTI, 15, -1)] }],
    )
    if (brakes !== undefined) runtime.send(SetHandling, { key: "brakes", value: brakes })
    run(120)
    const car = world().vehicles[0]!
    return {
      travelled: Math.sqrt((car.x - ON_BATTISTI.x) ** 2 + (car.y - ON_BATTISTI.y) ** 2),
      handling: world().handling,
    }
  }
  const real = stops(),
    weak = stops(0.5)
  assert.equal(weak.handling.brakes, 0.5)
  assert.ok(weak.travelled > real.travelled * 1.3, `${weak.travelled} against ${real.travelled} m`)
  const clamped = start()
  clamped.runtime.send(SetHandling, { key: "grip", value: 9 })
  clamped.runtime.send(SetHandling, { key: "abs", value: 0.6 })
  clamped.run(1)
  assert.deepEqual(clamped.world().handling, {
    ...DEFAULT_HANDLING,
    grip: HANDLING.grip.max,
    abs: 1,
  })
  const restored = start()
  assert.ok(restored.runtime.restore(jsonSave(clamped.runtime)).ok)
  assert.deepEqual(restored.world().handling, clamped.world().handling)
})

// Regression: the debug menu re-sends the stored knobs as the page loads; one sent before the first update, with a render tick in
// between, was dropped, as ApplyHandling only started listening on its first run.
test("SetHandling: a request sent before the first update still applies after another schedule ticks first", () => {
  const { runtime, run, world } = start()
  runtime.send(SetHandling, { key: "grip", value: 1.5 })
  assert.ok(runtime.tick(Game.Schedule(Game.System("Test/Draw", {}, () => {}))).ok)
  run(1)
  assert.equal(world().handling.grip, 1.5)
})

// Regression: arcade's low weight transfer and quick steering at speed let a half-second full-lock tap spin a car round at 90-100 km/h,
// where the real data never spins it.
test("presets: in arcade a half-second full-lock tap at 100 km/h does not spin a Giulia on the throttle or a Panda off it", () => {
  const spins = (model: VehicleModel, lift: boolean) => {
    const v = 100 / 3.6
    let most = 0
    drive(
      model,
      480,
      (frame, s) => ({
        throttle: lift && frame > 30 ? 0 : Math.max(-1, Math.min(1, (v - forward(s)) * 0.5)),
        steer: frame > 30 && frame <= 60 ? 1 : 0,
        handbrake: false,
      }),
      {
        speed: v,
        handling: HANDLING_PRESETS.arcade.values,
        each: (frame, s) => {
          // The angle between the heading and the motion, past which the car is sliding sideways or backwards.
          const c = Ops.cos(s.pose.angle),
            n = Ops.sin(s.pose.angle)
          if (frame > 30)
            most = Math.max(
              most,
              Math.abs(
                Ops.atan2(-s.motion.vx * n + s.motion.vy * c, s.motion.vx * c + s.motion.vy * n),
              ),
            )
        },
      },
    )
    return most > Math.PI / 4
  }
  assert.equal(spins("carabinieri", false), false)
  assert.equal(spins("panda", true), false)
})

/** Whether a `model` tapped to full lock for half a second at `kmh`, throttle lifted, slides past 45° from its heading. */
const spinsOnTap = (model: VehicleModel, kmh: number, handling: HandlingValue) => {
  const v = kmh / 3.6
  let most = 0
  drive(
    model,
    480,
    (frame, s) => ({
      throttle: frame > 30 ? 0 : Math.max(-1, Math.min(1, (v - forward(s)) * 0.5)),
      steer: frame > 30 && frame <= 60 ? 1 : 0,
      handbrake: false,
    }),
    {
      speed: v,
      handling,
      each: (frame, s) => {
        const c = Ops.cos(s.pose.angle),
          n = Ops.sin(s.pose.angle)
        if (frame > 30)
          most = Math.max(
            most,
            Math.abs(
              Ops.atan2(-s.motion.vx * n + s.motion.vy * c, s.motion.vx * c + s.motion.vy * n),
            ),
          )
      },
    },
  )
  return most > Math.PI / 4
}

test("stability assist: at 1 a Panda tapped to full lock at 160 km/h, off the throttle, does not spin round as the real one does", () => {
  assert.equal(spinsOnTap("panda", 160, REAL_HANDLING), true, "real: it spins")
  assert.equal(spinsOnTap("panda", 160, With({ stability: 1 })), false)
})

test("stability assist: it lets go while the handbrake is held, so a handbrake turn swings a car round as it does without it", () => {
  const turn = (stability: number) =>
    drive(
      "panda",
      120,
      (frame) => ({ throttle: 0, steer: frame > 10 ? 1 : 0, handbrake: frame > 10 }),
      { speed: 20, handling: With({ stability }) },
    ).pose.angle
  assert.equal(turn(1), turn(0))
  assert.ok(turn(1) > Math.PI / 2, `turned ${turn(1)} rad`)
})

// Regression: the assist aimed the yaw at the steering's kinematic rate, which at speed asks for 4–9 g, so held lock spun the car round.
test("stability assist: on arcade, full lock held for 5 s at 100–160 km/h, on or off the throttle, never slides a Giulia or a Panda past 10°", () => {
  for (const model of ["carabinieri", "panda"] as const)
    for (const kmh of [100, 130, 160])
      for (const mode of ["hold", "floor"] as const) {
        const v = kmh / 3.6
        let most = 0
        drive(
          model,
          330,
          (frame, s) => ({
            throttle: mode === "floor" ? 1 : Math.max(-1, Math.min(1, (v - forward(s)) * 0.5)),
            steer: frame > 30 ? 1 : 0,
            handbrake: false,
          }),
          {
            speed: v,
            handling: HANDLING_PRESETS.arcade.values,
            each: (frame, s) => {
              const c = Ops.cos(s.pose.angle),
                n = Ops.sin(s.pose.angle)
              if (frame > 30)
                most = Math.max(
                  most,
                  Math.abs(
                    Ops.atan2(
                      -s.motion.vx * n + s.motion.vy * c,
                      s.motion.vx * c + s.motion.vy * n,
                    ),
                  ),
                )
            },
          },
        )
        assert.ok(
          most < (10 * Math.PI) / 180,
          `${model} at ${kmh} km/h, ${mode}: slid ${(most * 180) / Math.PI}°`,
        )
      }
})

// Regression: the assist damped the centre of mass's sideways speed, which a clean turn has too, so it scrubbed held corners to walking pace.
test("stability assist: an arcade Giulia floored at full lock keeps circling fast, faster than without the assist", () => {
  const circling = (stability: number) =>
    forward(
      drive(
        "carabinieri",
        600,
        (frame) => ({ throttle: 1, steer: frame > 10 ? 1 : 0, handbrake: false }),
        {
          speed: 3,
          handling: { ...HANDLING_PRESETS.arcade.values, stability },
        },
      ),
    )
  assert.ok(
    circling(1) > 100 / 3.6 && circling(1) > circling(0),
    `${circling(1) * 3.6} km/h against ${circling(0) * 3.6} without`,
  )
})

test("self-righting: on, every vehicle left on its roof or side is back on its wheels and settled within 4 s; off, it stays there", () => {
  for (const model of ["panda", "carabinieri", "ape", "truck"] as const)
    for (const roll of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const { height, cg, width } = VEHICLES[model],
        chassis = { roll, pitch: 0, z: 100 + (roll === Math.PI ? height - cg : width / 2) }
      const after = (selfRighting: number) =>
        drive(model, 240, () => coast, { chassis, handling: With({ selfRighting }) }).chassis
      assert.equal(overturned(after(0)), true, `${model} at roll ${roll}: real, it stays over`)
      assert.ok(uprightness(after(1)) > 0.95, `${model} at roll ${roll}: righted`)
    }
})

// Regression: righting stopped once the hull lifted, so a laden truck on a cross slope rocked between its side and its wheels for good.
test("self-righting: the laden truck left on its roof or either side across a 20% slope, handbrake on, ends on its wheels and stays there", () => {
  const { height, cg, width } = VEHICLES.truck
  for (const roll of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
    let changes = 0,
      was = true
    const end = drive("truck", 600, () => ({ throttle: 0, steer: 0, handbrake: true }), {
      ground: (_, y) => 100 + 0.2 * y,
      chassis: { roll, pitch: 0, z: 100 + (roll === Math.PI ? height - cg : width / 2) + 0.3 },
      handling: With({ selfRighting: 1 }),
      each: (_, s) => {
        if (overturned(s.chassis) !== was) changes++
        was = overturned(s.chassis)
      },
    })
    assert.ok(
      !overturned(end.chassis) && changes <= 1,
      `roll ${roll}: ${changes} changes, ended overturned: ${overturned(end.chassis)}`,
    )
  }
})

test("self-righting: a car asleep on its roof wakes and rolls back onto its wheels once the knob is switched on", () => {
  const roof = {
    ...settle("panda", ON_BATTISTI),
    roll: Math.PI,
    z:
      settle("panda", ON_BATTISTI).z -
      VEHICLES.panda.cg +
      VEHICLES.panda.height -
      VEHICLES.panda.cg +
      0.02,
  }
  const wreck = Game.Command.spawn(
    [Vehicle, { model: "panda", color: 0xb8312b }],
    [Pose, ON_BATTISTI],
    [PrevPose, ON_BATTISTI],
    [Motion, { vx: 0, vy: 0, spin: 0.01 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: false }],
    [Chassis, roof],
    [Damage, UNDAMAGED],
  )
  // The player 400 m east, within the reach where vehicles move (FROZEN_BEYOND, 500 m); nobody else comes.
  const { runtime, run, world } = start(
    [],
    [{ x: ON_BATTISTI.x + 400, y: ON_BATTISTI.y, angle: 0 }, { cars: [wreck] }],
    { alone: true },
  )
  run(240)
  assert.equal(world().vehicles[0]!.chassis.rollRate, 0, "asleep on its roof")
  runtime.send(SetHandling, { key: "selfRighting", value: 1 })
  run(180)
  assert.equal(overturned(world().vehicles[0]!.chassis), false)
})
