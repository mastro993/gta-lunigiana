import assert from "node:assert/strict"
import { test } from "node:test"

import { Group, type Mesh, Vector3 } from "three"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, setTileSource, tilesOver } from "../../sim/map/tiles.ts"
import { type CrossingState, LOWERING, RAISING } from "../../sim/rail/barriers.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { STEP } from "../../sim/schema.ts"
import { BARRIER, makeCrossings, ROAD_LIGHT } from "../crossings.ts"
import { actorMaterial } from "../geometry.ts"
import { atGradeY } from "../ground.ts"
import { signalLampMaterials } from "../sky/glow.ts"
import { everyTileIn } from "../testing.ts"

// A box stands on its road once the ground under it is in memory: here all of it is.
everyTileIn()
const S = 1 / STEP.dt
/** The map's crossings drawn, every box in `state` at step `now`. */
const drawn = (state: CrossingState, now: number) => {
  const scene = new Group(),
    nodes = makeCrossings(scene)
  nodes.draw(
    CROSSINGS.map(() => state),
    now,
  )
  scene.updateMatrixWorld(true)
  return nodes
}
/** A point of a mesh's own frame in three space, as map x, y and height over the road at its box's approach. */
const world = (mesh: Mesh, x: number, y: number) => mesh.localToWorld(new Vector3(x, y, 0))
const roads = CROSSINGS.flatMap((box, i) => (box.walk ? [] : [{ box, i }]))

test("a road box has a barrier and a red road light on the post right of each way in; a foot crossing has none", () => {
  const nodes = drawn({ phase: "open", since: 0, from: 0, demanded: 0 }, 0)
  assert.ok(
    roads.length >= 4,
    "Via Riolo, Viale 20 Settembre, Via Castel dell'Aquila and Via Nuova",
  )
  for (const [i, box] of CROSSINGS.entries()) {
    const shown = nodes.boxes[i]
    if (box.walk) {
      assert.equal(shown, undefined, "a foot crossing shows nothing")
      continue
    }
    assert.equal(shown!.barriers.length, box.approaches.length)
    for (const barrier of shown!.barriers)
      assert.ok(barrier.arm.material === actorMaterial && barrier.skirt.material === actorMaterial)
    // Each lens on its approach's post, at the light's height over the road, toward the traffic coming in.
    const at = shown!.lenses.geometry.getAttribute("position")
    for (const [k, { pivot, entry, heading }] of box.approaches.entries()) {
      const middle = new Vector3()
      for (let v = 36 * k; v < 36 * (k + 1); v++)
        middle.add(new Vector3().fromBufferAttribute(at, v))
      middle.divideScalar(36)
      const toward =
        (middle.x - pivot.x) * Math.cos(heading) + (-middle.z - pivot.y) * Math.sin(heading)
      assert.ok(Math.abs(toward + ROAD_LIGHT.proud) < 1e-3, `toward the traffic ${toward}`)
      const right =
        (middle.x - entry.x) * Math.sin(heading) - (-middle.z - entry.y) * Math.cos(heading)
      assert.ok(right > 2, `right of the way in, ${right} m from the road's middle`)
      assert.ok(Math.abs(middle.y - (atGradeY(entry.x, entry.y) + ROAD_LIGHT.up)) < 1e-3)
    }
  }
})

test("the arms stand up while open and in the warning, come down across the road to the left of the way in, and lie across it closed", () => {
  const tip = (state: CrossingState, now: number) =>
    roads.flatMap(({ box, i }) =>
      drawn(state, now).boxes[i]!.barriers.map((barrier, k) => {
        const { pivot, entry, heading, arm } = box.approaches[k]!,
          at = world(barrier.arm, arm, 0),
          road = atGradeY(entry.x, entry.y)
        // Across: along the way in's left; up: over the pivot.
        const across = (at.x - pivot.x) * -Math.sin(heading) + (-at.z - pivot.y) * Math.cos(heading)
        return { across: across / arm, up: (at.y - road - BARRIER.pivot) / arm }
      }),
    )
  for (const phase of ["open", "warning"] as const)
    for (const { across, up } of tip({ phase, since: 0, from: 0, demanded: 0 }, 5 * S))
      assert.ok(across < 0.03 && up > 0.99, `${phase}: standing up (${across}, ${up})`)
  for (const { across, up } of tip({ phase: "closed", since: 0, from: 1, demanded: 0 }, 5 * S))
    assert.ok(
      Math.abs(across - 1) < 1e-6 && Math.abs(up) < 1e-6,
      `closed: across the road (${across}, ${up})`,
    )
  // Halfway down, 6 s into the lowering: at 45°.
  for (const { across, up } of tip(
    { phase: "lowering", since: 0, from: 0, demanded: 0 },
    (LOWERING / 2) * S,
  ))
    assert.ok(Math.abs(across - Math.SQRT1_2) < 1e-6 && Math.abs(up - Math.SQRT1_2) < 1e-6)
})

