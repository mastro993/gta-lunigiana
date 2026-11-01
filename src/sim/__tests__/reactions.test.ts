import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { wrapAngle } from "../body.ts"
import { barrierSpeeds, crashDamage } from "../damage.ts"
import { FAUNA } from "../fauna.ts"
import { Game, type Mood, Roam } from "../index.ts"
import { lanePoint } from "../route.ts"
import {
  ALONE,
  along,
  away,
  ELDER,
  HEADING,
  KID,
  lane,
  LANE,
  seeded,
  spot,
  VERGE,
  walker,
} from "../scene.ts"
import { animal } from "../spawning.ts"
import { deathChance, halfOf } from "../systems/contacts.ts"
import { followVelocity, paceOf, placeBeside } from "../systems/pedestrians.ts"
import { BATTISTI, battistiTraffic, LOOK, rolling, start } from "../testing.ts"
import { VEHICLES } from "../vehicles.ts"

/** An animal staged resting where it stands, so it is there when the car comes (a roaming one walks off on some seeds). */
const resting = (draft: ReturnType<typeof animal>, at: Vec2.Vec2) =>
  Game.Command.extend(draft, [
    Roam,
    { mood: "idle", until: 100_000, hx: at.x, hy: at.y, tx: at.x, ty: at.y },
  ])
/** Seeds a scene that rolls dice is run on. */
const SEEDS = [1, 2, 3, 4, 5, 6]

test("deaths: the chance a car kills a pedestrian follows Tefft 2011, lower for elders, none under 5 m/s", () => {
  const mph = 0.44704
  for (const [speed, risk] of [
    [23, 0.1],
    [32, 0.25],
    [42, 0.5],
    [50, 0.75],
    [58, 0.9],
  ] as const) {
    const p = deathChance(speed * mph, halfOf("adult"))
    assert.ok(Math.abs(p - risk) < 0.04, `${speed} mph: ${p.toFixed(3)} against Tefft's ${risk}`)
  }
  for (const age of ["kid", "adult", "elder"] as const)
    assert.equal(deathChance(4.99, halfOf(age)), 0, "under 5 m/s nobody dies")
  assert.ok(deathChance(30, halfOf("adult")) > 0.95, "a hit at 30 m/s nearly always kills")
  assert.equal(
    deathChance(14, halfOf("kid")),
    deathChance(14, halfOf("adult")),
    "children take the adult curve",
  )
  // Tefft: a 70-year-old struck at 25 mph runs a risk of severe injury or death like a 30-year-old's at 35 mph; the elder curve
  // carries that shift over to death alone (an estimate).
  assert.ok(
    Math.abs(deathChance(25 * mph, halfOf("elder")) - deathChance(35 * mph, halfOf("adult"))) <
      0.03,
  )
})

test("deaths: a car at 30 m/s nearly always kills (a fatal Impact, no point for an empty car), and the dead never get up and lie where they slid", () => {
  // Someone in the car's lane 8 m ahead of it: a quarter of a second to get away. Tefft's curve kills 96 % at 30 m/s.
  let killed = 0
  for (const seed of SEEDS) {
    const { run, world, heard } = seeded(
      seed,
      [
        away,
        {
          cars: [rolling("panda", spot(0, LANE), 30, 0.3)],
          peds: [walker(8, { side: LANE / VERGE, back: true })],
        },
      ],
      ALONE,
    )
    const id = world().peds[0]!.id
    run(300)
    const hits = heard.impacts.filter((i) => i.hit === "person" && i.other === id)
    assert.equal(hits.length, 1, "one person Impact")
    assert.equal(world().score.knocked, 0)
    if (hits[0]!.fatal !== true) continue
    killed++
    const ped = world().peds.find((p) => p.id === id)!
    assert.ok(ped.dead !== undefined && ped.down, "dead, and down for good")
    const lying = { x: ped.x, y: ped.y }
    run(600)
    const later = world().peds.find((p) => p.id === id)!
    assert.ok(later.dead !== undefined && later.down, "still dead 10 s later")
    assert.ok(
      Vec2.distance(later, lying) < 0.01 && Math.abs(later.vx) + Math.abs(later.vy) < 1e-6,
      "lying still",
    )
  }
  assert.ok(killed >= SEEDS.length - 1, `${killed} of ${SEEDS.length} killed`)
})

