/**
 * The valley's own sounds: wind (Farnell, Designing Sound ch. 18) with its gusts, whistle and
 * leaves; Italian tree crickets in the grass, chirping faster in warmer air; robins, tits,
 * blackbirds and chaffinches with their autumn calls, and the tawny owl at night; farm dogs; and
 * the village church bells.
 *
 * The continuous voices are diffuse, all around the listener, so they take no Doppler shift.
 *
 * @module audio/synth/nature
 */
import { bufferOf, loop, smoothstep } from "../buffers.ts"
import type { Continuous, Kit, OneShot, Shot, ShotIo, VoiceFactory } from "../types.ts"
import {
  bake,
  burst,
  fadeOut,
  jitter,
  jitterDb,
  normalise,
  outlet,
  perContext,
  ping,
  playBuffer,
  shuffled,
  trimmed,
  unit,
} from "./graph.ts"
import { type Vocal, vocalise } from "./voices.ts"

/** Smoothing of wind changes, s: altitude and exposure change slowly, and the gusts carry the motion. */
const WIND_TAU = 1
/** The valley's usual gustiness (a gust factor near 1.5, open ground at 10 m): the wind as it blew before the weather. */
export const VALLEY_GUSTS = 0.5
/** Waveshaper passing only the top of the gust signal (above 0.5), scaled back to 0…1: the whistle opens on strong gusts. */
const GUST_THRESHOLD = Float32Array.from(
  { length: 256 },
  (_, i) => Math.max(0, (i / 255) * 2 - 1.5) * 2,
)

/**
 * Wind at `strength` 0…1: louder, higher and more tonal as it rises (a whistle on strong gusts), with leaves ∝ `forest`; `gusts`
 * 0…1 deepens its swells (from half to 0.95 of its level) and quickens them (the gust signal at ½× to 2×), `VALLEY_GUSTS` as before.
 */
export const wind: VoiceFactory<Extract<Continuous, { readonly kind: "wind" }>> = ({
  ctx,
  out,
  kit,
}) => {
  const level = outlet(ctx, out),
    gust = loop(ctx, kit.gust)
  // Body: brown noise in a band whose level and centre breathe with the gusts.
  const brown = loop(ctx, kit.brown),
    band = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 400, Q: 0.8 })
  const body = new GainNode(ctx, { gain: 0 }),
    bodyGust = new GainNode(ctx, { gain: 0 }),
    bandGust = new GainNode(ctx, { gain: 0 })
  brown.connect(band).connect(body).connect(level)
  gust.connect(bodyGust).connect(body.gain)
  gust.connect(bandGust).connect(band.frequency)
  // Whistle: a resonance on wires and eaves, gliding with the gust.
  const white = loop(ctx, kit.white),
    pipe = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 40 })
  const gate = new GainNode(ctx, { gain: 0 }),
    whistle = new GainNode(ctx, { gain: 0 })
  white.connect(pipe).connect(gate).connect(whistle).connect(level)
  gust.connect(new WaveShaperNode(ctx, { curve: GUST_THRESHOLD })).connect(gate.gain)
  gust.connect(new GainNode(ctx, { gain: 120 })).connect(pipe.frequency)
  // Leaves: grains in a 4 kHz band, swelling with the gusts, at double speed, shuffled so the rustle never repeats.
  const leafBand = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 4000, Q: 0.6 }),
    crackle = shuffled(ctx, kit.crackle, leafBand, 2),
    rustle = new GainNode(ctx, { gain: 0.5 }),
    leaves = new GainNode(ctx, { gain: 0 })
  leafBand.connect(rustle).connect(leaves).connect(level)
  gust.connect(new GainNode(ctx, { gain: 0.5 })).connect(rustle.gain)
  let tau = 0.01
  return {
    update: (sound, now) => {
      const w = unit(sound.strength),
        w2 = w * w,
        g = unit(sound.gusts)
      // The gust swing stays below the base level (0.325…0.615 of 0.65), so the body's gain never goes negative.
      body.gain.setTargetAtTime(0.65 * w2, now, tau)
      bodyGust.gain.setTargetAtTime((0.47 + 0.29 * (g - VALLEY_GUSTS)) * w2, now, tau)
      gust.playbackRate.setTargetAtTime(2 ** (2 * g - 1), now, tau)
      band.frequency.setTargetAtTime(250 + 400 * w, now, tau)
      bandGust.gain.setTargetAtTime(150 * w, now, tau)
      whistle.gain.setTargetAtTime(8 * smoothstep(0.4, 1, w), now, tau)
      // Like the body, the leaves follow strength², so the bed's level law (`windDb`) holds for the whole voice.
      leaves.gain.setTargetAtTime(0.455 * unit(sound.forest) * w2, now, tau)
      crackle.update(now)
      // The first update lands at once (the outlet fades the voice in); later ones glide.
      tau = WIND_TAU
    },
    stop: (now) => fadeOut(level, [gust, brown, white, crackle.control], now),
  }
}

