import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"
import { Box3, Vector3, type BufferGeometry } from "three"

import type { AnimalValue, Look } from "../../sim/index.ts"
import { MAP } from "../../sim/map/index.ts"
import { lookOf } from "../../sim/population/looks.ts"
import { LOOK } from "../../sim/testing.ts"
import { AnimalNode, frameAnimal, markings } from "../animals.ts"
import { poolRadius, SPREAD } from "../blood.ts"
import { solidMaterial } from "../geometry.ts"
import { drawnY, groundY } from "../ground.ts"
import { type Doing, framePerson, longSleeves, PersonNode, PERSON_FRAMES } from "../people.ts"
import { shownProxy, vectorsAround } from "../testing.ts"

const bounds = (geometry: BufferGeometry): Box3 => {
  geometry.computeBoundingBox()
  return geometry.boundingBox!
}
const KID: Look = {
  ...LOOK,
  age: "kid",
  female: true,
  outfit: "dress",
  hairdo: "long",
  height: 1.2,
}
const NONNO: Look = { ...LOOK, age: "elder", outfit: "trousers", hairdo: "cap", height: 1.7 }
const NONNA: Look = {
  ...LOOK,
  age: "elder",
  female: true,
  outfit: "skirt",
  hairdo: "bun",
  height: 1.58,
}
/** Gragnola's centre: a village street, where the sim spawns people. */
const GRAGNOLA = { x: -1751, y: 3360 }

test("a person stands on the ground in every frame, as tall as its look (the hair or cap a few cm over)", () => {
  for (const look of [
    LOOK,
    KID,
    NONNO,
    NONNA,
    { ...LOOK, hairdo: "bald" as const, outfit: "shorts" as const },
  ]) {
    const node = new PersonNode(look, solidMaterial)
    for (const frame of PERSON_FRAMES) {
      const box = bounds(node.frames[frame])
      assert.ok(
        Math.abs(box.min.y) < 1e-6,
        `${look.age} ${frame}: the lowest foot on the ground, not ${box.min.y}`,
      )
      if (frame === "stand")
        assert.ok(
          box.max.y > look.height - 0.08 && box.max.y < look.height + 0.08,
          `${look.age}: ${box.max.y} m tall`,
        )
    }
  }
})

test("a kid is narrower than an adult; an elder stoops", () => {
  const shoulders = (look: Look) => {
    const node = new PersonNode(look, solidMaterial),
      box = bounds(node.frames.stand)
    return { width: box.max.z - box.min.z, front: box.max.x }
  }
  assert.ok(shoulders(KID).width < shoulders(LOOK).width, "a kid is narrower")
  assert.ok(
    shoulders(NONNO).front > shoulders({ ...NONNO, age: "adult" }).front + 0.05,
    "an elder's head and shoulders lean forward",
  )
})

test("frame choice: shock holds the head, chat gestures by turns, flight and speed run, walking steps by distance, swimmers stroke", () => {
  const doing = (over: Partial<Doing>): Doing => ({
    mood: "walk",
    lying: false,
    speed: 1.4,
    walked: 0,
    clock: 0,
    phase: 0,
    height: 1.75,
    swimming: false,
    ...over,
  })
  const strokes = [0, 0.6, 1.3, 1.9, 2.6].map((clock) =>
    framePerson(doing({ swimming: true, mood: "flee", speed: 0, clock })),
  )
  assert.deepEqual(
    [...new Set(strokes)].sort(),
    ["swim1", "swim2"],
    "a swimmer strokes, whatever its mood",
  )
  assert.equal(framePerson(doing({ swimming: true, lying: true })), "stand", "the dead float lying")
  assert.equal(framePerson(doing({ mood: "shock", speed: 0 })), "shock")
  assert.equal(framePerson(doing({ mood: "look", speed: 0 })), "stand")
  const talk = [0, 0.5, 1.2, 1.7, 2.3, 2.9].map((clock) =>
    framePerson(doing({ mood: "chat", speed: 0, clock })),
  )
  assert.deepEqual(
    [...new Set(talk)].sort(),
    ["stand", "talk"],
    "a talker stands and gestures by turns",
  )
  assert.notDeepEqual(
    [0, 1.2, 2.3].map((clock) => framePerson(doing({ mood: "chat", speed: 0, clock }))),
    [0, 1.2, 2.3].map((clock) => framePerson(doing({ mood: "chat", speed: 0, clock, phase: 0.5 }))),
    "two talkers' phases differ",
  )
  const run = [0, 0.8, 1.6, 2.4].map((walked) =>
    framePerson(doing({ mood: "flee", speed: 4, walked })),
  )
  assert.ok(
    run.every((f) => f === "run1" || f === "run2") && new Set(run).size === 2,
    `a flight runs: ${run}`,
  )
  assert.equal(
    framePerson(doing({ mood: "walk", speed: 3, walked: 0 })),
    "run1",
    "a follower catching up runs",
  )
  const walk = [0, 0.2, 0.4, 0.55, 0.75, 0.95, 1.15, 1.3].map((walked) =>
    framePerson(doing({ walked })),
  )
  assert.deepEqual([...new Set(walk)].sort(), ["stand", "walk1", "walk2"])
  assert.equal(
    framePerson(doing({ lying: true, mood: "flee", speed: 3 })),
    "stand",
    "the down and dead lie on the standing frame",
  )
  assert.equal(frameAnimal(false, 1, 0, 0.3), "step1")
  assert.equal(frameAnimal(false, 0, 0.5, 0.3), "stand")
  assert.equal(frameAnimal(true, 3, 0, 0.3), "stand")
})

