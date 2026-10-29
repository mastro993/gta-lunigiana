/**
 * The effects host and the render system that feeds it: the map's tyre marks and smoke, the
 * damaged engines' smoke and flames, the blasts and the level crossings' arms and lights, made once
 * for the page's life (`makeEffects`), and `DrawEffects`, which lays the steps' skids, sets off the
 * blasts near the player and gives off the damaged engines' smoke and fire each frame.
 *
 * @module render/effects
 */
import { Descriptor } from "@typeonce/ritmo"
import type { Object3D } from "three"

import { stageOf } from "../sim/damage.ts"
import { Damage, Explosion, Game, Player, Pose, Skid, STEP, Time } from "../sim/index.ts"
import { VIEW_REACH } from "../sim/view.ts"
import { Blasts } from "./blasts.ts"
import { RenderClock } from "./clock.ts"
import { makeCrossings } from "./crossings.ts"
import { groundY, yOf } from "./ground.ts"
import { Marks, TREAD } from "./marks.ts"
import { Vehicles } from "./registries.ts"
import { Smoke } from "./smoke.ts"
import { PLUMES_AT_ONCE, type WreckState, Wrecks } from "./wrecks.ts"

/**
 * The map's tyre marks and smoke, the damaged engines' smoke and flames, the blasts and the level crossings' arms and lights,
 * under `parent` for the page's life: in the scene from the first frame, so their programs compile before play.
 */
export const makeEffects = (parent: Object3D) => {
  const effects = {
    marks: new Marks(),
    smoke: new Smoke(),
    wrecks: new Wrecks(),
    blasts: new Blasts(),
    crossings: makeCrossings(parent),
  }
  parent.add(
    effects.marks.mesh,
    effects.smoke.mesh,
    effects.wrecks.smoke.mesh,
    effects.wrecks.flames.mesh,
    ...effects.blasts.meshes,
  )
  return effects
}
/** The host's tyre marks and smoke, the wrecks' smoke and fire and the blasts (`makeEffects`), fed by the render schedule; its `crossings` go in as the `Crossings` service. */
export const Effects = Descriptor.Service<ReturnType<typeof makeEffects>>()("Lunigiana/Effects")

/** Damaged engines and blasts farther than this from the player (m) are not drawn: past the view's reach, with room for a tall plume. */
const PLUME_REACH = VIEW_REACH + 60
/**
 * Which damaged engines smoke first: burning wrecks (about to blow), then the smoking ones, white or black alike so a near one is not
 * dropped for a far one, and the charred shells' thin wisps last.
 */
const PRIORITY = { destroyed: 0, severe: 1, medium: 1, burnt: 2 } as const satisfies Record<
  Exclude<WreckState, "light">,
  number
>

/**
 * Lays the steps' Skid events as tyre marks and smoke, sets off a blast for each Explosion near the
 * player at the drawn moment, gives off the smoke and fire of the damaged engines near the player
 * since the last frame, the burning ones first (by their stage of damage, or the thin smoke of a
 * shell that blew up, from their nodes as placed this frame), then moves them all to the drawn
 * moment's sim time.
 */
export const DrawEffects = Game.System(
  "Lunigiana/DrawEffects",
  {
    queries: {
      player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
      vehicles: Game.Query({ selection: { damage: Game.Query.read(Damage) } }),
    },
    resources: { time: Game.System.readResource(Time) },
    events: { skids: Game.System.readEvent(Skid), explosions: Game.System.readEvent(Explosion) },
    services: {
      effects: Game.System.service(Effects),
      nodes: Game.System.service(Vehicles),
      clock: Game.System.service(RenderClock),
    },
  },
  ({ queries, resources, events, services }) => {
    const { marks, smoke, wrecks, blasts } = services.effects
    for (const skid of events.skids.all()) {
      // A vehicle despawned since leaves no more marks.
      const node = services.nodes.get(skid.car)
      if (node === undefined) continue
      marks.add(skid, TREAD[node.model])
      smoke.add(skid)
    }
    const now = (resources.time.get().step + services.clock.alpha) * STEP.dt,
      dt = wrecks.frame(now)
    const me = queries.player.singleOptional(),
      at = me.ok ? me.value?.data.pose.get() : undefined
    for (const blast of events.explosions.all()) {
      // A wreck despawned since (out of view) is not drawn.
      const node = services.nodes.get(blast.car)
      if (
        at === undefined ||
        node === undefined ||
        Math.hypot(blast.x - at.x, blast.y - at.y) > PLUME_REACH
      )
        continue
      // Its pieces come down on the ground on the level nearest the wreck's: a bridge's deck, not the river under it.
      const y = yOf(blast.z),
        deck = groundY(blast.x, blast.y, y)
      blasts.start(blast.x, y, -blast.y, (x, z) => groundY(x, -z, deck), now, node.paint)
    }
    const plumes =
      at === undefined
        ? []
        : queries.vehicles.each().flatMap(({ entity, data }) => {
            const damage = data.damage.get(),
              state: WreckState = damage.exploded ? "burnt" : stageOf(damage.amount),
              node = services.nodes.get(entity.id)
            if (state === "light" || node === undefined) return []
            const away = Math.hypot(node.position.x - at.x, node.position.z + at.y)
            return away > PLUME_REACH ? [] : [{ node, state, away }]
          })
    // As many as the pools hold in full, by PRIORITY and then the nearest first (the player's own car among them).
    const first = plumes
      .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.away - b.away)
      .slice(0, PLUMES_AT_ONCE)
    for (const { node, state } of first) wrecks.emit(node, state, dt, now)
    marks.update(now)
    smoke.update(now)
    wrecks.update(now)
    blasts.update(now)
  },
)
