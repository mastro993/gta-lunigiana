# Coding standards

Every change follows these principles and steps; step 2 routes it to the checks for its part of the game in `docs/standards/`.

## Principles

- **The real place.** Streets, buildings, heights, rivers, land cover and names come from survey and open data of the real Lunigiana. When the game and the real place disagree, fix the data or the pipeline.
- **Code style.** No semicolons and double quotes (`pnpm format` applies both), a one-line JSDoc on every export, and modules under ~500 lines grouped by feature. Tests live in a `__tests__` folder beside the module they test: `src/sim/route.ts` is tested by `src/sim/__tests__/route.test.ts` (`pnpm lint` fails a test anywhere else).

## Every change

1. Rebase onto `origin/main`, then, in a new worktree, run `pnpm install --frozen-lockfile`: the Ritmo skill links (`.claude/skills/ritmo`, `.agents/skills/ritmo`) point into `node_modules`, so they resolve only after the install, and the install sets up the git hooks. Then run `pnpm fetch-raw` and `pnpm maps`: the maps are not in git, and `pnpm lint`, the tests and the dev server read them.
2. Before writing code, read:
   - the `ritmo` skill and the playbook it routes the change to. When no skill tool lists it, read `node_modules/@typeonce/ritmo/skills/ritmo/SKILL.md` directly;
   - the `docs/` sections that AGENTS.md routes the change to;
   - the standards file of every row that matches the change:

   | When the change touches | Read |
   |---|---|
   | `src/sim`: new saved state or events | [docs/standards/sim.md](docs/standards/sim.md) |
   | the map: `src/tools`, `src/sim/map`, `data/raw` and its lock, a data source, a new map part or biome | [docs/standards/map.md](docs/standards/map.md) |
   | `src/render`, the camera, the view, or the keys (`bindings` in `src/sim/schema.ts`) | [docs/standards/render.md](docs/standards/render.md) |
   | `src/audio` | [docs/standards/audio.md](docs/standards/audio.md) |
   | `src/hud` | [docs/standards/hud.md](docs/standards/hud.md) |
   | anything the player sees or hears | [docs/standards/playtest.md](docs/standards/playtest.md) |

3. Write the test first. Find map features by geometry, as `BATTISTI` in `src/sim/testing.ts` does, so the test survives a map rebuild. A bug fix, a review's finding included, proves its test red: revert the fix, watch the test fail, restore it.
4. Make the change and work through every item of each standards file you read.
5. Run `pnpm check` and read its exit code: `pnpm check > /tmp/check.log 2>&1; echo $?`. Piping it into `tail` hides a failure.
6. Update every doc that describes the changed behaviour: the markdown under `docs/`, the README's controls, scripts and layout tables, and the system-order and state tables in architecture.md. Measure every number you write, with its unit, run every command, and put the reason beside the rule. Headings name what their section holds, and each section opens with a summary line. Markdown under `docs/` wraps at about 100 columns; root markdown files stay unwrapped.
7. Sweep the touched files and their callers: delete dead code, unused exports and tests that only cover deleted code.

Done when `pnpm check` exits 0, each item of every standards file you read is done or does not apply, the touched files and their callers hold no dead code, and a search of every tracked `*.md` (`git grep`) for each name, key and number you changed finds only the new behaviour.
