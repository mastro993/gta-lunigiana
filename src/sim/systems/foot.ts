import { InputAxis, Ops, Vec2 } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import {
  Down,
  Driving,
  Footing,
  Game,
  Input,
  InWater,
  Motion,
  Person,
  Player,
  Pose,
  Rivers,
  Time,
  View,
} from "../schema.ts"
import { PERSON_RADIUS, SPRINT_SPEED, WALK_SPEED } from "../tuning.ts"
import { screenAxes } from "../view.ts"
import { FLOW, specificDischarge } from "../water/flow.ts"
import { waterUnder } from "../water/rivers.ts"
import { HARD_STROKE, STROKE, waterVelocity } from "../water/swim.ts"
import { personBuild } from "./water.ts"

/** On-foot acceleration toward the wanted velocity, m/s². */
const FOOT_ACCEL = 30
/** Deceleration of a knocked-down person sliding on the ground, m/s². */
const SLIDE_DECEL = 10

/** A knocked-down body's velocity after one step of ground friction. */
export const slide = (velocity: Vec2.Vec2, dt: number): Vec2.Vec2 =>
  Vec2.moveToward(velocity, Vec2.zero, SLIDE_DECEL * dt)

/**
 * The player on foot: arrow keys move along the screen axes of the turned view (up key = screen-up),
 * sprint held runs, the body faces where the keys point. Knocked down, it only slides. In the water
 * it wades, slower the deeper it is, or swims with the current (sprint held, a hard crawl); knocked
 * down there, the current takes it.
 */
export const PlayerFoot = Game.System(
  "Lunigiana/PlayerFoot",
  {
    queries: {
      player: Game.Query({
        selection: {
          pose: Game.Query.write(Pose),
          motion: Game.Query.write(Motion),
          down: Game.Query.optional(Down),
          look: Game.Query.read(Person),
          wet: Game.Query.optional(InWater),
          footing: Game.Query.read(Footing),
        },
        with: [Player],
        without: [Driving],
      }),
    },
    resources: {
      input: Game.System.readResource(Input),
      view: Game.System.readResource(View),
      time: Game.System.thisTick(Game.System.readResource(Time)),
      rivers: Game.System.readResource(Rivers),
    },
  },
  ({ queries, resources }) => {
    const { dt } = resources.time.get()
    const keys = resources.input.get()
    const { up, right } = screenAxes(resources.view.get().turns)
    for (const { data } of queries.player.each()) {
      const pose = data.pose.get()
      const motion = data.motion.get()
      const current = { x: motion.vx, y: motion.vy }
      const ix = InputAxis.axis(keys.actions.left.held, keys.actions.right.held)
      const iy = InputAxis.axis(keys.actions.down.held, keys.actions.up.held)
      const wish = data.down.present
        ? Vec2.zero
        : Vec2.normalizeOr({ x: right.x * ix + up.x * iy, y: right.y * ix + up.y * iy }, Vec2.zero)
      const wet = data.wet.value(),
        water =
          wet === undefined
            ? undefined
            : waterUnder(pose.x, pose.y, true, specificDischarge(resources.rivers.get(), FLOW))
      const wanted = Vec2.scale(wish, keys.actions.sprint.held ? SPRINT_SPEED : WALK_SPEED)
      let velocity: Vec2.Vec2
      if (wet !== undefined && water !== undefined) {
        const look = data.look.get(),
          down = data.down.present
        velocity = waterVelocity(
          current,
          wanted,
          water,
          personBuild(look.height),
          wet.swimming || down,
          down ? 0 : STROKE[look.age] * (keys.actions.sprint.held ? HARD_STROKE : 1),
          FOOT_ACCEL,
          dt,
        )
      } else
        velocity = data.down.present
          ? slide(current, dt)
          : Vec2.moveToward(current, wanted, FOOT_ACCEL * dt)
      const moved = walkBy(pose, Vec2.scale(velocity, dt), PERSON_RADIUS, data.footing.get().z)
      // Velocity is what actually happened, so walls stop it instead of storing it up.
      const real =
        dt > 0
          ? { x: (moved.position.x - pose.x) / dt, y: (moved.position.y - pose.y) / dt }
          : velocity
      const kept = Vec2.lengthSquared(real) < Vec2.lengthSquared(velocity) ? real : velocity
      const facing = wish.x !== 0 || wish.y !== 0 ? Ops.atan2(wish.y, wish.x) : pose.angle
      data.pose.set({ x: moved.position.x, y: moved.position.y, angle: facing })
      data.motion.set({ vx: kept.x, vy: kept.y, spin: 0 })
    }
  },
)