/** Echemes (chirps) per second of the Italian tree cricket at `celsius`: Dolbear's linear form fitted to 1/s at 22 °C, silent below 10 °C. */
export const echemeRate = (celsius: number): number => (celsius < 10 ? 0 : (celsius - 5) / 17)

/** Echemes per second the voice chirps at `celsius`: the law, never slower than at 10 °C, so a voice held in the cold (the director holds it only where the law sings) still chirps, never waiting forever. */
export const chirpRate = (celsius: number): number =>
  Math.max(echemeRate(celsius) || 0, echemeRate(10))
/** Oecanthus pellucens' carrier, Hz. */
const CARRIER = 2600
/** Crickets within earshot at full density. */
const SINGERS = 6
/** How far ahead echemes are scheduled, s. */
const LOOKAHEAD = 0.3

/** The chorus gain at `density`: fuller as more sing. */
const chorusAt = (density: number): number => 0.6 + 0.4 * density

/** How far (dB) the voice plays under full density at `density`: fewer singers (adding incoherently) in a quieter chorus. */
export const cricketsQuiet = (density: number): number => {
  const d = unit(density)
  return (
    10 * Math.log10(SINGERS / Math.max(1, Math.ceil(d * SINGERS))) - 20 * Math.log10(chorusAt(d))
  )
}

/** Tree crickets around the listener: `density` 0…1 sets how many sing and how loud, `celsius` how fast they chirp. */
export const crickets: VoiceFactory<Extract<Continuous, { readonly kind: "crickets" }>> = ({
  ctx,
  out,
}) => {
  const level = outlet(ctx, out),
    chorus = new GainNode(ctx, { gain: 0 })
  chorus.connect(level)
  const singers = Array.from({ length: SINGERS }, () => {
    const carrier = new OscillatorNode(ctx, { frequency: CARRIER * jitter(0.04) })
    // A 24–32 Hz square opens the carrier syllable by syllable: 8–21 syllables per echeme.
    const syllables = new OscillatorNode(ctx, { type: "square", frequency: 24 + 8 * Math.random() })
    const pulse = new GainNode(ctx, { gain: 0.5 }),
      gate = new GainNode(ctx, { gain: 0 })
    syllables.connect(new GainNode(ctx, { gain: 0.5 })).connect(pulse.gain)
    carrier
      .connect(pulse)
      .connect(gate)
      .connect(new StereoPannerNode(ctx, { pan: Math.random() * 1.4 - 0.7 }))
      .connect(chorus)
    carrier.start()
    syllables.start()
    return { carrier, syllables, gate: gate.gain, amp: 0.16 * jitter(0.4), next: 0 }
  })
  return {
    update: (sound, now) => {
      const density = unit(sound.density),
        rate = chirpRate(sound.celsius)
      chorus.gain.setTargetAtTime(chorusAt(density), now, 0.5)
      for (const singer of singers.slice(0, Math.ceil(density * SINGERS))) {
        // A cricket that was quiet (or fell behind) starts again somewhere in its next cycle.
        if (singer.next < now) singer.next = now + Math.random() / rate
        while (singer.next < now + LOOKAHEAD) {
          const t = singer.next,
            seconds = 0.29 + Math.random() * 0.43
          singer.gate.setValueAtTime(0, t)
          singer.gate.linearRampToValueAtTime(singer.amp, t + 0.01)
          singer.gate.setValueAtTime(singer.amp, t + seconds - 0.01)
          singer.gate.linearRampToValueAtTime(0, t + seconds)
          singer.next = t + Math.max(seconds + 0.15, jitter(0.15) / rate)
        }
      }
    },
    stop: (now) =>
      fadeOut(
        level,
        singers.flatMap((singer) => [singer.carrier, singer.syllables]),
        now,
      ),
  }
}

