// The playtest bot's command line: its usage, and the parse of a line into a command (the mode, its
// URL and its flags, each checked: spots, days, routes and the positive numbers) that
// src/tools/playtest.ts runs.
import { parseArgs } from "node:util"

/** What the CLI prints after a bad line's error. */
export const USAGE = `usage: node src/tools/playtest.ts shots <url> <outdir> <name>:<x>,<y>[,<texels/m>] … [map] [--port N] [--wait s] [--date YYYY-MM-DD]
       node src/tools/playtest.ts heap <url> [--port N] [--seconds s] [--at x,y] [--date YYYY-MM-DD]
       node src/tools/playtest.ts drive <url> [--port N] [--speed m/s] [--seconds s] [--route x1,y1,x2,y2,…]
shots and drive need a dev build (pnpm exec vite: window.gta); heap works on dev and production builds`

/** A place to shoot: x east and y north in map metres, at `zoom` texels per metre when set; or the full map. */
export type Spot =
  | {
      readonly kind: "spot"
      readonly name: string
      readonly x: number
      readonly y: number
      readonly zoom?: number
    }
  | { readonly kind: "map" }

/** A parsed command line. */
export type Command =
  | {
      readonly command: "shots"
      readonly url: string
      readonly outdir: string
      readonly spots: ReadonlyArray<Spot>
      readonly port: number
      readonly waitS: number
      /** Unset: the day the game starts on. */
      readonly date?: Day
    }
  | {
      readonly command: "heap"
      readonly url: string
      readonly port: number
      readonly seconds: number
      /** Unset: where the game starts the player. */
      readonly at?: { readonly x: number; readonly y: number }
      /** Unset: the day the game starts on. */
      readonly date?: Day
    }
  | {
      readonly command: "drive"
      readonly url: string
      readonly port: number
      /** m/s along the route. */
      readonly speed: number
      /** Unset: the route's length at `speed`. */
      readonly seconds?: number
      /** Flat x, y pairs in map metres; unset: `defaultRoute()`. */
      readonly route?: ReadonlyArray<number>
    }

/** A calendar day. */
export interface Day {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** Parses `YYYY-MM-DD`. */
const parseDay = (text: string): Day => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const [year, month, day] = [match?.[1], match?.[2], match?.[3]].map(Number)
  if (match === null || month! < 1 || month! > 12 || day! < 1 || day! > 31)
    throw new Error(`bad --date "${text}": want YYYY-MM-DD`)
  return { year: year!, month: month!, day: day! }
}

/** Parses `map` or `<name>:<x>,<y>[,<texels/m>]`; the name becomes a file name, so it holds only letters, digits, `_` and `-`. */
export const parseSpot = (text: string): Spot => {
  if (text === "map") return { kind: "map" }
  const match = /^([\w-]+):([^,]+),([^,]+)(?:,([^,]+))?$/.exec(text)
  const [x, y, zoom] = [match?.[2], match?.[3], match?.[4]].map((v) =>
    v === undefined ? undefined : Number(v),
  )
  if (match === null || !Number.isFinite(x) || !Number.isFinite(y))
    throw new Error(`bad spot "${text}": want <name>:<x>,<y>[,<texels/m>] or map`)
  if (zoom !== undefined && !(zoom > 0)) throw new Error(`bad zoom in "${text}": want texels/m > 0`)
  return { kind: "spot", name: match[1]!, x: x!, y: y!, ...(zoom === undefined ? {} : { zoom }) }
}

const positive = (text: string | undefined, fallback: number, flag: string): number => {
  const value = text === undefined ? fallback : Number(text)
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`bad ${flag} "${text}"`)
  return value
}

const parseRoute = (text: string): Array<number> => {
  const route = text.split(",").map((v) => (v.trim() === "" ? Number.NaN : Number(v)))
  if (route.length < 4 || route.length % 2 !== 0 || !route.every(Number.isFinite))
    throw new Error(`bad --route "${text}": want x1,y1,x2,y2,… (two points or more)`)
  return route
}

/** Parses the arguments after the script's name; throws on a bad line (the CLI prints the usage after the error). */
export const parseCli = (argv: ReadonlyArray<string>): Command => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      port: { type: "string" },
      wait: { type: "string" },
      seconds: { type: "string" },
      speed: { type: "string" },
      route: { type: "string" },
      date: { type: "string" },
      at: { type: "string" },
    },
  })
  const port = positive(values.port, 9333, "--port")
  if (!Number.isInteger(port) || port > 65_535) throw new Error(`bad --port "${values.port}"`)
  const [command, url, ...rest] = positionals
  if (url !== undefined && !URL.canParse(url)) throw new Error(`bad url "${url}"`)
  if (command === "shots" && url !== undefined && rest.length >= 2) {
    const [outdir, ...spots] = rest as [string, ...Array<string>]
    return {
      command,
      url,
      outdir,
      spots: spots.map(parseSpot),
      port,
      waitS: positive(values.wait, 6, "--wait"),
      ...(values.date === undefined ? {} : { date: parseDay(values.date) }),
    }
  }
  if (command === "heap" && url !== undefined && rest.length === 0) {
    const at = values.at?.split(",").map((v) => (v.trim() === "" ? Number.NaN : Number(v)))
    if (at !== undefined && (at.length !== 2 || !at.every(Number.isFinite)))
      throw new Error(`bad --at "${values.at}": want x,y`)
    return {
      command,
      url,
      port,
      seconds: positive(values.seconds, 10, "--seconds"),
      ...(at === undefined ? {} : { at: { x: at[0]!, y: at[1]! } }),
      ...(values.date === undefined ? {} : { date: parseDay(values.date) }),
    }
  }
  if (command === "drive" && url !== undefined && rest.length === 0)
    return {
      command,
      url,
      port,
      speed: positive(values.speed, 40, "--speed"),
      ...(values.seconds === undefined
        ? {}
        : { seconds: positive(values.seconds, 0, "--seconds") }),
      ...(values.route === undefined ? {} : { route: parseRoute(values.route) }),
    }
  throw new Error("missing or extra arguments")
}
