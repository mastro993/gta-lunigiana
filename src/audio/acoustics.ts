/**
 * Outdoor acoustics as plain functions of distance, geometry and speed: how loud, how dull, how
 * late and how shifted a sound reaches the listener. Losses are dB re the source's level at 1 m;
 * the director sums them and converts once with `mixGain`. The numbers come from the outdoor
 * propagation research (physics.md: ISO 9613-1/-2, Maekawa, the Doppler law, the masking rule),
 * cited per constant by section.
 *
 * @module audio/acoustics
 */
import type { CabinModel } from "./types.ts"

/** Speed of sound at 15 °C, m/s: c = 331.3 + 0.606·T (§5). */
export const SPEED_OF_SOUND = 340.4
/** Rural daytime background, dB(A) (§8: 30–40). */
export const AMBIENT_DB = 35
/** Rural night background, dB(A) (§8: 25–30): the stillest the masking floor gets. */
export const NIGHT_DB = 28
/** Ear height above the ground, m (§0). */
export const EAR_HEIGHT = 1.6

/** Linear amplitude of a level change in dB. */
export const dbToGain = (db: number): number => 10 ** (db / 20)
/** Level change in dB of a linear amplitude (−Infinity for 0). */
export const gainToDb = (gain: number): number => 20 * Math.log10(gain)
/** Energy sum of incoherent levels, dB (−Infinity for none). */
export const sumDb = (levels: ReadonlyArray<number>): number => {
  let energy = 0
  for (const level of levels) energy += 10 ** (level / 10)
  return 10 * Math.log10(energy)
}

/** Point-source spreading loss re 1 m, dB: −6 dB per doubling (§1), clamped at `rMin` (the source's size). */
export const spreading = (r: number, rMin: number): number => 20 * Math.log10(Math.max(r, rMin))

/** A straight piece of an incoherent line source (a river reach): ends a, b and sound power `lw`, dB per metre. */
export interface LineSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly lw: number
}

/**
 * Level at (x, y) of a polyline of incoherent line sources (§1, exact for any listener position):
 * Lp = 10·log10 Σ 10^(lwᵢ/10)·θᵢ/(4π·dᵢ), dᵢ the distance to segment i's line (clamped to 1 m), with
 * the listener `height` m over or under the polyline, and θᵢ the angle it subtends there; −Infinity
 * for no segments. Also the nearest point on the polyline.
 */
export const lineLevel = (
  segments: ReadonlyArray<LineSegment>,
  x: number,
  y: number,
  height = 0,
): { readonly level: number; readonly x: number; readonly y: number } => {
  let energy = 0,
    nearest = Number.MAX_VALUE,
    nx = x,
    ny = y
  for (const s of segments) {
    const length = Math.hypot(s.bx - s.ax, s.by - s.ay)
    if (length === 0) continue
    const ux = (s.bx - s.ax) / length,
      uy = (s.by - s.ay) / length
    // The ends' coordinates along the line from the foot of the perpendicular through (x, y).
    const ta = (s.ax - x) * ux + (s.ay - y) * uy,
      d = Math.max(1, Math.hypot((x - s.ax) * uy - (y - s.ay) * ux, height))
    energy +=
      (10 ** (s.lw / 10) * (Math.atan2(ta + length, d) - Math.atan2(ta, d))) / (4 * Math.PI * d)
    const t = Math.min(length, Math.max(0, -ta)),
      px = s.ax + ux * t,
      py = s.ay + uy * t
    const d2 = (px - x) ** 2 + (py - y) ** 2
    if (d2 < nearest) [nearest, nx, ny] = [d2, px, py]
  }
  return { level: 10 * Math.log10(energy), x: nx, y: ny }
}

/**
 * Where air absorption reaches 3 dB at distance r, Hz (ISO 9613-1 at 15 °C / 70 % RH, §2), and
 * the 10–25 m slope extended up to 20 kHz (about 6 m). Log-log between the rows; 315 Hz past 2 km.
 */
const AIR: ReadonlyArray<readonly [number, number]> = [
  [6, 20000],
  [10, 15100],
  [25, 9100],
  [50, 6300],
  [100, 4300],
  [200, 2900],
  [300, 2200],
  [500, 1500],
  [1000, 680],
  [2000, 315],
]

/** The air-absorption lowpass cutoff for a source r m away, Hz. */
export const airCutoff = (r: number): number => {
  if (r <= AIR[0]![0]) return AIR[0]![1]
  for (let i = 1; i < AIR.length; i++) {
    const [r1, f1] = AIR[i]!
    if (r > r1) continue
    const [r0, f0] = AIR[i - 1]!
    return f0 * (f1 / f0) ** (Math.log(r / r0) / Math.log(r1 / r0))
  }
  return AIR.at(-1)![1]
}

/** Ground effect over soft ground, dB (ISO 9613-2 §7.3.2, §3): max(0, 4.8 − (2h/r)(17 + 300/r)), h the mean path height. */
export const groundLoss = (r: number, meanHeight: number): number =>
  r <= 0 ? 0 : Math.max(0, 4.8 - ((2 * meanHeight) / r) * (17 + 300 / r))

/**
 * The extra loss over a fresh snow cover, dB, `cover` 0…1 of it: snow is soft porous ground (flow resistivity 10–35 kPa·s/m²),
 * under which pulses fall as r^−1.6 against r^−1.2 over summer ground (Albert, CRREL), so 8·log10 r more, up to 12 dB.
 */
