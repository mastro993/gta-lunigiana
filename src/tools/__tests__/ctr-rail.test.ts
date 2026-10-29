import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

import { chainTracks, readCtrRail, type CtrLine } from "../ctr-rail.ts"
import { local } from "../ctr.ts"
import type { P } from "../geometry.ts"
import { shapefile, type TestRecord } from "./shapefile.ts"

const line = (src: string, ...pts: ReadonlyArray<P>): CtrLine => ({ src, pts })
const lengthOf = (pts: ReadonlyArray<P>) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0)

test("chainTracks joins ends within 1 m that head on, nearest first, at their midpoint", () => {
  const a = line("a", [0, 0], [50, 0], [100, 0]),
    b = line("b", [100.3, 0.3], [150, 0.3], [200, 0]), // 0.42 m past a's end
    c = line("c", [300, 0], [250, 0], [200, 0]), // drawn the other way, meets b's end exactly
    kink = line("kink", [200, 0], [300, 52]), // also at b's end, but 27° off
    gap = line("gap", [302, 0], [400, 0]) // 2 m past c
  const chained = {
    src: ["a", "b", "c"],
    pts: [
      [0, 0],
      [50, 0],
      [100.15, 0.15],
      [150, 0.3],
      [200, 0],
      [250, 0],
      [300, 0],
    ],
  }
  assert.deepEqual(chainTracks([a, b, c, kink, gap], []), [
    chained,
    { src: ["kink"], pts: kink.pts },
    { src: ["gap"], pts: gap.pts },
  ])
  // Starting from a middle line walks both ways; the track runs the way that line does.
  assert.deepEqual(chainTracks([b, kink, a, c], [])[0], chained)
})

test("chainTracks cuts the lines out of tunnels, clips them to the play area and drops slivers", () => {
  const tunnel = [[40, -5, 60, -5, 60, 5, 40, 5]] // x 40..60
  const tracks = chainTracks(
    [
      line("bored", [0, 0], [100, 0]),
      line("east edge", [4890, 0], [4910, 0]), // the play area ends at x 4900
      line("sliver", [4899.5, 10], [4910, 10]), // 0.5 m inside
    ],
    [tunnel],
  )
  assert.deepEqual(tracks, [
    {
      src: ["bored"],
      pts: [
        [0, 0],
        [40, 0],
      ],
    },
    {
      src: ["bored"],
      pts: [
        [60, 0],
        [100, 0],
      ],
    },
    {
      src: ["east edge"],
      pts: [
        [4890, 0],
        [4900, 0],
      ],
    },
  ])
})

test("readCtrRail reads track lines, bridge and tunnel spans, platforms and crossings from the layers", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ctr-rail-"))
  t.after(() => rmSync(dir, { recursive: true }))
  const write = (layer: string, type: 13 | 15, records: ReadonlyArray<TestRecord>) => {
    const { shp, dbf } = shapefile(type, records)
    writeFileSync(join(dir, `23D99_${layer}.shp.gz`), gzipSync(shp))
    writeFileSync(join(dir, `23D99_${layer}.dbf.gz`), gzipSync(dbf))
  }
  // EPSG:6707 around (−1316, 2560) local: north of Pian di Molino, inside the play area.
  const E = 589_000,
    N = 4_893_000
  const box = (e0: number, n0: number, e1: number, n1: number) => [
    [
      [e0, n0, 0],
      [e0, n1, 0],
      [e1, n1, 0],
      [e1, n0, 0],
      [e0, n0, 0],
    ] as const,
  ]
  write("VLI", 13, [
    {
      attrs: { Cod_CTR: "0117" },
      parts: [
        [
          [E, N, 0],
          [E + 100, N, 0],
          [E + 200, N, 0],
        ],
      ],
    },
    {
      attrs: { Cod_CTR: "0001" },
      parts: [
        [
          [E, N + 50, 0],
          [E + 200, N + 50, 0],
        ],
      ],
    }, // a contour line
    {
      attrs: { Cod_CTR: "0117" },
      parts: [
        [
          [E + 200.3, N + 0.3, 0],
          [E + 300, N, 0],
        ],
      ],
    },
  ])
  write("AFE", 15, [
    {
      attrs: { Livello: "101", Sede: "054", Cod_CTR: "0140" },
      parts: box(E + 240, N - 10, E + 260, N + 10),
    },
    {
      attrs: { Livello: "102", Sede: "063", Cod_CTR: "0140" },
      parts: box(E + 40, N - 5, E + 60, N + 5),
    },
    {
      attrs: { Livello: "101", Sede: "060", Cod_CTR: "0140" },
      parts: box(E + 60, N - 5, E + 240, N + 5),
    },
  ])
  write("AGE", 15, [
    { attrs: { Cod_CTR: "0141" }, parts: box(E + 100, N + 2, E + 160, N + 6) },
    { attrs: { Cod_CTR: "0244" }, parts: box(E + 100, N + 20, E + 106, N + 26) }, // a garage
    { attrs: { Cod_CTR: "0122" }, parts: box(E + 180, N - 4, E + 186, N + 4) },
  ])
  const rail = readCtrRail(dir)
  assert.deepEqual(
    rail.tracks.map((tr) => tr.src),
    [["23D99 VLI#0.0", "23D99 VLI#2.0"], ["23D99 VLI#2.0"]],
  )
  const [west, east] = rail.tracks
  assert.deepEqual(west!.pts[0], local([E, N]))
  assert.deepEqual(east!.pts.at(-1), local([E + 300, N]))
  // 240 and 40 m in EPSG:6707; UTM's scale is 0.9996 at the meridian and about 1.0002 here.
  assert.ok(Math.abs(lengthOf(west!.pts) - 240) < 0.2, `${lengthOf(west!.pts)}`)
  assert.ok(Math.abs(lengthOf(east!.pts) - 40) < 0.05, `${lengthOf(east!.pts)}`)
  assert.deepEqual(
    [rail.tunnels, rail.bridges, rail.platforms, rail.crossings].map((a) => a.map((p) => p.src)),
    [["23D99 AFE#0"], ["23D99 AFE#1"], ["23D99 AGE#0"], ["23D99 AGE#2"]],
  )
  assert.equal(rail.platforms[0]!.rings.length, 1)
  assert.equal(rail.platforms[0]!.rings[0]!.length, 8, "an open ring of 4 corners")
})
