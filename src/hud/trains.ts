/**
 * The railway for dev tools, one store for the debug menu's Trains area and the console handle
 * `gta.trains` (main.ts creates it in dev builds only), so each shows what the other did. It sends
 * the sim's `SetTrains` call and shows what the call does, by the sim's own rule (`takesCall`), until
 * the game takes it: the game takes a request on its next step, and not at all while the full map
 * or the settings pause it. Nothing is stored: the service is saved sim state.
 *
 * @module hud/trains
 */
import type { TrainViewModel } from "../sim/index.ts"
import { takesCall } from "../sim/rail/dispatch.ts"

/** What the store needs: the railway to read (`TrainView`) and the `SetTrains` call to send. */
export interface TrainStoreHost {
  readonly read: () => TrainViewModel
  readonly send: (request: { readonly call: true }) => void
}

/** `railway` with a call taken: the next train due now on every line it reaches, each line no AI train runs on (`takesCall`). */
const called = (railway: TrainViewModel): TrainViewModel => {
  const running = new Set(
    railway.trains.flatMap(({ line, driver }) => (driver === "ai" ? [line] : [])),
  )
  return {
    ...railway,
    lines: railway.lines.map((line, i) =>
      takesCall(running.has(i), line.due, 0) ? { ...line, due: 0 } : line,
    ),
  }
}

/**
 * The store over the game's railway: what it shows is what the game holds, with a call sent but not yet taken laid over it, so the
 * menu open over the paused map shows the trains called.
 */
export const makeTrainStore = ({ read, send }: TrainStoreHost) => {
  // The railway as it read when the last call went, while the game has not stepped since. The view reads saved state only, so it
  // changes only on a step, and each step takes every request sent before it; a step that changes nothing shown found no line to call.
  let sent: string | undefined
  return {
    /** The game's railway, with a call sent but not yet taken laid over it. */
    now: (): TrainViewModel => {
      const game = read()
      if (sent !== undefined && JSON.stringify(game) !== sent) sent = undefined
      return sent === undefined ? game : called(game)
    },
    /** Calls a train now onto every line no AI train runs on; it enters once its line is clear (`SetTrains`). */
    call: (): void => {
      sent = JSON.stringify(read())
      send({ call: true })
    },
  }
}

/** The game's railway for dev tools, and the call for trains. */
export type TrainStore = ReturnType<typeof makeTrainStore>
