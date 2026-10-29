import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"
import { Random, Vec2 } from "@typeonce/ritmo-math"

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
import { graph, MAP } from "../map/index.ts"
import { PEOPLED, peopledIndex, residentsAlong, residentsNear } from "../population/density.ts"
import { FEMALE, lookOf } from "../population/looks.ts"
import { PLACES, randomParty } from "../population/parties.ts"
import { noTrains } from "../rail/testing.ts"
import { endNode, nextWalkEdge, walkIndex } from "../route.ts"
import type { Age, Look } from "../schema.ts"
import { ANIMALS } from "../systems/populate-animals.ts"
import { PEDESTRIANS, peopleOut } from "../systems/populate.ts"
import { start, teleport } from "../testing.ts"

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

/** The darker skin tones `lookOf` draws for a few people (looks.ts `DARKER_SKIN`). */
const DARKER_SKIN: ReadonlySet<number> = new Set([0xa8704f, 0x8a5a3c, 0x6b4630, 0x4a2f20])

/** The people out and the free animals, as setup leaves them. */
const Startup = Game.Inspector(
  "Test/Startup",
  {
    queries: {
      people: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Pedestrian] }),
      animals: Game.Query({
        selection: { pose: Game.Query.read(Pose), animal: Game.Query.read(Animal) },
        without: [Follows],
      }),
    },
  },
  ({ queries }) => ({
    people: queries.people.each().map(({ data }) => data.pose.get()),
    animals: queries.animals
      .each()
      .map(({ data }) => ({ ...data.pose.get(), species: data.animal.get().species })),
  }),
)

const share = <A>(items: ReadonlyArray<A>, is: (a: A) => boolean) =>
  items.filter(is).length / items.length
const mean = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0) / xs.length

test("looks: sexes, heights, hair and clothes by age, as the people of the Lunigiana villages", () => {
  const random = Random.make(7)
  const draw = (age: Age) => Array.from({ length: 6000 }, () => lookOf(random, age))
  const kids = draw("kid"),
    adults = draw("adult"),
    elders = draw("elder")
  for (const [age, looks] of [
    ["kid", kids],
    ["adult", adults],
    ["elder", elders],
  ] as const) {
    assert.ok(looks.every((l) => l.age === age))
    assert.ok(
      Math.abs(share(looks, (l) => l.female) - FEMALE[age]) < 0.03,
      `${age}: ${share(looks, (l) => l.female)} female`,
    )
    // A dress is the skirt in the shirt's colour.
    assert.ok(looks.filter((l) => l.outfit === "dress").every((l) => l.pants === l.shirt))
  }
  const men = adults.filter((l) => !l.female),
    women = adults.filter((l) => l.female)
  assert.ok(
    Math.abs(mean(men.map((l) => l.height)) - 1.75) < 0.01 &&
      Math.abs(mean(women.map((l) => l.height)) - 1.62) < 0.01,
  )
  assert.ok(
    [...adults, ...elders].every((l) => l.height > 1.35 && l.height < 2.05),
    "grown-ups within ±3 sd",
  )
  assert.ok(
    mean(elders.filter((l) => !l.female).map((l) => l.height)) <
      mean(men.map((l) => l.height)) - 0.03,
    "elders shorter",
  )
  assert.ok(
    kids.every((l) => l.height >= 1 && l.height < 1.45),
    "kids 1.00–1.45 m",
  )
  assert.ok(
    men.every((l) => l.outfit === "trousers" || l.outfit === "shorts") &&
      men.every((l) => l.hairdo === "short" || l.hairdo === "bald"),
  )
  const elderMen = elders.filter((l) => !l.female)
  assert.ok(
    elderMen.every((l) => l.outfit === "trousers"),
    "no shorts on elder men",
  )
  assert.ok(
    Math.abs(share(elderMen, (l) => l.hairdo === "bald") - 0.4) < 0.03 &&
      Math.abs(share(elderMen, (l) => l.hairdo === "cap") - 0.3) < 0.03,
  )
  assert.ok(
    share(
      elders.filter((l) => l.female),
      (l) => l.outfit !== "trousers",
    ) > 0.7,
    "elder women mostly in a skirt or dress",
  )
  assert.ok(share(women, (l) => l.hairdo === "long") > 0.4)
  // Variety: many skins (a few darker), many shirts; elders' hair has greyed.
  const all = [...kids, ...adults, ...elders]
  assert.ok(
    new Set(all.map((l) => l.skin)).size >= 8 && new Set(adults.map((l) => l.shirt)).size >= 10,
  )
  assert.ok(
    new Set(elders.filter((l) => !l.female).map((l) => l.hair)).size === 3,
    "elder men grey, white or salt and pepper",
  )
})

