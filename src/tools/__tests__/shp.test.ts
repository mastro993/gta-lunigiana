import assert from "node:assert/strict"
import { test } from "node:test"

import { parseShp, subsetShp } from "../shp.ts"
import { shapefile, type TestRecord } from "./shapefile.ts"

const LINES: ReadonlyArray<TestRecord> = [
  {
    attrs: { Cod_CTR: "0117" },
    parts: [
      [
        [10, 20, 0],
        [15, 26, 0],
      ],
    ],
  },
  {
    attrs: { Cod_CTR: "0001" },
    parts: [
      [
        [-50, -60, 300],
        [90, 80, 320],
      ],
    ],
  }, // a contour line, the widest
  {
    attrs: { Cod_CTR: "0117" },
    parts: [
      [
        [12, 18, 1],
        [13, 19, 2],
      ],
      [
        [30, 40, 5],
        [31, 22, 4],
        [35, 41, 3],
      ],
    ],
  },
]

test("parseShp reads every record's parts and attributes", () => {
  const { shp, dbf } = shapefile(13, LINES)
  const recs = parseShp(shp, dbf)
  assert.deepEqual(
    recs.map((r) => r.attrs.Cod_CTR),
    ["0117", "0001", "0117"],
  )
  assert.deepEqual(recs[2]!.parts, [
    [
      [12, 18],
      [13, 19],
    ],
    [
      [30, 40],
      [31, 22],
      [35, 41],
    ],
  ])
})

test("subsetShp keeps the chosen records, renumbered, and fixes both headers", () => {
  for (const eof of [false, true]) {
    const full = shapefile(13, LINES, eof)
    const sub = subsetShp(full.shp, full.dbf, (a) => a.Cod_CTR === "0117")
    assert.ok(sub !== undefined)
    const recs = parseShp(sub.shp, sub.dbf)
    assert.deepEqual(
      recs,
      parseShp(full.shp, full.dbf).filter((r) => r.attrs.Cod_CTR === "0117"),
    )
    assert.equal(sub.shp.readInt32BE(24) * 2, sub.shp.length, "file length in 16-bit words")
    assert.deepEqual(
      [36, 44, 52, 60].map((o) => sub.shp.readDoubleLE(o)),
      [10, 18, 35, 41],
      "bounding box of the kept records only",
    )
    assert.deepEqual(
      [68, 76].map((o) => sub.shp.readDoubleLE(o)),
      [0, 5],
      "z range of the kept records only",
    )
    const second = 100 + 8 + sub.shp.readInt32BE(104) * 2
    assert.deepEqual([sub.shp.readInt32BE(100), sub.shp.readInt32BE(second)], [1, 2])
    assert.equal(sub.dbf.readUInt32LE(4), 2)
    assert.equal(sub.dbf.length, full.dbf.length - full.dbf.readUInt16LE(10))
    assert.equal(
      sub.dbf.at(-1),
      eof ? 0x1a : "7".codePointAt(0),
      "the end-of-file marker only when the source has one",
    )
  }
})

test("subsetShp writes nothing when no record matches", () => {
  const { shp, dbf } = shapefile(13, LINES)
  assert.equal(
    subsetShp(shp, dbf, (a) => a.Cod_CTR === "0141"),
    undefined,
  )
})

test("subsetShp keeps records by their box too, and blanks the fields it is told to", () => {
  const named = LINES.map((r, i) => ({ ...r, attrs: { ...r.attrs, Dir_lav: `Surveyor ${i}` } }))
  const { shp, dbf } = shapefile(13, named)
  // Only the records whose box reaches east of x = 20: the contour line and the two-part track.
  const sub = subsetShp(shp, dbf, (_, box) => box !== undefined && box[2] > 20, ["Dir_lav"])
  assert.ok(sub !== undefined)
  const recs = parseShp(sub.shp, sub.dbf)
  assert.deepEqual(
    recs.map((r) => r.attrs),
    [
      { Cod_CTR: "0001", Dir_lav: "" },
      { Cod_CTR: "0117", Dir_lav: "" },
    ],
  )
  assert.throws(() => subsetShp(shp, dbf, () => true, ["Coll_fot"]), /no field Coll_fot/)
})

test("parseShp drops the NULs padding a number and reads UTF-8 tables when told to", () => {
  const { shp, dbf } = shapefile(13, [
    { ...LINES[0]!, attrs: { un_vol_av: "3.65xx", ar_str_uff: "LOCALITÀ " } },
  ])
  const nul = Buffer.from(dbf)
  const at = nul.indexOf("3.65xx", 0, "latin1") + 4
  nul.fill(0, at, at + 2)
  // The DBT writes its text in UTF-8: "À" is the two bytes c3 80.
  const utf8 = Buffer.from(nul)
  utf8.write("LOCALITÃ\u0080", utf8.indexOf("LOCALIT", 0, "latin1"), "latin1")
  assert.equal(parseShp(shp, nul)[0]!.attrs.un_vol_av, "3.65")
  assert.equal(parseShp(shp, nul)[0]!.attrs.ar_str_uff, "LOCALITÀ")
  assert.equal(parseShp(shp, utf8, "dbt", "utf8")[0]!.attrs.ar_str_uff, "LOCALITÀ")
})