test("reactions: a car speeding past walkers on the verge draws looks at it and, about half the time, angry cries, and nobody runs", () => {
  const ats = [14, 18, 22, 26, 30, 34]
  const cries: Array<string> = []
  for (const seed of SEEDS) {
    const { run, world, heard } = seeded(
      seed,
      [
        away,
        { cars: [rolling("panda", spot(0, LANE), 16, 0.4)], peds: ats.map((at) => walker(at)) },
      ],
      ALONE,
    )
    const ids = new Set<number>(world().peds.map((p) => p.id))
    const looked = new Set<number>()
    run(150, () => {
      for (const p of world().peds) {
        if (!ids.has(p.id)) continue
        assert.notEqual(p.mood, "flee", "a car in its lane is no danger to the verge")
        if (p.mood === "look") looked.add(p.id)
      }
    })
    assert.equal(looked.size, ats.length, "every walker looked at it")
    cries.push(...heard.cries.filter((c) => ids.has(c.who)).map((c) => c.feeling))
  }
  assert.ok(
    cries.every((feeling) => feeling === "anger"),
    cries.join(" "),
  )
  const share = cries.length / (ats.length * SEEDS.length)
  assert.ok(share > 0.25 && share < 0.75, `${(share * 100).toFixed(0)} % cried out`)
})

test("reactions: a car aimed at a walker sends them running off the road before it gets there, crying out in fright only when it comes fast", () => {
  // Battisti's traffic keeps 12 m/s: at 9 m/s the car could stop short of them, at 16 m/s it is speeding.
  for (const [speed, cries] of [
    [9, []],
    [16, ["fright"]],
  ] as const) {
    const car = rolling("panda", spot(0, LANE), speed, 0.3)
    const { run, world, heard } = start(
      [],
      [away, { cars: [car], peds: [walker(40, { side: LANE / VERGE, back: true })] }],
      ALONE,
    )
    const id = world().peds[0]!.id
    let fled = -1
    run(240, (frame) => {
      const p = world().peds.find((q) => q.id === id)!
      if (fled < 0 && p.mood === "flee") {
        fled = frame
        assert.ok(
          Math.abs(Math.abs(p.route.side) - VERGE) < 1e-9,
          `to a verge: side ${p.route.side}`,
        )
      }
    })
    assert.ok(fled >= 0, "ran")
    assert.equal(
      heard.impacts.findIndex((i) => i.other === id),
      -1,
      `got out of the way at ${speed} m/s`,
    )
    assert.deepEqual(
      heard.cries.filter((c) => c.who === id).map((c) => c.feeling),
      cries,
      `at ${speed} m/s`,
    )
  }
})

test("reactions: someone already running who finds a car aimed at them steps out of its path all the same", () => {
  // Running down the Panda's lane toward the car, from something up the street (regression: only a walker stepped aside).
  const from = lanePoint(lane, 60, 0)
  const runner = walker(30, {
    side: LANE / VERGE,
    back: true,
    mood: "flee",
    until: 360,
    fx: from.x,
    fy: from.y,
  })
  const { run, world, heard } = start(
    [],
    [away, { cars: [rolling("panda", spot(0, LANE), 9, 0.3)], peds: [runner] }],
    ALONE,
  )
  const id = world().peds[0]!.id
  run(240)
  assert.equal(
    heard.impacts.findIndex((i) => i.other === id),
    -1,
    "got out of the way",
  )
})

// Regression: a car creeping between KNOCK_SPEED and the old 4 m/s danger floor knocked people down without their stepping aside.
test("reactions: a car creeping at 3.5 m/s, fast enough to knock someone down, is dodged by whoever stands or walks in its lane", () => {
  const far = lanePoint(lane, 40, 8)
  const watching = walker(10, {
    side: LANE / VERGE,
    back: true,
    mood: "look",
    until: 100_000,
    fx: far.x,
    fy: far.y,
  })
  for (const p of [watching, walker(6, { side: LANE / VERGE })]) {
    const { run, world, heard } = start(
      [],
      [away, { cars: [rolling("panda", spot(0, LANE), 3.5, 0.05)], peds: [p] }],
      ALONE,
    )
    const id = world().peds[0]!.id
    run(400)
    assert.equal(
      heard.impacts.findIndex((i) => i.other === id),
      -1,
      "stepped out of its way",
    )
  }
})