test("a blood pool grows as √t to its full size over SPREAD seconds and lies just over the ground under the body", () => {
  assert.equal(poolRadius(0, 0.8), 0)
  assert.ok(
    Math.abs(poolRadius(SPREAD / 4, 0.8) - 0.4) < 1e-9,
    "a quarter of the time: half the radius",
  )
  assert.equal(poolRadius(SPREAD, 0.8), 0.8)
  assert.equal(poolRadius(60, 0.8), 0.8)

  const node = new PersonNode(LOOK, solidMaterial, 7)
  node.place(GRAGNOLA.x, GRAGNOLA.y, 0.7)
  node.lie(false, false)
  assert.equal(node.pool.visible, false, "the living do not bleed")
  node.lie(true, false)
  assert.equal(node.pool.visible, false, "nor the knocked down")
  node.lie(false, true)
  assert.equal(node.pool.visible, true)
  const reach = (seconds: number) => {
    node.bleed(seconds)
    node.updateMatrixWorld(true)
    const p = node.pool.geometry.getAttribute("position"),
      centre = node.pool.localToWorld(new Vector3().fromBufferAttribute(p, 0))
    let far = 0
    for (let i = 1; i < p.count; i++) {
      const corner = node.pool.localToWorld(new Vector3().fromBufferAttribute(p, i))
      far = Math.max(far, Math.hypot(corner.x - centre.x, corner.z - centre.z))
      const over = corner.y - drawnY(corner.x, -corner.z, node.position.y)
      assert.ok(over > 0.04 && over < 0.06, `a corner ${over} m over the ground`)
    }
    return far
  }
  const early = reach(SPREAD / 4),
    full = reach(SPREAD)
  assert.ok(early > 0.3 && early <= 0.4 + 1e-6, `${early} m after ${SPREAD / 4} s`)
  assert.ok(full > 0.6 && full <= 0.8 + 1e-6, `${full} m when full`)
})

/** The roads of the tiles within 2 km of the player's start (by Monzone station), in the map's order. */
const ROADS = vectorsAround([MAP.spawns.player], 2000).roads.items

/** Where each corner of a dead body's full-grown pool lies, in world space, the body at map (x, y) facing `angle`. */
const poolCorners = (x: number, y: number, angle: number) => {
  const node = new PersonNode(LOOK, solidMaterial, 5)
  node.place(x, y, angle)
  node.lie(false, true)
  node.bleed(SPREAD)
  node.updateMatrixWorld(true)
  const p = node.pool.geometry.getAttribute("position")
  return {
    node,
    corners: Array.from({ length: p.count - 1 }, (_, i) =>
      node.pool.localToWorld(new Vector3().fromBufferAttribute(p, i + 1)),
    ),
  }
}

