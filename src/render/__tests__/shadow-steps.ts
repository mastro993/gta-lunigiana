/**
 * The tests' own copy of the shadow box's steps (`holdBox` in `shadow-box.ts`, docs/architecture.md):
 * each × √2 the last, from the zoom's flat fit up to the 300 m cap, which a step landing within a
 * tenth of it gives way to. Map-free, so the quick tests read it too.
 *
 * @module render/__tests__/shadow-steps
 */

const STEP = Math.SQRT2,
  LEAST = 1.1,
  CAP = 300

/** The step above `half`. */
export const nextStep = (half: number): number => (half * STEP * LEAST > CAP ? CAP : half * STEP)

/** The smallest step from `base` that holds `need`. */
export const stepFor = (base: number, need: number): number => {
  let half = base
  while (half < need && half < CAP) half = nextStep(half)
  return half
}

/** Every step from `base`, the last the cap. */
export const ladder = (base: number): Array<number> => {
  const steps = [base]
  while (steps.at(-1)! < CAP) steps.push(nextStep(steps.at(-1)!))
  return steps
}