test("reactions: a car at 100 km/h in its lane makes walkers on the verge ahead jump away, crying out; at 16 m/s they only look", () => {
  for (const [speed, throttle, startles] of [
    [16, 0.4, false],
    [28, 0.6, true],
  ] as const) {
    const peds = [walker(30, { back: true }), walker(36, { back: true })]
    const { run, world, heard } = start(
      [],
      [away, { cars: [rolling("panda", spot(0, LANE), speed, throttle)], peds }],
      ALONE,
    )
    const ids = world().peds.map((p) => p.id),
      fled = new Set<number>()
    run(150, () => {
      for (const p of world().peds) if (p.mood === "flee") fled.add(p.id)
    })
    assert.equal(fled.size, startles ? ids.length : 0, `at ${speed} m/s`)
    if (startles)
      assert.ok(
        ids.every((id) => heard.cries.some((c) => c.who === id && c.feeling === "fright")),
        "in fright",
      )
  }
})

test("reactions: a death 12–25 m away shocks the witnesses (a shock cry each), then up to four gather by the body and the rest run, then walk on", () => {
  // The victim walks down the right lane into a car at 30 m/s; eight witnesses walk the far verge 10–24 m up the street.
  const witnesses = [18, 20, 22, 24, 26, 28, 30, 32].map((at) => walker(at, { side: -1 }))
  const { run, world, heard } = start(
    [],
    [
      away,
      {
        cars: [rolling("panda", spot(0, LANE), 30, 0.3)],
        peds: [walker(8, { side: LANE / VERGE, back: true }), ...witnesses],
      },
    ],
    ALONE,
  )
  const [victim, ...others] = world().peds.map((p) => p.id)
  const shocked = new Map<number, number>()
  const then = new Map<number, Mood>()
  const moods = new Map<number, Array<Mood>>(others.map((id) => [id, []]))
  run(1200, (frame) => {
    for (const p of world().peds) {
      if (!others.includes(p.id)) continue
      if (moods.get(p.id)!.at(-1) !== p.mood) moods.get(p.id)!.push(p.mood)
      if (p.mood === "shock" && !shocked.has(p.id)) shocked.set(p.id, frame)
      if (shocked.has(p.id) && !then.has(p.id) && p.mood !== "shock") then.set(p.id, p.mood)
    }
  })
  const fatal = heard.impacts.find((i) => i.other === victim)
  assert.equal(fatal?.fatal, true, "killed")
  assert.equal(shocked.size, others.length, "everyone was shocked")
  assert.ok(
    others.every((id) => heard.cries.some((c) => c.who === id && c.feeling === "shock")),
    "and cried out",
  )
  assert.ok(
    [...then.values()].every((mood) => mood === "gather" || mood === "flee"),
    JSON.stringify([...then]),
  )
  assert.equal(then.size, others.length)
  const gatherers = [...then.values()].filter((mood) => mood === "gather").length
  assert.ok(gatherers >= 1 && gatherers <= 4, `${gatherers} gathered`)
  // Regression: those who ran all stopped together and looked at each other "fleeing" for 2 s.
  for (const [id, seen] of moods)
    if (seen.includes("flee"))
      assert.deepEqual(
        seen.slice(seen.indexOf("flee")),
        ["flee", "walk"],
        `${id}: ${seen.join(" ")}`,
      )
  const gathered = world().peds.filter((p) => others.includes(p.id) && p.mood === "gather")
  for (const p of gathered) {
    const d = Vec2.distance(p, { x: p.fx, y: p.fy })
    assert.ok(d > 1.8 && d < 3.2, `stands ${d.toFixed(2)} m from the body`)
  }
})

test("reactions: a body met on the way shocks a walker; one who has just been shocked walks on", () => {
  const body = walker(22, { mood: "walk" })
  const fresh = walker(4)
  const calm = walker(6, { side: -1, until: 99999 })
  const { run, world, heard } = start([], [away, { bodies: [body], peds: [fresh, calm] }], ALONE)
  const [freshId, calmId] = world()
    .peds.filter((p) => p.dead === undefined)
    .map((p) => p.id)
  const moods = new Map<number, Set<Mood>>([
    [freshId!, new Set()],
    [calmId!, new Set()],
  ])
  run(900, () => {
    for (const p of world().peds) moods.get(p.id)?.add(p.mood)
  })
  assert.ok(moods.get(freshId!)!.has("shock"), "shocked")
  assert.ok(heard.cries.some((c) => c.who === freshId && c.feeling === "shock"))
  assert.ok(
    moods.get(freshId!)!.has("gather") || moods.get(freshId!)!.has("flee"),
    "then gathered or ran",
  )
  assert.deepEqual([...moods.get(calmId!)!], ["walk"], "in its cooldown it passes")
})

