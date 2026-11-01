import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"
import { Vec2 } from "@typeonce/ritmo-math"

import {
  Animal,
  bindings,
  Dead,
  Follows,
  Game,
  KeyboardInput,
  makeRuntime,
  Pedestrian,
  Person,
  Pose,
  setup,
  update,
} from "../index.ts"
import { noTrains } from "../rail/testing.ts"
import { PEDESTRIANS, peopleOut } from "../systems/populate.ts"
import { start, teleport } from "../testing.ts"
import { GRAGNOLA, ISOLATED, RURAL, share, VINCA } from "./spots.ts"

/** The people and the living dogs on a lead, with what the population tests read: look, party and whether they are alive. */
const People = Game.Inspector(
  "Test/People",
  {
    queries: {
      people: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          person: Game.Query.read(Person),
          ped: Game.Query.read(Pedestrian),
          follows: Game.Query.optional(Follows),
          dead: Game.Query.optional(Dead),
        },
      }),
      // A dog a car killed lies where it fell, its lead let go: only the living walk with their owner.
      leashed: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          animal: Game.Query.read(Animal),
          follows: Game.Query.read(Follows),
        },
        without: [Dead],
      }),
    },
  },
  ({ queries }) => ({
    people: queries.people.each().map(({ entity, data }) => {
      const follows = data.follows.value()
      return {
        id: entity.id,
        ...data.pose.get(),
        look: data.person.get(),
        mood: data.ped.get().mood,
        dead: data.dead.present,
        leader: follows === undefined ? undefined : Game.Entity.id(follows.leader),
      }
    }),
    dogs: queries.leashed.each().map(({ data }) => ({
      ...data.pose.get(),
      species: data.animal.get().species,
      leader: Game.Entity.id(data.follows.get().leader),
    })),
  }),
)

/** A runtime with the player standing at `at` (nobody else about yet), and a reader of its people. */
const standAt = (at: Vec2.Vec2) => {
  const sim = start([], [{ ...at, angle: 0 }])
  assert.ok(sim.runtime.tick(Game.Schedule(teleport({ ...at, angle: 0 }))).ok)
  return { ...sim, people: () => sim.runtime.inspect(People) }
}

// A centre fills once and few join later, and 9 % of parties walk a dog (PARTY_WEIGHTS), so one
// seeded fill may draw none: Gragnola's has drawn none since the rail moved onto the CTR (240 s
// watched). The sightings of both centres count.
test("populate: Gragnola's and Vinca's centres fill to their targets in parties; kids and dogs keep beside their grown-up", () => {
  let dogs = 0
  // How far each kid walking with its walking parent is from it, every half second.
  const gaps: Array<number> = []
  for (const centre of [GRAGNOLA, VINCA]) {
    const { run, people } = standAt(centre)
    const target = peopleOut(centre.x, centre.y)
    let most = 0
    run(2400, (frame) => {
      if (frame % 30 !== 29) return
      const { people: all, dogs: leashed } = people()
      const living = all.filter((p) => !p.dead)
      most = Math.max(most, living.length)
      assert.ok(
        living.length <= Math.min(PEDESTRIANS.max, target + 2),
        `${living.length} people out`,
      )
      const byId = new Map(all.map((p) => [p.id, p]))
      for (const kid of all.filter((p) => p.look.age === "kid")) {
        const parent = kid.leader === undefined ? undefined : byId.get(kid.leader)
        assert.ok(parent !== undefined && parent.look.age !== "kid", "a kid is never out alone")
        if (parent.mood === "walk" && kid.mood === "walk") gaps.push(Vec2.distance(kid, parent))
      }
      for (const dog of leashed) {
        const owner = byId.get(dog.leader)
        if (owner?.mood !== "walk") continue
        dogs++
        assert.ok(
          dog.species === "dog" && Vec2.distance(dog, owner) < 6,
          `dog ${Vec2.distance(dog, owner).toFixed(2)} m from its owner`,
        )
      }
    })
    assert.ok(most >= target - 2, `${centre.x}: ${most} people out of a target of ${target}`)
  }
  assert.ok(gaps.length > 0 && dogs > 0, `${gaps.length} kid and ${dogs} dog sightings`)
  // Kids walk beside their parent: a kid left behind by a flight (it runs slower) catches up within a few seconds.
  assert.ok(
    share(gaps, (d) => d < 2) > 0.9 && Math.max(...gaps) < 6,
    `kids from their parent: ${gaps.map((d) => d.toFixed(1)).join(" ")}`,
  )
})

