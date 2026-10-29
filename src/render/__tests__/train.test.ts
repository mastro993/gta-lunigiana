import assert from "node:assert/strict"
import { test } from "node:test"

import { Box3, Mesh, Vector3 } from "three"

import { terrainZ } from "../../sim/map/ground.ts"
import { curvatureAt, LINES, pointAt } from "../../sim/rail/lines.ts"
import { TRAINS, trainLength } from "../../sim/rail/models.ts"
import { MONZONE, RAIL_BRIDGE } from "../../sim/rail/testing.ts"
import type { TrainMotionValue } from "../../sim/schema.ts"
import { solidMaterial } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { cabinLightMaterial, signalLampMaterials } from "../sky/glow.ts"
import { shownProxy } from "../testing.ts"
import { trainCars, TrainNode } from "../train.ts"

const line = LINES[MONZONE.line]!,
  { cars, bogie } = TRAINS.atr220,
  length = trainLength("atr220")
/** A train's motion on Monzone's line: its nose at `s` (at `prev` the step before), its cab facing `facing`. */
const motion = (s: number, facing: 1 | -1, prev = s): TrainMotionValue => ({
  line: line.index,
  s,
  prev,
  v: 0,
  facing,
  power: 0,
  brake: 0,
})
/** A train drawn with its nose at `s` (blended from `prev` at `alpha`), its cab facing `facing`. */
const drawn = (s: number, facing: 1 | -1, prev = s, alpha = 1) => {
  const node = new TrainNode("atr220", solidMaterial)
  node.place(trainCars(line, motion(s, facing, prev), "atr220", alpha))
  node.updateMatrixWorld(true)
  return node
}
/** Each car's two pivots: m back from the active nose, and where they lie along the car's mesh (+X toward the train's front). */
const pivots = cars.map((car, k) => {
  const joint = cars.slice(0, k).reduce((sum, c) => sum + c, 0)
  return {
    back: [k === 0 ? bogie : joint, k === cars.length - 1 ? length - bogie : joint + car] as const,
    local: [
      k === 0 ? car / 2 - bogie : car / 2,
      k === cars.length - 1 ? bogie - car / 2 : -car / 2,
    ],
  }
})
/** How far each car's pivots are drawn from the rail head under them on the line, m (three space). */
const offRails = (node: TrainNode, s: number, facing: 1 | -1): number =>
  Math.max(
    ...node.cars.flatMap((car, k) =>
      pivots[k]!.back.map((back, end) => {
        const at = pointAt(line, s - facing * back)
        return car
          .localToWorld(new Vector3(pivots[k]!.local[end], 0, 0))
          .distanceTo(new Vector3(at.x, yOf(at.z), -at.y))
      }),
    ),
  )
/** The sharpest curve of Monzone's line out of its tunnels: the deck at its east end, 162 m in radius. */
const CURVE = (() => {
  let best = 0,
    at = 0
  for (let s = 0; s < line.length; s += 5) {
    const bend = Math.abs(curvatureAt(line, s))
    if (bend > best && !pointAt(line, s).tunnel) [best, at] = [bend, s]
  }
  return at
})()
/** Monzone's platforms' middle, at grade. */
const STATION = (MONZONE.s0 + MONZONE.s1) / 2

test("every car stands on the rail head under its pivots: at grade, on a deck over the valley and round the sharpest curve, both ways", () => {
  assert.ok(1 / Math.abs(curvatureAt(line, CURVE)) < 200, "a sharp curve")
  for (const [where, s] of [
    ["Monzone's platforms", STATION],
    ["the highest deck", RAIL_BRIDGE],
    ["the sharpest curve", CURVE],
  ] as const)
    for (const facing of [1, -1] as const) {
      const off = offRails(drawn(s, facing), s, facing)
      assert.ok(off < 0.02, `${where}, facing ${facing}: a pivot ${off} m off the rails`)
    }
  // On the deck, not in the valley under it.
  for (const car of drawn(RAIL_BRIDGE, 1).cars)
    assert.ok(car.position.y - yOf(terrainZ(car.position.x, -car.position.z)) > 10)
})

