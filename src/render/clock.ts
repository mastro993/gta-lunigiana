/**
 * The render's clock: the fraction of a fixed step the loop has run past the last one when it draws
 * a frame. A service of its own module, so the systems the render schedule lists from other modules
 * (render/train, render/crossings) read it without importing the schedule.
 *
 * @module render/clock
 */
import { Descriptor } from "@typeonce/ritmo"

/** Mutable host object: the loop writes `alpha` (fraction of a step since the last one) before ticking `render`. */
export const RenderClock = Descriptor.Service<{ readonly alpha: number }>()("Lunigiana/RenderClock")