test("populate: nobody comes out on the rural road or by a lone house over a minute", () => {
  for (const at of [RURAL, ISOLATED]) {
    const { run, people } = standAt(at)
    run(3600, (frame) => {
      if (frame % 60 === 59)
        assert.equal(people().people.length, 0, `people out at ${at.x},${at.y}`)
    })
  }
})

/** Everyone out talking: where they stand and whom they face. */
const Talkers = Game.Inspector(
  "Test/Talkers",
  {
    queries: {
      people: Game.Query({
        selection: { pose: Game.Query.read(Pose), ped: Game.Query.read(Pedestrian) },
      }),
    },
  },
  ({ queries }) =>
    queries.people
      .each()
      .map(({ entity, data }) => ({ id: entity.id, ...data.pose.get(), ...data.ped.get() })),
)

test("parties: neighbours stop in the street to talk face to face, then go their ways", () => {
  let pairs = 0,
    natural = 0
  // Many chats at the start are broken off by the traffic, a horn or a crash: of the 18 pairs over seeds 1-24, 9 ran their
  // course. Seed 12 has one pair, which runs its course; seed 20 three, one of which does.
  for (const seed of [12, 20]) {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    // By Monzone station: no train, as in every test that does not ask for one.
    assert.ok(made.ok && made.value.tick(noTrains, setup).ok)
    const runtime = made.value
    const talking = runtime.inspect(Talkers).filter((p) => p.mood === "chat")
    const partner = new Map<number, number>()
    for (const p of talking) {
      // Each faces the other, a conversation's distance away.
      const other = talking.find(
        (o) => o.id !== p.id && Vec2.distance(o, { x: p.fx, y: p.fy }) < 0.01,
      )
      assert.ok(other !== undefined && Vec2.distance(p, other) < 1.5, `${p.id} talks to nobody`)
      assert.ok(
        Vec2.distance({ x: other.fx, y: other.fy }, p) < 0.01,
        `${p.id} and ${other.id} face each other`,
      )
      partner.set(p.id, other.id)
    }
    pairs += talking.length / 2
    if (talking.length === 0) continue
    // The chat ends within two minutes, and each walks off its own way: 3 s after a chat that ran its course, the two are well
    // apart (one broken off by a passing car or a horn ends with both looking, where they stand). Once out of it, a talker may
    // meet someone and stop for a new chat (perceive.ts), so what counts is leaving the chat it began in.
    const ended = new Set<number>(),
      left = new Set<number>()
    // Watched until every talker has left its chat and the 3 s after each that ran its course are checked.
    const done = (step: number) =>
      left.size === talking.length &&
      talking.every((p) => !ended.has(p.id) || step >= p.until + 180)
    for (let step = 1; step <= 125 * 60 && !done(step - 1); step++) {
      assert.ok(runtime.tick(update).ok)
      const now = new Map<number, (typeof talking)[number]>(
        runtime.inspect(Talkers).map((o) => [o.id, o]),
      )
      for (const p of talking) {
        const me = now.get(p.id),
          other = now.get(partner.get(p.id)!)
        if (me?.mood !== "chat") left.add(p.id)
        if (me === undefined || other === undefined) continue
        if (step === p.until - 1 && me.mood === "chat" && other.mood === "chat") ended.add(p.id)
        if (ended.has(p.id) && step === p.until + 180) {
          assert.ok(
            Vec2.distance(me, other) > 3,
            `seed ${seed}: ${p.id} and ${other.id} ${Vec2.distance(me, other).toFixed(2)} m apart 3 s after parting`,
          )
        }
      }
    }
    natural += ended.size / 2
    for (const p of talking)
      assert.ok(left.has(p.id), `seed ${seed}: ${p.id} still talking after two minutes`)
  }
  assert.ok(pairs >= 2, `${pairs} pairs of neighbours talking at the start over 2 seeds`)
  assert.ok(natural >= 1, `${natural} chats ran their course`)
})