/** Each arm's angle up from across the road, rad. */
const angles = (state: CrossingState, now: number) =>
  roads.flatMap(({ i }) => drawn(state, now).boxes[i]!.barriers.map((b) => b.arm.rotation.z))

// Regression: with only the phase and its start the arms snapped up when a train asked for a rising box.
test("a train asking for the box while its arms rise sends them back down from where they stood, at the drawn moment between steps", () => {
  const rising = { phase: "raising", since: 0, from: 1, demanded: 0 } as const,
    now = (RAISING / 4) * S + 0.5,
    up = now / (RAISING * S)
  const before = angles(rising, now)
  assert.ok(
    before.every((a) => Math.abs(a - (up * Math.PI) / 2) < 1e-9),
    "a quarter of the way up and half a step on",
  )
  const again = { phase: "lowering", since: now, from: 1 - up, demanded: now } as const
  assert.deepEqual(angles(again, now), before, "lowering again from there, no snap")
  assert.ok(
    angles(again, now + S).every((a) => a < (up * Math.PI) / 2 - 0.1),
    "and coming down",
  )
})

test("the arms' lamps and the road lights are lit from the warning until the arms stand up again", () => {
  for (const [phase, lit] of [
    ["open", false],
    ["warning", true],
    ["lowering", true],
    ["closed", true],
    ["raising", true],
  ] as const) {
    const nodes = drawn({ phase, since: 0, from: phase === "raising" ? 1 : 0, demanded: 0 }, S)
    for (const { i } of roads) {
      const shown = nodes.boxes[i]!,
        want = lit ? signalLampMaterials.on : signalLampMaterials.off
      assert.equal(shown.lenses.material, want, `${phase}: road lights`)
      for (const barrier of shown.barriers)
        assert.equal(barrier.lamps.material, want, `${phase}: arm lamps`)
    }
  }
})

test("the skirt hangs plumb under the arm at every angle, and folds flat against it standing up", () => {
  const foot = -BARRIER.tall / 2 - BARRIER.skirt
  for (const arm of [0, 0.3, 0.7, 1]) {
    const state = { phase: "lowering", since: 0, from: arm, demanded: 0 } as const
    for (const { i } of roads)
      for (const { skirt } of drawn(state, 0).boxes[i]!.barriers) {
        const top = world(skirt, 2, -BARRIER.tall / 2),
          bottom = world(skirt, 2, foot)
        assert.ok(Math.hypot(top.x - bottom.x, top.z - bottom.z) < 1e-6, `arm ${arm}: plumb`)
        assert.ok(Math.abs(top.y - bottom.y - BARRIER.skirt) < 1e-6)
      }
  }
  const standing = drawn({ phase: "open", since: 0, from: 0, demanded: 0 }, 0)
  for (const { i } of roads)
    for (const { arm, skirt } of standing.boxes[i]!.barriers) {
      // Its foot lies along the standing arm: no more than 2 cm out of the arm's line.
      const base = world(arm, 0, 0),
        up = world(arm, 1, 0).sub(base),
        point = world(skirt, 2, foot).sub(base)
      const off = point
        .clone()
        .sub(up.clone().multiplyScalar(point.dot(up)))
        .length()
      assert.ok(off < 0.02, `folded ${off} m out`)
    }
})

test("a box stays hidden until the ground under its ways in is in memory, then stands on its road", () => {
  const { box, i } = roads[0]!,
    { x, y } = box.approaches[0]!.entry
  const out = tilesOver(x, y, x, y)[0]!
  const scene = new Group(),
    nodes = makeCrossings(scene),
    shown = nodes.boxes[i]!,
    open = CROSSINGS.map((): CrossingState => ({ phase: "open", since: 0, from: 0, demanded: 0 }))
  assert.ok(!shown.placed && !shown.lenses.visible && shown.barriers.every((b) => !b.post.visible))
  setTileSource(undefined)
  dropTile(out)
  try {
    nodes.draw(open, 0)
    assert.ok(!shown.placed && !shown.lenses.visible, `hidden while tile ${out} is out`)
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
    everyTileIn()
  }
  nodes.draw(open, 0)
  assert.ok(shown.placed && shown.lenses.visible && shown.barriers.every((b) => b.post.visible))
  for (const [k, { entry }] of box.approaches.entries())
    assert.equal(
      shown.barriers[k]!.post.position.y,
      atGradeY(entry.x, entry.y) + BARRIER.pivot,
      "the pivot over the road",
    )
})