type Species = Extract<OneShot, { readonly kind: "bird" }>["species"]

/** A pure-tone note at `t`, gliding `from` → `to` Hz over `seconds`, optionally trilled (`trill`: rate Hz, depth Hz); returns its end. */
const note = (
  io: ShotIo,
  t: number,
  from: number,
  to: number,
  seconds: number,
  peak: number,
  trill?: readonly [number, number],
): number => {
  const { ctx } = io,
    end = t + seconds * 1.5
  const tone = new OscillatorNode(ctx, { frequency: from }),
    amp = new GainNode(ctx, { gain: 0 })
  tone.frequency.setValueAtTime(from, t)
  tone.frequency.exponentialRampToValueAtTime(to, t + seconds)
  if (trill !== undefined) {
    const lfo = new OscillatorNode(ctx, { frequency: trill[0] })
    lfo.connect(new GainNode(ctx, { gain: trill[1] })).connect(tone.frequency)
    lfo.start(t)
    lfo.stop(end)
  }
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(peak, t + Math.min(0.008, seconds / 3))
  amp.gain.setTargetAtTime(0, t + seconds * 0.6, seconds / 6)
  tone.connect(amp).connect(io.out)
  tone.onended = () => amp.disconnect()
  tone.start(t)
  tone.stop(end)
  return end
}

/**
 * An owl's note at `t`: its fundamental and a weak octave (−18 dB) through the (s, Hz) points of `contour` scaled by `pitch`, at
 * `peak`, softly breathed in, quavering by `trill` (rate Hz, depth Hz) if given; returns its end.
 */
const hoot = (
  io: ShotIo,
  t: number,
  contour: ReadonlyArray<readonly [number, number]>,
  pitch: number,
  peak: number,
  trill?: readonly [number, number],
): number => {
  const { ctx } = io,
    seconds = contour.at(-1)![0],
    end = t + seconds + 0.06
  const tone = new OscillatorNode(ctx, {
      periodicWave: new PeriodicWave(ctx, { real: [0, 0, 0], imag: [0, 1, 0.12] }),
    }),
    amp = new GainNode(ctx, { gain: 0 })
  tone.frequency.setValueAtTime(contour[0]![1] * pitch, t)
  for (const [at, hz] of contour.slice(1))
    tone.frequency.linearRampToValueAtTime(hz * pitch, t + at)
  if (trill !== undefined) {
    const lfo = new OscillatorNode(ctx, { frequency: trill[0] })
    lfo.connect(new GainNode(ctx, { gain: trill[1] })).connect(tone.frequency)
    lfo.start(t)
    lfo.stop(end)
  }
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(peak, t + Math.min(0.04, seconds / 4))
  amp.gain.setValueAtTime(peak, t + seconds - Math.min(0.05, seconds / 4))
  amp.gain.linearRampToValueAtTime(0, end)
  burst(ctx, io.kit.white, io.out, t, 0.02, seconds / 8, contour[0]![1] * pitch, 1.2, 0.15 * peak)
  tone.connect(amp).connect(io.out)
  tone.onended = () => amp.disconnect()
  tone.start(t)
  tone.stop(end)
  return end
}

