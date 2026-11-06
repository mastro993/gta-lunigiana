import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { clearOf, wallsAlong } from "../body.ts"
import { segDist2 } from "../collide.ts"
import { atGrade, groundZ, ON_DECK, ROAD_LIFT } from "../map/ground.ts"
import { DECK_SLAB, isDrivable, MAP, roadClassOf } from "../map/index.ts"
import { placeAt } from "../map/tiles.ts"
import { liveKeys } from "../rail/testing.ts"
import { Footing, Game, Player, Pose } from "../schema.ts"
import { rolling, start } from "../testing.ts"
import { PERSON_HEIGHT, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import { screenAxes } from "../view.ts"

// Regressions (issue #87): under a bridge, the ground rising toward its deck led the player onto its
// top once it came within ON_DECK (0.5 m) of it, the head through the 0.9 m slab first. The issue's
// three, each found by geometry: the road bridge whose line passes nearest the point it walked from.
const BRIDGES = [
  { name: "Via Nuova's in Gragnola", from: { x: -1600.7, y: 3675.3 } },
  { name: "Via Borgo Lucido's", from: { x: -1828.6, y: 3306.1 } },
  { name: "Via delle Cave's", from: { x: -369.2, y: 392.4 } },
] as const

/** Room to stand under a deck: its underside PERSON_HEIGHT or more over the ground, m under its top. */
const ROOM = DECK_SLAB.depth + PERSON_HEIGHT
/** A footing this near a deck's surface (m) is on it. */
const ON = 0.05

/** A road bridge's class, line (flat), profile and surface over it, half-width and ends. */
interface Deck {
  readonly cls: string
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly lift: number
  readonly half: number
  readonly ends: readonly [Vec2.Vec2, Vec2.Vec2]
}

/** The road bridge whose line passes nearest `at`, from the tile holding it. */
const deckNear = (at: Vec2.Vec2): Deck => {
  const { ids, items } = placeAt(at.x, at.y).vectors.roads
  let best = Infinity,
    found: Deck | undefined
  ids.forEach((road, k) => {
    const info = MAP.roads[road]!
    if (info.bridge !== true) return
    const { pts, z } = items[k]!
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const { d2 } = segDist2(at.x, at.y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!)
      if (d2 >= best) continue
      best = d2
      const n = pts.length
      found = {
        cls: roadClassOf(info),
        pts,
        z,
        lift: ROAD_LIFT[roadClassOf(info)],
        half: info.w / 2,
        ends: [
          { x: pts[0]!, y: pts[1]! },
          { x: pts[n - 2]!, y: pts[n - 1]! },
        ],
      }
    }
  })
  assert.ok(found !== undefined, `no bridge by (${at.x}, ${at.y})`)
  return found
}

