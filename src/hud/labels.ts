/**
 * Where the full map's place names go (`mapLabels` in `worldmap.ts`): each label's name on one of
 * the sides round its dot, clear of the names and dots placed before it, or the label left out with
 * its dot.
 *
 * @module hud/labels
 */
import type { Box } from "./map-view.ts"

const apart = (a: Box, b: Box): boolean =>
  a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0

/**
 * A place's label to place: its rank (the order labels are placed in; -1 for the player's place,
 * `mapLabels`), whether it is a major (the player's place, a town or a village: named together,
 * `placeLabels`) and whether it is a first among them (the player's place or a town: named before
 * the villages when not all fit), its dot's box and the boxes its name may take, best first.
 */
export interface Label {
  readonly rank: number
  readonly major: boolean
  readonly first: boolean
  readonly dot: Box
  readonly sides: ReadonlyArray<Box>
}

/**
 * How much room a name in `box` takes from the labels of `spare`: each of their sides it overlaps,
 * and all of a label's sides when it covers that label's dot, which leaves the label out.
 */
const roomTaken = (labels: ReadonlyArray<Label>, spare: ReadonlyArray<number>, box: Box): number =>
  spare.reduce((sum, i) => {
    const { dot, sides } = labels[i]!
    return apart(dot, box)
      ? sides.reduce((n, side) => n + (apart(side, box) ? 0 : 1), sum)
      : sum + sides.length
  }, 0)

/**
 * Names the labels of `group` in what `taken` leaves and adds each name placed and its dot to
 * `taken`. The label with the fewest free sides goes next (the earlier on a tie), so a name with
 * room to spare does not take another's last side, and it takes the free side that takes the least
 * room from the labels of `spare` (`roomTaken`), the earlier on a tie: with none to spare, its first
 * free side. A side is free when it overlaps nothing taken, its own dot or the dot of a label of
 * `group` still to place: a name over a dot reads as that place's. A dot under something taken
 * leaves its label out, and the dot of a label left out frees the sides it covered.
 */
const placeGroup = (
  labels: ReadonlyArray<Label>,
  group: ReadonlyArray<number>,
  taken: Array<Box>,
  placed: Array<number | undefined>,
  spare: ReadonlyArray<number> = [],
): void => {
  const n = group.length,
    of = (a: number) => labels[group[a]!]!
  // Per label and side: whether something taken or its own dot blocks it, and how many dots of the
  // group still to place lie under it; per label, the sides over its dot. Counted once here and kept
  // up to date as labels go, so a group of hundreds is placed in milliseconds.
  const blocked = group.map((_, a) =>
      of(a).sides.map((side) => !apart(side, of(a).dot) || taken.some((b) => !apart(side, b))),
    ),
    under = group.map((_, a) => of(a).sides.map(() => 0)),
    over = group.map((): Array<readonly [number, number]> => [])
  for (let a = 0; a < n; a++)
    for (const [s, side] of of(a).sides.entries())
      for (let b = 0; b < n; b++)
        if (b !== a && !apart(side, of(b).dot)) {
          under[a]![s]!++
          over[b]!.push([a, s])
        }
  const isFree = (a: number, s: number) => !blocked[a]![s] && under[a]![s] === 0
  const out = group.map((_, a) => taken.some((b) => !apart(of(a).dot, b))),
    free = group.map((_, a) => of(a).sides.filter((_, s) => isFree(a, s)).length),
    open = group.map(() => true)
  const sidesLeft = (a: number) => (out[a] ? 0 : free[a]!)
  for (let step = 0; step < n; step++) {
    let next = -1
    for (let a = 0; a < n; a++)
      if (open[a] && (next < 0 || sidesLeft(a) < sidesLeft(next))) next = a
    open[next] = false
    for (const [a, s] of over[next]!) if (--under[a]![s]! === 0 && !blocked[a]![s]) free[a]!++
    if (sidesLeft(next) === 0) continue
    let side = -1,
      least = Number.POSITIVE_INFINITY
    for (const [s, box] of of(next).sides.entries()) {
      if (!isFree(next, s)) continue
      const room = roomTaken(labels, spare, box)
      if (room < least) [side, least] = [s, room]
      if (room === 0) break
    }
    placed[group[next]!] = side
    const dot = of(next).dot,
      name = of(next).sides[side]!
    taken.push(dot, name)
    for (let a = 0; a < n; a++) {
      if (!open[a]) continue
      if (!apart(of(a).dot, dot) || !apart(of(a).dot, name)) out[a] = true
      for (const [s, box] of of(a).sides.entries())
        if (!blocked[a]![s] && (!apart(box, dot) || !apart(box, name))) {
          blocked[a]![s] = true
          if (under[a]![s] === 0) free[a]!--
        }
    }
  }
}

/**
 * The side each label's name takes (an index in its `sides`), or undefined for one left out with
 * its dot. The majors (the player's place, the towns and the villages) go first, together
 * (`placeGroup`): each name clear of the `fixed` boxes (the north arrow, the scale bar), of the
 * majors' names and dots, and on the free side that takes the least room from the hamlets and
 * peaks. When that leaves out a town or the player's place and placing the majors rank by rank
 * (the player's place, the towns, then the villages, each name on its first free side) names more
 * of those, rank by rank stands, so a crowded map names the player's place and the towns before
 * the villages; a village left out, or a town or the player's place no order names, keeps the
 * majors named together. The hamlets, then the peaks, go after, rank by rank.
 */
export const placeLabels = (
  labels: ReadonlyArray<Label>,
  fixed: ReadonlyArray<Box> = [],
): Array<number | undefined> => {
  const majors = labels.flatMap((l, i) => (l.major ? [i] : [])),
    minors = labels.flatMap((l, i) => (l.major ? [] : [i]))
  const byRank = (ids: ReadonlyArray<number>) =>
    [...new Set(ids.map((i) => labels[i]!.rank))]
      .sort((a, b) => a - b)
      .map((rank) => ids.filter((i) => labels[i]!.rank === rank))
  /** The majors placed from scratch, together or rank by rank, and the boxes they take. */
  const placeMajors = (together: boolean) => {
    const placed: Array<number | undefined> = labels.map(() => undefined),
      taken = [...fixed]
    if (together) placeGroup(labels, majors, taken, placed, minors)
    else for (const group of byRank(majors)) placeGroup(labels, group, taken, placed)
    return { placed, taken }
  }
  /** How many of the towns and the player's place `placed` names. */
  const firsts = (placed: ReadonlyArray<number | undefined>) =>
    majors.filter((i) => labels[i]!.first && placed[i] !== undefined).length
  let { placed, taken } = placeMajors(true)
  if (firsts(placed) < majors.filter((i) => labels[i]!.first).length) {
    const ranked = placeMajors(false)
    if (firsts(ranked.placed) > firsts(placed)) ({ placed, taken } = ranked)
  }
  for (const group of byRank(minors)) placeGroup(labels, group, taken, placed)
  return placed
}
