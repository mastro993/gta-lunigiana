/**
 * The level crossings' moving parts and lights: host nodes for the page's life, made with the
 * effects (`makeEffects`), so they stand in the scene when the shaders compile. At each road box of
 * the sim's `CROSSINGS`, every approach has its barrier on the pivot the sim gives (right of the
 * way in): a red and white arm with its counterweight, three red lamps along it, and the skirt
 * (RFI's *grembiale*) hanging under it, whose bars stay plumb as the arm rises and fold flat when it
 * stands up; and the steady red road light on the same post, facing the traffic coming in (the
 * posts, the cabinets and the light's housing are chunk pieces, drawn with the track). Each frame
 * `DrawCrossings` shows every box as the sim's `crossingAt` says at the drawn moment: the arms from
 * standing up (0) to across the road (1), and the lamps and the road lights lit from the warning
 * until the arms are up again, on the signal lamp program that shines by day as well. No lights are
 * made: the lamps glow on their own. A foot crossing shows nothing. The arms are lit like the actors
 * (cloud shadows, no snow on the stripes).
 *
 * @module render/crossings
 */
import { Descriptor } from "@typeonce/ritmo"
import { BoxGeometry, type BufferGeometry, Group, Mesh, type Object3D } from "three"

import { Game, LevelCrossings, Time } from "../sim/index.ts"
import { crossingAt, type CrossingState, OPEN } from "../sim/rail/barriers.ts"
import { type CrossingBox, CROSSINGS } from "../sim/rail/crossings.ts"
import { RenderClock } from "./clock.ts"
import { actorMaterial, merge, paint, sharedGeometry } from "./geometry.ts"
import { atGradeY } from "./ground.ts"
import { PALETTE } from "./palette.ts"
import { signalLampMaterials } from "./sky/glow.ts"

/**
 * A barrier as drawn, m: its pivot over the road (the TD96/2 box's 1.0–1.17 m), the arm's height and thickness (its top edge
 * 1.18 m over the road: the law's 0.90–1.30 m; a reading width, about 1.5 texels at the driving zoom) and its stripes' length
 * along it (the law's 45° stripes do not read at this pixel size), where the arm starts out from the pivot, the counterweight
 * behind it, the skirt's drop under the arm and where it starts along it, and the three lamps along the arm (as shares of its
 * length) and their size.
 */
export const BARRIER = {
  pivot: 1.05,
  tall: 0.26,
  thick: 0.12,
  stripe: 0.5,
  from: 0.3,
  counterweight: 0.9,
  skirt: 0.6,
  skirtFrom: 0.7,
  lamps: [0.08, 0.5, 0.95],
  lamp: 0.3,
} as const
/**
 * The road light: its centre over the road (the law's 2.0–2.5 m), its lens's size (a reading size, the real one is about 0.2 m
 * across: over two texels at the driving zoom) and depth, and how far toward the traffic coming in it stands from the post's
 * axis, m. render/rail fits the light's back plate between the arm and the lens's back.
 */
export const ROAD_LIGHT = { up: 2.25, size: 0.45, deep: 0.06, proud: 0.12 } as const
/** The steepest an arm is drawn standing up, rad: just short of plumb, so the folded skirt keeps a sliver of height. */
const STANDING = Math.PI / 2 - 0.02

/** A box from x0 to x1 along the arm, y0 to y1 across it, `d` m thick, in one colour. */
const block = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  d: number,
  hex: number,
): BufferGeometry =>
  paint(new BoxGeometry(x1 - x0, y1 - y0, d).translate((x0 + x1) / 2, (y0 + y1) / 2, 0), hex)

/** An arm `length` m long out along +X from its pivot: red and white stripes from the tip, the hub and the counterweight behind. */
const armOf = (length: number): BufferGeometry =>
  sharedGeometry(`arm:${length}`, () => {
    const B = BARRIER,
      half = B.tall / 2,
      count = Math.ceil((length - B.from) / B.stripe)
    return [
      ...Array.from({ length: count }, (_, i) =>
        block(
          Math.max(B.from, length - (i + 1) * B.stripe),
          length - i * B.stripe,
          -half,
          half,
          B.thick,
          i % 2 === 0 ? PALETTE.signalRed : PALETTE.marbleWhite,
        ),
      ),
      // In the arm's plane, so they swing clear of the housing standing on its traffic side (render/rail).
      block(-0.25, B.from, -0.12, 0.12, B.thick + 0.02, PALETTE.stoneDark),
      block(-B.counterweight, -0.25, -0.16, 0.16, B.thick + 0.02, PALETTE.stoneDark),
    ]
  })

/** The three red lamps along an arm `length` m long, on its top, standing proud of both faces. */
const armLampsOf = (length: number): BufferGeometry =>
  sharedGeometry(`arm-lamps:${length}`, () => {
    const B = BARRIER
    return B.lamps.map((at) => {
      const x = B.from + (length - B.from) * at
      return block(
        x - B.lamp / 2,
        x + B.lamp / 2,
        B.tall / 2 - 0.02,
        B.tall / 2 + B.lamp - 0.02,
        B.lamp,
        PALETTE.signalRed,
      )
    })
  })

/** The skirt under an arm `length` m long, in its own frame: x along the arm, y plumb (its bars hang from the arm's underside), a red rail at its foot. */
const skirtOf = (length: number): BufferGeometry =>
  sharedGeometry(`skirt:${length}`, () => {
    const B = BARRIER,
      top = -B.tall / 2,
      foot = top - B.skirt
    return [
      block(B.skirtFrom, length - 0.2, foot + 0.08, top, 0.03, PALETTE.limestone),
      block(B.skirtFrom, length - 0.2, foot, foot + 0.08, 0.05, PALETTE.signalRed),
    ]
  })