test("parties: kids only ever go out with a grown-up; the people out are about Fivizzano's ages", () => {
  const random = Random.make(3)
  const parties = Array.from({ length: 20000 }, () => randomParty(random))
  const people: Array<Look> = parties.flatMap((p) => [
    p.leader,
    ...p.people.map((f) => f.look),
    ...(p.neighbour === undefined ? [] : [p.neighbour.look]),
  ])
  assert.ok(
    parties.every((p) => p.leader.age !== "kid"),
    "a kid never leads",
  )
  for (const p of parties) {
    const kids = p.people.filter((f) => f.look.age === "kid")
    assert.ok(
      kids.length === 0 ||
        (kids.length === p.people.length && kids.length <= 2 && p.dog === undefined),
      "kids come in families of one or two",
    )
    assert.ok(kids.every((k) => Math.abs(k.side) === PLACES.kid.side && k.back === PLACES.kid.back))
    if (kids.length === 2)
      assert.equal(kids[0]!.side, -kids[1]!.side, "two kids walk one on each side")
    for (const f of p.people.filter((f) => f.look.age !== "kid")) {
      assert.ok(
        Math.abs(f.side) === PLACES.partner.side &&
          f.back === PLACES.partner.back &&
          f.look.age === p.leader.age,
        "a pair walks side by side, of an age",
      )
    }
    if (p.dog !== undefined)
      assert.ok(
        p.dog.look.species === "dog" &&
          Math.abs(p.dog.side) === PLACES.dog.side &&
          p.dog.back === PLACES.dog.back,
      )
  }
  // Fivizzano, 1 January 2025 (ISTAT): 7.7 % under 15, 53.8 % aged 15–64, 38.5 % over 65.
  const mix = {
    kid: share(people, (l) => l.age === "kid"),
    adult: share(people, (l) => l.age === "adult"),
    elder: share(people, (l) => l.age === "elder"),
  }
  assert.ok(
    Math.abs(mix.kid - 0.077) < 0.015 &&
      Math.abs(mix.adult - 0.538) < 0.03 &&
      Math.abs(mix.elder - 0.385) < 0.03,
    JSON.stringify(mix),
  )
  assert.ok(share(parties, (p) => p.dog !== undefined) > 0.08, "dogs on a lead")
})

test("parties: a family shares its origin, and a parent's natural hair runs in its kids", () => {
  const random = Random.make(3)
  const parties = Array.from({ length: 200000 }, () => randomParty(random))
  const darker = (l: Look) => DARKER_SKIN.has(l.skin)
  const families = parties.filter((p) => p.people[0]?.look.age === "kid"),
    pairs = parties.filter(
      (p) => p.people[0]?.look.age === "adult" || p.people[0]?.look.age === "elder",
    )
  assert.ok(
    families.length > 10000 && families.filter((p) => darker(p.leader)).length > 200,
    `${families.length} families`,
  )
  for (const p of families)
    for (const kid of p.people)
      assert.equal(darker(kid.look), darker(p.leader), "a kid has its parent's origin")
  // A pair is mostly of one origin: a darker-skinned leader's partner is too in about nine pairs of ten.
  const led = pairs.filter((p) => darker(p.leader))
  assert.ok(
    led.length > 500 && share(led, (p) => darker(p.people[0]!.look)) > 0.85,
    `${led.length} pairs led by a darker-skinned grown-up`,
  )
  // A kid's hair is its parent's natural shade or one fairer, where the parent's has not greyed and is not dyed.
  const ladder = [0x17161a, 0x2b1d14, 0x4a3222, 0x6e4a2e, 0x9c7a4a, 0xd4a85e]
  const natural = families.filter((p) => ladder.includes(p.leader.hair))
  assert.ok(natural.length > 5000, `${natural.length} families with a parent's natural hair`)
  for (const p of natural)
    for (const kid of p.people) {
      const step = ladder.indexOf(kid.look.hair) - ladder.indexOf(p.leader.hair)
      assert.ok(
        step === 0 || step === 1,
        `kid's hair ${kid.look.hair.toString(16)} by a parent's ${p.leader.hair.toString(16)}`,
      )
    }
  // Kids are still fairer than the grown-ups they walk with, as `KIDS_HAIR` has them.
  const kidsHair = natural.flatMap((p) => p.people.map((k) => ladder.indexOf(k.look.hair)))
  assert.ok(mean(kidsHair) > mean(natural.map((p) => ladder.indexOf(p.leader.hair))) + 0.3)
})

/** Calibrated spots: the village centres, and the SR445 between Gragnola and Monzone, with no house within 140 m. */
const GRAGNOLA = { x: -1751.2, y: 3360.4 },
  VINCA = { x: 2273, y: -2620 },
  RURAL = { x: -279, y: 3736 }
/** A lane by a lone house or two, between Equi Terme and Monzone: residents nearby, none of the walk edges around it peopled. */
const ISOLATED = { x: 1049, y: 1388 }

test("density: as many people are out as live nearby, and nobody on a country road or by a lone house", () => {
  const spots = [
    [-1751, 3360],
    [2273, -2620],
    [-34, -300],
    [-412, 438],
    [1804, 721],
    [RURAL.x, RURAL.y],
  ] as const
  // Gragnola, Vinca, Monzone Alto, Monzone's start, Equi Terme, the SR445.
  assert.deepEqual(
    spots.map(([x, y]) => peopleOut(x, y)),
    [18, 15, 10, 9, 9, 0],
  )
  assert.ok(residentsNear(ISOLATED.x, ISOLATED.y, 140) > 5, "people live by the isolated lane")
  assert.equal(
    peopledIndex.around(ISOLATED.x, ISOLATED.y, [0, PEDESTRIANS.spawn[1]]).length,
    0,
    "but none of its streets is peopled",
  )
})