// Blending each car's pose between two steps would cut the chord inside the curve: 0.25 m off the rails for a 20 m step here.
test("between steps the train's s is blended, never its cars' poses: every alpha keeps every car on the rails", () => {
  const prev = CURVE - 10,
    next = CURVE + 10
  for (const alpha of [0.25, 0.5, 0.75]) {
    const s = prev + (next - prev) * alpha,
      node = drawn(next, 1, prev, alpha)
    assert.ok(offRails(node, s, 1) < 0.02, `alpha ${alpha}`)
    const there = drawn(s, 1)
    for (const [k, car] of node.cars.entries())
      assert.ok(car.position.distanceTo(there.cars[k]!.position) < 1e-9, `car ${k}`)
  }
})

/** Each car body's box and the middle of its vertices, in three space (a cab car's lies toward its nose). */
const bodies = (node: TrainNode) =>
  node.cars.map((car) => {
    const at = car.body.geometry.getAttribute("position"),
      middle = new Vector3()
    for (let i = 0; i < at.count; i++)
      middle.add(car.body.localToWorld(new Vector3().fromBufferAttribute(at, i)))
    return { box: new Box3().setFromObject(car.body), middle: middle.divideScalar(at.count) }
  })

test("a train with its cab facing either way along the same stretch is drawn as the same three cars, a cab at each end", () => {
  const ahead = bodies(drawn(STATION, 1)),
    back = bodies(drawn(STATION - length, -1)).toReversed()
  for (const [k, { box, middle }] of ahead.entries()) {
    const other = back[k]!
    assert.ok(
      box.min.distanceTo(other.box.min) < 0.02 && box.max.distanceTo(other.box.max) < 0.02,
      `car ${k}: ${box.min.toArray()} – ${box.max.toArray()} vs ${other.box.min.toArray()} – ${other.box.max.toArray()}`,
    )
    assert.ok(middle.distanceTo(other.middle) < 0.02, `car ${k} drawn the same way round`)
  }
})

test("the leading cab shows three white head lamps at the nose, the trailing cab two red tail lamps, and a train left alone none", () => {
  for (const facing of [1, -1] as const) {
    const node = drawn(STATION, facing),
      lead = node.cars[0]!.lamps!,
      trail = node.cars.at(-1)!.lamps!
    node.setLamps(true)
    assert.deepEqual(
      [lead.head.material, lead.tail.material, trail.head.material, trail.tail.material],
      [
        signalLampMaterials.on,
        signalLampMaterials.off,
        signalLampMaterials.off,
        signalLampMaterials.on,
      ],
    )
    assert.equal(node.cars[1]!.lamps, undefined, "the middle car has none")
    const nose = pointAt(line, STATION),
      tail = pointAt(line, STATION - facing * length)
    const lamps = (mesh: typeof lead.head) => new Box3().setFromObject(mesh)
    for (const [what, mesh, at, count] of [
      ["head", lead.head, nose, 3],
      ["tail", trail.tail, tail, 2],
    ] as const) {
      const centre = lamps(mesh).getCenter(new Vector3())
      assert.ok(
        Math.hypot(centre.x - at.x, -centre.z - at.y) < 0.5,
        `facing ${facing}: the ${what} lamps ${Math.hypot(centre.x - at.x, -centre.z - at.y)} m from their end`,
      )
      assert.equal(
        mesh.geometry.getAttribute("position").count / 36,
        count,
        `${count} ${what} lamps`,
      )
    }
    node.setLamps(false)
    for (const car of [node.cars[0]!, node.cars.at(-1)!])
      assert.ok(
        car.lamps!.head.material === signalLampMaterials.off &&
          car.lamps!.tail.material === signalLampMaterials.off,
      )
  }
})

