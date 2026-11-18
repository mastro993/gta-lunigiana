/**
 * The debug menu's Trains area, through the trains store (`hud/trains.ts`) that `gta.trains` shares:
 * "Call trains now" (the sim's `SetTrains`), and live readouts of each line's next train (when it is
 * due and the end it enters from), each train (its model, line, place and speed, the end it faces,
 * who drives it, its AI driver's state, the station it calls at next, and whether it is stolen) and
 * each level crossing (its phase, its arms, its road light and its bell), refreshed each frame while
 * the menu is open and never announced (no live region). Lines and their ends are named by their
 * first and last stations, or by the compass points their ends lie toward where those are one
 * (the Pontremolese's two, calling at Aulla Lunigiana alone), and crossings by their roads, so any
 * railway the map holds reads the same way.
 *
 * @module hud/debug-trains
 */
import type { TrainRunValue, TrainViewModel } from "../sim/index.ts"
import { MAP } from "../sim/map/index.ts"
import { type Line, LINES, pointAt } from "../sim/rail/lines.ts"
import type { Area, Make } from "./debug.ts"
import { kmh } from "./hud.ts"
import { set } from "./title.ts"
import type { TrainStore } from "./trains.ts"

type TrainShown = TrainViewModel["trains"][number]
type CrossingShown = TrainViewModel["crossings"][number]

/** The names of `line`'s stations, in the order it calls at them going up its s. */
const stationsOf = (line: Line): ReadonlyArray<string> =>
  line.stations.map((station) => MAP.railway.stations[station]?.name ?? "")

/** The compass point nearest the way (dx, dy) points, +y north. */
const compass = (dx: number, dy: number) =>
  Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "east" : "west") : dy > 0 ? "north" : "south"

const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" } as const

/**
 * The names of `line`'s start and end, and whether they are its stations: its first and last, where they differ ("Equi Terme",
 * "Gragnola"); else the compass points each end lies toward from the other ("north", "south"), which always differ.
 */
export const endsOf = (
  line: Line,
): { readonly ends: readonly [string, string]; readonly stations: boolean } => {
  const names = stationsOf(line),
    first = names[0],
    last = names.at(-1)
  if (first !== undefined && last !== undefined && first !== last)
    return { ends: [first, last], stations: true }
  const a = pointAt(line, 0),
    b = pointAt(line, line.length),
    toward = compass(b.x - a.x, b.y - a.y)
  return { ends: [OPPOSITE[toward], toward], stations: false }
}

/**
 * Line `line` named by its ends (`endsOf`): "Equi Terme – Gragnola", or, named by compass points, its one station before them,
 * "Aulla Lunigiana, north – south"; "" for a line the map does not hold.
 */
export const lineName = (line: number): string => {
  const shown = LINES[line]
  if (shown === undefined) return ""
  const { ends, stations } = endsOf(shown),
    [only] = stationsOf(shown)
  const run = `${ends[0]} – ${ends[1]}`
  return stations || only === undefined ? run : `${only}, ${run}`
}

/** An end of line `line` (0 its start, 1 its end) named as `endsOf` names it: "the Gragnola end", "the north end"; "its start" for a line the map does not hold. */
export const endName = (line: number, end: 0 | 1): string => {
  const shown = LINES[line]
  if (shown === undefined) return end === 0 ? "its start" : "its end"
  return `the ${endsOf(shown).ends[end]} end`
}

/** A wait of `seconds` real seconds, rounded up: "45 s", "2 min 5 s", "3 min". */
export const waitText = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds)),
    minutes = Math.floor(whole / 60),
    rest = whole % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/**
 * Line `line`'s next train as the menu reads it, from its `due` (s from now, 0 once due, null when none is) and the end it enters
 * from, and whether an AI train runs on it now: "due in 1 min 35 s, from the Gragnola end", "due now, from …" (it enters once its
 * line is clear), "a train runs on it" or "none due".
 */
export const dueText = (
  line: number,
  due: number | null,
  from: 0 | 1,
  running: boolean,
): string => {
  if (due === null) return running ? "a train runs on it" : "none due"
  return `${due === 0 ? "due now" : `due in ${waitText(due)}`}, from ${endName(line, from)}`
}

/** An AI driver's state as the menu reads it. */
const STATES = {
  run: "running",
  dwell: "dwelling",
  braking: "held up, braking",
  horn: "held up, sounding the horn",
  creep: "held up, creeping on",
} as const satisfies Record<TrainRunValue["state"], string>

/**
 * Where on line `line` the nose at `s` is: "at km 6.703" along it, or on a run-out beyond an end, "1.066 km short of the Equi
 * Terme end" (a train entering or leaving the line).
 */
