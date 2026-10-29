/**
 * Every vehicle sound: engines (the listener's own from the driver's seat) at the sim's revs and load,
 * worn by its damage and cut by its misfires, a destroyed vehicle's fire until it blows up and the
 * blast, tyres rolling and skidding, horns and the Carabinieri siren (both dead with the engine), the
 * truck's reversing beeper, crashes into walls, vehicles and the ground, the suspension bottoming out,
 * scrapes along walls and the ground, people and animals hit (a person who lives groans), AI honks,
 * and the doors and starter of the listener getting in and out. A crash knows both bodies and how
 * worn each is where it was hit, the wall's or the ground's material and the ground under the car; a
 * scrape, the material; a blast, the ground its debris rains on. Sounds of the listener's own car are
 * heard from inside it: its crash, clunk, scrape and doors through no cabin, its horn and siren (out
 * by the grille, up on the roof) through all of it; so are a car's crash into the player's own train
 * and its scrape along it.
 *
 * @module audio/director/vehicles
 */
import { forwardSpeed } from "../../sim/body.ts"
import { surfaceAt } from "../../sim/map/surface.ts"
import { VEHICLES, type VehicleModel } from "../../sim/vehicles.ts"
import { hash01 } from "../../tools/geometry.ts"
import { mixGain } from "../acoustics.ts"
import { wallAt } from "../places.ts"
import type { HeardTrain } from "../rail-types.ts"
import { crushSpeeds } from "../synth/crash/hit.ts"
import { crashQuiet } from "../synth/crash/index.ts"
import { engineQuiet } from "../synth/engine.ts"
import { BOTTOMED, clunkQuiet, CRANK } from "../synth/impacts.ts"
import type {
  Body,
  Happening,
  HeardVehicle,
  Material,
  OneShot,
  Skidding,
  Surface,
  Zone,
} from "../types.ts"
import { type Frame, groundAt } from "./frame.ts"
import type { Hearing, Source } from "./hearing.ts"
import { ENGINE, HEIGHT, LEVELS, OWN_ENGINE_DB } from "./levels.ts"
import { cueVoice } from "./people.ts"

/** Tyres roll audibly above this speed, m/s; the beeper sounds below this forward speed. */
const ROLLING = 1,
  REVERSING = -0.3
/** A skid holds this long (s) past the frame that last reported it: a frame with no sim step in it (a 120 Hz display) reports none. */
const SKID_HOLD = 0.05
/**
 * Impacts from this speed crash (m/s); softer wall contacts of a car still faster than `SCRAPING`, and its body down on the ground
 * (`hullDown`) as fast, grind for `SCRAPE_HOLD` s.
 */
const CRASH_FROM = 1.5,
  SCRAPING = 2,
  SCRAPE_HOLD = 0.2
/** One hit arrives over a few steps: within `MERGE` s of a car's crash only a `HARDER`× harder one plays. */
const MERGE = 0.1,
  HARDER = 1.5
/** A scrape keeps its material until another one has been met for this long, s (a bank passing trees, contact jitter). */
const SWITCH = 0.25
/** How many vehicles' wear is remembered, the most recently crashed. */
const WORN = 256
/** A person hit (and alive) groans this long after the thud, s; a door closes this long after it opened, s. */
const GROAN_AFTER = 0.25,
  DOOR_CLOSES = 0.7

/** The own engine, from the driver's seat: centred, open, no Doppler; the voice makes the cabin tone. */
const OWN_ENGINE: Hearing = {
  placement: { gain: mixGain(OWN_ENGINE_DB, 0), pan: 0, cutoff: 20000, cents: 0, wet: 0 },
  level: OWN_ENGINE_DB,
  audible: true,
  r: 0,
  delay: 0,
}

/** A vehicle is heard from its centre of mass, in the air too. */
const sourceOf = (v: HeardVehicle): Source => ({ x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy })

/** The level a vehicle stands on, for the ground and the surface under it: a deck's, a tunnel's or the riverbed's under a bridge. */
const levelOf = (v: HeardVehicle | undefined): number | undefined =>
  v === undefined ? undefined : v.z - VEHICLES[v.model].cg

/** The ground struck, by how it sounds: the road and paving as `road` (rigid, coarse grit), loose ground like an earth bank. */
const GROUND = {
  asphalt: "road",
  stone: "road",
  gravel: "earth",
  dirt: "earth",
  grass: "earth",
  leaves: "earth",
} as const satisfies Record<Surface, Material>

/** A vehicle's hit on a wall, another vehicle or the ground. */
type Hit = Extract<Happening, { readonly kind: "impact"; readonly hit: "wall" | "car" | "ground" }>

