import assert from "node:assert/strict"
import { test } from "node:test"

import type { Osm } from "../osm.ts"
import { routeEnds, trainRoutes } from "../rail-routes.ts"

/** An extract of `ways` (id → node ids) and route relations (tags, members as [type, ref, role]). */
const extract = (
  ways: Record<string, ReadonlyArray<string>>,
  routes: ReadonlyArray<
    readonly [Record<string, string>, ReadonlyArray<readonly [string, string, string]>]
  >,
): Osm => ({
  nodes: new Map(),
  ways: new Map(Object.entries(ways).map(([id, nds]) => [id, { id, nds, tags: {} }])),
  relations: new Map(
    routes.map(([tags, members], i) => [
      String(i),
      { id: String(i), tags, members: members.map(([type, ref, role]) => ({ type, ref, role })) },
    ]),
  ),
})

const TRAIN = { type: "route", route: "train" }

test("routeEnds: a train route's first and last stops with the ways it leaves and comes in on, but a stop any route makes on its way", () => {
  const osm = extract({ 11: ["a", "x"], 12: ["x", "t"], 13: ["t", "y", "p"], 14: ["p", "q"] }, [
    // Into the terminus t: it leaves a along 11 and comes in on 12.
    [
      TRAIN,
      [
        ["node", "a", "stop"],
        ["node", "t", "stop_exit_only"],
        ["way", "11", ""],
        ["way", "12", ""],
      ],
    ],
    // From y through p to q, and back from q to p: p is no terminus.
    [
      TRAIN,
      [
        ["node", "y", "stop"],
        ["node", "p", "stop"],
        ["node", "q", "stop"],
        ["way", "13", ""],
        ["way", "14", ""],
      ],
    ],
    [
      TRAIN,
      [
        ["node", "q", "stop"],
        ["node", "p", "stop"],
        ["way", "14", ""],
      ],
    ],
    // A bus's route, and a train's whose last way does not run through its last stop (a platform is no stop).
    [
      { type: "route", route: "bus" },
      [
        ["node", "a", "stop"],
        ["node", "x", "stop"],
        ["way", "11", ""],
      ],
    ],
    [
      TRAIN,
      [
        ["node", "x", "stop"],
        ["node", "p", "platform"],
        ["node", "a", "stop"],
        ["way", "12", ""],
        ["way", "13", ""],
      ],
    ],
  ])
  // A stop's station is its name, else its id.
  osm.nodes.set("t", { id: "t", lat: 0, lon: 0, tags: { name: "Aulla" } })
  assert.deepEqual(routeEnds(osm), [
    { node: "a", way: 11, station: "a" },
    { node: "t", way: 12, station: "Aulla" },
    { node: "y", way: 13, station: "y" },
    { node: "q", way: 14, station: "q" },
    { node: "x", way: 12, station: "x" },
  ])
})

test("trainRoutes: each train route's ways in its running order, its platforms left out, no other route's", () => {
  const osm = extract({ 11: ["a", "x"], 12: ["x", "t"] }, [
    [
      TRAIN,
      [
        ["node", "a", "stop"],
        ["way", "12", ""],
        ["way", "77", "platform"],
        ["way", "11", ""],
      ],
    ],
    [{ type: "route", route: "bus" }, [["way", "11", ""]]],
  ])
  assert.deepEqual(trainRoutes(osm), [[12, 11]])
})
