import { Clock } from "@typeonce/ritmo"
import { Random, Vec2 } from "@typeonce/ritmo-math"

import { onLevel } from "../rail/bodies.ts"
import { railSense } from "../rail/senses.ts"
import { cruiseSpeed, roadOf, trafficIndex } from "../route.ts"
import {
  Cry,
  Dead,
  Down,
  Driving,
  type Feeling,
  Follows,
  Footing,
  Game,
  Honk,
  Impact,
  LevelCrossings,
  type Look,
  type Mood,
  Motion,
  Pedestrian,
  type PedestrianValue,
  Person,
  Player,
  Pose,
  Rng,
  Route,
  STEP,
  Time,
  Train,
  TrainMotion,
  Vehicle,
  Whistle,
  Witness,
} from "../schema.ts"
import { footingAt } from "./footing.ts"
import { FLEE_TIME, runFrom, sameRoute } from "./pedestrians.ts"
import {
  alarm,
  type Car,
  carOf,
  DANGER,
  endangers,
  honkedAt,
  inSight,
  USUAL,
  vergeAway,
} from "./senses.ts"

/** How strong each mood is: a stimulus takes over only a mood it ranks at least as high as, unless that mood has run out. */
const RANK = { walk: 0, chat: 1, look: 2, gather: 3, shock: 4, flee: 5 } as const satisfies Record<
  Mood,
  number
>
/** The moods a stimulus or a follow-up sets, which followers copy from their leader. */
const reacting = (mood: Mood): boolean => mood !== "walk" && mood !== "chat"

/** Whole steps in `seconds` of data (a random duration). */
const stepsOf = (seconds: number): number => Math.max(1, Math.round(seconds * STEP.hz))

/**
 * Speeding: a vehicle faster than 13.9 m/s (50 km/h, the limit in built-up areas, Codice della Strada art. 142) within 15 m,
 * or faster than 8.3 m/s (30 km/h, a village's zona 30) within 6 m, draws a look and, half the time, an angry cry (TUNED).
 * Only a vehicle faster than USUAL × the street's own traffic (`cruiseSpeed`) counts: people do not glare at every car on the
 * main road, whose traffic keeps 12 m/s 1 m from the verge.
 */
const SPEEDING = [
  { speed: 13.9, range: 15 },
  { speed: 8.3, range: 6 },
] as const
const SPEEDING_LOOK = Clock.duration(STEP, 2.5)
const SPEEDING_ANGER = 0.5
/**
 * Someone struck by a vehicle (TUNED): seen within SIGHT m with no wall between, or heard within HEAR m; within NEAR m of the
 * car the witness runs from it for FLEE s, and once clear, a death shocks them too. A death shocks for SHOCK s; a knockdown
 * draws a look of LOOK s (the victim is up and running after 2.5 s, so nobody goes over); an animal hit, a look (or shock) of
 * BEAST s.
 */
const STRUCK = { sight: 40, hear: 15, near: 8 } as const
const STRUCK_FLEE = Clock.duration(STEP, 6)
const STRUCK_SHOCK = Clock.duration(STEP, 3)
const STRUCK_LOOK = Clock.duration(STEP, 4)
const BEAST_LOOK = Clock.duration(STEP, 3)
/** A dead person within this many metres, in sight, shocks someone walking past (not in a cooldown) for BODY_SHOCK (TUNED). */
const BODY_RANGE = 10
const BODY_SHOCK = Clock.duration(STEP, 2.5)
/**
 * After a death, a grown-up without children who can see the body stays by it with this chance, for GATHER_DEATH seconds,
 * while fewer than GATHER_MOST already do; everyone else runs from there for STRUCK_FLEE (TUNED). Gatherers count for a victim
 * within CROWD m of it.
 */
const GATHER_SHARE = 0.4
const GATHER_MOST = 4
const GATHER_DEATH = [20, 40] as const
const CROWD = 3
/** A crash (a vehicle into a wall, another vehicle or the ground) faster than CRASH_SPEED m/s within CRASH_RANGE m (TUNED). */
const CRASH_SPEED = 6
const CRASH_RANGE = 35
const CRASH_LOOK = Clock.duration(STEP, 3)
const CRASH_SURPRISE = 0.6
/**
 * A horn within HORN_RANGE m draws a look (TUNED); the one it is meant for (`honkedAt`: the traffic AI honks at whoever holds
 * it up), out of a cooldown, it angers HORN_ANGER of the time. A horn at someone else's back is no
 * provocation: 41 AI honks a minute in Gragnola's centre made bystanders yell 7 times a minute.
 */
