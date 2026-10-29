import { Clock } from "@typeonce/ritmo"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { clearOf, wallsAlong } from "../body.ts"
import { FAUNA, randomAnimal, SIZE } from "../fauna.ts"
import { peopledIndex, residentsAlong, residentsNear } from "../population/density.ts"
import {
  buildingsNear,
  farmsNear,
  grazing,
  indoors,
  offWall,
  openGround,
  pasture,
  RURAL,
  RURAL_REACH,
} from "../population/farms.ts"
import { offTrack } from "../rail/bodies.ts"
import { laneOf, lanePoint, roadOf, walkSide } from "../route.ts"
import {
  Animal,
  Dead,
  Follows,
  Game,
  Motion,
  Player,
  Pose,
  PrevPose,
  Rng,
  Roam,
  type Species,
  STEP,
  Time,
} from "../schema.ts"
import { animal } from "../spawning.ts"
import { VIEW_REACH } from "../view.ts"
import { FILL_NEAR } from "./populate.ts"

const PERIOD = Clock.duration(STEP, 0.5)
/**
 * The free animals around the player (dogs on a lead come with their walkers, from `Populate`): each kind's count is a
 * share of what lies within `reach` m of the player, at most `max`; each is despawned beyond `despawn` m.
 * - cats, in the villages: `perResident` of the residents (Italy keeps ≈ 0.2 pet cats a resident: 11.9 M cats and 9 M
 *   dogs for 59 M people, Assalco–Zoomark 2025; about one in ten out on the street at a time is an estimate);
 * - free dogs, at farms and in hamlets: `perFarm` of the farms (TUNED, an estimate per farm: about one farm in seven has its
 *   dog lying out in the yard);
 * - cows, in rural parts only: `perFarm` of the rural farms, in herds of `herd` (TUNED); they go farther before they are
 *   despawned, since a herd grazes up to `FAUNA.cow.home` m from where it was put;
 * - pigs, in rural parts only: `perPen` of the rural sheds, barns and farmyards, `litter` at a pen (TUNED).
 */
export const ANIMALS = {
  cat: { perResident: 0.02, reach: 140, max: 5, despawn: 140 },
  dog: { perFarm: 0.15, reach: 140, max: 3, despawn: 140 },
  cow: { perFarm: 0.15, reach: 250, max: 8, herd: [2, 5], despawn: 180 },
  pig: { perPen: 0.15, reach: 140, max: 5, litter: [1, 3], despawn: 140 },
} as const
/** Animals spawn out of view, this far from the player (m); cats on the pedestrians' band, the rest up to the despawn reach of their kind's neighbours. */
const SPAWN = { cat: [VIEW_REACH, 120], farm: [VIEW_REACH, 140] } as const
/** Cats sit this far beyond the pedestrians' line on a verge, or this far from a house wall, m. */
const CAT_SPOT = { verge: [0.3, 1.2], wall: [1, 3] } as const
/** A free dog lies this far from its farm building, pigs root this far from their shed, cows of a herd stand within `herd` m of its middle (m). */
const FARM_SPOT = { dog: [4, 8], pig: [5, 15], herd: 8, apart: 2.5, litter: 1.5 } as const
/** Spots tried for an animal (or a herd, or a litter) before giving up: until the next period, or for the rest of the first fill. */
const TRIES = 8