export const snowLoss = (r: number, cover: number): number =>
  cover * Math.min(12, 8 * Math.log10(Math.max(1, r)))

/** Loss through `metres` of foliage at 1 kHz, dB (ISO 9613-2 Annex A, §3): 1 dB for 10–20 m, then 0.06 dB/m up to 200 m. */
export const foliageLoss = (metres: number): number =>
  metres < 10 ? 0 : metres < 20 ? 1 : Math.min(12, 0.06 * metres)

/** Path difference δ (m) → diffraction loss (dB, the 250 Hz Maekawa value, capped) and one-pole cutoff (Hz) matching the tilt (§4). */
const DIFFRACTION: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 20000],
  [0.05, 6.5, 1800],
  [0.1, 7.7, 1500],
  [0.25, 10.1, 1400],
  [0.5, 12.5, 1900],
  [1, 15, 2800],
]

/** Loss and lowpass of an edge `delta` m of path difference into the shadow; past 1 m the last row holds (15 dB cap). */
export const diffraction = (delta: number): { readonly loss: number; readonly cutoff: number } => {
  for (let i = 1; i < DIFFRACTION.length; i++) {
    const [d1, loss1, f1] = DIFFRACTION[i]!
    if (delta > d1) continue
    const [d0, loss0, f0] = DIFFRACTION[i - 1]!,
      t = Math.max(0, (delta - d0) / (d1 - d0))
    return { loss: loss0 + (loss1 - loss0) * t, cutoff: f0 * (f1 / f0) ** t }
  }
  const [, loss, cutoff] = DIFFRACTION.at(-1)!
  return { loss, cutoff }
}

/**
 * Doppler shift, cents, of a source at (sx, sy) moving (svx, svy) heard at (lx, ly) moving
 * (lvx, lvy): f′/f = (c − v_L·u)/(c − v_S·u), u the unit vector source → listener (§5), clamped to
 * [0.7, 1.4]; 0 within 1 m, where the direction is noise.
 */
export const doppler = (
  sx: number,
  sy: number,
  svx: number,
  svy: number,
  lx: number,
  ly: number,
  lvx: number,
  lvy: number,
): number => {
  const r = Math.hypot(lx - sx, ly - sy)
  if (r < 1) return 0
  const ux = (lx - sx) / r,
    uy = (ly - sy) / r
  const ratio = (SPEED_OF_SOUND - (lvx * ux + lvy * uy)) / (SPEED_OF_SOUND - (svx * ux + svy * uy))
  return 1200 * Math.log2(Math.min(1.4, Math.max(0.7, ratio)))
}

/** Travel time over r m, s (§6). */
export const delayOf = (r: number): number => r / SPEED_OF_SOUND

/**
 * Stereo position of a source (dx, dy) m from the listener (x east, y north): its direction's
 * share along `right`, the screen's right axis on the ground, scaled to ±0.85 so nothing sits in
 * one ear only, and fading to centre within 2 m (inside the head).
 */
export const panOf = (
  dx: number,
  dy: number,
  right: { readonly x: number; readonly y: number },
): number => (0.85 * (dx * right.x + dy * right.y)) / Math.max(2, Math.hypot(dx, dy))

/** How much of a sound at `levelDb` survives masking by `ambientDb`, 0…1: full at ambient − 5, linear in dB to 0 at ambient − 15 (§8). */
export const audibility = (levelDb: number, ambientDb: number): number =>
  Math.min(1, Math.max(0, (levelDb - ambientDb + 15) / 10))

/** Insertion loss of a vehicle's body for outside sounds heard in it: dB, and the lowpass it leaves, Hz. */
export interface Cabin {
  readonly loss: number
  readonly cutoff: number
}

const CLOSED: Cabin = { loss: 15, cutoff: 1400 }
/**
 * Heard from the driver's seat (§10): closed cabins with the windows up; the Ape's cab is open at the back. A train's cab is
 * TUNED (estimated, no measurement found): a sealed driver's cab, quieter than a car's, so its own 130 dB horn on the roof
 * 2.5 m ahead reaches the driver at 97 dB(A), near TSI Noise's 95 dB(A) limit in the cab while the horn sounds.
 */
export const CABIN = {
  panda: CLOSED,
  ape: { loss: 6, cutoff: 3500 },
  truck: CLOSED,
  carabinieri: CLOSED,
  atr220: { loss: 24, cutoff: 1200 },
} as const satisfies Record<CabinModel, Cabin>

/** HDR mix (§9): source levels are compressed around L_REF by K, so a horn is not 54 dB above a footstep; losses stay physical. */
const L_REF = 120,
  K = 0.6
/**
 * The compressed level, dB, that plays at gain 1, a voice's nominal peak (0.5, about −6 dBFS): a running step on stone
 * heard from 1 m (62 dB(A), levels.ts). So the listener's own steps peak near −22 dBFS over a valley near −40 and traffic
 * passing 10 m away near −20; the loudest near sounds (a horn or siren from the seat, a crash a few metres away) go past
 * gain 1 and the master limiter holds them under −1.5 dBFS.
 */
const FULL_SCALE = L_REF + K * (62 - L_REF)

/** Linear gain of a source of `sourceDb` dB(A) at 1 m after `lossDb` of propagation losses. */
export const mixGain = (sourceDb: number, lossDb: number): number =>
  10 ** ((L_REF + K * (sourceDb - L_REF) - lossDb - FULL_SCALE) / 20)
