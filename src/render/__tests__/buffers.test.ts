import assert from "node:assert/strict"
import { test } from "node:test"

import { buffersOf } from "../../sim/rail/collisions.ts"
import { LINES } from "../../sim/rail/lines.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { bufferPieces, bufferStops } from "../buffers.ts"
import { emptySink, linear } from "../geometry.ts"
import { yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { railPieces } from "../rail.ts"

// Regression: the player's train on the Lucca–Aulla line stopped dead at the end of Aulla
// Lunigiana's track 4, where its line ends at a terminus, against nothing drawn there.
test("buffer stops: one across the track at each terminus, where a driven train stops dead, its red board facing the train coming in over the train's whole width", () => {
  const termini = LINES.filter((line) => line.terminus)
  assert.ok(termini.length > 0, "the Lucca–Aulla line ends at Aulla Lunigiana")
  const stops = bufferStops()
  assert.equal(stops.length, termini.length)
  const pieces = bufferPieces()
  // Drawn with the track, chunk by chunk.
  const drawn = railPieces(() => [])
  for (const { pts } of pieces)
    assert.ok(drawn.some((p) => p.pts.length === 2 && p.pts[0] === pts[0] && p.pts[1] === pts[1]))
  termini.forEach((line, i) => {
    // The driven train's buffer stop is the line's end.
    assert.equal(buffersOf(line).hi, line.length)
    const { x, y, z, ux, uy } = stops[i]!,
      sink = emptySink()
    pieces[i]!.draw(() => sink, 0, 0)
    const { position, color } = sink.solid,
      [r, g, b] = linear(PALETTE.signalRed)
    let red = 0,
      across = 0,
      high = -Infinity
    for (let t = 0; t < position.length; t += 3) {
      const px = position[t]!,
        py = -position[t + 2]!,
        along = (px - x) * ux + (py - y) * uy,
        side = Math.abs(-(px - x) * uy + (py - y) * ux)
      // Nothing stands short of the line's end, where the train's head stops.
      assert.ok(along >= -1e-6, `${along.toFixed(2)} m short of the end`)
      across = Math.max(across, side)
      if (color[t] === r && color[t + 1] === g && color[t + 2] === b) {
        red++
        high = Math.max(high, position[t + 1]!)
        assert.ok(side <= 0.5, "the board over the track")
      }
    }
    assert.ok(red > 0, "a red board")
    assert.ok(high > yOf(z) + 1.4, "standing over the beam, in the driver's sight")
    assert.ok(across >= TRAINS.atr220.width / 2, `the beam ${across.toFixed(2)} m out each side`)
  })
})