const HORN_RANGE = 12
const HORN_LOOK = Clock.duration(STEP, 1.5)
const HORN_ANGER = 0.3
/** A train's whistle draws a look of WHISTLE_LOOK (within `WHISTLE_RANGE`, rail/senses.ts), and its alarm a flight in fright from its path. */
const WHISTLE_LOOK = Clock.duration(STEP, 1.5)
/** A train's car farther than this, m, is out of a walker's danger and speeding senses (1.5 s at 130 km/h and half a car). */
const TRAIN_SENSED = 80
/** Holding short of a level crossing closing to them, someone stands watching, renewed each step (rail/senses.ts). */
const HOLD_LOOK = Clock.duration(STEP, 1)
/** Someone running away within PANIC_RANGE m draws a look toward what they run from (TUNED); a look never spreads further. */
const PANIC_RANGE = 8
const PANIC_LOOK = Clock.duration(STEP, 2)
/** The player on foot faster than SHOVE_SPEED m/s within SHOVE_RANGE m (TUNED). */
const SHOVE_SPEED = 3
const SHOVE_RANGE = 1
const SHOVE_LOOK = Clock.duration(STEP, 2)
const SHOVE_ANGER = 0.7
/**
 * Two calm grown-ups from different parties within CHAT_RANGE m start talking at CHAT_RATE per second, for CHAT_TIME seconds
 * (TUNED).
 */
const CHAT_RANGE = 1.6
const CHAT_RATE = 0.35
const CHAT_TIME = [8, 25] as const
/** A chat goes on while the partner, still chatting, stands within this many metres of where it was (m). */
const PARTNER = 1
/**
 * After a reaction or a chat, a walker neither chats nor reacts to a body again for this long; after one about a body (a gather,
 * a vigil, a flight from it), SHAKEN, so nobody makes small talk a minute after a killing (TUNED).
 */
const COOLDOWN = Clock.duration(STEP, 30)
const CHAT_COOLDOWN = Clock.duration(STEP, 45)
const SHAKEN = Clock.duration(STEP, 180)
/**
 * A grown-up whose child or partner was killed, or a partner whose leader was, stays by the body this long, then walks on
 * (TUNED). A child whose parent was killed stays by the body until it is taken away (despawned with it), never walking alone.
 */
const VIGIL = Clock.duration(STEP, 120)
/** While a party member lies knocked down, the others stay by them, renewed for this long while they lie there. */
const BESIDE = Clock.duration(STEP, 1)
/**
 * A witness's, a shock's and a gather's point keeps to the body lying nearest it within this many metres: a body slides after
 * it is thrown (m).
 */
const TRACK = 2
/** An orphaned child goes back to a body within this many metres when something drove it off (m). */
const ORPHAN_REACH = 40

/** What a stimulus calls for: a mood for `steps`, about (x, y), and a cry it draws with `chance` when the mood changes into it. */
interface Reaction {
  readonly mood: "look" | "shock" | "flee"
  readonly steps: number
  readonly x: number
  readonly y: number
  readonly feeling: Feeling | undefined
  readonly chance: number
  /** It saw a person killed or lying dead (see `Witness`). */
  readonly witness: boolean
  /** What a flight runs from: (x, y), or the car that killed someone at (x, y). */
  readonly from: Vec2.Vec2
  /** It cries out even in the mood it is in: a car it was stepping aside from is now too close to stop. */
  readonly startled: boolean
  /** A vehicle's velocity, to step out of its path to the far verge. */
  readonly path: Vec2.Vec2 | undefined
}

/** How a reaction is felt: its cry and that cry's chance, whether it witnesses a death, what a flight runs from and a car's path. */
interface Cue {
  readonly feeling?: Feeling
  readonly chance?: number
  readonly witness?: boolean
  readonly from?: Vec2.Vec2
  readonly startled?: boolean
  readonly path?: Vec2.Vec2
}