test("every car's windows light at night along its window band on both sides, out of the body and under its doors; a cab's own stay dark", () => {
  const node = drawn(STATION, 1),
    half = TRAINS.atr220.width / 2
  for (const [k, car] of node.cars.entries()) {
    const panes = car.body.children.filter(
      (child): child is Mesh => child instanceof Mesh && child.material === cabinLightMaterial,
    )
    assert.equal(panes.length, 1, `car ${k}: one mesh of lit windows`)
    const { geometry } = panes[0]!
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!
    assert.ok(
      min.y >= 1.5 - 1e-6 && max.y <= 2.45 + 1e-6,
      `car ${k}: in the window band (${min.y}–${max.y} m)`,
    )
    assert.ok(min.z < -half && max.z > half, `car ${k}: on both sides`)
    // Between the side's livery patches (0.012 m out) and its doors (0.024 m), so a door's own window covers them.
    const out = [...geometry.getAttribute("position").array]
      .filter((_, i) => i % 3 === 2)
      .map(Math.abs)
    assert.ok(
      out.every((z) => z > half + 0.011 && z < half + 0.024),
      `car ${k}: ${Math.min(...out) - half}–${Math.max(...out) - half} m out of the body`,
    )
    if (k === 0)
      assert.ok(
        max.x < cars[0] / 2 - 2.6,
        "the cab's side window and windscreen are the driver's, not lit",
      )
  }
})

// Regression (seen in the browser): an x-ray box round each whole car cut into its neighbour's at the joints,
// and seen along the train its end face behind the next car showed a yellow block at every joint.
test("a driven train's x-ray boxes stop short of the joints and are open there, so on the sharpest curve no car's box reaches into its neighbour's", () => {
  const node = drawn(CURVE, 1)
  node.showXray(true)
  node.updateMatrixWorld(true)
  const proxies = node.cars.map((car) => {
    const proxy = shownProxy(car)!
    proxy.geometry.computeBoundingBox()
    return { car, box: proxy.geometry.boundingBox! }
  })
  for (const [k, { car, box }] of proxies.entries()) {
    const half = cars[k]! / 2
    assert.ok(box.max.x <= half - 0.24 || k === 0, `car ${k}: front trimmed`)
    assert.ok(box.min.x >= 0.24 - half || k === cars.length - 1, `car ${k}: rear trimmed`)
    assert.ok(k > 0 || box.max.x >= half, "the leading cab's box covers its nose")
    assert.ok(k < cars.length - 1 || box.min.x <= -half, "the trailing cab's box covers its nose")
    // Open at a joint: seen along the train, the next car stands in front of an end face there, which would show yellow.
    const proxy = shownProxy(car)!.geometry,
      at = proxy.getAttribute("position"),
      index = proxy.getIndex()!
    for (let t = 0; t < index.count; t += 3) {
      const xs = [0, 1, 2].map((v) => at.getX(index.getX(t + v)))
      assert.ok(
        !(k > 0 && xs.every((x) => x === box.max.x)) &&
          !(k < cars.length - 1 && xs.every((x) => x === box.min.x)),
        `car ${k}: a face across a joint`,
      )
    }
    const next = proxies[k + 1]
    if (next === undefined) continue
    // The next car's front corners, in this car's frame: behind this car's box.
    for (const z of [next.box.min.z, next.box.max.z])
      for (const y of [next.box.min.y, next.box.max.y]) {
        const corner = car.worldToLocal(next.car.localToWorld(new Vector3(next.box.max.x, y, z)))
        assert.ok(
          corner.x < box.min.x,
          `car ${k + 1}'s corner reaches ${corner.x} into car ${k}'s ${box.min.x}`,
        )
      }
  }
})

test("a train's node frees its x-ray boxes, never the bodies and lamps its model shares", () => {
  const node = drawn(STATION, 1)
  node.showXray(true)
  const freed: Array<string> = []
  for (const [k, car] of node.cars.entries()) {
    shownProxy(car)!.geometry.addEventListener("dispose", () => freed.push(`x-ray ${k}`))
    car.body.geometry.addEventListener("dispose", () => freed.push(`body ${k}`))
    if (car.lamps !== undefined)
      for (const mesh of [car.lamps.head, car.lamps.tail])
        mesh.geometry.addEventListener("dispose", () => freed.push(`lamps ${k}`))
  }
  node.dispose()
  assert.deepEqual(freed, ["x-ray 0", "x-ray 1", "x-ray 2"])
  assert.equal(drawn(STATION, 1).cars[0]!.body.geometry, node.cars[0]!.body.geometry, "shared")
})
