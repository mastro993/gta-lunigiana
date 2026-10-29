import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

import { parseCli, parseSpot, spotScript } from "../playtest.ts"

test("parseSpot: name, map metres and an optional zoom; map; bad spots throw", () => {
  assert.deepEqual(parseSpot("monzone:-494,436.9"), {
    kind: "spot",
    name: "monzone",
    x: -494,
    y: 436.9,
  })
  assert.deepEqual(parseSpot("vinca-2:2274,-2620,4"), {
    kind: "spot",
    name: "vinca-2",
    x: 2274,
    y: -2620,
    zoom: 4,
  })
  assert.deepEqual(parseSpot("map"), { kind: "map" })
  // The name becomes a file name: no paths.
  for (const bad of ["../up:1,2", "a/b:1,2", "a:1", "a:1,x", "a:1,2,0", "a:1,2,3,4", ":1,2"])
    assert.throws(() => parseSpot(bad), /bad/, bad)
})

test("parseCli: shots, heap and drive with their defaults and flags; bad lines throw", () => {
  assert.deepEqual(
    parseCli(["shots", "http://localhost:5174/?seed=1", "out", "a:1,2", "map", "--port", "9444"]),
    {
      command: "shots",
      url: "http://localhost:5174/?seed=1",
      outdir: "out",
      spots: [{ kind: "spot", name: "a", x: 1, y: 2 }, { kind: "map" }],
      port: 9444,
      waitS: 6,
    },
  )
  assert.deepEqual(parseCli(["heap", "http://localhost:4173/", "--seconds", "3"]), {
    command: "heap",
    url: "http://localhost:4173/",
    port: 9333,
    seconds: 3,
  })
  assert.equal(
    (parseCli(["shots", "http://h/", "o", "map", "--wait", "1.5"]) as { waitS: number }).waitS,
    1.5,
  )
  assert.deepEqual(parseCli(["drive", "http://h/"]), {
    command: "drive",
    url: "http://h/",
    port: 9333,
    speed: 40,
  })
  assert.deepEqual(
    parseCli([
      "drive",
      "http://h/",
      "--speed",
      "25.5",
      "--seconds",
      "30",
      "--route",
      "0,0,-10.5,2e3",
    ]),
    {
      command: "drive",
      url: "http://h/",
      port: 9333,
      speed: 25.5,
      seconds: 30,
      route: [0, 0, -10.5, 2000],
    },
  )
  for (const bad of [
    [],
    ["shots", "http://h/", "out"],
    ["heap"],
    ["heap", "http://h/", "extra"],
    ["heap", "not a url"],
    ["heap", "http://h/", "--port", "0"],
    ["heap", "http://h/", "--port", "70000"],
    ["heap", "http://h/", "--seconds=-1"],
    ["drive"],
    ["drive", "http://h/", "extra"],
    ["drive", "http://h/", "--speed", "0"],
    ["drive", "http://h/", "--seconds", "x"],
    ["drive", "http://h/", "--route", "1,2"],
    ["drive", "http://h/", "--route", "1,2,3"],
    ["drive", "http://h/", "--route", "1,2,3,y"],
    ["drive", "http://h/", "--route", "1,2,,4"],
  ])
    assert.throws(() => parseCli(bad), /bad|missing or extra/, bad.join(" "))
  assert.throws(() => parseCli(["heap", "http://h/", "--nope"]))
})

test("spotScript: pins the focus on the ground (render y = elevation − 200, z = −north) and the zoom when given", () => {
  const view = {
    focus: { x: 0, y: 0, z: 0, set: (): unknown => undefined },
    texelsPerMetre: 8,
  }
  const body = {
    children: [
      { id: "game", style: { visibility: "" } },
      { id: "hud", style: { visibility: "" } },
    ],
  }
  const gta = { view, heightAt: (x: number, y: number) => 300 + x / 100 + y / 1000 }
  const run = (script: string): unknown => runInNewContext(script, { gta, document: { body } })
  assert.equal(run(spotScript({ kind: "spot", name: "a", x: 100, y: -2000, zoom: 4 })), 299)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  assert.deepEqual(
    body.children.map((el) => el.style.visibility),
    ["", "hidden"],
  )
  // The game's frame writes neither the focus nor the pinned zoom.
  view.focus.set()
  view.texelsPerMetre = 7
  assert.equal(view.texelsPerMetre, 4)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  // A spot without a zoom frees it again.
  run(spotScript({ kind: "spot", name: "b", x: 0, y: 0 }))
  view.texelsPerMetre = 6
  assert.equal(view.texelsPerMetre, 6)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [0, 100, 0])
})