/** Each species' autumn call from `t` (synthesis.md §9.2); returns its end. */
const CALLS = {
  // Robins sing through autumn to hold winter territories: plaintive, varied 2–8 kHz notes with jumps and trills.
  robin: (io, t) => {
    let end = t
    for (let i = 0, n = 8 + Math.floor(Math.random() * 10); i < n; i++) {
      const hz = 2000 + Math.random() * 6000,
        seconds = 0.03 + Math.random() * 0.12
      // A long note's tail can outlast the short one after it.
      end = Math.max(
        end,
        note(
          io,
          t,
          hz,
          hz * jitter(0.3),
          seconds,
          0.3 + 0.2 * Math.random(),
          Math.random() < 0.3 ? [40 + 40 * Math.random(), 400] : undefined,
        ),
      )
      t += seconds + 0.01 + 0.05 * Math.random()
    }
    return end
  },
  // The great tit's "tea-cher", three to seven times.
  tit: (io, t) => {
    let end = t
    for (let i = 0, n = 3 + Math.floor(Math.random() * 5); i < n; i++, t += 0.24) {
      note(io, t, 4900, 4600, 0.07, 0.5)
      end = note(io, t + 0.1, 4300, 3500, 0.07, 0.4)
    }
    return end
  },
  // Out of season for its song: the "chink-chink" alarm, or now and then the thin high "seee".
  blackbird: (io, t) => {
    if (Math.random() < 0.3) return note(io, t, 8000, 7000, 0.45, 0.25, [30, 150])
    let end = t
    for (
      let i = 0, n = 3 + Math.floor(Math.random() * 6);
      i < n;
      i++, t += 0.18 + 0.08 * Math.random()
    )
      end = note(io, t, 7000, 4200, 0.018, 0.5)
    return end
  },
  // The chaffinch's autumn "pink": about 40 ms near 5 kHz, sharply modulated, once to three times.
  chaffinch: (io, t) => {
    let end = t
    for (
      let i = 0, n = 1 + Math.floor(Math.random() * 3);
      i < n;
      i++, t += 0.5 + 0.4 * Math.random()
    )
      end = note(io, t, 5600, 4600, 0.04, 0.45, [120, 400])
    return end
  },
  // The tawny owl (Strix aluco), the woods' caller at night, most vocal in autumn (Wild Echoes; BTO): the male's hoot, a note rising
  // 750 → 850 Hz and falling over 0.9 s, a pause of 2.5–4 s, a short "hu", then the quavering "hu-hu-hu-hooo"; now and then the
  // female's rough "kewick" (1.2 → 1.0 → 1.4 kHz). Each owl a little higher or lower.
  owl: (io, t) => {
    const pitch = jitter(0.05)
    if (Math.random() < 0.3)
      return hoot(
        io,
        t,
        [
          [0, 1200],
          [0.12, 1000],
          [0.4, 1400],
        ],
        pitch,
        0.45,
        [70, 120],
      )
    hoot(
      io,
      t,
      [
        [0, 760],
        [0.25, 850],
        [0.9, 720],
      ],
      pitch,
      0.5,
    )
    t += 3.4 + 1.5 * Math.random()
    hoot(
      io,
      t,
      [
        [0, 800],
        [0.15, 760],
      ],
      pitch,
      0.3,
    )
    t += 0.4
    for (let i = 0; i < 3; i++, t += 0.13)
      hoot(
        io,
        t,
        [
          [0, 780],
          [0.09, 800],
        ],
        pitch,
        0.35,
      )
    return hoot(
      io,
      t,
      [
        [0, 800],
        [0.3, 850],
        [1, 730],
      ],
      pitch,
      0.5,
      [5, 12],
    )
  },
} satisfies Record<Species, (io: ShotIo, t: number) => number>

/** One bird calling. */
export const bird: Shot<Extract<OneShot, { readonly kind: "bird" }>> = {
  play: (io, { species }, when) => CALLS[species](io, when),
}

