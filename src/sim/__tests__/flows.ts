/**
 * The rivers' flows the water and railway tests stage, m³/s per km² of catchment, shared by
 * `water.test.ts`, `water.long-test.ts`, `trains-world.test.ts` and `crossing-traffic.ts`.
 *
 * @module sim/__tests__/flows
 */

/** The rivers at about their mean (the Soliera gauge's 8.5 m³/s over 208 km²), and in a spate (125 m³/s there). */
export const MEAN = 0.041,
  SPATE = 0.6