test("reactions: panic spreads one hop: a walker near someone running looks where they look; a walker near that one does not", () => {
  // The runner flees back down the lane from a threat ahead; the watcher stands 6 m up the lane, the next 7 m beyond it.
  const threat = lanePoint(lane, 40, 0)
  const runner = walker(10, { back: true, mood: "flee", until: 600, fx: threat.x, fy: threat.y })
  const { run, world, heard } = start(
    [],
    [away, { peds: [runner, walker(16, { back: true }), walker(23, { back: true })] }],
    ALONE,
  )
  const [runnerId, watcherId, nextId] = world().peds.map((p) => p.id)
  const moods = new Map<number, Set<Mood>>([
    [watcherId!, new Set()],
    [nextId!, new Set()],
  ])
  run(150, () => {
    for (const p of world().peds) {
      moods.get(p.id)?.add(p.mood)
      if (p.id === watcherId && p.mood === "look")
        assert.deepEqual([p.fx, p.fy], [threat.x, threat.y])
    }
  })
  assert.ok(moods.get(watcherId!)!.has("look"), "the watcher looked")
  assert.deepEqual([...moods.get(nextId!)!], ["walk"], "the one beyond did not")
  assert.deepEqual(
    heard.cries.filter((c) => c.who !== runnerId),
    [],
    "a look at panic is silent",
  )
})

test("chat: two grown-ups walking side by side stop, face each other and talk, then walk on", () => {
  const { run, world } = start(
    [],
    [away, { peds: [walker(4), walker(4, { side: (VERGE - 1) / VERGE })] }],
    ALONE,
  )
  const [a, b] = world().peds.map((p) => p.id)
  let began = -1,
    ended = -1
  run(3000, (frame) => {
    const pa = world().peds.find((p) => p.id === a)!,
      pb = world().peds.find((p) => p.id === b)!
    if (began < 0 && pa.mood === "chat") {
      began = frame
      assert.equal(pb.mood, "chat", "both at once")
    }
    if (began >= 0 && ended < 0 && frame > began + 90 && pa.mood === "chat" && pb.mood === "chat") {
      for (const [me, other] of [
        [pa, pb],
        [pb, pa],
      ] as const) {
        assert.ok(Vec2.distance({ x: me.fx, y: me.fy }, other) < 0.05, "about the other")
        assert.ok(Math.abs(me.vx) + Math.abs(me.vy) < 0.05, "standing")
        const facing = Math.abs(wrapAngle(Ops.atan2(other.y - me.y, other.x - me.x) - me.angle))
        assert.ok(facing < 0.3, `facing the other: ${facing.toFixed(2)} rad off`)
      }
    }
    if (began >= 0 && ended < 0 && pa.mood !== "chat") ended = frame
  })
  assert.ok(began >= 0, "they talked")
  assert.ok(
    ended > began + 8 * 60 - 2 && ended <= began + 25 * 60 + 2,
    `for ${(ended - began) / 60} s`,
  )
  run(120)
  const pa = world().peds.find((p) => p.id === a)!
  assert.equal(pa.mood, "walk")
  assert.ok(Math.sqrt(pa.vx * pa.vx + pa.vy * pa.vy) > 1, "walking on")
})