/** What `hit` met: the ground's under the contact point, at the struck car's `level`, or the wall's (as the sim names it, else the drive wall's, `wallAt`). */
const materialOf = (hit: Hit, level: number | undefined): Material =>
  hit.hit === "ground"
    ? GROUND[surfaceAt(hit.x, hit.y, level)]
    : (hit.material ?? wallAt(hit.x, hit.y))

/** The rail head under train `id` nearest (x, y) among `trains`: where its hits stand (the ground knows no rail decks). */
const railLevel = (
  trains: ReadonlyArray<HeardTrain>,
  id: number,
  x: number,
  y: number,
): number | undefined =>
  trains
    .find((t) => t.id === id)
    ?.cars.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a)).z

/** The vehicle part of the director, with what it remembers between frames. */
export const makeVehicles = () => {
  // The listener's vehicle last frame, and the vehicles that were running then.
  let car: number | undefined, model: VehicleModel | undefined
  let running: ReadonlySet<number> = new Set()
  let horn = false
  /** Vehicle → when its engine catches, after the starter. */
  const cranking = new Map<number, number>()
  const sirens = new Set<number>()
  /** Vehicle → its last crash; vehicle → until when it scrapes, along what (a train, `by`), and what it has met since when (not yet switched to). */
  const crashes = new Map<number, { readonly at: number; readonly speed: number }>()
  const scrapes = new Map<
    number,
    {
      readonly until: number
      readonly material: Material
      readonly by?: number | undefined
      readonly next?: { readonly material: Material; readonly since: number }
    }
  >()
  /** Vehicle → its tyres' last skid and until when it holds. */
  const skids = new Map<number, Skidding & { readonly until: number }>()
  /** Vehicle → the hardest crush each zone of it took (barrier-equivalent m/s), so a broken part stays broken: the `WORN` most recently crashed. */
  const worn = new Map<number, Partial<Record<Zone, number>>>()
  /** `body` of vehicle `id` with its zone's wear (0: intact). */
  const wornOf = (id: number | undefined, body: Body): Body => ({
    ...body,
    worn: (id === undefined ? undefined : worn.get(id)?.[body.zone]) ?? 0,
  })
  /** Vehicle `id`'s `zone` was just crushed at `speed`. */
  const wear = (id: number | undefined, zone: Zone, speed: number) => {
    if (id === undefined) return
    const zones = worn.get(id) ?? {}
    worn.delete(id)
    worn.set(id, { ...zones, [zone]: Math.max(speed, zones[zone] ?? 0) })
    if (worn.size > WORN) worn.delete(worn.keys().next().value!)
  }
  /** `car`'s scrape along `material` (train `by`'s side) now: the material it had holds until `material` has been met for `SWITCH` s. */
  const scrape = (car: number, material: Material, now: number, by?: number) => {
    const held = scrapes.get(car),
      until = now + SCRAPE_HOLD
    if (held === undefined || held.material === material)
      return void scrapes.set(car, { until, material, by })
    const since = held.next?.material === material ? held.next.since : now
    scrapes.set(
      car,
      now - since >= SWITCH
        ? { until, material, by }
        : { until, material: held.material, by, next: { material, since } },
    )
  }

  return {
    hear: (frame: Frame): void => {
      const { heard, now } = frame,
        mine = heard.listener.car
      const byId = new Map(heard.vehicles.map((v) => [v.id, v]))
      // Own sounds come from the car the ears sit in: no occlusion key.
      const keyOf = (id: number) => (id === mine ? undefined : `car:${id}`)

      // Getting in: the door, and the starter if the engine was off; getting out (not thrown out by its blast): the door where the listener now stands.
      if (car === undefined && mine !== undefined) {
        const v = byId.get(mine)
        if (v !== undefined) {
          const at = sourceOf(v),
            door = frame.path(undefined, at, LEVELS.door, { cabin: false })
          frame.play({ kind: "door", model: v.model, open: true }, door)
          frame.play({ kind: "door", model: v.model, open: false }, door, DOOR_CLOSES)
          if (!running.has(mine)) {
            frame.play(
              { kind: "ignition", model: v.model },
              frame.path(undefined, at, LEVELS.ignition, { cabin: false }),
            )
            cranking.set(mine, now + CRANK[v.model].seconds)
          }
        }
      } else if (
        car !== undefined &&
        mine === undefined &&
        model !== undefined &&
        !heard.happenings.some((h) => h.kind === "explosion" && h.car === car)
      ) {
        const { x, y } = heard.listener,
          door = frame.path(undefined, { x, y, z: groundAt(x, y) + HEIGHT.person }, LEVELS.door)
        frame.play({ kind: "door", model, open: true }, door)
        frame.play({ kind: "door", model, open: false }, door, DOOR_CLOSES)
      }

      for (const [id, until] of cranking) if (until <= now) cranking.delete(id)
      for (const [id, { until }] of scrapes) if (until <= now) scrapes.delete(id)
      for (const [id, last] of crashes) if (now - last.at >= MERGE) crashes.delete(id)
      // The hardest hits first, so the softer tail of the same hit merges into them.
      const hits = heard.happenings
        .filter((h): h is Hit => h.kind === "impact" && h.hit !== "person" && h.hit !== "animal")
        .sort((a, b) => b.speed - a.speed)
      for (const hit of hits) {
        const v = byId.get(hit.car),
          level = levelOf(v) ?? railLevel(heard.trains, hit.car, hit.x, hit.y),
          bottomed = hit.hit === "ground" && hit.face === "under"
        if (hit.speed < CRASH_FROM) {
          // A soft contact along a wall grinds while the car still moves (the physics reports no ground hit this soft).
          if (hit.hit === "wall" && v !== undefined && Math.hypot(v.vx, v.vy) > SCRAPING)
            scrape(hit.car, materialOf(hit, level), now, hit.other)
          continue
        }
        // The other body crushed: a vehicle's (a train met is the car's wall, its `other` only who drives it).
        const struck = hit.otherBody === undefined ? undefined : hit.other
        const last = Math.max(
          crashes.get(hit.car)?.speed ?? 0,
          struck === undefined ? 0 : (crashes.get(struck)?.speed ?? 0),
        )
        if (hit.speed < HARDER * last) continue
        for (const id of [hit.car, struck])
          if (id !== undefined) crashes.set(id, { at: now, speed: hit.speed })
        // On foot `mine` is undefined, and so is a wall hit's `other` but a train's. A car the player's train meets is their own hit.
        const own = hit.car === mine || (mine !== undefined && hit.other === mine)
        const point = { x: hit.x, y: hit.y, z: groundAt(hit.x, hit.y, level) + HEIGHT.vehicle }
        // Cresting a hump or a light landing: the bump stops take it.
        if (bottomed && hit.speed < BOTTOMED) {
          const clunk = {
            kind: "clunk",
            speed: hit.speed,
            heavy: hit.body.model === "truck",
          } as const
          frame.play(
            clunk,
            frame.path(own ? undefined : `car:${hit.car}`, point, LEVELS.clunk, {
              cabin: !own,
              quiet: clunkQuiet(hit.speed),
            }),
          )
          continue
        }
        // Debris lands where the car is: a wall hit's contact point lies on the house front, off the street (a ground hit's lies under the car).
        const ground = hit.hit === "wall" ? (v ?? hit) : hit
        const sound: Extract<OneShot, { readonly kind: "crash" }> = {
          kind: "crash",
          speed: hit.speed,
          mass: hit.mass,
          body: wornOf(hit.car, hit.body),
          against:
            hit.otherBody === undefined
              ? { kind: "wall", material: materialOf(hit, level) }
              : { kind: "car", body: wornOf(hit.other, hit.otherBody) },
          surface: surfaceAt(ground.x, ground.y, level),
        }
        // How hard each was crushed where it was hit, for the next crash.
        crushSpeeds(sound).forEach((speed, i) =>
          wear(i === 0 ? hit.car : hit.other, (i === 0 ? hit.body : hit.otherBody!).zone, speed),
        )
        frame.play(
          sound,
          frame.path(own ? undefined : `car:${hit.car}`, point, LEVELS.crash, {
            cabin: !own,
            quiet: crashQuiet(sound),
          }),
        )
      }
      for (const h of heard.happenings) {
        if (h.kind === "honk") {
          frame.play(
            { kind: "honk", model: h.model },
            frame.path(
              `car:${h.car}`,
              { x: h.x, y: h.y, z: groundAt(h.x, h.y, levelOf(byId.get(h.car))) + HEIGHT.vehicle },
              LEVELS.honk,
            ),
          )
        } else if (h.kind === "explosion") {
          // From the wreck's centre of mass; its debris rains on the ground under it (a bridge's deck, not the river under it).
          // The sim throws a driver out of the wreck in the step it blows up, so a blast is never the listener's own car's.
          const surface = surfaceAt(h.x, h.y, groundAt(h.x, h.y, h.z))
          frame.play(
            { kind: "explosion", surface },
            frame.path(`car:${h.car}`, h, LEVELS.explosion),
          )
        } else if (h.kind === "impact" && (h.hit === "person" || h.hit === "animal")) {
          // The body hit: a thud from the car, and a person who lives groans (an animal's pain is its own cry, in animals.ts).
          const who = h.other ?? h.car,
            key = `${h.hit}:${who}`,
            at = { x: h.x, y: h.y, z: groundAt(h.x, h.y) + HEIGHT.person }
          frame.play(
            { kind: "thud", speed: h.speed },
            frame.path(key, at, LEVELS.thud, { cabin: h.car !== mine }),
          )
          const person =
            h.hit === "person" && h.fatal !== true
              ? heard.people.find((p) => p.id === who)
              : undefined
          if (person !== undefined)
            frame.play(
              { kind: "groan", voice: cueVoice(person) },
              frame.path(key, at, LEVELS.groan),
              GROAN_AFTER,
            )
        }
      }

      // The Carabinieri's horn key toggles the siren; it falls silent once its engine no longer runs (nobody drives, or it is destroyed).
      const pressed = heard.horn && !horn
      for (const v of heard.vehicles) {
        if (!v.mine || v.model !== "carabinieri" || !pressed) continue
        if (sirens.has(v.id)) sirens.delete(v.id)
        else sirens.add(v.id)
      }
      for (const id of sirens) if (byId.get(id)?.running !== true) sirens.delete(id)

      for (const [id, { until }] of skids) if (until <= now) skids.delete(id)
      for (const v of heard.vehicles) {
        const at = sourceOf(v),
          key = keyOf(v.id),
          forward = forwardSpeed(v, v.angle),
          speed = Math.hypot(v.vx, v.vy),
          level = levelOf(v)
        const catches = cranking.get(v.id)
        if (v.running && (catches === undefined || catches <= now)) {
          const engine = {
            kind: "engine",
            model: v.model,
            rpm: v.rpm,
            load: v.load,
            inside: v.id === mine,
            variant: hash01(v.id),
            damage: v.damage,
            misfire: v.misfire,
          } as const
          const way = { doppler: true, quiet: engineQuiet(v.model, v.rpm, v.load, v.damage) }
          frame.hold(
            `engine:${v.id}`,
            engine,
            v.id === mine ? OWN_ENGINE : frame.path(key, at, ENGINE[v.model], way),
          )
        }
        if (v.skid !== undefined) skids.set(v.id, { ...v.skid, until: now + SKID_HOLD })
        const skid = skids.get(v.id)
        // In the air or on its side the tyres touch nothing; standing, they sound only while they skid.
        if (v.wheelsDown && (speed > ROLLING || skid !== undefined)) {
          const tyres = {
            kind: "tyres",
            speed,
            skid: skid?.amount ?? 0,
            slip: skid?.slip ?? 0,
            surface: skid?.surface ?? surfaceAt(v.x, v.y, level),
            heavy: v.model === "truck",
          } as const
          frame.hold(`tyres:${v.id}`, tyres, frame.path(key, at, LEVELS.tyres, { doppler: true }))
        }
        // A wreck burns, however still it lies, until it blows up; its engine is dead, and with it the horn and the siren.
        if (v.burning)
          frame.hold(
            `fire:${v.id}`,
            { kind: "fire" },
            frame.path(key, at, LEVELS.fire, { doppler: true }),
          )
        if (v.mine && v.running && heard.horn && v.model !== "carabinieri") {
          frame.hold(
            `horn:${v.id}`,
            { kind: "horn", model: v.model },
            frame.path(key, at, LEVELS.horn, { doppler: true }),
          )
        }
        if (sirens.has(v.id))
          frame.hold(
            `siren:${v.id}`,
            { kind: "siren" },
            frame.path(key, at, LEVELS.siren, { doppler: true }),
          )
        if (v.running && v.model === "truck" && forward < REVERSING)
          frame.hold(
            `beeper:${v.id}`,
            { kind: "beeper" },
            frame.path(key, at, LEVELS.beeper, { doppler: true }),
          )
        // Its body down on the ground grinds along it while it slides: the roof, a side, or the belly beached on a bank.
        if (v.hullDown && speed > SCRAPING) scrape(v.id, GROUND[surfaceAt(v.x, v.y, level)], now)
        // A car the player's train drags grinds along their own train: heard as their own car's scrape.
        const grinding = scrapes.get(v.id),
          own = v.id === mine || (mine !== undefined && grinding?.by === mine)
        if (grinding !== undefined)
          frame.hold(
            `scrape:${v.id}`,
            { kind: "scrape", speed, material: grinding.material },
            frame.path(own ? undefined : key, at, LEVELS.scrape, { doppler: true, cabin: !own }),
          )
      }

      car = mine
      model = mine === undefined ? undefined : byId.get(mine)?.model
      running = new Set(heard.vehicles.flatMap((v) => (v.running ? [v.id] : [])))
      horn = heard.horn
    },
  }
}