test("walk choice: walkers keep to the streets people live on, and some still walk out of the village", () => {
  const walks = new Set(graph.walkEdges)
  const anyWay = (node: number, arrived: number, random: Random.Random) => {
    const edge =
      random.pick(graph.adjacency[node]!.filter((e) => e !== arrived && walks.has(e))) ?? arrived
    return { edge, forward: graph.edges[edge]!.a === node }
  }
  // 200 walkers from the centre, 1.5 km each: the share of the way on peopled streets, and how many end 300 m or more away.
  const stroll = (from: Vec2.Vec2, choose: typeof nextWalkEdge) => {
    const random = Random.make(5)
    let peopled = 0,
      all = 0,
      away = 0
    for (let walker = 0; walker < 200; walker++) {
      let step = { edge: walkIndex.nearest(from.x, from.y), forward: random.next() < 0.5 }
      for (
        let gone = 0;
        gone < 1500;
        step = choose(endNode(step.edge, step.forward), step.edge, random)
      ) {
        const length = graph.edges[step.edge]!.length
        gone += length
        all += length
        if (residentsAlong(step.edge) >= PEOPLED) peopled += length
      }
      if (Vec2.distance(graph.nodes[endNode(step.edge, step.forward)]!, from) > 300) away++
    }
    return { peopled: peopled / all, away: away / 200 }
  }
  for (const centre of [GRAGNOLA, VINCA]) {
    const kept = stroll(centre, nextWalkEdge),
      loose = stroll(centre, anyWay)
    assert.ok(
      kept.peopled > 0.85 && kept.peopled > loose.peopled + 0.2,
      `${centre.x}: ${JSON.stringify({ kept, loose })}`,
    )
  }
  assert.ok(stroll(GRAGNOLA, nextWalkEdge).away > 0.1, "some walk out of Gragnola")
})

test("walk choice: a walker turns back only at a dead end", () => {
  const end = graph.walkEdges
    .map((e) => graph.edges[e]!)
    .flatMap((e) => [e.a, e.b])
    .find((n) => graph.adjacency[n]!.filter((e) => graph.walkEdges.includes(e)).length === 1)!
  const only = graph.adjacency[end]!.find((e) => graph.walkEdges.includes(e))
  const step = nextWalkEdge(end, only!, Random.make(1))
  assert.equal(step.edge, only)
  assert.equal(step.forward, graph.edges[only!]!.a === end, "back out of the dead end")
})

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

test("first fill: at the start the village is already peopled, in view as well as out of it, and its cats are out", () => {
  const at = MAP.spawns.player
  const target = peopleOut(at.x, at.y)
  const cats = Math.min(
    ANIMALS.cat.max,
    Math.round(residentsNear(at.x, at.y, ANIMALS.cat.reach) * ANIMALS.cat.perResident),
  )
  // On foot the camera shows about 45 m round the player: they see the share of the people out that lives that near.
  const inView =
    (target * residentsNear(at.x, at.y, 45)) / residentsNear(at.x, at.y, PEDESTRIANS.despawn)
  assert.ok(
    target >= 5 && cats >= 1 && inView > 1.5,
    `${target} people out, ${cats} cats, ${inView.toFixed(1)} in view at the start`,
  )
  const seeds = Array.from({ length: 16 }, (_, k) => k + 1)
  let near = 0,
    catsNear = 0
  for (const seed of seeds) {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    assert.ok(made.ok && made.value.tick(setup).ok)
    const { people: all, animals } = made.value.inspect(Startup)
    const d = (p: Vec2.Vec2) => Vec2.distance(p, at)
    assert.ok(
      all.length >= target && all.length <= target + 2,
      `seed ${seed}: ${all.length} people out of a target of ${target}`,
    )
    assert.ok(
      all.every((p) => d(p) >= 4),
      "nobody on top of the player",
    )
    near += all.filter((p) => d(p) < 45).length
    const free = animals.filter((a) => a.species === "cat")
    assert.equal(free.length, cats, `seed ${seed}: cats out`)
    catsNear += free.filter((a) => d(a) < 45).length
  }
  const mean = near / seeds.length
  assert.ok(
    Math.abs(mean - inView) < 1,
    `${mean.toFixed(2)} people within 45 m on average, against ${inView.toFixed(2)}`,
  )
  assert.ok(catsNear > 0, "cats within 45 m")
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
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
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
    for (let step = 1; step <= 125 * 60; step++) {
      assert.ok(runtime.tick(update).ok)
      const now = runtime.inspect(Talkers)
      for (const p of talking) {
        const me = now.find((o) => o.id === p.id),
          other = now.find((o) => o.id === partner.get(p.id))
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
  assert.ok(pairs >= 2, `${pairs} pairs of neighbours talking at the start over 8 seeds`)
  assert.ok(natural >= 1, `${natural} chats ran their course`)
})
