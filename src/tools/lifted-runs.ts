// A chain's bridges and tunnels on its profile (profiles.ts): the decks and bores it is laid out in,
// and the levels their ends take before the fit.
import type { V } from "./geometry.ts"
import type { Profile } from "./terrain.ts"

/** A bridge's or tunnel's end may take the elevation of the ground this far (m) out of it along the chain. */
const PORTAL = 4

/**
 * A chain laid out on its profile `p`: its pieces' `runs` of vertices (in chain order), each run's
 * first vertex as an index into the chain's (`first`), which pieces are bridges or tunnels and which
 * tunnels, and what is read off that: the piece a sample belongs to, its deck and its lifted run.
 */
export const laidOut = (
  p: Profile,
  runs: ReadonlyArray<ReadonlyArray<V>>,
  first: ReadonlyArray<number>,
  isLifted: (i: number) => boolean,
  isTunnel: (i: number) => boolean,
) => {
  /** The piece sample `k` lies on: the last whose first vertex is at or before it. */
  const pieceOfSample = (k: number) => {
    let i = runs.length - 1
    while (i > 0 && p.vertexSample[first[i]!]! > k) i--
    return i
  }
  // A deck: the consecutive lifted pieces of one kind round piece i, first and last, straight from
  // end to end. OSM splits a bridge or a bore where its tags change: taken piece by piece, the
  // joint of the SS63's two-piece bridge over the Rosaro at Soliera fell toward the ground 12 m
  // under it (4.9 m), and the joint inside the Galleria del Lupacino, at its speed limit, took the
  // hill's surface over it. So did the rail's, its smoothing held only short spans: the joint of
  // the Pontremolese's second track over the Magra north of Aulla, between pieces of 175 and 391 m,
  // stood 5.6 m under the line between the deck's ends, the grade changing 4.5% over 20 m there.
  const deckOf = (i: number): readonly [number, number] => {
    let a = i,
      b = i
    const joins = (k: number) => isLifted(k) && isTunnel(k) === isTunnel(i)
    while (a > 0 && joins(a - 1)) a--
    while (b + 1 < runs.length && joins(b + 1)) b++
    return [a, b]
  }
  /** The first and last vertex of deck `[a, b]`, as indices into the chain's vertices. */
  const deckEnds = ([a, b]: readonly [number, number]) =>
    [first[a]!, first[b]! + runs[b]!.length - 1] as const
  /** The lifted pieces in a row round piece i, bridges and tunnels alike, first and last. */
  const liftedRunOf = (i: number): readonly [number, number] => {
    let a = i,
      b = i
    while (a > 0 && isLifted(a - 1)) a--
    while (b + 1 < runs.length && isLifted(b + 1)) b++
    return [a, b]
  }
  return { p, runs, first, isLifted, isTunnel, pieceOfSample, deckOf, deckEnds, liftedRunOf }
}

/** A chain laid out on its profile (`laidOut`). */
export type Laid = ReturnType<typeof laidOut>

/** How a chain's lifted runs take their ends' levels before the fit (`levelLifted`). */
export interface LiftedSpec {
  /**
   * Ground falling away from a tunnel's mouth along the line more steeply than this (per metre) is
   * the hill's face over its cutting, past PORTAL m too: the rail's (`Spec.faces` in profiles.ts).
   */
  readonly face?: number
  /** Whether the chain runs on from a level already set at its first vertex (`Spec.start`). */
  readonly start: boolean
  /** Whether node `id` lies inside a bore or on a deck (`Spec.inside`). */
  readonly inside?: (id: string) => boolean
}

/**
 * Sets the levels of `laid`'s lifted runs before the fit, in its profile: each run's ends from the
 * ground out of them, a cut end's or an inside end's from the run's other end or `nodeZ`, and the
 * run straight between them.
 */
