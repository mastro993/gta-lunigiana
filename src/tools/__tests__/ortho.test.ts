import assert from "node:assert/strict"
import { test } from "node:test"

import { frameOf, licenceOf, tilesOf, type WmsLayer } from "../ortho-wms.ts"
import { captionOf, fitPx, niceStep, orthoSvg, type Overlay, pathOf, readArgs } from "../ortho.ts"

test("readArgs takes negative coordinates as the crop and tells the layer from the .svg path", () => {
  assert.deepEqual(readArgs(["-170,-450,130,-150"]), {
    rect: [-170, -450, 130, -150],
    layer: "rt_ofc.2k10",
    px: 0.5,
    refresh: false,
  })
  assert.deepEqual(
    readArgs(["0,0,10,20", "out/a.svg", "--px", "0.2", "rt_ofc.5k24.32bit", "--refresh"]),
    {
      rect: [0, 0, 10, 20],
      layer: "rt_ofc.5k24.32bit",
      out: "out/a.svg",
      px: 0.2,
      refresh: true,
    },
  )
  for (const bad of [[], ["1,2,3"], ["10,0,0,10"], ["0,0,10,10", "--px", "0"], ["a,b,c,d"]])
    assert.throws(() => readArgs(bad), /usage/, bad.join(" "))
})

test("pathOf draws flat local points in pixels, closing rings", () => {
  const f = frameOf([0, 0, 300, 300], 0.5)
  assert.equal(pathOf(f, [0, 300, 300, 300, 300, 0], true), "M0 0L600 0L600 600Z")
  assert.equal(pathOf(f, [10.03, 290, 20, 280], false), "M20.1 20L40 40")
  assert.equal(pathOf(f, [], true), "")
})

test("niceStep and fitPx pick round grid steps and keep big crops under the pixel cap", () => {
  assert.deepEqual([60, 100, 0.3, 7.5, 1999].map(niceStep), [50, 100, 0.2, 5, 1000])
  assert.equal(fitPx([0, 0, 300, 300], 0.5), 0.5)
  const px = fitPx([0, 0, 4000, 4000], 0.5, 40e6)
  assert.equal(px, 0.64)
  assert.ok((4000 / px) ** 2 <= 40e6)
})

const INFO: WmsLayer = {
  title: "OFC 2010 2k col",
  attribution: "Fonte dei dati: Regione Toscana",
  box: [9.5, 42.1, 12.4, 44.5],
}

test("orthoSvg embeds the photo and draws the overlay in the frame's pixels, leaving out what lies outside", () => {
  const f = frameOf([0, 0, 100, 100], 0.5) // 200 × 200 px
  const overlay: Overlay = {
    buildings: [
      [10, 90, 20, 90, 20, 80],
      [500, 500, 510, 500, 510, 510], // far outside: left out
    ],
    cores: [
      [50, 50, 20],
      [900, 900, 10],
    ],
    water: [{ kind: "stream", name: "Lucido & co", w: 4, bed: 3, pts: [0, 10, 100, 10] }],
  }
  const svg = orthoSvg(
    f,
    [{ tile: tilesOf(f, 4096)[0]!, jpeg: new Uint8Array([1, 2, 3]) }],
    overlay,
    captionOf("rt_ofc.2k10", INFO, licenceOf("rt_ofc.2k10")),
  )
  assert.match(
    svg,
    /<image x="0" y="0" width="200" height="200" [^>]*xlink:href="data:image\/jpeg;base64,AQID"\/>/,
  )
  assert.match(svg, /<path d="M20 20L40 20L40 40Z" stroke="#ffd400"/)
  assert.doesNotMatch(svg, /M1000 /)
  assert.match(svg, /<ellipse cx="100" cy="100" rx="40" ry="40"/)
  assert.equal(svg.match(/<ellipse/g)?.length, 1)
  assert.match(svg, /d="M0 180L200 180" stroke="#e0b060" stroke-opacity="0.35" stroke-width="12"/)
  assert.match(svg, /d="M0 180L200 180" stroke="#1e90ff" stroke-opacity="0.55" stroke-width="8"/)
  assert.match(svg, /Lucido &amp; co: w 4 m, bed ±3 m/)
  assert.match(svg, />Fonte dei dati: Regione Toscana –</)
  assert.match(
    captionOf("rt_ofc.2k10", INFO, licenceOf("rt_ofc.2k10")).credit,
    /^Fonte dei dati: Regione Toscana – OFC 2010 2k col, CC BY \(/,
  )
  assert.match(svg, />0, 100</)
  assert.match(svg, />100, 0</)
  assert.doesNotMatch(svg, /LOOK ONLY/)
})

test("a look-only layer gets a banner on the photo and the reason in the caption", () => {
  const f = frameOf([0, 0, 100, 100], 0.5)
  const caption = captionOf("rt_ofc.2k11.aulla", INFO, licenceOf("rt_ofc.2k11.aulla"))
  assert.match(caption.lookOnly ?? "", /Blom/)
  const svg = orthoSvg(f, [], { buildings: [], cores: [], water: [] }, caption)
  assert.match(svg, /LOOK ONLY: never trace from this layer/)
  assert.match(
    captionOf("rt_ofc.x", INFO, undefined).lookOnly ?? "",
    /not in ortho-wms.ts's licence table/,
  )
})