/** `deck`'s surface at the point of its line nearest `at`, how far `at` lies off it, and whether it lies abeam (not past an end). */
const onDeck = (deck: Deck, at: Vec2.Vec2) => {
  const { pts, z } = deck
  let best = Infinity,
    level = 0,
    abeam = false
  for (let k = 0; k + 1 < z.length; k++) {
    const ax = pts[2 * k]!,
      ay = pts[2 * k + 1]!,
      bx = pts[2 * k + 2]!,
      by = pts[2 * k + 3]!
    const { d2, t } = segDist2(at.x, at.y, ax, ay, bx, by)
    if (d2 >= best) continue
    best = d2
    level = z[k]! + (z[k + 1]! - z[k]!) * t + deck.lift
    const u =
      ((at.x - ax) * (bx - ax) + (at.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)
    abeam = (k > 0 || u >= 0) && (k + 2 < z.length || u <= 1)
  }
  return { level, d: Math.sqrt(best), abeam }
}

/**
 * The point under `deck`'s slab nearest `at` (on a 0.25 m lattice, within 6 m) where a person stands
 * on the ground with 0.3–3 m more than ROOM under its top, a metre or more clear of every walk wall
 * they meet there: some way down the bank from the wall.
 */
const roomUnder = (deck: Deck, at: Vec2.Vec2): Vec2.Vec2 => {
  let best: Vec2.Vec2 | undefined
  for (let dy = -6; dy <= 6; dy += 0.25)
    for (let dx = -6; dx <= 6; dx += 0.25) {
      const p = { x: at.x + dx, y: at.y + dy },
        on = onDeck(deck, p),
        ground = atGrade(p.x, p.y),
        room = on.level - ground
      if (!on.abeam || on.d > deck.half + DECK_SLAB.margin || room < ROOM + 0.3 || room > ROOM + 3)
        continue
      const walls = wallsAlong("walk", p.x, p.y, 0, 0, PERSON_RADIUS + 1.5, ground)
      if (!clearOf(walls, p.x, p.y, PERSON_RADIUS + 1)) continue
      if (best === undefined || Vec2.distance(p, at) < Vec2.distance(best, at)) best = p
    }
  assert.ok(best !== undefined, `no room to stand under the deck by (${at.x}, ${at.y})`)
  return best
}

/** The arrow keys held for each way to walk at the home view: ← → and ↓ ↑ along its screen axes. */
const WAYS = (() => {
  const { up, right } = screenAxes(0)
  return [-1, 0, 1].flatMap((ix) =>
    [-1, 0, 1].flatMap((iy) =>
      ix === 0 && iy === 0
        ? []
        : [
            {
              keys: [
                ...(ix < 0 ? (["left"] as const) : ix > 0 ? (["right"] as const) : []),
                ...(iy < 0 ? (["down"] as const) : iy > 0 ? (["up"] as const) : []),
              ],
              way: Vec2.normalizeOr(
                { x: right.x * ix + up.x * iy, y: right.y * ix + up.y * iy },
                Vec2.zero,
              ),
            },
          ],
    ),
  )
})()

/**
 * The player on foot at `from`, on its ground on the level `level` (m a.s.l.), walking with the
 * arrow keys toward each of `goals` in turn (the next once within 0.3 m of one), for at most
 * `frames` steps; `each` sees its footing and pose after every step.
 */
const walk = (
  from: Vec2.Vec2,
  level: number,
  goals: ReadonlyArray<Vec2.Vec2>,
  frames: number,
  each: (footing: number, at: Vec2.Vec2) => void,
) => {
  const keys = liveKeys()
  const game = start([], [{ ...from, angle: 0 }, {}], { alone: true, keys })
  let footing = level,
    at: Vec2.Vec2 = from
  const player = Game.Query({
    selection: { pose: Game.Query.read(Pose), footing: Game.Query.optional(Footing) },
    with: [Player],
  })
  const set = Game.Schedule(
    Game.System(
      "Test/Footing",
      { queries: { player }, commands: Game.System.commands(Game.System.inserts(Footing)) },
      ({ queries, commands }) => {
        for (const { entity } of queries.player.each())
          commands.insert(entity, [Footing, { z: level }])
      },
    ),
    Game.Schedule.applyDeferred(),
  )
  const read = Game.Schedule(
    Game.System("Test/ReadFooting", { queries: { player } }, ({ queries }) => {
      for (const { data } of queries.player.each()) {
        at = data.pose.get()
        footing = data.footing.value()?.z ?? footing
      }
    }),
  )
  assert.ok(game.runtime.tick(set).ok)
  let goal = 0
  for (let frame = 0; frame < frames && goal < goals.length; frame++) {
    if (Vec2.distance(at, goals[goal]!) < 0.3) goal++
    const to = goals[Math.min(goal, goals.length - 1)]!,
      wanted = Vec2.normalizeOr(Vec2.subtract(to, at), Vec2.zero)
    const best = WAYS.reduce((a, b) => (Vec2.dot(b.way, wanted) > Vec2.dot(a.way, wanted) ? b : a))
    keys.release("up", "down", "left", "right")
    keys.hold(...best.keys)
    game.run(1)
    assert.ok(game.runtime.tick(read).ok)
    each(footing, at)
  }
  return { footing, at }
}

/** The deck's end nearest `at`, and the way onto the deck from it (a unit vector along its line). */
const endNear = (deck: Deck, at: Vec2.Vec2) => {
  const n = deck.pts.length,
    first = Vec2.distance(deck.ends[0], at) <= Vec2.distance(deck.ends[1], at),
    end = first ? deck.ends[0] : deck.ends[1],
    next = first
      ? { x: deck.pts[2]!, y: deck.pts[3]! }
      : { x: deck.pts[n - 4]!, y: deck.pts[n - 3]! }
  return { end, onto: Vec2.normalizeOr(Vec2.subtract(next, end), Vec2.zero) }
}

for (const { name, from } of BRIDGES) {
  const deck = deckNear(from)

  test(`under decks: under ${name} bridge, the player walking up the bank toward its deck is stopped by a wall and stays on the ground's level`, () => {
    // From under the deck, where there is room to stand, toward its nearer end, where the ground rises to it.
    const start = roomUnder(deck, from),
      { end } = endNear(deck, start)
    let nearest = Vec2.distance(start, end)
    walk(start, atGrade(start.x, start.y), [end], 240, (footing, at) => {
      const on = onDeck(deck, at)
      assert.ok(
        footing < on.level - ON_DECK,
        `the player at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}) stands at ${footing.toFixed(2)} m, the deck's top ${on.level.toFixed(2)} m over it`,
      )
      nearest = Math.min(nearest, Vec2.distance(at, end))
    })
    assert.ok(
      nearest < Vec2.distance(start, end) - 0.5,
      `the player walked from ${Vec2.distance(start, end).toFixed(2)} m of the deck's end to ${nearest.toFixed(2)} m`,
    )
  })

  test(`under decks: from the road at each end of ${name} bridge, the player walks onto its deck and a Panda drives onto it`, () => {
    for (const end of deck.ends) {
      const { onto } = endNear(deck, end)
      // On foot: from 6 m back along the deck's line, on the road there, to 4 m onto the deck.
      const back = Vec2.add(end, Vec2.scale(onto, -6)),
        into = Vec2.add(end, Vec2.scale(onto, 4))
      const reached = walk(back, groundZ(back.x, back.y), [end, into], 360, () => {})
      const on = onDeck(deck, reached.at)
      assert.ok(
        Vec2.distance(reached.at, into) < 0.5 && Math.abs(reached.footing - on.level) < ON,
        `walking onto it at (${end.x}, ${end.y}): at (${reached.at.x.toFixed(2)}, ${reached.at.y.toFixed(2)}), ${reached.footing.toFixed(2)} m, its top ${on.level.toFixed(2)} m`,
      )
      if (!isDrivable(deck.cls)) continue
      // By car: a Panda rolling onto it from 8 m back along its line, at 4 m/s.
      const car = Vec2.add(end, Vec2.scale(onto, -8)),
        pose = { ...car, angle: Ops.atan2(onto.y, onto.x) }
      const game = start(
        [],
        [
          { ...back, angle: 0 },
          { cars: [rolling("panda", pose, 4, 0.3, 0, groundZ(car.x, car.y))] },
        ],
        { alone: true },
      )
      game.run(180)
      const panda = game.world().vehicles[0]!,
        wheels = panda.chassis.z - VEHICLES.panda.cg,
        under = onDeck(deck, panda)
      assert.ok(
        under.abeam && under.d < deck.half && Math.abs(wheels - under.level) < 0.3,
        `driving onto it at (${end.x}, ${end.y}): the Panda at (${panda.x.toFixed(2)}, ${panda.y.toFixed(2)}), its wheels at ${wheels.toFixed(2)} m, the deck's top ${under.level.toFixed(2)} m`,
      )
    }
  })
}
