/**
 * The shapes that stand at tunnel mouths: a portal round a bore (the railway's, or a road's sized
 * to its carriageway), and an underpass's head wall where the bank is too low for one; and the
 * least ground each needs over the road. The bake places them by these (render/mouths) and
 * render/portals draws them from them, so what stands clear is what is drawn.
 *
 * @module render/mouths/shapes
 */
import type { RoadInfo } from "../../sim/map/index.ts"
import { type Bore, boreOf, UNDER } from "../bores.ts"

/**
 * A portal's shape, m: the face wall's half width and height over the floor, and its thickness and
 * the cornice on it (how far it stands proud of the wall all round, and its height); the lined
 * throat's half width and height over the floor; and the dark mouth as steps of an arch (half
 * width, top over the floor).
 */
export interface Portal {
  readonly half: number
  readonly high: number
  readonly thick: number
  readonly cornice: { readonly proud: number; readonly high: number }
  readonly throat: { readonly half: number; readonly high: number }
  readonly mouth: ReadonlyArray<readonly [number, number]>
}

/** How far the face wall stands past the mouth's sides and over its crown, m; the throat, past its sides and over its crown. */
const FACE = { side: 2.6, over: 1.7 } as const
const LINING = { side: 0.8, over: 0.4 } as const
/** The cornice on the face wall, m: how far it stands proud of the wall all round, and its height. */
export const CORNICE = { proud: 0.2, high: 0.3 } as const
/** The face wall's thickness, m. */
export const THICK = 1
/** The throat runs into the hill at least this far, at most this far, m, until the hill stands over it. */
export const THROAT = { shortest: 3, longest: 40 } as const

/**
 * The portal round a tunnel's cross-section: an arch springing at `spring` and rising in three
 * steps to `crown` (half of `half` over the springing, as the railway's, unless given lower), the
 * face wall and the throat round it (FACE, LINING).
 */
export const portalRound = (
  { half, spring }: Pick<Bore, "half" | "spring">,
  crown = spring + half / 2,
): Portal => {
  const rise = crown - spring
  return {
    half: half + FACE.side,
    high: crown + FACE.over,
    thick: THICK,
    cornice: CORNICE,
    throat: { half: half + LINING.side, high: crown + LINING.over },
    mouth: [
      [half, spring],
      [(half * 19) / 24, spring + (rise * 2) / 3],
      [(half * 11) / 24, crown],
    ],
  }
}

/** A single-track tunnel's portal: its mouth 4.8 m wide, springing 4.6 m over the rail head, 5.8 m to its crown. */
export const RAIL_PORTAL = portalRound({ half: 2.4, spring: 4.6 })

/**
 * An underpass's head wall, m: how far it stands past its opening's sides (over the box's lining,
 * LINING, and as far again as a cornice stands proud), and its flat lintel over the opening, as
 * high as the bore's headroom, so it reaches where a portal's arch would spring.
 */
const HEAD = { side: 1, lintel: 0.5 } as const

/**
 * The head wall round a tunnel's cross-section, where the hill is too low for a portal's arch (an
 * underpass under an embankment): a plain wall over a flat-lintelled opening as wide as the bore
 * and as high as its clear height, under a coping (the portals' cornice), and the box behind it
 * lined round the opening as a portal's throat.
 */
export const headWall = ({ half, clear }: Bore): Portal => ({
  half: half + HEAD.side,
  high: clear + HEAD.lintel,
  thick: THICK,
  cornice: CORNICE,
  throat: { half: half + LINING.side, high: clear + LINING.over },
  mouth: [[half, clear]],
})

/** The height (m a.s.l.) the hill must stand at over the end of `portal`'s throat, its floor `floor`: 0.5 m over the throat's top. */
export const overThroat = (floor: number, portal: Portal): number =>
  floor + portal.throat.high + 0.5

/**
 * The least height (m over the road) the ground over road `road`'s tunnel must rise to somewhere
 * along it for a portal to stand at its mouth: the face wall over a flat arch at the springing.
 */
export const leastCover = (road: RoadInfo): number => boreOf(road).spring + FACE.over

/** The highest crown (m over the road) a portal's arch may rise to under ground `cover` m over the road: as the railway's, or as far as leaves its face wall under that ground. */
export const crownUnder = ({ half, spring }: Bore, cover: number): number =>
  Math.min(spring + half / 2, cover - FACE.over)

/**
 * The least height (m over the road) the ground over the end of road `road`'s tunnel by a mouth
 * must rise to for a head wall to stand there: its coping's top (the clear height, the lintel and
 * the coping: 4.8 m untagged) and the margin the bore's walls keep under the terrain (UNDER), so a
 * head wall never stands out of its bank.
 */
export const leastWall = (road: RoadInfo): number =>
  headWall(boreOf(road)).high + CORNICE.high + UNDER
