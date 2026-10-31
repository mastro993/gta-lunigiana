/**
 * Square buckets on a lattice from the origin holding items by their boxes, each bucket's items in
 * the order they went in: the broad phase a point lookup builds from a place's vectors (`derived`
 * in `./tiles.ts`). Its features go in by their index in the whole map's list, so a bucket lists
 * them in the whole map's order, and one inside the place lists every feature of the map that
 * reaches into it (the place holds every feature within `HALO` of its square): the same list one
 * set of buckets over the whole map gave. Only buckets holding something take memory.
 *
 * @module map/buckets
 */

/** Items in square buckets of `size` m from the origin: each non-empty bucket's, by `bucketKey`. */
export interface Buckets<T> {
  readonly size: number
  readonly lists: Map<number, Array<T>>
}

/** An empty bucket's items. */
const NONE: ReadonlyArray<never> = []

/** Bucket (bx, by)'s key: distinct for every bucket within 32768 of the origin each way (524 km at 16 m). */
const keyOf = (bx: number, by: number) => (bx + 32768) * 65536 + by + 32768

/** No items yet, in buckets of `size` m. */
export const emptyBuckets = <T>(size: number): Buckets<T> => ({ size, lists: new Map() })

/** Puts `item` last in every bucket its box (minX, minY, maxX, maxY) reaches into. */
export const addToBuckets = <T>(
  into: Buckets<T>,
  item: T,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void => {
  const { size, lists } = into
  for (let bx = Math.floor(minX / size); bx <= Math.floor(maxX / size); bx++)
    for (let by = Math.floor(minY / size); by <= Math.floor(maxY / size); by++) {
      const list = lists.get(keyOf(bx, by))
      if (list === undefined) lists.set(keyOf(bx, by), [item])
      else list.push(item)
    }
}

/** The items of bucket (bx, by) (the one holding (x, y) is (⌊x / size⌋, ⌊y / size⌋)), in the order they went in. */
export const bucketItems = <T>(from: Buckets<T>, bx: number, by: number): ReadonlyArray<T> =>
  from.lists.get(keyOf(bx, by)) ?? NONE
