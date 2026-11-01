import assert from "node:assert/strict"
import { test } from "node:test"

import { PALETTE } from "../../render/palette.ts"
import { overviewPng, overviewSize, paintOverview } from "../overview.ts"
import { filteredRgba, pngData } from "../png.ts"

test("the overview is about 4096 px on its long side and under Safari's 16.7 MP, the bounds exactly", () => {
  assert.deepEqual(overviewSize({ minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 }), {
    width: 3195,
    height: 4096,
    scale: 0.4096,
  })
  assert.deepEqual(overviewSize({ minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 }), {
    width: 4000,
    height: 4000,
    scale: 1,
  })
})

/** A map 8192 × 4096 m (so 0.5 px/m, the paint's look at 0.125 px/m) in an L, its notch north-east of (4096, 2000). */
const BOUNDS = { minX: 0, minY: 0, maxX: 8192, maxY: 4096 }
const road = (cls: string, pts: Array<number>, tunnel?: true) => ({ cls, w: 7, pts, tunnel })
const MAP = {
  outline: [[0, 0, 8192, 0, 8192, 2000, 4096, 2000, 4096, 4096, 0, 4096]],
  areas: [{ kind: "forest", rings: [[1001, 2501, 2001, 2501, 2001, 3501, 1001, 3501]] }],
  water: [{ w: 2, pts: [5001, 501, 6001, 501] }],
  rail: [],
  roads: [
    road("motorway", [101, 1000, 8091, 1000]),
    { ...road("residential", [2500, 101, 2500, 3995]), w: 5 },
    road("primary", [101, 3001, 3995, 3001], true),
    road("path", [3501, 101, 3501, 3995]),
  ],
  buildings: [{ outer: [1401, 2901, 1601, 2901, 1601, 3101, 1401, 3101] }],
}

const rgba = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]

test("the overview paints the full map's look: grass on the play area only, areas, water, roads by class narrowest first, no tunnels or paths, buildings on top", () => {
  const { width, height, rgba: pixels } = paintOverview(MAP, BOUNDS)
  assert.deepEqual([width, height], [4096, 2048])
  const at = (x: number, y: number) => {
    const k = 4 * (Math.floor((4096 - y) / 2) * width + Math.floor(x / 2))
    return [...pixels.subarray(k, k + 4)]
  }
  assert.deepEqual(at(6001, 1501), rgba(PALETTE.grass))
  assert.deepEqual(at(6001, 3001), [0, 0, 0, 0], "the notch is left clear")
  assert.deepEqual(at(1201, 2701), rgba(PALETTE.forest))
  assert.deepEqual(at(1501, 3001), rgba(PALETTE.roofTile))
  assert.deepEqual(at(2501, 1001), rgba(PALETTE.signYellow), "the motorway over the street")
  assert.deepEqual(at(3001, 3001), rgba(PALETTE.grass), "no tunnel")
  assert.deepEqual(at(3501, 1501), rgba(PALETTE.grass), "no path")
  // a stream: its least 1 px (4 overview px), faded to 30 %
  const [w, g] = [rgba(PALETTE.waterShallow), rgba(PALETTE.grass)]
  assert.deepEqual(
    at(5501, 501),
    w.map((c, k) => (k === 3 ? 255 : Math.round(c * 0.3 + g[k]! * 0.7))),
  )
  // the motorway at its least 3 px, the street 1.5, 5 overview px each (whole pixels: the edges blend)
  const count = (hex: number, k0: number, step: number, n: number) => {
    const want = rgba(hex).join()
    let found = 0
    for (let m = 0; m < n; m++)
      if ([...pixels.subarray(4 * (k0 + m * step), 4 * (k0 + m * step) + 4)].join() === want)
        found++
    return found
  }
  assert.equal(count(PALETTE.signYellow, 3000, width, height), 14)
  assert.equal(count(PALETTE.limestone, Math.floor((4096 - 2201) / 2) * width, 1, width), 6)
})

test("the overview is the same bytes every time, and its PNG holds exactly its pixels", () => {
  const a = overviewPng(MAP, BOUNDS),
    b = overviewPng(MAP, BOUNDS)
  assert.ok(a.equals(b))
  const { width, height, rgba: pixels } = paintOverview(MAP, BOUNDS)
  const { data } = pngData(a)
  assert.deepEqual([pngData(a).width, pngData(a).height], [width, height])
  assert.ok(data.equals(filteredRgba(width, height, pixels)))
  // undo the filters (PNG's own arithmetic): the pixels come back
  const stride = 4 * width,
    out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = data[y * (stride + 1)]!
    for (let k = 0; k < stride; k++) {
      const a = k < 4 ? 0 : out[y * stride + k - 4]!,
        b = y === 0 ? 0 : out[(y - 1) * stride + k]!,
        c = k < 4 || y === 0 ? 0 : out[(y - 1) * stride + k - 4]!
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c)
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!
      out[y * stride + k] = (data[y * (stride + 1) + 1 + k]! + predicted) & 255
    }
  }
  assert.ok(Buffer.from(out).equals(Buffer.from(pixels)))
})
