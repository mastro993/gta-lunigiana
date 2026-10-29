# Browser playtest

Anything the player sees or hears is checked in a real browser, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md). The T3 and MCP browser preview tools time out on
this WebGL page, so drive headless Chrome over CDP:

1. Start Vite on a free port: `pnpm exec vite --port <port> --strictPort`. The user's own server
   is on 5173, and other sessions run their own Vite and Chrome. When other sessions edit the same
   checkout, serve a snapshot of it instead: Vite reloads the page on every save (nothing accepts
   hot updates), which cuts a shot or a measurement short.

   ```sh
   rsync -a --delete --exclude node_modules --exclude .git --exclude .research --exclude docs ./ /tmp/<name>/
   ln -sfn "$PWD/node_modules" /tmp/<name>/node_modules
   cd /tmp/<name> && pnpm exec vite --port <port> --strictPort
   ```

   Vite listens on `localhost`, not `127.0.0.1`.
2. Start Chrome with `--headless=new`, `--remote-debugging-port=<port>`,
   `--user-data-dir=$(mktemp -d)`, `--window-size=1280,720` and `--force-device-scale-factor=1`,
   plus `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` on macOS
   (`--use-angle=swiftshader --enable-unsafe-swiftshader` elsewhere). For sound, add
   `--autoplay-policy=no-user-gesture-required --mute-audio`.
3. Drive it over CDP. `.research/playtest/bot.ts <seed>` walks, steals the Carabinieri car, drives
   and gets out; `cdp.ts` sends single steps. `.research/` is gitignored, so these scripts live only
   in the main checkout (`git worktree list`): copy them over, then change their hard-coded CDP port
   (9333) and game URL (port 5173). On every new CDP connection send
   `Emulation.setDeviceMetricsOverride` with `{ width: 1280, height: 720, deviceScaleFactor: 1,
   mobile: false }`: the override lasts only as long as the connection that set it, and without it
   the page is 1280×633 (the window's 720 px include the browser's frame), and so are the
   shots.
   For a phone, send it before loading the page with `mobile: true` (for example 844 × 390 at
   `deviceScaleFactor` 3; swap the sides for a phone held upright), together with
   `Emulation.setTouchEmulationEnabled`; both make `(pointer: coarse)` match, so the game starts
   in mobile mode. Drive the touch controls with `Input.dispatchTouchEvent`.
4. Dev builds expose `window.gta`: `renderer`, `view`, `scene`, `world`, `effects` (its
   `crossings.boxes` hold each level crossing's barriers and road lights, as the render last set
   them; `undefined` at a foot crossing), `heightAt`,
   `player()`, `handling()` (the handling knobs in force), `audio` (`level()` gives the output in
   dBFS), `sky`, `skyLook()`, `trains()` and `cut` (the see-through cut: `open`, and `follow`,
   which the render schedule calls with the player each frame; wrap it to pin the cut to a spot you
   shoot).
   Load `?seed=N`, wait for `gta`, then press a key to dismiss the title card.
   - `gta.sky` is the debug menu's sky store: `now()` (the game time, its rate, Rome's wall clock
     in `local`, and the weather), `rate()`, `regime()` (the regime held, `null` in Auto),
     `heading()`, and the setters `setTime(secondOfDay)` (Rome time),
     `setDate({ year, month, day })`, `setSeconds(utc)`, `setRate(gameSecondsPerStep)`,
     `force(regime | null)` and `settle()`.
     The game clock is held behind the title card (`gta.sky.rate()` reads 0 there) and its release
     sends rate 1, so set rates after dismissing the card. The game takes a request on its next
     step, and not while the map or the settings pause it. Night rain on 21 December, the clock
     stopped:

     ```js
     gta.sky.setRate(0); gta.sky.setDate({ year: 2026, month: 12, day: 21 }); gta.sky.setTime(20 * 3600 + 30 * 60); gta.sky.force("rain"); gta.sky.settle()
     ```

   - `gta.skyLook()` returns what the sky host drew last: the sky frame (night, lamps, ambient,
     flash, wind, rain and snow), the sun and the moon, the light, the key light's aim, the
     exposure, whether shadows were drawn, the fog layers and the weather at the focus.
   - `gta.trains()` returns the railway as the debug menu's Trains area shows it (`TrainView`
     through the trains store): `lines` (`due`, real seconds until each line's next train may
     enter, 0 once due, `null` when none is; `from`, the end it enters from), `trains` (id, label,
     line, `s`, `v`, `facing`, the AI driver's `state`, `next`, `driver` and `stolen`) and
     `crossings` (centre, road, `walk`, `phase`, `arm`, `lit`, `ringing`). `gta.trains.call()`
     calls a train now onto every line no AI train runs on (`SetTrains`); until the game steps,
     `gta.trains()` already shows those lines due now. At the start of a new game each line's train
     stands at its station nearest the player, so the call reaches a line only once its train is
     gone or stolen. A crew door, to board a train from a bot, is 2.5 m behind each nose
     (`doorsOf` in `src/sim/rail/boarding.ts`, which Vite serves to the page as
     `/src/sim/rail/boarding.ts`).
   - The debug menu (P) has ids for bots: `#debug-time-rate-{0,1,10,60}`, `#debug-time-of-day`,
     `#debug-time-date`, `#debug-time-sunrise`, `#debug-time-sunset`,
     `#debug-weather-{auto,clear,fair,cloudy,overcast,fog,rain,storm,windy,snow}`,
     `#debug-weather-settle`, and `#debug-trains-call` under `#debug-trains-title`.
5. To shoot the spot at (x east, y north), run this, then wait about 6 s:

   ```js
   const f = gta.view.focus; f.set = function () { return this }; f.x = x; f.y = gta.heightAt(x, y) - 200; f.z = -y
   ```

   For a visible change, shoot the same spot before you change the code too: the PR shows before
   and after. M opens the full map. Shots for the README come from `pnpm build && pnpm preview` at
   1280×720, go in `docs/screenshots/`, and are committed with the README change.
6. Kill the Vite and Chrome processes you started, by PID.

Done when you have seen the changed behaviour in the browser (a PNG of it that you opened, or for
a sound a `gta.audio.level()` reading), opened every PNG you cite, and no process you started is
still running.
