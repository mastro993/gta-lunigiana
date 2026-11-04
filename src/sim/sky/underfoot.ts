/**
 * The weather under a wheel on the map: `groundAt` with the ground's own facing (`facingAt`), so the
 * grip drops where the renderer draws the snow, north faces lower and steep faces bare. The physics
 * and the traffic read it; it reads the map's tiles at the point, so only where they are in memory.
 *
 * @module sky/underfoot
 */
import { facingAt } from "../map/ground.ts"
import type { WeatherValue } from "../schema.ts"
import type { Air } from "./climate.ts"
import { groundAt, type GroundWeather } from "./local.ts"

/** The ground's wet and snow at (x, y) on the level nearest `level` (m a.s.l.) under `weather` and the air `air` (`airAt`). */
export const underfoot =
  (weather: Pick<WeatherValue, "wet" | "snowLine">, air: Air) =>
  (x: number, y: number, level: number): GroundWeather =>
    groundAt(weather, x, y, level, air, facingAt)
