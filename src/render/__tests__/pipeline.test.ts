import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, Scene, Vector3, type WebGLRenderer } from "three"

import { QUARTER, screenAxes } from "../../sim/view.ts"
import { PixelView, viewAxes, zoomFor } from "../pipeline.ts"

test("at every quarter turn the camera's screen axes are the sim's on the ground, and ground axes project as exact 2:1 pixel lines", () => {
  for (const turns of [0, 1, 2, 3, -1, 6]) {
    const { right, up } = viewAxes(turns * QUARTER),
      sim = screenAxes(turns)
    // three (x, z) = sim (x, −y)
    assert.ok(
      Math.abs(right.x - sim.right.x) < 1e-9 &&
        Math.abs(-right.z - sim.right.y) < 1e-9 &&
        Math.abs(right.y) < 1e-9,
      `right at ${turns}`,
    )
    const ground = new Vector3(up.x, 0, up.z).normalize()
    assert.ok(
      Math.abs(ground.x - sim.up.x) < 1e-9 && Math.abs(-ground.z - sim.up.y) < 1e-9,
      `up at ${turns}`,
    )
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
      assert.ok(Math.abs(Math.abs(axis.dot(up) / axis.dot(right)) - 0.5) < 1e-9, `2:1 at ${turns}`)
    }
  }
})

test("the driving zoom widens above 16 m/s and narrows again only below 13 m/s", () => {
  assert.equal(zoomFor(undefined, 5), 8)
  assert.equal(zoomFor(15, 8), 6, "just got in at town speed")
  assert.equal(zoomFor(17, 6), 5)
  assert.equal(zoomFor(-14, 5), 5, "slowing through the band keeps the wide view")
  assert.equal(zoomFor(12, 5), 6)
  assert.equal(zoomFor(15, 6), 6)
})

// Regression: compiled while the canvas was bound, every program was an sRGB-output twin no frame used
// (26 programs against 16), and the ones the frames draw with compiled mid-game.
test("compile builds the programs into the target the scene renders into, then binds the canvas again", () => {
  let bound: unknown = null
  const compiled: Array<unknown> = [],
    rendered: Array<unknown> = []
  const renderer = {
    setRenderTarget: (target: unknown) => {
      bound = target
    },
    compile: () => compiled.push(bound),
    render: () => rendered.push(bound),
    setPixelRatio: () => {},
    setSize: () => {},
    getDrawingBufferSize: (size: { set(x: number, y: number): unknown }) => size.set(640, 360),
  }
  const view = new PixelView(renderer as unknown as WebGLRenderer),
    scene = new Scene()
  view.resize(640, 360, 1)
  view.compile(scene, new Group())
  assert.equal(bound, null, "the canvas bound again")
  view.render(scene)
  const [target, canvas] = rendered
  assert.ok(
    target !== null && canvas === null,
    "the scene into the target, then the blit to the canvas",
  )
  assert.deepEqual(compiled, [target, target], "the scene and the stand-ins, both into that target")
})
