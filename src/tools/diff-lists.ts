// Comparison of two lists, for map-diff.ts: multisets (equal items pair up wherever they stand),
// the order of the items two lists share, items matched by a key that may repeat, what changed
// between two versions of an item, and the box round the changes.

/** A box [minX, minY, maxX, maxY], m; empty while minX > maxX. */
export type Box = [number, number, number, number]

/** A box holding nothing yet. */
export const emptyBox = (): Box => [
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
]

/** Grows `box` round the points of a flat [x0, y0, x1, y1, ...] array from value `from` to `to`. */
export const addFlat = (
  box: Box,
  flat: ArrayLike<number>,
  from = 0,
  to: number = flat.length,
): void => {
  for (let k = from; k + 1 < to; k += 2) {
    const x = flat[k]!,
      y = flat[k + 1]!
    if (x < box[0]) box[0] = x
    if (y < box[1]) box[1] = y
    if (x > box[2]) box[2] = x
    if (y > box[3]) box[3] = y
  }
}

/** A number as the report prints it: at most 3 decimals, no trailing zeros. */
export const num = (n: number): string => String(Number(n.toFixed(3)))

/** ", in x a..b, y c..d" for a box that holds something, else "". */
export const boxText = (box: Box): string =>
  box[0] > box[2] ? "" : `, in x ${num(box[0])}..${num(box[2])}, y ${num(box[1])}..${num(box[3])}`

/** JSON with every object's keys sorted, so two items built with their fields in another order compare equal. */
export const canon = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([p], [q]) => (p < q ? -1 : 1)))
      : v,
  )

/** The items only `a` has (`removed`, indices into a, ascending) and only `b` has (`added`, indices into b). */
export interface Bag {
  readonly removed: ReadonlyArray<number>
  readonly added: ReadonlyArray<number>
}

/** How many items two lists hold `same` item by item at their head, then at their tail (not overlapping the head). */
const commonEnds = (
  na: number,
  nb: number,
  same: (i: number, j: number) => boolean,
): readonly [number, number] => {
  let head = 0
  while (head < na && head < nb && same(head, head)) head++
  let tail = 0
  while (head + tail < na && head + tail < nb && same(na - 1 - tail, nb - 1 - tail)) tail++
  return [head, tail]
}

/**
 * Two lists of `na` and `nb` items compared as multisets of their keys: equal items pair up
 * wherever they stand. The common head and tail (`same` item by item) are skipped without keys,
 * so a few changes in long, equally ordered lists cost one pass.
 */
export const bagDiff = (
  na: number,
  nb: number,
  keyA: (i: number) => string,
  keyB: (j: number) => string,
  same: (i: number, j: number) => boolean = (i, j) => keyA(i) === keyB(j),
): Bag => {
  const [head, tail] = commonEnds(na, nb, same)
  const left = new Map<string, Array<number>>()
  for (let i = head; i < na - tail; i++) {
    const key = keyA(i),
      list = left.get(key)
    if (list === undefined) left.set(key, [i])
    else list.push(i)
  }
  const added: Array<number> = []
  for (let j = head; j < nb - tail; j++) if (left.get(keyB(j))?.pop() === undefined) added.push(j)
  const removed = [...left.values()].flat().sort((i, j) => i - j)
  return { removed, added }
}

/** Tuple `i` of a flat list of `stride`-number tuples as a key. */
const tupleKey = (v: ArrayLike<number>, i: number, stride: number): string => {
  let s = ""
  for (let k = 0; k < stride; k++) s += `${v[i * stride + k]},`
  return s
}

/** Whether tuple `i` of `a` and tuple `j` of `b` hold the same numbers. */
const sameTuple = (
  a: ArrayLike<number>,
  i: number,
  b: ArrayLike<number>,
  j: number,
  stride: number,
): boolean => {
  for (let k = 0; k < stride; k++) if (a[i * stride + k] !== b[j * stride + k]) return false
  return true
}

/** `bagDiff` over flat tuples of `stride` numbers (wall segments, trees, graph nodes); the indices count tuples. */
export const flatDiff = (a: ArrayLike<number>, b: ArrayLike<number>, stride: number): Bag =>
  bagDiff(
    a.length / stride,
    b.length / stride,
    (i) => tupleKey(a, i, stride),
    (j) => tupleKey(b, j, stride),
    (i, j) => sameTuple(a, i, b, j, stride),
  )

/** For each of `v`'s values, whether it is on one longest strictly increasing run through them (patience sorting). */
const onLongestRun = (v: ReadonlyArray<number>): Uint8Array => {
  // ends[k]: the index of the least value ending a run of k + 1 values so far; before[n]: the index
  // of the value before n on its run, -1 for none
  const ends: Array<number> = [],
    before = new Int32Array(v.length),
    on = new Uint8Array(v.length)
  for (let n = 0; n < v.length; n++) {
    let lo = 0,
      hi = ends.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (v[ends[mid]!]! < v[n]!) lo = mid + 1
      else hi = mid
    }
    before[n] = lo > 0 ? ends[lo - 1]! : -1
    ends[lo] = n
  }
  for (let n = ends.at(-1) ?? -1; n >= 0; n = before[n]!) on[n] = 1
  return on
}