// Regression: corners past a deck's edge were draped on the ground below it, so the pool hung a red spike 2–16 m off the bridge.
test("a blood pool by a bridge deck's edge lies flat on the deck, and one on a steep road still follows the road", () => {
  let checked = false
  for (const road of ROADS) {
    if (road.bridge !== true) continue
    const [ax, ay, bx, by] = road.pts as [number, number, number, number]
    const len = Math.hypot(bx - ax, by - ay),
      ux = (bx - ax) / len,
      uy = (by - ay) / len
    if (len < 6) continue
    // A body 0.3 m inside the deck's left edge at its first segment's middle, lying along the road; the ground 2 m past the
    // edge is at least 2 m under the deck.
    const off = road.w / 2 - 0.3,
      x = (ax + bx) / 2 - uy * off,
      y = (ay + by) / 2 + ux * off
    const deck = groundY(x, y)
    if (groundY(x - uy * 2.3, y + ux * 2.3, deck) > deck - 2) continue
    const { node, corners } = poolCorners(x, y, Math.atan2(uy, ux))
    if (Math.abs(node.position.y - deck) > 0.05) continue
    for (const c of corners)
      assert.ok(
        Math.abs(c.y - deck) < 0.5,
        `bridge ${road.id}: a corner ${c.y - deck} m off the deck`,
      )
    checked = true
    break
  }
  assert.ok(checked, "a bridge high over the ground")

  // The first at-grade road climbing at over 20 % for 6 m or more: the pool drapes over its slope.
  const steep = ROADS.flatMap((road) =>
    road.bridge === true || road.tunnel === true
      ? []
      : road.z.slice(1).flatMap((z1, k) => {
          const [ax, ay, bx, by] = road.pts.slice(2 * k, 2 * k + 4) as [
              number,
              number,
              number,
              number,
            ],
            len = Math.hypot(bx - ax, by - ay)
          return len > 6 && (z1 - road.z[k]!) / len > 0.2
            ? [{ x: (ax + bx) / 2, y: (ay + by) / 2, angle: Math.atan2(by - ay, bx - ax) }]
            : []
        }),
  )[0]!
  const { node, corners } = poolCorners(steep.x, steep.y, steep.angle)
  for (const c of corners) {
    const over = c.y - drawnY(c.x, -c.z, node.position.y)
    assert.ok(over > 0.04 && over < 0.06, `on the steep road a corner ${over} m over the ground`)
  }
  const rises = corners.map((c) => c.y)
  assert.ok(Math.max(...rises) - Math.min(...rises) > 0.3, "the pool slopes with the road")
})

test("a dead body lies flat on the ground, a person on its face along its heading, an animal on its side", () => {
  const flat = (node: PersonNode | AnimalNode) => {
    node.lie(false, true)
    node.updateMatrixWorld(true)
    return new Box3().setFromObject(node.body)
  }
  const person = flat(new PersonNode(LOOK, solidMaterial))
  assert.ok(
    Math.abs(person.min.y) < 1e-6 && person.max.y < 0.6,
    `a person lies ${person.min.y}…${person.max.y} m`,
  )
  assert.ok(person.max.x > LOOK.height - 0.1, "head forward, along the heading")
  const cow = flat(
    new AnimalNode({ species: "cow", coat: 0xf2f0ea, patch: 0x1c1c1c, size: 1 }, solidMaterial),
  )
  assert.ok(
    Math.abs(cow.min.y) < 1e-6 && cow.max.y < 0.75,
    `a cow lies ${cow.min.y}…${cow.max.y} m`,
  )
})

test("animal models are their species' size, scaled by the animal's, in their markings", () => {
  const size = (a: AnimalValue) => {
    const box = bounds(new AnimalNode(a, solidMaterial).frames.stand)
    return { long: box.max.x - box.min.x, tall: box.max.y, low: box.min.y }
  }
  const near = (got: number, want: number, what: string) =>
    assert.ok(Math.abs(got - want) / want < 0.2, `${what}: ${got} vs ${want}`)
  const dog = size({ species: "dog", coat: 0xc49a6c, patch: 0xeee8dc, size: 1 })
  near(dog.long, 0.8 + 0.15, "dog nose to tail") // 0.8 m nose to rump, its tail behind
  const cat = size({ species: "cat", coat: 0x8a857c, patch: 0x4e4a45, size: 1 })
  near(cat.long, 0.45, "cat long")
  const cow = size({ species: "cow", coat: 0x7a6e64, patch: 0x7a6e64, size: 1 })
  near(cow.long, 2.3, "cow long")
  near(cow.tall, 1.42, "cow to the horns")
  const pig = size({ species: "pig", coat: 0xe8b4a0, patch: 0xe8b4a0, size: 1.15 })
  near(pig.long, 1.2 * 1.15, "a big pig")
  near(pig.tall, 0.7 * 1.15, "a big pig's back")
  for (const s of [dog, cat, cow, pig]) assert.ok(Math.abs(s.low) < 1e-6, "feet on the ground")

  assert.equal(markings({ species: "pig", coat: 0x2b2624, patch: 0xefe6dc, size: 1 }), "belt")
  assert.equal(markings({ species: "cow", coat: 0xf2f0ea, patch: 0x1c1c1c, size: 1 }), "patches")
  assert.equal(markings({ species: "cat", coat: 0x8a857c, patch: 0x4e4a45, size: 1 }), "stripes")
  assert.equal(markings({ species: "dog", coat: 0x1c1a19, patch: 0xeee8dc, size: 1 }), "points")
  assert.equal(markings({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }), "plain")
})

