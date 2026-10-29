/**
 * The railway's part of the map (`MAP.railway`): its lines over the running track, the stations they
 * call at, the level crossings and the platforms, as `src/tools/railway.ts` and `platforms.ts` build
 * them. Types only; the rail pieces themselves are `Rail` in ./index.ts.
 *
 * @module map/railway
 */

/** A running piece of a line: `MAP.rail[rail]`, walked from its last vertex to its first when `rev`. */
export interface LinePiece {
  readonly rail: number
  readonly rev: boolean
}

/**
 * A line: running track from one terminal (a dead end on the map's edge, where the track runs on
 * beyond it) to another, on the straightest way through junctions. Consecutive pieces share their
 * end vertex bit-identically; its arc length s counts metres from the first piece's start.
 */
export interface RailLine {
  readonly pieces: ReadonlyArray<LinePiece>
  /** OSM's speed limits, `[from s, to s, km/h]` in s order; a stretch with no tag has none. */
  readonly maxspeed: ReadonlyArray<readonly [number, number, number]>
}

/** Where a line calls at a station: the extent along it of the station's platforms beside it, and their side. */
export interface Station {
  readonly name: string
  /** Index into `MAP.railway.lines`. */
  readonly line: number
  /** From and to s along the line, m (s0 <= s1). */
  readonly s0: number
  readonly s1: number
  /** 1: the platform stands right of the line's direction (increasing s), -1: left of it. */
  readonly side: 1 | -1
}

/**
 * Where a road crosses track at grade: its crossing nodes on one road within 10 m of each other
 * (Via Castel dell'Aquila's over Gragnola's two tracks are one).
 */
export interface LevelCrossing {
  /** Index into `MAP.roads`. */
  readonly road: number
  /** Indices into `graph.nodes`: each a vertex both the road and a rail piece have. */
  readonly nodes: ReadonlyArray<number>
  /** The nodes' mean, m. */
  readonly x: number
  readonly y: number
  /** Index into `MAP.railway.lines` of the line crossed, or -1 where only a loop or siding is. */
  readonly line: number
  /** The line's s at its node, m, or -1. */
  readonly s: number
}

/**
 * A station platform, or a rail-level walkway (a strip between two tracks, or one narrower than
 * 1.2 m): its rings are `MAP.areas[area]` (kind "platform", or "paved" for a walkway). Its top
 * follows the rail head of the running track beside it (`platformTop` in `./ground.ts`).
 */
export interface Platform {
  readonly area: number
  readonly walkway?: boolean
  /** The station's name (of the nearest station or stop node), when one is near. */
  readonly name?: string
  /** Flat x, y of the centreline of the running track beside it, over the platform's extent along it. */
  readonly axis: ReadonlyArray<number>
  /** The top per axis vertex, m a.s.l.: that track's rail head plus 0.25 m (a walkway's plus 0.02 m). */
  readonly top: ReadonlyArray<number>
}

/** The railway as trains, crossings and people on platforms read it (built by `src/tools/railway.ts` and `platforms.ts`). */
export interface Railway {
  readonly lines: ReadonlyArray<RailLine>
  /** By line, then s0. */
  readonly stations: ReadonlyArray<Station>
  readonly crossings: ReadonlyArray<LevelCrossing>
  readonly platforms: ReadonlyArray<Platform>
}
