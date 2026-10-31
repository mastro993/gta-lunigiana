/**
 * An integer hash for numbers a game draws from its seed and a key alone, with no random stream:
 * each day's weather plan (sky/plan.ts) and each parked spot's car (population/parked.ts).
 *
 * @module hash
 */

/** murmur3's 32-bit finaliser: a bijection that spreads every bit of `x` over every bit out. */
export const mix = (x: number): number => {
  const a = Math.imul(x ^ (x >>> 16), 0x85ebca6b),
    b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35)
  return (b ^ (b >>> 16)) >>> 0
}
