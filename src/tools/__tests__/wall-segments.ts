/**
 * Walls as segments, shared by `walls.test.ts` and `walls.long-test.ts`.
 *
 * @module tools/__tests__/wall-segments
 */

/** The walls' segments as [ax, ay, bx, by] tuples. */
export const segments = (flat: ReadonlyArray<number>) =>
  Array.from({ length: flat.length / 4 }, (_, k) => flat.slice(4 * k, 4 * k + 4))
