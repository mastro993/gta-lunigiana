/**
 * The spots the population and sky tests stand at, and the population tests' `share`, each shared
 * by a test file and its `*.long-test.ts`.
 *
 * @module sim/__tests__/spots
 */

/** Calibrated spots: the village centres, and the SR445 between Gragnola and Monzone, with no house within 140 m. */
export const GRAGNOLA = { x: -1751.2, y: 3360.4 },
  VINCA = { x: 2273, y: -2620 },
  RURAL = { x: -279, y: 3736 }
/** A lane by a lone house or two, between Equi Terme and Monzone: residents nearby, none of the walk edges around it peopled. */
export const ISOLATED = { x: 1049, y: 1388 }
/** The player out of the way, in the map's empty south-west corner: Populate brings nobody near. */
export const FAR_AWAY = { x: -2800, y: -6000, angle: 0 }

/** The share of `items` that pass `is`. */
export const share = <A>(items: ReadonlyArray<A>, is: (a: A) => boolean) =>
  items.filter(is).length / items.length
