/**
 * The scripted joyride the sim's architecture tests replay, shared by `index.test.ts` and `index.long-test.ts`.
 *
 * @module sim/__tests__/joyride
 */
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { type Look } from "../index.ts"
import { MAP } from "../map/index.ts"
import { carOn, PARKING, spotsWithin } from "../population/parked.ts"
import { laneOf, lanePoint, roadOf, walkIndex, walkSide } from "../route.ts"
import { animal, parkedCar, pedestrian } from "../spawning.ts"
import {
  BATTISTI,
  burning,
  door,
  facing,
  FAR,
  LOOK,
  ON_BATTISTI,
  press,
  rolling,
  type Timeline,
  TOWARD,
} from "../testing.ts"
import { VEHICLES } from "../vehicles.ts"

/**
 * Walk to a car, drive it hard around Via Cesare Battisti, the view following it, get out and turn the view, while another car crashes into a house wall and
 * goes on pushing at it on its worn, misfiring engine, and a wreck across the road blows up, killing a bystander and setting
 * the car beside it on fire: every system has work to do.
 */
export const joyride: Timeline = [
  { frame: 0, press: ["left"] },
  { frame: 10, release: ["left"] },
  ...press(12, "action"),
  { frame: 14, press: ["up"] },
  { frame: 100, press: ["left"] },
  { frame: 130, release: ["left"], press: ["handbrake", "right"] },
  { frame: 170, release: ["handbrake", "right"] },
  { frame: 240, release: ["up"], press: ["down"] },
  { frame: 300, release: ["down"] },
  ...press(330, "action"),
  ...press(334, "turnLeft"),
  { frame: 340, press: ["up", "sprint"] },
  { frame: 400, release: ["up", "sprint"] },
]

/**
 * Up the street, a mother with her son and their dog on a lead walk toward a man lying dead on their verge: they come on him in
 * about 2 s, stand shocked and run from him; a cat sits across the street. Followers, bodies, animals and reactions all replay.
 * A man walks by the burning wreck. Out of view, a parked car stands burnt out on `WRECKED`: it goes in the first half second,
 * and its spot stays empty (`Parking.wrecked`).
 */
const BYSTANDER = { x: FAR.x, y: FAR.y + 2.5, angle: 0 }

/** A parked spot 150–300 m from the joyride's start where seed 1 parks a car. */
export const WRECKED = spotsWithin(ON_BATTISTI, PARKING.fill[1]).find(
  (i) => Vec2.distance(MAP.spawns.parked[i]!, ON_BATTISTI) > 150 && carOn(1, i) !== undefined,
)!

/** The joyride's cast on Via Cesare Battisti: the cars, the walkers, the dog and the cat it meets. */
export const joyrideCast = (() => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    verge = walkSide(roadOf(BATTISTI.edge)),
    angle = Ops.atan2(-lane.dy, -lane.dx)
  const back = { ...BATTISTI, forward: !BATTISTI.forward, side: -verge }
  const mother: Look = { ...LOOK, female: true, height: 1.64, outfit: "dress", hairdo: "long" }
  const son: Look = { ...LOOK, age: "kid", height: 1.25, outfit: "shorts" }
  return [
    door(ON_BATTISTI),
    {
      cars: [
        parkedCar("panda", 0xb8312b, ON_BATTISTI),
        rolling("panda", { ...facing(4.85), angle: TOWARD }, 34, 1),
        burning("panda", FAR, 100),
        parkedCar("panda", 0xf2efe6, {
          x: FAR.x + VEHICLES.panda.length + 0.8,
          y: FAR.y,
          angle: 0,
        }),
      ],
      wrecks: [WRECKED],
      peds: [
        pedestrian(
          LOOK,
          BYSTANDER,
          { edge: walkIndex.nearest(BYSTANDER.x, BYSTANDER.y), forward: true, side: 0 },
          { mood: "walk", until: 0, fx: 0, fy: 0 },
        ),
      ],
      bodies: [
        pedestrian(LOOK, { ...lanePoint(lane, 36, verge), angle }, back, {
          mood: "walk",
          until: 0,
          fx: 0,
          fy: 0,
        }),
      ],
      parties: [
        {
          leader: pedestrian(mother, { ...lanePoint(lane, 48, verge), angle }, back, {
            mood: "walk",
            until: 0,
            fx: 0,
            fy: 0,
          }),
          people: [
            {
              draft: pedestrian(son, { ...lanePoint(lane, 48.4, verge - 0.5), angle }, back, {
                mood: "walk",
                until: 0,
                fx: 0,
                fy: 0,
              }),
              side: 0.5,
              back: 0.4,
            },
          ],
          animals: [
            {
              draft: animal(
                { species: "dog", coat: 0xc49a6c, patch: 0xeee8dc, size: 1 },
                { ...lanePoint(lane, 48.9, verge + 0.5), angle },
              ),
              side: -0.5,
              back: 0.9,
            },
          ],
        },
      ],
      animals: [
        animal(
          { species: "cat", coat: 0x2b2b2b, patch: 0x2b2b2b, size: 1 },
          { ...lanePoint(lane, 44, -verge), angle: 0 },
        ),
      ],
    },
  ] as const
})()