test("parties: a kid keeps within 2 m of its parent walking, runs when the parent runs, crying out", () => {
  const parent = walker(4, { look: ELDER })
  const kid = walker(4, { look: KID, side: 0.85 })
  const dog = animal(
    { species: "dog", coat: 0x5a3a22, patch: 0x5a3a22, size: 1 },
    spot(3.5, VERGE * 0.85),
  )
  const { run, world, heard } = start(
    [],
    [
      away,
      {
        parties: [
          {
            leader: parent,
            people: [{ draft: kid, side: 0.5, back: 0.4 }],
            animals: [{ draft: dog, side: -0.5, back: 0.9 }],
          },
        ],
      },
    ],
    ALONE,
  )
  const {
    peds: [p, k],
  } = world()
  assert.equal(k!.leader, p!.id)
  let most = 0
  run(900, () => {
    const now = world().peds
    const pp = now.find((q) => q.id === p!.id)!,
      kk = now.find((q) => q.id === k!.id)!
    most = Math.max(most, Vec2.distance(pp, kk))
  })
  assert.ok(most < 2, `the kid strayed ${most.toFixed(2)} m`)
  assert.ok(along(world().peds.find((q) => q.id === p!.id)!) > 15, "they walked on")
  // A car comes at them, fast: the parent runs and the kid with it.
  const {
    run: run2,
    world: world2,
    heard: heard2,
  } = start(
    [],
    [
      away,
      {
        cars: [rolling("panda", spot(0, VERGE), 16, 0.3)],
        parties: [
          {
            leader: walker(25, { back: true, look: ELDER }),
            people: [
              { draft: walker(25, { back: true, look: KID, side: 0.85 }), side: 0.5, back: 0.4 },
            ],
          },
        ],
      },
    ],
    ALONE,
  )
  const [pid, kid2] = world2().peds.map((q) => q.id)
  let both = false
  run2(120, () => {
    const now = world2().peds
    both ||=
      now.find((q) => q.id === pid)!.mood === "flee" &&
      now.find((q) => q.id === kid2)!.mood === "flee"
  })
  assert.ok(both, "both ran")
  assert.ok(
    heard2.cries.some((c) => c.who === kid2 && c.feeling === "fright"),
    "the kid cried out",
  )
  assert.ok(
    heard.cries.every((c) => c.who !== p!.id && c.who !== k!.id),
    "a calm walk is quiet",
  )
})

test("parties: a kid whose parent lies dead stays by the body, no longer following, and never walks off alone", () => {
  const { run, world } = start(
    [],
    [
      away,
      {
        parties: [
          {
            leader: walker(10),
            dead: true,
            people: [{ draft: walker(12, { look: KID }), side: 0.5, back: 0.4 }],
          },
        ],
      },
    ],
    ALONE,
  )
  const body = world().peds.find((p) => p.dead !== undefined)!,
    kidId = world().peds.find((p) => p.dead === undefined)!.id
  run(600)
  const kid = world().peds.find((p) => p.id === kidId)!
  assert.equal(kid.leader, undefined, "Follows removed")
  assert.equal(kid.mood, "gather")
  // Regression: after a 2-minute vigil it wandered the village alone.
  let farthest = 0
  run(200 * 60, () => {
    const now = world().peds.find((p) => p.id === kidId)!
    farthest = Math.max(farthest, Vec2.distance(now, body))
  })
  assert.ok(farthest < 1.5, `beside it: at most ${farthest.toFixed(2)} m off`)
})

test("paces: grown-ups walk at Bohannon & Andrews' comfortable gait, elders slower, a taller person a little faster", () => {
  assert.ok(Math.abs(paceOf({ ...LOOK, height: 1.75 }).walk - 1.4) < 1e-9)
  assert.ok(Math.abs(paceOf({ ...LOOK, female: true, height: 1.62 }).walk - 1.35) < 1e-9)
  assert.ok(paceOf(ELDER).walk < paceOf({ ...ELDER, age: "adult" }).walk)
  assert.ok(
    paceOf({ ...LOOK, height: 1.9 }).walk > paceOf(LOOK).walk &&
      paceOf({ ...LOOK, height: 2.5 }).walk <= 1.4 * 1.1 + 1e-9,
  )
  assert.ok(paceOf(ELDER).run < paceOf(KID).run && paceOf(KID).run < paceOf(LOOK).run)
  // A follower beside a standing leader settles at its place and stops there.
  const leader = { x: 0, y: 0, angle: 0 },
    place = placeBeside(leader, 0.5, 0.4)
  assert.deepEqual(
    [place.x, place.y].map((v) => Math.round(v * 1e6) / 1e6),
    [-0.4, -0.5],
  )
  assert.deepEqual(
    followVelocity(place, place, leader, Vec2.zero, 4, { ...BATTISTI, side: VERGE }),
    Vec2.zero,
  )
})

