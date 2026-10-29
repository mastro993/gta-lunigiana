/**
 * The target `ritmo-devtools lint` checks (`pnpm lint`): the simulation's `setup` and `update`, run
 * headless, and the host's render and audio schedules, described, not run. It lives beside the
 * simulation, not in it, as the one module that loads both: `src/sim` never imports host code.
 *
 * @module lint
 */
import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import type * as Lint from "@typeonce/ritmo-devtools/Lint"

import {
  bindings,
  Game,
  KeyboardInput,
  makeRuntime,
  type Root,
  SetClock,
  SetHandling,
  SetTrains,
  SetWeather,
  setup,
  update,
} from "./sim/index.ts"

/** The runtime and schedules `ritmo-devtools lint` checks; the render and audio schedules are described, not run. */
export const lintTarget = async (): Promise<Lint.Target<typeof Game.schema, typeof Root>> => {
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
    ),
    debug: { hostClock: HostClock.test() },
  })
  if (!made.ok) throw new Error(`invalid runtime: ${JSON.stringify(made.error)}`)
  // Loaded here, not at the top: modules loaded inside lintTarget are host code to the lint, so the
  // simulation coverage check leaves the render and audio modules out.
  const { render } = await import("./render/index.ts")
  // The audio schedule is the only reader of Cry.
  const { audio } = await import("./audio/index.ts")
  // The host's handling store (src/hud/handling.ts, behind the settings and the dev debug menu) sends SetHandling with runtime.send;
  // the host sends SetClock to hold the clock behind the title card (holdClock, src/hud/title.ts), and the dev debug menu sends
  // SetClock and SetWeather. SetTrains calls a train onto every idle line: the tests and the dev debug menu's Trains area send it.
  return {
    runtime: made.value,
    schedules: { setup, update },
    describe: { render, audio },
    hostEvents: [SetHandling, SetClock, SetWeather, SetTrains],
  }
}
