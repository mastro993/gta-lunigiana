/**
 * The railway's closed sets and its rolling stock, decoding no map: the schema imports them for its
 * codecs, as it does the vehicle models (`sky/__tests__/mapfree.test.ts` checks it). The train's
 * geometry on a line is in ./consist.ts, its dynamics in ./dynamics.ts.
 *
 * Sources for the ATR 220 Tr "Swing" (PESA Atribo, Trenitalia, the line's only train since 2025):
 * pesa.pl (55.57 m, 2.883 m wide, 4.185 m over the rail head, 2 × 390 kW, 130 km/h), pl.wikipedia
 * "Pesa Atribo" (108 t in service, B′2′2′B′ on Jacobs bogies, a 600 mm floor at the doors, 4 of its 8
 * axles driven), MAN (the D2876 LUE623 six, 12.8 l, 390 kW at 1800 rpm), the FSE data poster
 * (≥ 0.5 m/s² from 0 to 40 km/h, starts on 27 ‰), Dittus et al. 2011 (a 100 t DMU's running
 * resistance, scaled to 108 t), TrainRuns.jl after Wende 2003 (the rotating-mass factor) and RAIB
 * Report 25/2006 (a modern unit's full service and emergency rates). The car lengths are read off the
 * poster's side drawing (±0.5 m); the power at the rail, the starting force and the engine's torque are
 * estimates fitted to the poster's figures.
 *
 * @module rail/models
 */
import type { EngineSpec } from "../vehicles.ts"

/** The trains there are: only the ATR 220 runs the line. */
export const TRAIN_MODELS = ["atr220"] as const
/** A train model. */
export type TrainModel = (typeof TRAIN_MODELS)[number]

/** One train model: its body, mass, traction, resistance and brakes. */
export interface TrainSpec {
  readonly label: string
  /** Each car's length from the leading nose, m: an end car from its coupler to the joint, a middle car joint to joint. */
  readonly cars: ReadonlyArray<number>
  /** The outer bogies' pivots, m in from each nose (the inner pivots are the Jacobs bogies at the joints). */
  readonly bogie: number
  /** Body width, height over the rail head and floor at the doors over it, m. */
  readonly width: number
  readonly height: number
  readonly floor: number
  /** In service, kg. */
  readonly mass: number
  /** Rotating-mass factor ξ: the wheels, axles and gears add this share to the mass the force accelerates. */
  readonly rotating: number
  /** Power at the rail, W, and the starting tractive effort, N. */
  readonly power: number
  readonly startForce: number
  /** The share of the weight on driven axles (the adhesion traction can use). */
  readonly adhesive: number
  /** Running resistance A + B·v + C·v² (N, N·s/m, N·s²/m²). */
  readonly davis: { readonly a: number; readonly b: number; readonly c: number }
  /** Top speed, m/s. */
  readonly vmax: number
  /** Full service and emergency braking, m/s². */
  readonly service: number
  readonly emergency: number
  /** Each power pack's engine, and how many (one under each end car). */
  readonly engine: EngineSpec
  readonly engines: number
  /** The crew doors, m behind each nose. */
  readonly door: number
}

/** Every train model's data. */
export const TRAINS = {
  atr220: {
    label: "ATR 220 Swing",
    // 19.5 + 16.5 + 19.5 m on the drawing; the end cars take the couplers' 0.07 m, so the train is pesa.pl's 55.57 m.
    cars: [19.535, 16.5, 19.535],
    bogie: 2.5,
    width: 2.883,
    height: 4.185,
    floor: 0.6,
    mass: 108000,
    rotating: 1.08,
    // 2 × 390 kW at the engines, about 0.82 of it through the hydrodynamic transmission and the auxiliaries.
    power: 640000,
    startForce: 95000,
    adhesive: 0.5,
    davis: { a: 2000, b: 76, c: 5 },
    vmax: 130 / 3.6,
    service: 0.9,
    emergency: 1.2,
    engine: {
      fuel: "diesel",
      strokes: 4,
      cylinders: 6,
      displacement: 12816,
      aspiration: "turbo",
      torque: 2300,
      torqueRpm: 1300,
      power: 390,
      powerRpm: 1800,
      idle: 600,
      redline: 1800,
    },
    engines: 2,
    door: 2.5,
  },
} as const satisfies Record<TrainModel, TrainSpec>

/** A model's length over the couplers, m. */
export const trainLength = (model: TrainModel): number =>
  TRAINS[model].cars.reduce((sum, car) => sum + car, 0)

/** A train faster than this, m/s, is moving: slower, it leads with its active cab, drags nothing and demands boxes as one standing. */
export const MOVING = 0.5

/** The body of a train `length` m long with its active cab's nose at `s` facing `facing` along its line: its far end, and its low and high ends, s. */
export const spanOf = (
  s: number,
  facing: 1 | -1,
  length: number,
): { readonly tail: number; readonly lo: number; readonly hi: number } => {
  const tail = s - facing * length
  return { tail, lo: Math.min(s, tail), hi: Math.max(s, tail) }
}

/**
 * A level crossing's phases: `open` (arms up, dark), `warning` (light and bell, arms still up),
 * `lowering`, `closed` (arms down) and `raising`.
 */
export const CROSSING_PHASES = ["open", "warning", "lowering", "closed", "raising"] as const
/** A crossing phase. */
export type CrossingPhase = (typeof CROSSING_PHASES)[number]

/**
 * What an AI train is doing: running (to its next station or off the line), dwelling at a station, or held by something on
 * the track ahead (rail/lookout.ts): braking to a stand, standing sounding the horn, then creeping on.
 */
export const RUN_STATES = ["run", "dwell", "braking", "horn", "creep"] as const
/** An AI train's run state. */
export type RunState = (typeof RUN_STATES)[number]
/** Whether an AI train in `state` is held by something on the track ahead. */
export const isHeld = (state: RunState): boolean =>
  state === "braking" || state === "horn" || state === "creep"