/** A big and a small dog's bark (synthesis.md §9.4); `peak` TUNED by rendering: the big dog peaks near 0.5, the small one 2 dB under. */
const DOGS = {
  big: {
    f0: [260, 380, 220],
    vowel: [500, 1400, 2600],
    seconds: 0.14,
    rough: 0.4,
    roughHz: 60,
    breath: 1,
    peak: 1.6,
  },
  small: {
    f0: [550, 800, 500],
    vowel: [650, 1700, 3000],
    seconds: 0.09,
    rough: 0.3,
    roughHz: 80,
    breath: 1,
    peak: 0.75,
  },
} as const satisfies Record<"big" | "small", Vocal>

/** A farm dog barking two to five times. */
export const bark: Shot<Extract<OneShot, { readonly kind: "bark" }>> = {
  play: (io, { big }, when) => {
    const dog: Vocal = big ? DOGS.big : DOGS.small
    let t = when,
      end = when
    for (
      let i = 0, n = 2 + Math.floor(Math.random() * 4);
      i < n;
      i++, t += 0.35 + 0.25 * Math.random()
    ) {
      // A noisy onset 6 dB down, then the voiced bark.
      burst(io.ctx, io.kit.white, io.out, t, 0.001, 0.002, 2500, 0.7, dog.peak / 2)
      const f0 = jitter(0.06)
      end = vocalise(io, { ...dog, f0: [dog.f0[0] * f0, dog.f0[1] * f0, dog.f0[2] * f0] }, t)
    }
    return end
  },
}

/** Bell partials relative to the prime: ratio, level, decay time relative to the hum's (hum, prime, tierce, quint, nominal, upper partials). */
const PARTIALS = [
  [0.5, 0.5, 1],
  [1, 0.45, 0.65],
  [1.2, 0.5, 0.55],
  [1.5, 0.2, 0.4],
  [2, 0.6, 0.35],
  [2.5, 0.12, 0.2],
  [3, 0.2, 0.18],
  [4, 0.12, 0.12],
] as const
/** Baked primes, a major third apart over the village range; any pitch plays the nearest, resampled by at most ±2 semitones. */
const PRIMES = [400, 504, 635, 800] as const
/** Seconds baked per stroke; the tail fades over the last 1.5 s. */
const RING = 10

/** One stroke of a bell with prime `prime` Hz: each partial split ±0.4 Hz to beat like a real, slightly uneven bell. */
const strike = (oc: OfflineAudioContext, kit: Kit, prime: number): void => {
  // Bigger (lower) bells ring longer: the hum's T60 is 18 s at 400 Hz, 9 s at 800 Hz.
  const humT60 = 7200 / prime,
    bell = new GainNode(oc)
  bell.connect(oc.destination)
  bell.gain.setValueAtTime(1, RING - 1.5)
  bell.gain.linearRampToValueAtTime(0, RING - 0.05)
  for (const [ratio, level, decay] of PARTIALS) {
    for (const beat of [-0.4, 0.4])
      ping(oc, bell, 0, (prime + beat) * ratio, level / 2, (humT60 * decay) / 6.91, RING)
  }
  // The clapper's metallic click.
  burst(oc, kit.white, bell, 0, 0.0005, 0.004, prime * 5, 1, 0.3)
}

const bells = perContext(async (ctx, kit) => {
  const sounds = await Promise.all(
    PRIMES.map((prime) => bake(ctx.sampleRate, RING, (oc) => strike(oc, kit, prime)).then(trimmed)),
  )
  normalise(sounds, 0.5)
  return sounds.map((samples) => bufferOf(ctx, samples))
})

/** The baked prime nearest `pitch` on a log scale. */
const nearestPrime = (pitch: number): number =>
  PRIMES.reduce(
    (best, prime, i) =>
      Math.abs(Math.log(pitch / prime)) < Math.abs(Math.log(pitch / PRIMES[best]!)) ? i : best,
    0,
  )

/** One stroke of a church bell. */
export const bell: Shot<Extract<OneShot, { readonly kind: "bell" }>> = {
  prepare: bells.prepare,
  play: (io, { pitch }, when) => {
    const buffers = bells.get(io.ctx)
    if (buffers === undefined) return when
    const i = nearestPrime(pitch)
    return playBuffer(io, buffers[i]!, when, pitch / PRIMES[i]!, jitterDb(1))
  },
}