/**
 * The fewest items of two flat lists of `stride`-number tuples that must move to put the items both
 * hold in one order, as indices into `a`, ascending; none when they keep their order. `bag` is
 * their multiset diff (`flatDiff`). Every copy of an item with a copy added or removed is left out,
 * as which copy went is unknown (a wrong guess would shift all between the copies); the other copies
 * pair up in their order, and those off a longest run that keeps its order in both lists moved.
 */
export const outOfOrder = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  stride: number,
  bag: Bag,
): Array<number> => {
  const na = a.length / stride,
    nb = b.length / stride
  // the common head and tail keep their order, and every other shared item stands between them
  const [head, tail] = commonEnds(na, nb, (i, j) => sameTuple(a, i, b, j, stride))
  const changed = new Set([
    ...bag.removed.map((i) => tupleKey(a, i, stride)),
    ...bag.added.map((j) => tupleKey(b, j, stride)),
  ])
  // b's places of each unchanged item, last first, so pop gives the copies in their order
  const places = new Map<string, Array<number>>()
  for (let j = nb - tail - 1; j >= head; j--) {
    const key = tupleKey(b, j, stride)
    if (changed.has(key)) continue
    const list = places.get(key)
    if (list === undefined) places.set(key, [j])
    else list.push(j)
  }
  const items: Array<number> = [],
    at: Array<number> = []
  for (let i = head; i < na - tail; i++) {
    const j = places.get(tupleKey(a, i, stride))?.pop()
    if (j === undefined) continue
    items.push(i)
    at.push(j)
  }
  const on = onLongestRun(at)
  return items.filter((_, n) => on[n] === 0)
}

/** Items matched by key: the versions that differ (`changed`), and the items only `a` or only `b` has. */
interface Keyed<T> {
  readonly removed: ReadonlyArray<T>
  readonly added: ReadonlyArray<T>
  readonly changed: ReadonlyArray<readonly [T, T]>
}

/**
 * Two lists matched by `key`, which may repeat (roads cut from one OSM way share its id): items
 * with an identical twin drop out wherever they stand, then the rest pair up by key in order of
 * occurrence (`changed`); those left over are `removed` from a or `added` in b.
 */
export const keyedDiff = <T>(
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  key: (item: T) => string | number,
): Keyed<T> => {
  const ja = a.map(canon),
    jb = b.map(canon)
  const bag = bagDiff(
    a.length,
    b.length,
    (i) => ja[i]!,
    (j) => jb[j]!,
  )
  const later = new Map<string | number, Array<T>>()
  for (const j of bag.added) {
    const item = b[j]!,
      list = later.get(key(item))
    if (list === undefined) later.set(key(item), [item])
    else list.push(item)
  }
  const removed: Array<T> = [],
    changed: Array<readonly [T, T]> = []
  for (const i of bag.removed) {
    const item = a[i]!,
      twin = later.get(key(item))?.shift()
    if (twin === undefined) removed.push(item)
    else changed.push([item, twin])
  }
  return { removed, added: [...later.values()].flat(), changed }
}

const isNumbers = (v: unknown): v is ReadonlyArray<number> =>
  Array.isArray(v) && v.every((x) => typeof x === "number")

const shown = (v: unknown): string =>
  v === undefined ? "(none)" : typeof v === "number" ? num(v) : JSON.stringify(v)

/**
 * What differs between two versions of an item, one phrase per field: `cls "tertiary" ->
 * "secondary"`, `z max diff 0.4 (3 of 12 values)` for number arrays of one length, `pts 12 -> 14
 * values`, or `holes changed` for anything nested.
 */
export const fieldChanges = (x: object, y: object): Array<string> => {
  const u: Record<string, unknown> = { ...x },
    v: Record<string, unknown> = { ...y }
  const out: Array<string> = []
  for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) {
    const p = u[k],
      q = v[k]
    if (canon(p) === canon(q)) continue
    if (isNumbers(p) && isNumbers(q)) {
      if (p.length !== q.length) {
        out.push(`${k} ${p.length} -> ${q.length} values`)
        continue
      }
      let max = 0,
        n = 0
      for (let i = 0; i < p.length; i++) {
        const d = Math.abs(p[i]! - q[i]!)
        if (d > 0) n++
        if (d > max) max = d
      }
      out.push(`${k} max diff ${num(max)} (${n} of ${p.length} values)`)
    } else if (typeof p === "object" || typeof q === "object") out.push(`${k} changed`)
    else out.push(`${k} ${shown(p)} -> ${shown(q)}`)
  }
  return out
}