/** `seconds` as whole steps. */
const stepsOf = (seconds: number): number => Math.round(seconds * STEP.hz)
const cap = (n: number, max: number) => Math.min(max, Math.round(n))
/** How many of each kind the player at `at` should have about: the shares of `ANIMALS`, as `PopulateAnimals` keeps them. */
const wanted = (at: Vec2.Vec2): Record<Species, number> => {
  const rural = residentsNear(at.x, at.y, RURAL_REACH) < RURAL
  return {
    cat: cap(
      residentsNear(at.x, at.y, ANIMALS.cat.reach) * ANIMALS.cat.perResident,
      ANIMALS.cat.max,
    ),
    dog: cap(
      farmsNear(at.x, at.y, ANIMALS.dog.reach).length * ANIMALS.dog.perFarm,
      ANIMALS.dog.max,
    ),
    // Cows and pigs only where the player is out in the country, and only by its farms.
    cow: rural
      ? cap(
          farmsNear(at.x, at.y, ANIMALS.cow.reach).filter((f) => f.rural).length *
            ANIMALS.cow.perFarm,
          ANIMALS.cow.max,
        )
      : 0,
    pig: rural
      ? cap(
          farmsNear(at.x, at.y, ANIMALS.pig.reach).filter((f) => f.rural && f.pen).length *
            ANIMALS.pig.perPen,
          ANIMALS.pig.max,
        )
      : 0,
  }
}

/** Whether `p` is within `r` m of `at`. */
const within = (at: Vec2.Vec2, p: Vec2.Vec2, r: number) => Vec2.distanceSquared(p, at) <= r * r
/** Whether an animal of `species` (of the largest size) fits at `p`: `band` m from `at`, outdoors, clear of walk walls and off the railway's track (`offTrack`). */
const fits = (
  species: Species,
  p: Vec2.Vec2,
  at: Vec2.Vec2,
  [near, far]: readonly [number, number],
) => {
  const r = FAUNA[species].radius * SIZE[1]
  return (
    !within(at, p, near) &&
    within(at, p, far) &&
    !indoors(p.x, p.y) &&
    clearOf(wallsAlong("land", p.x, p.y, 0, 0, r + 0.5), p.x, p.y, r) &&
    offTrack(p.x, p.y)
  )
}

/** Where a cat may sit `band` m from `at`: on a village street's verge, or by a wall of a house along it (`TRIES` spots). */
const catSpot = (
  random: Random.Random,
  at: Vec2.Vec2,
  band: readonly [number, number],
): Vec2.Vec2 | undefined => {
  const edges = peopledIndex.around(at.x, at.y, band)
  for (let k = 0; k < TRIES; k++) {
    const edge = random.weighted(edges, residentsAlong)
    if (edge === undefined) break
    const lane = laneOf(edge, true),
      along = random.range(0, lane.length),
      verge = walkSide(roadOf(edge))
    // On the verge, or by a wall of a house along it.
    const by = lanePoint(lane, along, 0)
    const house =
      random.next() < 0.5
        ? random.pick(buildingsNear(by.x, by.y, verge + CAT_SPOT.wall[1] + 5))
        : undefined
    const spot =
      house === undefined
        ? lanePoint(
            lane,
            along,
            (random.next() < 0.5 ? -1 : 1) *
              (verge + random.range(CAT_SPOT.verge[0], CAT_SPOT.verge[1])),
          )
        : offWall(house, random.range(CAT_SPOT.wall[0], CAT_SPOT.wall[1]), random)
    if (fits("cat", spot, at, band)) return spot
  }
  return undefined
}

/** Where a free dog may lie `band` m from `at`: on open ground off a wall of a farm there (`TRIES` spots). */
const dogSpot = (
  random: Random.Random,
  at: Vec2.Vec2,
  band: readonly [number, number],
): Vec2.Vec2 | undefined => {
  const out = farmsNear(at.x, at.y, ANIMALS.dog.reach).filter((f) => !within(at, f, band[0]))
  for (let k = 0; k < TRIES; k++) {
    const farm = random.pick(out)
    if (farm === undefined) break
    const spot = offWall(farm.building, random.range(FARM_SPOT.dog[0], FARM_SPOT.dog[1]), random)
    if (openGround(spot.x, spot.y) && fits("dog", spot, at, band)) return spot
  }
  return undefined
}