export const levelLifted = (
  { p, runs, isLifted, isTunnel, pieceOfSample, deckEnds, liftedRunOf }: Laid,
  spec: LiftedSpec,
  nodeZ: ReadonlyMap<string, number>,
): void => {
  // The lifted pieces in a row are straight from end to end, a bridge and a tunnel joined end to
  // end too (each deck still ships straight between its own ends, at the fit's levels): the ground
  // at their joint is the hill's face over the mouth or the valley's side under the abutment, and
  // 4 m out of either is the other's, the hill over the bore or the valley under the deck. Read so,
  // the Pontremolese's up track at Santo Stefano di Magra, off its deck 86258947 into its tunnel
  // 54567426, stood at 28.7 m there, 4.7 m over the down track's joint 15 m away; both now stand at
  // 23.8 m.
  for (let i = 0; i < runs.length; i++) {
    if (!isLifted(i)) continue
    const [i0, i1] = liftedRunOf(i)
    i = i1
    const [k0, k1] = deckEnds([i0, i1]).map((v) => p.vertexSample[v]!) as [number, number]
    // Each end takes the ground PORTAL m out of it when that is nearer the line's level: at a
    // tunnel's portal the terrain model climbs the hill's face (3.6 m over the cutting at the
    // Ugliancaldo tunnel's west portal), and a bridge's end may stand on the slope of what it
    // spans (the Lucido's banks at Monzone). With `face` a tunnel's mouth takes the ground at the
    // foot of the face, out along the line at grade while the ground falls away more steeply than
    // that: Liguria's DTM, interpolated from the NC5's heights, does not see a cutting, and before
    // Vezzano Ligure's Pontremolese mouths climbs 14–19 m over 32 m.
    for (const [k, step, tunnel] of [
      [k0, -1, isTunnel(i0)],
      [k1, 1, isTunnel(i1)],
    ] as const) {
      /** Whether sample `j` is on the profile and the segment to it from the one before at grade. */
      const atGrade = (j: number) =>
        j >= 0 && j < p.z.length && !isLifted(pieceOfSample(Math.min(j, j - step)))
      let o = k
      while (o + step >= 0 && o + step < p.z.length && Math.abs(p.s[o]! - p.s[k]!) < PORTAL)
        o += step
      const portal = o
      if (tunnel && spec.face !== undefined)
        while (
          atGrade(o + step) &&
          p.z[o]! - p.z[o + step]! > spec.face * Math.abs(p.s[o + step]! - p.s[o]!)
        )
          o += step
      if (o !== k && Math.abs(p.s[o]! - p.s[k]!) >= PORTAL)
        p.z[k] = tunnel ? Math.min(p.z[k]!, p.z[o]!) : Math.max(p.z[k]!, p.z[o]!)
      // Past PORTAL m the face stands over the cutting's floor too: the line runs on from the
      // mouth to the foot, not up the face.
      if (o !== portal)
        for (let j = k + step; j !== o; j += step)
          p.z[j] = Math.min(
            p.z[j]!,
            p.z[k]! + ((p.z[o]! - p.z[k]!) * (p.s[j]! - p.s[k]!)) / (p.s[o]! - p.s[k]!),
          )
    }
    // An end the play area's outline cut (the chain's own end, with no id: `clipPieces` gives a
    // cut point none) is no portal or abutment: the ground there is the hill over the tunnel or
    // the valley under the bridge, so it takes its other end's level. The Galleria del Lupacino,
    // cut 1325 m in at x 6700, fell 3.7% from the hill's 528 m there to its portal at 357 m.
    const cut0 = i0 === 0 && runs[i0]![0]!.id === undefined && !spec.start,
      cut1 = i1 === runs.length - 1 && runs[i1]!.at(-1)!.id === undefined
    if (cut0 && !cut1) p.z[k0] = p.z[k1]!
    if (cut1 && !cut0) p.z[k1] = p.z[k0]!
    // Nor is a chain's end at a node inside a bore or on a deck (`inside`): its deck takes the
    // level an earlier chain set at either end, else its other end's. North of Aulla a switch of
    // the Pontremolese's in a tunnel took the hill's 114.9 m over the bore and humped the line, 99 m
    // there, 5.5 m; a crossover's switch on its second track's deck over the SS665 took the
    // valley's 71.8 m and sagged that track 4.4 m under the line beside it.
    const v0 = runs[i0]![0]!,
      v1 = runs[i1]!.at(-1)!
    const within = (v: V) => v.id !== undefined && spec.inside?.(v.id) === true
    const in0 = i0 === 0 && within(v0),
      in1 = i1 === runs.length - 1 && within(v1)
    if (in0 || in1) {
      const set = (v: V) => (v.id === undefined ? undefined : nodeZ.get(v.id))
      const z0 = set(v0) ?? (in0 || cut0 ? undefined : p.z[k0]),
        z1 = set(v1) ?? (in1 || cut1 ? undefined : p.z[k1])
      if (z0 !== undefined || z1 !== undefined) {
        p.z[k0] = z0 ?? z1!
        p.z[k1] = z1 ?? z0!
      }
    }
    for (let k = k0 + 1; k < k1; k++)
      p.z[k] = p.z[k0]! + ((p.z[k1]! - p.z[k0]!) * (p.s[k]! - p.s[k0]!)) / (p.s[k1]! - p.s[k0]!)
  }
}