const placeText = (line: number, s: number): string => {
  const length = LINES[line]?.length ?? Infinity
  if (s < 0) return `${(-s / 1000).toFixed(3)} km short of ${endName(line, 0)}`
  if (s > length) return `${((s - length) / 1000).toFixed(3)} km past ${endName(line, 1)}`
  return `at km ${(s / 1000).toFixed(3)}`
}

/**
 * A train as the menu reads it: "ATR 220 Swing, line 0 at km 6.703: 42 km/h forward, facing the Gragnola end; AI driver, running;
 * next Gragnola". Forward is the way it faces; km counts its active cab's nose along the line, and off it, on a run-out, how far
 * beyond its end.
 */
export const trainText = (train: TrainShown): string => {
  const speed = kmh(train.v)
  const motion =
    speed === 0
      ? "standing"
      : `${speed} km/h ${train.v * train.facing > 0 ? "forward" : "backing up"}`
  const driver =
    train.state === undefined
      ? train.driver === "player"
        ? "you drive it"
        : "no driver"
      : `AI driver, ${STATES[train.state]}`
  const next =
    train.next === undefined
      ? "no station ahead"
      : `${train.state === "dwell" ? "at" : "next"} ${train.next}`
  return `${train.label}, line ${train.line} ${placeText(train.line, train.s)}: ${motion}, facing ${endName(train.line, train.facing > 0 ? 1 : 0)}; ${driver}${train.stolen ? ", stolen" : ""}; ${next}`
}

/** A level crossing's name in the menu: its road's, else what it is. */
export const crossingName = ({ road, walk }: Pick<CrossingShown, "road" | "walk">): string => {
  if (road === "") return walk ? "Foot crossing" : "Crossing"
  return road
}

/** What a level crossing shows as the menu reads it: "closed: arms 100 % down, light on, bell off"; a foot crossing has none of them. */
export const crossingText = (crossing: CrossingShown): string =>
  crossing.walk
    ? `${crossing.phase}; a foot crossing: no arms, light or bell`
    : `${crossing.phase}: arms ${Math.round(crossing.arm * 100)} % down, light ${crossing.lit ? "on" : "off"}, bell ${crossing.ringing ? "ringing" : "off"}`

/** A readout row of `name`: the row and its value cell. */
const row = (make: Make, name: string) => {
  const value = make("dd", { textContent: "—" })
  return { node: make("div", {}, make("dt", { textContent: name }), value), value }
}

/** The Trains area: "Call trains now", then each line's next train, each train and each level crossing, as the store shows them. */
export const trainsArea = (make: Make, store: TrainStore): Area => {
  const call = make("button", {
    type: "button",
    id: "debug-trains-call",
    textContent: "Call trains now",
  })
  const about = make("p", {
    id: "debug-trains-call-about",
    textContent:
      "Makes a train due now on every line no AI train runs on: it enters at the end of the line once the track ahead is clear.",
  })
  call.setAttribute("aria-describedby", about.id)
  call.addEventListener("click", () => store.call())
  // The lines and the crossings are the map's, fixed; the trains come and go, so their rows are made again when they do.
  const shown = store.now()
  const lines = shown.lines.map((_, i) => row(make, `Line ${i}`)),
    crossings = shown.crossings.map((crossing) => row(make, crossingName(crossing)))
  const list = (rows: ReadonlyArray<{ readonly node: Node }>) =>
    make("dl", { className: "debug-readouts" }, ...rows.map(({ node }) => node))
  const trainList = list([]),
    none = make("p", { textContent: "No train on the map." })
  let trains: ReadonlyArray<{ readonly value: HTMLElement }> = [],
    ids = ""
  const live = () => {
    const railway = store.now()
    const running = new Set(
      railway.trains.flatMap(({ line, driver }) => (driver === "ai" ? [line] : [])),
    )
    railway.lines.forEach(({ due, from }, i) => {
      const name = lineName(i),
        text = dueText(i, due, from, running.has(i))
      if (lines[i] !== undefined) set(lines[i].value, name === "" ? text : `${name}: ${text}`)
    })
    const now = railway.trains.map(({ id }) => id).join(" ")
    if (now !== ids) {
      ids = now
      const rows = railway.trains.map(({ id }) => row(make, `Train ${id}`))
      trainList.replaceChildren(...rows.map(({ node }) => node))
      trains = rows
      none.hidden = rows.length > 0
    }
    railway.trains.forEach((train, i) => {
      if (trains[i] !== undefined) set(trains[i].value, trainText(train))
    })
    railway.crossings.forEach((crossing, i) => {
      if (crossings[i] !== undefined) set(crossings[i].value, crossingText(crossing))
    })
  }
  return {
    title: "Trains",
    nodes: [
      make("div", { className: "debug-settle" }, call, about),
      make("h4", { textContent: "Lines" }),
      list(lines),
      make("h4", { textContent: "Trains" }),
      trainList,
      none,
      make("h4", { textContent: "Crossings" }),
      list(crossings),
    ],
    first: call,
    live,
  }
}