/** A herd of at least `ANIMALS.cow.herd[0]` and at most `most` cows on a rural pasture `band` m from `at`, and its middle (`TRIES` spots). */
const herdSpots = (
  random: Random.Random,
  at: Vec2.Vec2,
  band: readonly [number, number],
  most: number,
) => {
  for (let k = 0; k < TRIES; k++) {
    const r = random.range(band[0], band[1]),
      a = random.range(0, 2 * Math.PI)
    const middle = { x: at.x + r * Ops.cos(a), y: at.y + r * Ops.sin(a) }
    if (!pasture(middle.x, middle.y) || residentsNear(middle.x, middle.y, RURAL_REACH) >= RURAL)
      continue
    const size = Math.min(random.integer(ANIMALS.cow.herd[0], ANIMALS.cow.herd[1] + 1), most)
    const herd: Array<Vec2.Vec2> = []
    for (let j = 0; j < 3 * size && herd.length < size; j++) {
      const d = FARM_SPOT.herd * Math.sqrt(random.next()),
        b = random.range(0, 2 * Math.PI)
      const spot = { x: middle.x + d * Ops.cos(b), y: middle.y + d * Ops.sin(b) }
      if (
        grazing(spot.x, spot.y) &&
        fits("cow", spot, at, band) &&
        herd.every((q) => Vec2.distance(q, spot) >= FARM_SPOT.apart)
      )
        herd.push(spot)
    }
    if (herd.length >= ANIMALS.cow.herd[0]) return { middle, spots: herd }
  }
  return undefined
}

/** A litter of up to `most` pigs rooting by a rural pen `band` m from `at`, and its middle (`TRIES` spots). */
const litterSpots = (
  random: Random.Random,
  at: Vec2.Vec2,
  band: readonly [number, number],
  most: number,
) => {
  const out = farmsNear(at.x, at.y, ANIMALS.pig.reach).filter(
    (f) => f.rural && f.pen && !within(at, f, band[0]),
  )
  for (let k = 0; k < TRIES; k++) {
    const pen = random.pick(out)
    if (pen === undefined) break
    const middle = offWall(pen.building, random.range(FARM_SPOT.pig[0], FARM_SPOT.pig[1]), random)
    if (!openGround(middle.x, middle.y) || !fits("pig", middle, at, band)) continue
    const litter = Math.min(random.integer(ANIMALS.pig.litter[0], ANIMALS.pig.litter[1] + 1), most)
    const spots = [middle]
    for (let j = 0; j < 3 * litter && spots.length < litter; j++) {
      const spot = {
        x: middle.x + random.range(-FARM_SPOT.litter, FARM_SPOT.litter),
        y: middle.y + random.range(-FARM_SPOT.litter, FARM_SPOT.litter),
      }
      if (openGround(spot.x, spot.y) && fits("pig", spot, at, band)) spots.push(spot)
    }
    return { middle, spots }
  }
  return undefined
}

/** An animal of `species` at `p`, resting a while from step `now`, at home at `home`. */
const resting = (
  random: Random.Random,
  now: number,
  species: Species,
  p: Vec2.Vec2,
  home: Vec2.Vec2 = p,
) => {
  const pose = { x: p.x, y: p.y, angle: random.range(-Math.PI, Math.PI) }
  const rest = {
    mood: "idle",
    until: now + stepsOf(random.range(0, 10)),
    hx: home.x,
    hy: home.y,
    tx: p.x,
    ty: p.y,
  } as const
  return Game.Command.extend(animal(randomAnimal(species, random), pose), [Roam, rest])
}

/**
 * Every half second, keeps the animals around the player: cats on the village streets, free dogs at the farms, herds of
 * cows and pigs by their pens in the countryside; spawned out of view, despawned once far behind (dead ones too).
 */