test("traffic: a car brakes for an animal lying in its lane and waits behind it", () => {
  const dog = animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, spot(12, LANE))
  const { run, world } = start(
    [],
    [away, { traffic: [battistiTraffic(0x74746f)], carcasses: [dog] }],
    ALONE,
  )
  run(300)
  const car = world().vehicles.find((v) => v.traffic)!
  assert.ok(along(car) < 12 - 2, `stopped short: ${along(car).toFixed(1)} m`)
  assert.equal(world().animals[0]!.dead, 0, "untouched")
})

test("contacts: a car nudging a cow at walking pace shoves it without knocking it down; a dog hit gets up and bolts", () => {
  // A cow across the lane 6 m ahead of a car rolling at 4 m/s: under twice KNOCK_SPEED.
  const cow = resting(
    animal(
      { species: "cow", coat: 0x6b4a2e, patch: 0x6b4a2e, size: 1 },
      { ...spot(6, LANE), angle: HEADING + Math.PI / 2 },
    ),
    spot(6, LANE),
  )
  const { run, world, heard } = start(
    [],
    [away, { cars: [rolling("panda", spot(0, LANE), 4, 0)], animals: [cow] }],
    ALONE,
  )
  run(120)
  const bump = heard.impacts.filter((i) => i.hit === "animal")
  assert.ok(
    bump.length > 0 && bump.every((i) => i.speed < 6 && i.fatal === false),
    JSON.stringify(bump),
  )
  assert.equal(world().animals[0]!.down, false, "the cow stands")
  assert.ok(
    Math.abs(world().vehicles[0]!.vx) + Math.abs(world().vehicles[0]!.vy) < 2.5,
    "and the car is stopped short",
  )
  // A dog 5 m ahead of a car at 4.5 m/s: too close to get away, too slow to die.
  const dog = resting(
    animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, spot(5, LANE)),
    spot(5, LANE),
  )
  const second = start(
    [],
    [away, { cars: [rolling("panda", spot(0, LANE), 4.5, 0)], animals: [dog] }],
    ALONE,
  )
  let downAt = -1,
    roseAt = -1
  second.run(400, (frame) => {
    const d = second.world().animals[0]!
    if (downAt < 0 && d.down) downAt = frame
    if (downAt >= 0 && roseAt < 0 && !d.down) {
      roseAt = frame
      assert.equal(d.mood, "flee", "bolts")
    }
  })
  assert.ok(downAt >= 0 && roseAt - downAt >= 149, `down at ${downAt}, up at ${roseAt}`)
  const hit = second.heard.impacts.find((i) => i.hit === "animal")
  assert.equal(hit?.fatal, false, "under 5 m/s it lives")
})

// Regression: merged with crash damage, every animal hit cost the car a wall crash at the impact's speed, a cat as much as a cow.
test("damage: a cow struck at speed costs the car its share of their masses, as another vehicle would; a cat run over costs nothing", () => {
  const struck = (species: "cow" | "cat") => {
    const beast = resting(
      animal(
        { species, coat: 0x6b4a2e, patch: 0x6b4a2e, size: 1 },
        { ...spot(3, LANE), angle: HEADING + Math.PI / 2 },
      ),
      spot(3, LANE),
    )
    const { run, world, heard } = start(
      [],
      [away, { cars: [rolling("panda", spot(0, LANE), 15, 0)], animals: [beast] }],
      ALONE,
    )
    run(180)
    const hits = heard.impacts.filter((i) => i.hit === "animal")
    assert.ok(hits.length > 0, `${species}: struck`)
    return {
      hardest: Math.max(...hits.map((i) => i.speed)),
      amount: world().vehicles[0]!.damage.amount,
    }
  }
  const cow = struck("cow")
  const [share] = barrierSpeeds(cow.hardest, VEHICLES.panda.mass, FAUNA.cow.mass)
  assert.ok(cow.amount > 0, "the cow dents the car")
  assert.ok(
    Math.abs(cow.amount - crashDamage("panda", share)) < 1e-9,
    `${cow.amount} for a hit at ${cow.hardest.toFixed(1)} m/s, ${share.toFixed(1)} m/s its share`,
  )
  assert.equal(struck("cat").amount, 0, "a cat costs nothing")
})