/** One approach's barrier: its arm, turning about the pivot, the lamps on it, and the skirt under it. */
interface Barrier {
  readonly arm: Mesh
  readonly lamps: Mesh
  readonly skirt: Mesh
}

/** A box's moving parts and lights: a barrier per approach, and its road lights merged into one lens mesh. */
interface BoxNodes {
  readonly barriers: ReadonlyArray<Barrier>
  readonly lenses: Mesh
}

/** A box's barrier at `approach`, under `parent`: its pivot on the post, the arm across the road (to the left of the way in) when down. */
const barrierAt = (parent: Object3D, approach: CrossingBox["approaches"][number]): Barrier => {
  const { pivot, entry, heading, arm: length } = approach
  const post = new Group()
  // The arm along the post group's +X: across the road, to the left of a car driving in; it rises about the road's axis (+Z).
  post.position.set(pivot.x, atGradeY(entry.x, entry.y) + BARRIER.pivot, -pivot.y)
  post.rotation.y = heading + Math.PI / 2
  const arm = new Mesh(armOf(length), actorMaterial),
    lamps = new Mesh(armLampsOf(length), signalLampMaterials.off),
    skirt = new Mesh(skirtOf(length), actorMaterial)
  // The arm's shadow on the road; the skirt's thin bars cast none worth a draw call.
  arm.castShadow = true
  skirt.matrixAutoUpdate = false
  arm.add(lamps)
  post.add(arm, skirt)
  parent.add(post)
  return { arm, lamps, skirt }
}

/** A box's road lights, one per approach: a red lens on the post facing the traffic coming in, all in one mesh. */
const lensesOf = (box: CrossingBox): BufferGeometry =>
  merge(
    box.approaches.map(({ pivot, entry, heading }) => {
      const { up, size, deep, proud } = ROAD_LIGHT
      return paint(
        new BoxGeometry(deep, size, size)
          .rotateY(heading)
          .translate(
            pivot.x - Math.cos(heading) * proud,
            atGradeY(entry.x, entry.y) + up,
            -(pivot.y - Math.sin(heading) * proud),
          ),
        PALETTE.signalRed,
      )
    }),
  )

/** Sets a barrier `arm` of the way down (0 standing up … 1 across the road): the arm turned up from across, its skirt's bars kept plumb. */
const lower = (barrier: Barrier, arm: number): void => {
  const angle = Math.min(STANDING, (1 - arm) * (Math.PI / 2)),
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  barrier.arm.rotation.z = angle
  // The skirt's x along the arm, its y still plumb: its bars hang from the arm and fold up against it as it rises.
  barrier.skirt.matrix.set(cos, 0, 0, 0, sin, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  barrier.skirt.matrixWorldNeedsUpdate = true
}

/** Every road box's barriers and road lights (`CROSSINGS` order; none at a foot crossing), set each frame by `draw`. */
class CrossingNodes {
  /** Per box, its nodes; undefined for a foot crossing. */
  readonly boxes: ReadonlyArray<BoxNodes | undefined>

  /** Builds every box's nodes under `parent`, the arms up and the lights dark. */
  constructor(parent: Object3D) {
    this.boxes = CROSSINGS.map((box) => {
      if (box.walk || box.approaches.length === 0) return undefined
      const barriers = box.approaches.map((approach) => barrierAt(parent, approach))
      for (const barrier of barriers) lower(barrier, 0)
      const lenses = new Mesh(lensesOf(box), signalLampMaterials.off)
      parent.add(lenses)
      return { barriers, lenses }
    })
  }

  /** Shows each box as `crossingAt` says in `states` (the `LevelCrossings` resource) at step `now` (fractional: the drawn moment). */
  draw(states: ReadonlyArray<CrossingState>, now: number): void {
    for (const [i, nodes] of this.boxes.entries()) {
      const box = CROSSINGS[i]
      if (nodes === undefined || box === undefined) continue
      const { arm, lit } = crossingAt(box, states[i] ?? OPEN, now),
        lamp = lit ? signalLampMaterials.on : signalLampMaterials.off
      for (const barrier of nodes.barriers) {
        lower(barrier, arm)
        barrier.lamps.material = lamp
      }
      nodes.lenses.material = lamp
    }
  }
}

/** The map's level crossings as drawn, under `parent` (`makeEffects` makes them). */
export const makeCrossings = (parent: Object3D): CrossingNodes => new CrossingNodes(parent)

/** The host's level crossings (`makeCrossings`, made with the effects), set by the render schedule. */
export const Crossings = Descriptor.Service<CrossingNodes>()("Lunigiana/CrossingNodes")

/** Shows every level crossing as the sim says it stands at the drawn moment: its arms, its lamps and its road lights. */
export const DrawCrossings = Game.System(
  "Lunigiana/DrawCrossings",
  {
    resources: {
      crossings: Game.System.readResource(LevelCrossings),
      time: Game.System.readResource(Time),
    },
    services: { nodes: Game.System.service(Crossings), clock: Game.System.service(RenderClock) },
  },
  ({ resources, services }) =>
    services.nodes.draw(
      resources.crossings.get(),
      resources.time.get().step + services.clock.alpha,
    ),
)