const reaction = (
  mood: Reaction["mood"],
  steps: number,
  at: Vec2.Vec2,
  cue: Cue = {},
): Reaction => ({
  mood,
  steps,
  x: at.x,
  y: at.y,
  feeling: cue.feeling,
  chance: cue.chance ?? 1,
  witness: cue.witness ?? false,
  from: cue.from ?? { x: at.x, y: at.y },
  startled: cue.startled ?? false,
  path: cue.path,
})

/** A child cries out in surprise where a grown-up would in anger. */
const voiced = (look: Look, feeling: Feeling): Feeling =>
  look.age === "kid" && feeling === "anger" ? "surprise" : feeling

/** Whether `r` wins over `than`: a stronger mood, or on a tie a death seen over a car to dodge, which comes again next step. */
const stronger = (r: Reaction, than: Reaction) =>
  RANK[r.mood] > RANK[than.mood] || (RANK[r.mood] === RANK[than.mood] && r.witness && !than.witness)

const sameMood = (a: PedestrianValue, b: PedestrianValue) =>
  a.mood === b.mood &&
  a.until === b.until &&
  a.blocked === b.blocked &&
  a.fx === b.fx &&
  a.fy === b.fy

/**
 * Pedestrians take in what surrounds them and react (each step, after the contacts, so this step's hits count): a vehicle about
 * to hit them, a train's car on their level among them (flee, re-aimed at every threat, crying out only when it alarms them),
 * one speeding past (look, often in anger), someone struck (flee from the car if near, then shock at a death; shock at a death,
 * a look at a knockdown), a body met on the way (shock), a crash, a horn (look, in anger when it honks at them), a train's
 * whistle (look; its alarm sends whoever stands in its path off the track in fright), someone running away (look), the player
 * shoving past (look, in anger), a level crossing closing as their way leads onto its track (look, holding short of it). The strongest stimulus wins when it ranks at least as high as the current mood (or that has run out), and a
 * mood changing into a reaction may draw a `Cry`. Looks, gathers, flights and chats end in a calm walk with a cooldown, longer
 * after a death; a shock at a death ends in a choice to gather (when the body is in sight) or run. Two calm grown-ups passing
 * close may stop to chat. Followers copy their leader's reactions; one whose leader is gone walks alone. A party keeps by its
 * own: a leader stays by a follower lying down or dead, a follower by a leader killed, and a child left alone by the body.
 */
