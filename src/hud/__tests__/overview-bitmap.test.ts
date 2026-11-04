import assert from "node:assert/strict"
import { test } from "node:test"

import { overviewBitmap } from "../overview-bitmap.ts"

test("the overview downloads once, is decoded at each opening and let go at each closing, even when it comes late", async () => {
  const heard: Array<number | undefined> = []
  let downloads = 0,
    offline = true
  const bitmaps: Array<{ readonly n: number; closed: boolean; close(): void }> = []
  const overview = overviewBitmap(
    () => {
      downloads++
      return offline ? Promise.reject(new Error("offline")) : Promise.resolve(new Blob(["png"]))
    },
    () => {
      const bitmap = {
        n: bitmaps.length,
        closed: false,
        close() {
          this.closed = true
        },
      }
      bitmaps.push(bitmap)
      return Promise.resolve(bitmap)
    },
    () => heard.push(overview.bitmap?.n),
  )
  const settle = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  overview.want()
  await settle()
  assert.deepEqual([downloads, overview.bitmap, heard], [1, undefined, []], "a failed download")
  overview.release()
  offline = false
  overview.want()
  overview.want() // a repaint while it is open
  await settle()
  assert.deepEqual(
    [downloads, overview.bitmap?.n, heard],
    [2, 0, [0]],
    "tried again when it opens again",
  )
  overview.release()
  assert.deepEqual(
    [overview.bitmap, bitmaps[0]!.closed],
    [undefined, true],
    "let go when it closes",
  )
  overview.want()
  overview.release() // closed before its file came
  await settle()
  assert.deepEqual(
    [overview.bitmap, bitmaps.length, heard],
    [undefined, 1, [0]],
    "an opening closed before the file came decodes nothing",
  )
  overview.want()
  await settle()
  assert.deepEqual([downloads, overview.bitmap?.n, heard], [2, 1, [0, 1]], "downloaded once")
})

test("the overview decodes once for the opening still open when its file comes, and a download that failed while the map was shut is tried again", async () => {
  let arrive: (blob: Blob) => void = () => {},
    fail: (error: Error) => void = () => {},
    downloads = 0,
    decodes = 0
  const overview = overviewBitmap(
    () => {
      downloads++
      return new Promise<Blob>((resolve, reject) => {
        arrive = resolve
        fail = reject
      })
    },
    () => {
      decodes++
      return Promise.resolve({ close() {} })
    },
    () => {},
  )
  const settle = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  // opened and shut three times while the file downloads, then open when it comes
  for (let k = 0; k < 3; k++) {
    overview.want()
    overview.release()
  }
  overview.want()
  arrive(new Blob(["png"]))
  await settle()
  assert.deepEqual([downloads, decodes], [1, 1])
  assert.ok(overview.bitmap !== undefined)
  overview.release()
  // a fresh overview whose download fails after the map has shut
  const late = overviewBitmap(
    () => {
      downloads++
      return new Promise<Blob>((resolve, reject) => {
        arrive = resolve
        fail = reject
      })
    },
    () => Promise.resolve({ close() {} }),
    () => {},
  )
  late.want()
  late.release()
  fail(new Error("offline"))
  await settle()
  late.want()
  arrive(new Blob(["png"]))
  await settle()
  assert.equal(downloads, 3, "downloaded again at the next opening")
  assert.ok(late.bitmap !== undefined)
})
