/**
 * The audio schedule: once per animation frame it projects what can be heard into plain `Heard`
 * data (the player's ears; vehicles someone drives, that move or that burn, on the tiles in memory
 * (farther ones stand frozen, out of earshot), with the drivetrain's revs and load from their worn
 * engines, their damage, whether they burn, whether their wheels or their body are down and how
 * their tyres skid; people on foot, with who they are, what they are
 * doing and who they walk with; the animals; every train, car by car, and the level crossings'
 * bells (./rail.ts); the Impact, Honk, Cry, Explosion, Lightning and Whistle events since the last
 * frame, each impact with the bodies it struck, those with trains rewritten as steel; the horn key;
 * the game clock's day, time and sun, and a copy of the weather) and hands it to the `Audio` service.
 * No acoustics here: the director behind the service decides what is loud enough and where it sits,
 * and works out the weather at the ears.
 * Read-only towards the world, like render (render/__tests__/index.test.ts checks every described schedule).
 *
 * @module audio
 */
import { Descriptor } from "@typeonce/ritmo"

import { forwardSpeed } from "../sim/body.ts"
import { hullDown, overturned } from "../sim/chassis.ts"
import { burning, destroyed } from "../sim/damage.ts"
import { engineRevs } from "../sim/drivetrain.ts"
import {
  Animal,
  CarInput,
  Chassis,
  Cry,
  Damage,
  Dead,
  Down,
  Driving,
  Explosion,
  Follows,
  Game,
  GameClock,
  Honk,
  Impact,
  Input,
  LevelCrossings,
  Lightning,
  Motion,
  Pedestrian,
  Person,
  Player,
  Pose,
  Roam,
  Skid,
  Time,
  Traffic,
  Train,
  TrainMotion,
  Vehicle,
  View,
  Weather,
  Whistle,
} from "../sim/index.ts"
import { groundZ } from "../sim/map/ground.ts"
import { daysFromCivil, romeTime } from "../sim/sky/calendar.ts"
import { sunOver } from "../sim/sky/day.ts"
import { VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { followYaw, QUARTER } from "../sim/view.ts"
import { exactAt, groundAt } from "./ground.ts"
import type { HeardTrain } from "./rail-types.ts"
import { heardCrossings, heardTrain, railImpact } from "./rail.ts"
import type {
  Body,
  Happening,
  Heard,
  HeardAnimal,
  HeardPerson,
  HeardSky,
  HeardVehicle,
  Skidding,
  Zone,
} from "./types.ts"

/** The host's ears: gets one `Heard` per frame while there is a player. */
export const Audio = Descriptor.Service<{ readonly hear: (heard: Heard) => void }>()(
  "Lunigiana/Audio",
)

/** Below this speed (m/s) and rate (rad/s), planar or of the body on its springs, a vehicle nobody drives is silent. */
const STILL = 0.01
/** A centre of mass this far (m) above where it sits at rest has lifted the wheels off the ground (TUNED: past the suspension's droop). */
const AIRBORNE = 0.3

/** The face of a body that struck the ground. */
type Face = NonNullable<Descriptor.Descriptor.Value<typeof Impact>["face"]>
/** The zone of the body a ground hit lands on, by the face that struck: the roof is heard as a side (no bumper, no airbag; the glass goes). */
const FACE_ZONE = {
  under: "under",
  roof: "side",
  side: "side",
  front: "front",
  rear: "rear",
} as const satisfies Record<Face, Zone>

/** Where (x, y) lies on a vehicle of `model` at `pose`: by the face of its L × W box it is nearest in proportion, the front, the rear or a side. */
const zoneOf = (
  model: VehicleModel,
  pose: { readonly x: number; readonly y: number; readonly angle: number },
  x: number,
  y: number,
): Zone => {
  const { length, width } = VEHICLES[model],
    dx = x - pose.x,
    dy = y - pose.y,
    fx = Math.cos(pose.angle),
    fy = Math.sin(pose.angle)
  const along = (dx * fx + dy * fy) / length,
    across = Math.abs(dy * fx - dx * fy) / width
  return along > across ? "front" : -along > across ? "rear" : "side"
}

/** The sky at game time `seconds` (Unix UTC): the Rome day and time of day, and the sun's elevation over the map. */
export const skyAt = (seconds: number): HeardSky => {
  const { year, month, day, hour, minute } = romeTime(seconds)
  return {
    seconds,
    day: daysFromCivil(year, month, day),
    hour,
    minute,
    sun: sunOver(seconds).elevation,
  }
}

const Hear = Game.System(
  "Lunigiana/Hear",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          driving: Game.Query.optional(Driving),
        },
        with: [Player],
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          vehicle: Game.Query.read(Vehicle),
          input: Game.Query.read(CarInput),
          chassis: Game.Query.read(Chassis),
          damage: Game.Query.read(Damage),
          traffic: Game.Query.optional(Traffic),
        },
      }),
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          person: Game.Query.read(Person),
          pedestrian: Game.Query.optional(Pedestrian),
          follows: Game.Query.optional(Follows),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          player: Game.Query.optional(Player),
        },
        without: [Driving],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          animal: Game.Query.read(Animal),
          roam: Game.Query.read(Roam),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
        },
      }),
      trains: Game.Query({
        selection: { train: Game.Query.read(Train), motion: Game.Query.read(TrainMotion) },
      }),
    },
    resources: {
      input: Game.System.readResource(Input),
      view: Game.System.readResource(View),
      time: Game.System.readResource(Time),
      clock: Game.System.readResource(GameClock),
      weather: Game.System.readResource(Weather),
      crossings: Game.System.readResource(LevelCrossings),
    },
    events: {
      impacts: Game.System.readEvent(Impact),
      honks: Game.System.readEvent(Honk),
      skids: Game.System.readEvent(Skid),
      cries: Game.System.readEvent(Cry),
      lightning: Game.System.readEvent(Lightning),
      explosions: Game.System.readEvent(Explosion),
      whistles: Game.System.readEvent(Whistle),
    },
    services: { audio: Game.System.service(Audio) },
  },
  ({ queries, resources, events, services }) => {
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const me = found.value.data
    const pose = me.pose.get(),
      motion = me.motion.get()
    const driving = me.driving.value()
    const car = driving === undefined ? undefined : Game.Entity.id(driving.vehicle)
    const { step } = resources.time.get()
    // Each car's wheels sliding since the last frame: the most past grip, the fastest, and the surface under the one furthest past.
    const skids = new Map<number, Skidding>()
    for (const skid of events.skids.all()) {
      const was = skids.get(skid.car)
      skids.set(skid.car, {
        amount: Math.max(skid.amount, was?.amount ?? 0),
        slip: Math.max(skid.slip, was?.slip ?? 0),
        surface: was === undefined || skid.amount > was.amount ? skid.surface : was.surface,
      })
    }
    // Every vehicle's body, parked ones too: a struck parked car is not heard otherwise.
    const bodies = new Map<
      number,
      {
        readonly model: VehicleModel
        readonly x: number
        readonly y: number
        readonly angle: number
      }
    >()
    const vehicles = queries.vehicles.each().flatMap(({ entity, data }): Array<HeardVehicle> => {
      const at = data.pose.get(),
        v = data.motion.get(),
        chassis = data.chassis.get(),
        { model } = data.vehicle.get()
      bodies.set(entity.id, { model, ...at })
      const mine = entity.id === car,
        wear = data.damage.get(),
        damage = wear.amount,
        fire = burning(wear)
      // A destroyed engine is dead, whoever sits at the wheel; its fire is heard however still the wreck lies, until it blows up.
      const running = (mine || data.traffic.present) && !destroyed(damage)
      const moving = v.vx * v.vx + v.vy * v.vy > STILL * STILL || v.spin !== 0
      const shaking =
        Math.max(Math.abs(chassis.vz), Math.abs(chassis.pitchRate), Math.abs(chassis.rollRate)) >
        STILL
      // One off the tiles in memory stands frozen a kilometre or more from the player (the host keeps the tiles nearer):
      // too far to hear, and the ground the director would read under it is not there.
      if ((!running && !moving && !shaking && !fire) || !exactAt(at.x, at.y)) return []
      const spec = VEHICLES[model],
        revs = engineRevs(
          spec,
          chassis,
          forwardSpeed(v, at.angle),
          data.input.get().throttle,
          step,
          { damage, seed: entity.id },
        )
      const lift = chassis.z - groundZ(at.x, at.y, chassis.z - spec.cg) - spec.cg,
        skid = skids.get(entity.id)
      return [
        {
          id: entity.id,
          model,
          x: at.x,
          y: at.y,
          z: chassis.z,
          angle: at.angle,
          vx: v.vx,
          vy: v.vy,
          rpm: revs.rpm,
          load: revs.load,
          wheelsDown: !overturned(chassis) && lift < AIRBORNE,
          hullDown: hullDown(model, at, chassis),
          ...(skid === undefined ? {} : { skid }),
          running,
          mine,
          damage,
          misfire: revs.misfire,
          burning: fire,
        },
      ]
    })
    /** Vehicle `id`'s model and the zone of it a hit at (x, y) landed on (by the face that struck, for a ground hit); undefined once it is gone. */
    const bodyAt = (id: number, x: number, y: number, face?: Face): Body | undefined => {
      const found = bodies.get(id)
      return found === undefined
        ? undefined
        : {
            model: found.model,
            zone: face === undefined ? zoneOf(found.model, found, x, y) : FACE_ZONE[face],
          }
    }
    // Who walks with whom: each follower with its leader, and a leader with the first person following it (a dog on a lead is no partner).
    const partners = new Map<number, number>()
    for (const { entity, data } of queries.people.each()) {
      const follows = data.follows.value()
      if (follows === undefined) continue
      const leader = Game.Entity.id(follows.leader)
      partners.set(entity.id, leader)
      if (!partners.has(leader)) partners.set(leader, entity.id)
    }
    const people = queries.people.each().map(({ entity, data }): HeardPerson => {
      const at = data.pose.get(),
        v = data.motion.get(),
        { age, female } = data.person.get(),
        ped = data.pedestrian.value(),
        partner = partners.get(entity.id)
      return {
        id: entity.id,
        x: at.x,
        y: at.y,
        vx: v.vx,
        vy: v.vy,
        player: data.player.present,
        age,
        female,
        mood: ped?.mood ?? "walk",
        fx: ped?.fx ?? at.x,
        fy: ped?.fy ?? at.y,
        down: data.down.present,
        dead: data.dead.present,
        ...(partner === undefined ? {} : { with: partner }),
      }
    })
    const animals = queries.animals.each().map(({ entity, data }): HeardAnimal => {
      const at = data.pose.get(),
        v = data.motion.get(),
        { species, size } = data.animal.get()
      return {
        id: entity.id,
        species,
        x: at.x,
        y: at.y,
        vx: v.vx,
        vy: v.vy,
        size,
        mood: data.roam.get().mood,
        down: data.down.present,
        dead: data.dead.present,
      }
    })
    const trains = new Map<number, HeardTrain>()
    for (const { entity, data } of queries.trains.each()) {
      const train = heardTrain(
        entity.id,
        data.train.get().model,
        data.motion.get(),
        entity.id === car,
      )
      if (train !== undefined) trains.set(entity.id, train)
    }
    const happenings: Array<Happening> = [
      // A vehicle despawned since its hit is no longer heard.
      ...events.impacts.all().flatMap((hit): ReadonlyArray<Happening> => {
        const rail = railImpact(hit, bodyAt, trains)
        if (rail !== undefined) return rail
        if (hit.hit === "train") return []
        const kind = hit.hit
        const body = bodyAt(hit.car, hit.x, hit.y, hit.face),
          otherBody =
            hit.hit === "car" && hit.other !== undefined
              ? bodyAt(hit.other, hit.x, hit.y)
              : undefined
        if (body === undefined || (hit.hit === "car" && otherBody === undefined)) return []
        return kind === "person" || kind === "animal"
          ? [{ kind: "impact", ...hit, hit: kind, body }]
          : [
              {
                kind: "impact",
                ...hit,
                hit: kind,
                body,
                ...(otherBody === undefined ? {} : { otherBody }),
              },
            ]
      }),
      ...events.honks.all().map((honk) => ({ kind: "honk" as const, ...honk })),
      ...events.cries.all().map((cry) => ({ kind: "cry" as const, ...cry })),
      ...events.lightning.all().map(({ x, y, bolt, power, seed }) => ({
        kind: "lightning" as const,
        x,
        y,
        bolt,
        power,
        seed,
      })),
      ...events.explosions
        .all()
        .map(({ car, x, y, z }) => ({ kind: "explosion" as const, car, x, y, z })),
      // At the train's nose: its cab's rail head (the ground knows no rail decks).
      ...events.whistles.all().map(({ train, x, y, urgent }) => ({
        kind: "whistle" as const,
        train,
        x,
        y,
        z: trains.get(train)?.cars[0]?.z ?? groundAt(x, y),
        urgent,
      })),
    ]
    services.audio.hear({
      listener: {
        x: pose.x,
        y: pose.y,
        vx: motion.vx,
        vy: motion.vy,
        car,
        yaw: car === undefined ? resources.view.get().turns * QUARTER : followYaw(pose.angle),
      },
      vehicles,
      people,
      animals,
      trains: [...trains.values()],
      crossings: heardCrossings(resources.crossings.get(), step),
      happenings,
      horn: resources.input.get().actions.horn.held,
      sky: skyAt(resources.clock.get().seconds),
      weather: { ...resources.weather.get() },
    })
  },
)

/** The audio schedule, ticked once per animation frame after `render` (its first tick right after `setup`, so no event is missed). */
export const audio = Game.Schedule(Hear)