export const PopulateAnimals = Game.System(
  "Lunigiana/PopulateAnimals",
  {
    queries: {
      player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          animal: Game.Query.read(Animal),
          follows: Game.Query.optional(Follows),
          dead: Game.Query.optional(Dead),
        },
      }),
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.spawns(Animal, Roam, Pose, PrevPose, Motion),
      Game.System.despawns(Animal),
    ),
  },
  ({ queries, resources, commands }) => {
    const time = resources.time.get()
    if (!Clock.every(time, PERIOD)) return
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const random = Random.draw(resources.rng)

    const free: Record<Species, number> = { cat: 0, dog: 0, cow: 0, pig: 0 }
    for (const { entity, data } of queries.animals.each()) {
      const { species } = data.animal.get()
      if (!within(at, data.pose.get(), ANIMALS[species].despawn)) commands.despawn(entity)
      else if (!data.dead.present && !data.follows.present) free[species]++
    }
    /** Spawns an animal of `species` at `p`, at home at `home`. */
    const put = (species: Species, p: Vec2.Vec2, home?: Vec2.Vec2) => {
      commands.spawn(resting(random, time.step, species, p, home))
      free[species]++
    }

    const want = wanted(at)
    if (free.cat < want.cat) {
      const spot = catSpot(random, at, SPAWN.cat)
      if (spot !== undefined) put("cat", spot)
    }
    if (free.dog < want.dog) {
      const spot = dogSpot(random, at, SPAWN.farm)
      if (spot !== undefined) put("dog", spot)
    }
    if (want.cow - free.cow >= ANIMALS.cow.herd[0]) {
      const herd = herdSpots(random, at, SPAWN.farm, want.cow - free.cow)
      for (const spot of herd?.spots ?? []) put("cow", spot, herd?.middle)
    }
    if (free.pig < want.pig) {
      const litter = litterSpots(random, at, SPAWN.farm, want.pig - free.pig)
      for (const spot of litter?.spots ?? []) put("pig", spot, litter?.middle)
    }
  },
)

/**
 * Setup: the animals `PopulateAnimals` keeps around the player's start, put there at once from `FILL_NEAR` m of the player to
 * the edge of its spawn bands, so the player meets them from the first frame. It also builds the farm list (about 0.1 s) behind
 * the title card rather than in play.
 */
export const FillAnimals = Game.System(
  "Lunigiana/FillAnimals",
  {
    queries: { player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }) },
    resources: { rng: Game.System.writeResource(Rng), time: Game.System.readResource(Time) },
    commands: Game.System.commands(Game.System.spawns(Animal, Roam, Pose, PrevPose, Motion)),
  },
  ({ queries, resources, commands }) => {
    const found = queries.player.singleOptional()
    if (!found.ok || found.value === undefined) return
    const at = found.value.data.pose.get()
    const random = Random.draw(resources.rng)
    const now = resources.time.get().step
    const want = wanted(at)
    const cats: readonly [number, number] = [FILL_NEAR, SPAWN.cat[1]],
      farms: readonly [number, number] = [FILL_NEAR, SPAWN.farm[1]]
    // Each kind until it has its share, or no spot is found for one more.
    for (const [species, place] of [
      ["cat", () => catSpot(random, at, cats)],
      ["dog", () => dogSpot(random, at, farms)],
    ] as const) {
      for (let n = 0; n < want[species]; n++) {
        const spot = place()
        if (spot === undefined) break
        commands.spawn(resting(random, now, species, spot))
      }
    }
    for (let n = 0; want.cow - n >= ANIMALS.cow.herd[0];) {
      const herd = herdSpots(random, at, farms, want.cow - n)
      if (herd === undefined) break
      for (const spot of herd.spots) commands.spawn(resting(random, now, "cow", spot, herd.middle))
      n += herd.spots.length
    }
    for (let n = 0; n < want.pig;) {
      const litter = litterSpots(random, at, farms, want.pig - n)
      if (litter === undefined) break
      for (const spot of litter.spots)
        commands.spawn(resting(random, now, "pig", spot, litter.middle))
      n += litter.spots.length
    }
  },
)
