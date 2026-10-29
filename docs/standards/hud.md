# HUD standards

Checks for a change in `src/hud`, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md):

- **Shared answers**: when the HUD mirrors an action, the HUD and the system call one function, as
  the prompt and `EnterExit` share `boardingAt` (`src/sim/rail/boarding.ts`, over `vehicleInReach`
  in `src/sim/body.ts`).
- **Access**: honour `prefers-reduced-motion`, move focus into dialogs so screen readers announce
  them, and match keys by the character typed, with the key's position as fallback.
- **Canvas size**: keep every canvas under 16.7 MP, Safari's limit.
