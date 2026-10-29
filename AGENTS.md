# AGENTS.md

Grand Theft Auto: Lunigiana is a Ritmo ECS simulation (`src/sim`), the browser hosts that draw, play and show it (`src/render`, `src/audio`, `src/hud`, `src/main.ts`), and the Node pipeline that builds its map (`src/tools`).

- **Changing** any file: first read [CODING_STANDARDS.md](CODING_STANDARDS.md) and follow its steps.
- **Reviewing** a diff or PR: judge it against [CODING_STANDARDS.md](CODING_STANDARDS.md) and the standards files it routes the diff to.
- **Branching**, committing or opening a PR: first read [docs/standards/commits-and-prs.md](docs/standards/commits-and-prs.md).
- **Proposing** a change to the look, the camera or the controls: first read the user's Settled design in [docs/standards/render.md](docs/standards/render.md).
- **Evaluating** a data source: apply the licence rules in [docs/standards/map.md](docs/standards/map.md#data-sources-and-requests) before recommending it.
- **Sending** anything off this machine (request headers, issue and PR text, screenshots): it carries no local paths, personal names or e-mail addresses, and a request names only the project in its `User-Agent`, as `src/tools/net.ts` does for every downloader (its `request`, `getText`, `getBytes` and `overpass`). A subagent once sent the user's e-mail to Overpass.
- **Long runs** (map builds, playtests, background agents): post a one-line status every few minutes.

`docs/` is the source of truth for how each part behaves. Read the section before you change or explain it:

| Topic | Doc |
|---|---|
| systems, schedules, state, input, rendering, HUD, checks | [docs/architecture.md](docs/architecture.md) |
| the player, vehicles, traffic, people and their reactions, animals, score, tuning | [docs/gameplay.md](docs/gameplay.md) |
| the game clock, the map's place, sun and moon, the national climate model, odds and day plan and their sources, weather, grip, lightning, how the weather looks and sounds | [docs/weather.md](docs/weather.md) |
| the rivers' flow and its calibration, their depth and current, wading and swimming, vehicles in the water, the shore walls, how the water looks | [docs/water.md](docs/water.md) |
| the map build, its sources, the file format, the data's limits | [docs/map.md](docs/map.md) |
| sounds, acoustics, calibration, audio tests | [docs/audio.md](docs/audio.md) |