/** The box `node`'s x-ray proxy fills now, in the node's frame (the node unplaced). */
const proxyBox = (node: PersonNode): Box3 => {
  node.updateMatrixWorld(true)
  const proxy = shownProxy(node)
  assert.ok(proxy !== undefined, "a proxy shows")
  return new Box3().setFromObject(proxy)
}
const encloses = (outer: Box3, inner: Box3, what: string) => {
  for (const axis of ["x", "z"] as const) {
    assert.ok(
      outer.min[axis] <= inner.min[axis] && outer.max[axis] >= inner.max[axis],
      `${what}: ${axis} ${inner.min[axis]}…${inner.max[axis]} out of the proxy`,
    )
  }
  assert.ok(outer.max.y >= inner.max.y, `${what}: its top out of the proxy`)
}

// Regression: a person's proxy enclosed all seven frames (a shock's elbows, a run's strides), so the walking player's reached
// 0.66 m sideways into walls; and it turned with the body when down, reaching 0.53 m into the ground.
test("the player's x-ray proxy fits the gait shown: the walk's strides walking, the run's running, the body lying down", () => {
  const node = new PersonNode(LOOK, solidMaterial)
  const gait = (speed: number, walked: number) => {
    node.speed = speed
    node.walked = walked
    node.pose()
    return proxyBox(node)
  }
  assert.equal(shownProxy(node), undefined, "no proxy until one shows")
  node.showXray(true)
  const walk = gait(1.4, 0)
  for (const frame of ["stand", "walk1", "walk2"] as const)
    encloses(walk, bounds(node.frames[frame]), frame)
  for (const walked of [0.2, 0.4, 0.55, 0.75])
    assert.ok(
      gait(1.4, walked).equals(walk),
      "one box through the walk cycle: it does not jump every half step",
    )
  assert.ok(
    walk.max.z < 0.45 && walk.min.z > -0.45,
    `walking, it reaches ${walk.min.z}…${walk.max.z} m sideways`,
  )
  assert.ok(walk.max.x < 0.55, `walking, it reaches ${walk.max.x} m forward, not the run's stride`)
  assert.ok(
    Math.abs(walk.min.y - 0.15) < 1e-6,
    `its bottom ${walk.min.y} m over the ground at the feet`,
  )
  const run = gait(4, 0)
  for (const frame of ["run1", "run2"] as const) encloses(run, bounds(node.frames[frame]), frame)
  assert.ok(
    run.max.z < 0.45 && run.min.z > -0.45,
    `running, it reaches ${run.min.z}…${run.max.z} m sideways`,
  )

  node.lie(true, false)
  node.pose()
  node.updateMatrixWorld(true)
  const lying = proxyBox(node),
    body = new Box3().setFromObject(node.body)
  assert.ok(
    lying.min.y >= 0.1,
    `lying down, its bottom ${lying.min.y} m over the ground, not in it`,
  )
  encloses(lying, body, "the body lying down")
  assert.ok(lying.max.y < 0.5, `lying down, its top ${lying.max.y} m`)

  node.showXray(false)
  assert.equal(shownProxy(node), undefined, "hidden")
  assert.ok(
    node.children.every((child) => child === node.body || child === node.pool || !child.visible),
    "every proxy hidden",
  )
})

test("only an actor that shows its x-ray silhouette builds the proxy: no animal does", () => {
  const cat = new AnimalNode(
    { species: "cat", coat: 0x1a1918, patch: 0x1a1918, size: 0.85 },
    solidMaterial,
  )
  cat.lie(false, false)
  cat.pose()
  assert.equal(shownProxy(cat), undefined)
  assert.ok(
    cat.children.length === 2 && cat.children.includes(cat.body) && cat.children.includes(cat.pool),
    "nothing but its body and pool",
  )
})

// Regression: a dress sets the pants to the shirt's colour, so every dress was drawn with long sleeves.
test("about a third of the young and grown wear long sleeves, in a dress or not; elders all do", () => {
  const random = Random.make(3)
  for (const age of ["kid", "adult"] as const) {
    const looks = Array.from({ length: 4000 }, () => lookOf(random, age))
    for (const dress of [true, false]) {
      const some = looks.filter((look) => (look.outfit === "dress") === dress),
        share = some.filter(longSleeves).length / some.length
      assert.ok(
        some.length > 100 && share > 0.2 && share < 0.45,
        `${age}, ${dress ? "a dress" : "no dress"}: ${share} in long sleeves`,
      )
    }
  }
  assert.ok(Array.from({ length: 200 }, () => lookOf(random, "elder")).every(longSleeves))
})