export const Perceive = Game.System(
  "Lunigiana/Perceive",
  {
    queries: {
      peds: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          look: Game.Query.read(Person),
          ped: Game.Query.write(Pedestrian),
          route: Game.Query.write(Route),
          follows: Game.Query.optional(Follows),
          witness: Game.Query.optional(Witness),
          down: Game.Query.optional(Down),
          dead: Game.Query.optional(Dead),
          footing: Game.Query.optional(Footing),
        },
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          motion: Game.Query.read(Motion),
          vehicle: Game.Query.read(Vehicle),
        },
      }),
      player: Game.Query({
        selection: { pose: Game.Query.read(Pose), motion: Game.Query.read(Motion) },
        with: [Player],
        without: [Driving],
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      crossings: Game.System.thisTick(Game.System.readResource(LevelCrossings)),
    },
    events: {
      impacts: Game.System.thisTick(Game.System.readEvent(Impact)),
      honks: Game.System.thisTick(Game.System.readEvent(Honk)),
      whistles: Game.System.thisTick(Game.System.readEvent(Whistle)),
      cries: Game.System.writeEvent(Cry),
    },
    commands: Game.System.commands(
      Game.System.inserts(Witness),
      Game.System.removes(Follows, Witness),
    ),
  },
  ({ queries, resources, events, commands }) => {
    const { step, dt } = resources.time.get()
    if (dt <= 0) return
    const random = Random.draw(resources.rng)
    const walkers = queries.peds.each().map((match) => {
      const { data } = match
      const motion = data.motion.get(),
        follows = data.follows.value()
      return {
        match,
        id: match.entity.id,
        at: data.pose.get(),
        velocity: { x: motion.vx, y: motion.vy },
        look: data.look.get(),
        leader: follows === undefined ? undefined : Game.Entity.id(follows.leader),
        down: data.down.present,
        dead: data.dead.present,
        witness: data.witness.present,
        mood: data.ped.get(),
        route: data.route.get(),
        footing: data.footing.value(),
      }
    })
    type Walker = (typeof walkers)[number]
    const byId = new Map(walkers.map((w) => [w.id, w]))
    const withKids = new Set(
      walkers.flatMap((w) =>
        w.leader !== undefined && w.look.age === "kid" && !w.dead ? [w.leader] : [],
      ),
    )
    // Each leader's followers lying knocked down or dead, whom it stays by.
    const fallen = new Map<number, Array<Walker>>()
    for (const w of walkers)
      if (w.leader !== undefined && (w.down || w.dead))
        fallen.set(w.leader, [...(fallen.get(w.leader) ?? []), w])
    const cars: ReadonlyArray<Car> = queries.vehicles.each().flatMap(({ entity, data }) => {
      const pose = data.pose.get(),
        { vx, vy } = data.motion.get()
      if (Math.sqrt(vx * vx + vy * vy) <= DANGER.slowest) return []
      const usual = cruiseSpeed(roadOf(trafficIndex.nearest(pose.x, pose.y)))
      return [carOf(entity.id, data.vehicle.get().model, pose, vx, vy, usual)]
    })
    const positions = new Map(
      queries.vehicles.each().map(({ entity, data }) => [entity.id as number, data.pose.get()]),
    )
    // The railway: the trains' moving cars (on their level only), their whistles, the crossings closing.
    const rail = railSense(
      queries.trains.each().map(({ entity, data }) => ({
        id: entity.id,
        motion: data.motion.get(),
        model: data.train.get().model,
      })),
      events.whistles.all(),
      resources.crossings.get(),
      step,
    )
    const bodies = walkers.filter((w) => w.dead).map((w) => w.at)
    const lying = walkers.filter((w) => w.dead || w.down).map((w) => w.at)
    const impacts = events.impacts.all(),
      honks = events.honks.all()
    const shover = queries.player
      .each()
      .map(({ data }) => ({ ...data.pose.get(), ...data.motion.get() }))
      .find((p) => p.vx * p.vx + p.vy * p.vy > SHOVE_SPEED ** 2)
    // Who is running away as the step begins (not stopping now): panic spreads from them, one hop.
    const fleeing = walkers
      .filter(
        (w) =>
          !w.down &&
          !w.dead &&
          w.leader === undefined &&
          w.mood.mood === "flee" &&
          w.mood.until > step,
      )
      .map((w) => ({ id: w.id, x: w.at.x, y: w.at.y, fx: w.mood.fx, fy: w.mood.fy }))
    const near = (a: Vec2.Vec2, b: Vec2.Vec2, range: number) =>
      Vec2.distanceSquared(a, b) < range * range

    // Who cried out this step: a child cries with its family, not at every step aside its parent takes.
    const cried = new Set<number>()
    const cry = (w: Walker, feeling: Feeling) => {
      events.cries.emit({ who: w.id, x: w.at.x, y: w.at.y, feeling })
      cried.add(w.id)
    }
    const witnessed = (w: Walker, saw: boolean) => {
      if (saw === w.witness) return
      if (saw) commands.insert(w.match.entity, [Witness, {}])
      else commands.remove(w.match.entity, Witness)
      w.witness = saw
    }
    const calm = (w: Walker, cooldown: Clock.Duration) => {
      w.mood = {
        mood: "walk",
        until: step + Clock.steps(cooldown),
        blocked: 0,
        fx: w.mood.fx,
        fy: w.mood.fy,
      }
      witnessed(w, false)
    }
    const flee = (w: Walker, from: Vec2.Vec2, steps: number) => {
      w.mood = { mood: "flee", until: step + steps, blocked: 0, fx: from.x, fy: from.y }
      w.route = runFrom(w.route, w.at, from)
    }
    const gather = (w: Walker, at: Vec2.Vec2, steps: number) => {
      w.mood = { mood: "gather", until: step + steps, blocked: 0, fx: at.x, fy: at.y }
    }

    /**
     * A leader stays by a follower lying down (while it lies there) or dead (one vigil, crying out as it begins; when the vigil is
     * over the dead stop counting as its party, and it walks on).
     */
    const keepBy = (w: Walker, lost: ReadonlyArray<Walker>) => {
      const dead = lost.find((f) => f.dead),
        { mood, fx, fy } = w.mood
      if (dead === undefined) gather(w, lost[0]!.at, Clock.steps(BESIDE))
      else if (mood === "gather" && near(dead.at, { x: fx, y: fy }, TRACK)) {
        for (const f of lost) if (f.dead) commands.remove(f.match.entity, Follows)
        fallen.delete(w.id)
        calm(w, SHAKEN)
      } else {
        if (mood !== "shock") cry(w, "shock")
        gather(w, dead.at, Clock.steps(VIGIL))
        witnessed(w, false)
      }
    }

    /**
     * A mood run out. A witness clear of the car that killed someone takes in the death (shock); a leader keeps by its fallen; a
     * child left alone stays by the body; a witness's shock ends in a choice to gather by the body, in sight, or run; anyone else
     * walks on, calm for a while (longer after a death).
     */
    const settle = (w: Walker) => {
      const { mood, fx, fy } = w.mood,
        victim = { x: fx, y: fy },
        lost = fallen.get(w.id)
      const orphan =
        w.look.age === "kid" ? bodies.find((b) => near(b, w.at, ORPHAN_REACH)) : undefined
      if (w.witness && mood === "flee") {
        w.mood = { mood: "shock", until: step + Clock.steps(STRUCK_SHOCK), blocked: 0, fx, fy }
        cry(w, "shock")
      } else if (lost !== undefined) keepBy(w, lost)
      else if (orphan !== undefined)
        gather(w, bodies.find((b) => near(b, victim, TRACK)) ?? orphan, Clock.steps(VIGIL))
      else if (w.witness && mood === "shock") {
        const crowd = walkers.filter(
          (o) => o.mood.mood === "gather" && near({ x: o.mood.fx, y: o.mood.fy }, victim, CROWD),
        ).length
        const grown = w.look.age !== "kid" && !withKids.has(w.id)
        if (grown && crowd < GATHER_MOST && inSight(w.at, victim) && random.next() < GATHER_SHARE)
          gather(w, victim, stepsOf(random.range(...GATHER_DEATH)))
        else flee(w, victim, Clock.steps(STRUCK_FLEE))
        witnessed(w, false)
      } else
        calm(
          w,
          mood === "chat"
            ? CHAT_COOLDOWN
            : bodies.some((b) => near(b, victim, TRACK))
              ? SHAKEN
              : COOLDOWN,
        )
    }

    /** Takes on `r` if it ranks at least as high as the mood; a change of mood into it may draw its cry. */
    const react = (w: Walker, r: Reaction) => {
      const was = w.mood
      if (RANK[r.mood] < RANK[was.mood]) return
      const changed = r.mood !== was.mood
      // A witness running from a killing keeps the victim as its point while it dodges a car on the way.
      const keep = !changed && w.witness && !r.witness
      w.mood = {
        mood: r.mood,
        until: changed ? step + r.steps : Math.max(was.until, step + r.steps),
        blocked: changed ? 0 : was.blocked,
        fx: keep ? was.fx : r.x,
        fy: keep ? was.fy : r.y,
      }
      // Every threat re-aims a flight: someone already running turns from a new one and steps out of a car's path too.
      if (r.mood === "flee") {
        w.route = runFrom(w.route, w.at, r.from)
        if (r.path !== undefined) w.route = vergeAway(w.route, w.at, r.from, r.path)
      }
      if (r.witness || changed) witnessed(w, r.witness)
      if ((changed || r.startled) && r.feeling !== undefined && random.next() < r.chance)
        cry(w, voiced(w.look, r.feeling))
    }

    /**
     * What `w` takes in this step, the first found winning a tie (`stronger`): danger (a train's cars on its level too), someone
     * struck, a body, a crash, speeding, a horn, a train's whistle, a shove, panic, a level crossing closing to it.
     */
    const stimuli = (w: Walker): Array<Reaction> => {
      const found: Array<Reaction> = []
      let ground: number | undefined
      const groundOf = () => (ground ??= footingAt(w.footing, w.at.x, w.at.y))
      // A train's cars within reach of its senses, on its level.
      const moving =
        rail.cars.length === 0
          ? cars
          : [
              ...cars,
              ...rail.cars.filter(
                (car) => near(w.at, car, TRAIN_SENSED) && onLevel(groundOf(), car.z),
              ),
            ]
      for (const car of moving) {
        if (!endangers(w.at, w.velocity, car)) continue
        const { alarming, fresh } = alarm(w.at, w.velocity, car, dt)
        found.push(
          reaction("flee", Clock.steps(FLEE_TIME), car, {
            feeling: alarming ? "fright" : undefined,
            startled: fresh,
            path: { x: car.vx, y: car.vy },
          }),
        )
      }
      for (const hit of impacts) {
        if (
          (hit.hit !== "person" && hit.hit !== "animal") ||
          hit.other === w.id ||
          !near(w.at, hit, STRUCK.sight)
        )
          continue
        if (!near(w.at, hit, STRUCK.hear) && !inSight(w.at, hit)) continue
        const car = positions.get(hit.car) ?? hit,
          killed = hit.hit === "person" && hit.fatal === true
        // Jumping back from the car, a witness of a killing keeps the victim in mind (its point) to take in once clear.
        if (near(w.at, car, STRUCK.near))
          found.push(
            reaction("flee", Clock.steps(STRUCK_FLEE), killed ? hit : car, {
              feeling: "fright",
              witness: killed,
              from: car,
            }),
          )
        else if (killed)
          found.push(
            reaction("shock", Clock.steps(STRUCK_SHOCK), hit, { feeling: "shock", witness: true }),
          )
        else if (hit.hit === "person")
          found.push(reaction("look", Clock.steps(STRUCK_LOOK), hit, { feeling: "surprise" }))
        else
          found.push(
            reaction(hit.fatal === true ? "shock" : "look", Clock.steps(BEAST_LOOK), hit, {
              feeling: hit.fatal === true ? "shock" : "surprise",
            }),
          )
      }
      if (w.mood.mood === "walk" && w.mood.until <= step) {
        const body = bodies.find((b) => near(w.at, b, BODY_RANGE) && inSight(w.at, b))
        if (body !== undefined)
          found.push(
            reaction("shock", Clock.steps(BODY_SHOCK), body, { feeling: "shock", witness: true }),
          )
      }
      for (const hit of impacts) {
        if (
          (hit.hit === "car" ||
            hit.hit === "wall" ||
            hit.hit === "ground" ||
            hit.hit === "train") &&
          hit.speed > CRASH_SPEED &&
          near(w.at, hit, CRASH_RANGE)
        ) {
          found.push(
            reaction("look", Clock.steps(CRASH_LOOK), hit, {
              feeling: "surprise",
              chance: CRASH_SURPRISE,
            }),
          )
        }
      }
      for (const car of moving) {
        if (
          car.speed > car.usual * USUAL &&
          SPEEDING.some(({ speed, range }) => car.speed > speed && near(w.at, car, range))
        ) {
          found.push(
            reaction("look", Clock.steps(SPEEDING_LOOK), car, {
              feeling: "anger",
              chance: SPEEDING_ANGER,
            }),
          )
        }
      }
      for (const honk of honks) {
        if (!near(w.at, honk, HORN_RANGE)) continue
        // Honked at again within a cooldown of its last reaction, it only looks: the traffic AI honks at whoever holds it up.
        const car = positions.get(honk.car),
          aimed =
            car !== undefined &&
            honkedAt(w.at, car) &&
            (w.mood.mood !== "walk" || w.mood.until <= step)
        found.push(
          reaction(
            "look",
            Clock.steps(HORN_LOOK),
            honk,
            aimed ? { feeling: "anger", chance: HORN_ANGER } : {},
          ),
        )
      }
      for (const heard of rail.whistled(w.at, groundOf))
        found.push(
          heard.mood === "flee"
            ? reaction("flee", Clock.steps(FLEE_TIME), heard, {
                feeling: "fright",
                path: heard.path,
              })
            : reaction("look", Clock.steps(WHISTLE_LOOK), heard),
        )
      if (shover !== undefined && near(w.at, shover, SHOVE_RANGE)) {
        found.push(
          reaction("look", Clock.steps(SHOVE_LOOK), shover, {
            feeling: "anger",
            chance: SHOVE_ANGER,
          }),
        )
      }
      for (const f of fleeing) {
        if (f.id !== w.id && near(w.at, f, PANIC_RANGE))
          found.push(reaction("look", Clock.steps(PANIC_LOOK), { x: f.fx, y: f.fy }))
      }
      const hold = rail.holding(w.at, w.route)
      if (hold !== undefined) found.push(reaction("look", Clock.steps(HOLD_LOOK), hold))
      return found
    }

    // Everyone on their feet who is not following someone: their own eyes and ears.
    for (const w of walkers) {
      if (w.down || w.dead || w.leader !== undefined) continue
      // A leader walking with a follower fallen goes back to it; anyone else when the mood runs out.
      if (w.mood.mood === "walk" ? fallen.has(w.id) : step >= w.mood.until) settle(w)
      const strongest = stimuli(w).reduce<Reaction | undefined>(
        (best, r) => (best === undefined || stronger(r, best) ? r : best),
        undefined,
      )
      if (strongest !== undefined) react(w, strongest)
      // A leader whose child or partner lies fallen stops running as soon as nothing comes at it any more.
      if (w.mood.mood === "flee" && fallen.has(w.id) && strongest?.mood !== "flee") settle(w)
      const { mood, fx, fy } = w.mood
      if (w.witness || mood === "shock" || mood === "gather") {
        // Keep to the body as it slides to a stop.
        const body = lying.find((b) => near(b, { x: fx, y: fy }, TRACK))
        if (body !== undefined) w.mood = { ...w.mood, fx: body.x, fy: body.y }
      } else if (mood === "chat") {
        const partner = walkers.find(
          (o) => o !== w && o.mood.mood === "chat" && near(o.at, { x: fx, y: fy }, PARTNER),
        )
        if (partner === undefined) calm(w, CHAT_COOLDOWN)
        else w.mood = { ...w.mood, fx: partner.at.x, fy: partner.at.y }
      }
    }

    // Followers: they react as their leader does, and stay by a leader on the ground.
    for (const w of walkers) {
      if (w.down || w.dead || w.leader === undefined) continue
      const lead = byId.get(w.leader)
      const was = w.mood
      if (lead === undefined) {
        commands.remove(w.match.entity, Follows)
        continue
      }
      if (lead.dead) {
        commands.remove(w.match.entity, Follows)
        gather(w, lead.at, Clock.steps(VIGIL))
      } else if (lead.down) gather(w, lead.at, Clock.steps(BESIDE))
      else if (reacting(lead.mood.mood)) w.mood = { ...lead.mood, blocked: 0 }
      else if (was.mood !== "walk")
        w.mood = { mood: "walk", until: 0, blocked: 0, fx: was.fx, fy: was.fy }
      const now = w.mood.mood
      if (now === was.mood || !reacting(now)) continue
      // A child cries out when its family runs crying out or one of them falls; a grown-up beside a fallen partner, in shock.
      if (
        w.look.age === "kid" &&
        ((now === "flee" && cried.has(lead.id)) || lead.down || lead.dead)
      )
        cry(w, "fright")
      else if (lead.dead) cry(w, "shock")
    }

    // Two calm grown-ups from different parties passing close may stop and talk, facing each other.
    const calmed = walkers.filter(
      (w) =>
        !w.down &&
        !w.dead &&
        w.leader === undefined &&
        w.look.age !== "kid" &&
        w.mood.mood === "walk" &&
        w.mood.until <= step,
    )
    const talking = new Set<Walker>()
    for (let i = 0; i < calmed.length; i++)
      for (let j = i + 1; j < calmed.length; j++) {
        const a = calmed[i]!,
          b = calmed[j]!
        if (
          talking.has(a) ||
          talking.has(b) ||
          !near(a.at, b.at, CHAT_RANGE) ||
          random.next() >= CHAT_RATE * dt
        )
          continue
        const until = step + stepsOf(random.range(...CHAT_TIME))
        a.mood = { mood: "chat", until, blocked: 0, fx: b.at.x, fy: b.at.y }
        b.mood = { mood: "chat", until, blocked: 0, fx: a.at.x, fy: a.at.y }
        talking.add(a).add(b)
      }

    for (const w of walkers) {
      if (!sameMood(w.mood, w.match.data.ped.get())) w.match.data.ped.set(w.mood)
      if (!sameRoute(w.route, w.match.data.route.get())) w.match.data.route.set(w.route)
    }
  },
)
