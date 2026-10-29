# Weather and the time of day

The game keeps a clock and a weather in its saved state, and pure functions turn them into the sun,
the moon, the air's temperature, the rain and snow falling, the wet and the snow on the ground, the
fog and the wind at any point of the map. The physics, the traffic, the renderer, the audio and the
HUD all read the weather through those same functions, so a road grips, looks and sounds as wet as
it is. The weather is Italy's, from national statistics: it works unchanged on any Italian map,
which enters only through its latitude and its heights ([The map's place](#the-maps-place)). The
code is in `src/sim/sky/` and `src/sim/systems/sky.ts`; the systems' order and the saved resources
are in [architecture.md](architecture.md#schedules-and-system-order). Heights are metres above sea
level, the map frame is x east and y north, and times of day are Rome's.

## The game clock

`GameClock` holds the game time and how fast it runs: `seconds`, whole Unix UTC seconds, and `rate`,
the game seconds each 60 Hz step adds.

- **A game minute a real second.** At rate 1 each step adds a game second, so a real second is a
  game minute and a game day lasts 24 real minutes: long enough to drive a while in one light, short
  enough to see a dusk and a dawn in one session (the user's choice). `AdvanceClock` adds the rate
  each step; at rate 0 the clock stands still and is not written.
- **The pause stops it.** The full map (M) and the settings (Esc) stop the `update` schedule, and
  the clock with it.
- **A new game starts today at 08:00.** `main.ts` gives `makeRuntime` the browser's local date at
  08:00 in Rome as `start`: the simulation never reads a date itself, or a replay would not replay.
  Without a `start` the runtime begins at `DEFAULT_START`, 2026-10-22 08:00 CEST (1792648800), so
  tests replay the same day. Behind the title card the clock is held at rate 0 (`holdClock`,
  `src/hud/title.ts`) and set going at rate 1 when the card goes, so play starts at 08:00 however
  long the card stayed up; traffic, people and animals move on behind it.
- **Requests.** `SetClock { seconds?, rate? }` sets the time, the rate or both (`setClock`,
  `src/sim/sky/clock.ts`): the seconds are rounded and kept from 2000-01-01 to 2100-01-01 UTC
  (`SECONDS_RANGE`, inside the calendar's summer-time rule), the rate is a whole number from 0 to
  3600 (`MAX_RATE`, a game hour a step), and a request with neither as a finite number is dropped.
  The host sends one to hold the clock behind the card, the dev menu to set the time
  ([The HUD and the dev menu](#the-hud-and-the-dev-menu)).
- **Two kinds of time.** The sun, the moon, the temperature, the day's plan, the wetness and the
  snow line follow the game time. What moves on screen or in the ears (rain falling, clouds
  drifting, lightning, trees swaying) runs on sim seconds, `(Time.step + alpha) · STEP.dt`: game
  time runs 60 times faster and would fling them, and sim seconds stand still in the pause like the
  rest of the game.

## The calendar and Rome time

`src/sim/sky/calendar.ts` turns the clock into dates and Rome's wall clock with exact integer
arithmetic, so every host and every replay reads the same date: the simulation's lint bans `Date`,
and `Intl`'s time-zone data comes from the host.

- **Dates**: Howard Hinnant's `days_from_civil` and `civil_from_days` (`daysFromCivil`,
  `civilFromDays`, day numbers from 1970-01-01) and `weekday`.
- **Rome's offset**: CET (UTC+1), and CEST (UTC+2) from 01:00 UTC on the last Sunday of March to
  01:00 UTC on the last Sunday of October, the EU rule Italy has kept since 1996 (`romeOffset`).
- **Wall clock**: `romeTime` gives the date, hour, minute and second, keeping the fraction of a
  host's fractional time. `utcFromRome` reads a wall-clock time back to UTC: the hour skipped in
  March reads an hour later, the hour repeated in October as its first, summer-time pass.
  `romeDay` gives the Rome calendar day (days since 1970-01-01) and the seconds since its local
  midnight, the clock the day's plan keeps.
- **Checks**: `calendar.test.ts` round-trips every day from 1900 to 2100 and checks the switches of
  2026, 2027 and 2032 against IANA's Europe/Rome.

## The map's place

The sky knows where the map lies only through `place()` (`src/sim/sky/place.ts`): four numbers the
map module works out once it decodes the map, so the sky modules themselves decode no map and a
new map needs no weather data of its own.

| Field | What it is | On the shipped map |
|---|---|---|
| `lat`, `lon` | the map's origin (`MAP.origin`, degrees north and east): the sun and the moon are worked out for it, and the latitude picks the climate | 44.16175 N, 10.13 E |
| `floor` | the map's low ground, m: the 5th percentile of its heightmap | 230.3 m |
| `downslope` | the way its ground falls, rad counter-clockwise from east: the steepest descent of a least-squares plane through its heights | 2.127 (toward the north-north-west) |

- **Provided at load.** `src/sim/map/index.ts` calls `providePlace(placeFrom(MAP.origin,
  MAP.heightmap))` right after decoding, as the host hands the map file to `provideMap`. The fit
  reads every one of the 4.9 million height nodes once: 13–20 ms in Node (three runs).
- **Without a map** (the audio lab, the HUD and sky unit tests) `place()` is the reference site,
  `REFERENCE_PLACE`: 44.16175 N, 10.13 E, floor 230 m, downslope 2.13, the shipped map's own place
  rounded, so a map-free page hears and shows what the game does. `mapfree.test.ts` asserts that
  the sky modules decode no map, and that once the map is decoded `place()` is the map's origin,
  its 5th-percentile height and its plane fit, within 0.5 m and 0.005 rad of the reference.
- **Absolute or over the floor.** Temperature, precipitation and snow follow the height above sea
  level, so a high map is colder and snowier. What relief sets counts from the floor instead: the
  low-ground fog, the cloud base, the wind's growth on exposed ground, the drying air and the
  audio's wind law. Otherwise a coastal plain would sit in the "valley" fog all day and an Alpine
  map in a gale everywhere.
- **Why a plane.** The night's drainage breeze blows down the map's slope and the day's breeze up
  it; on a coastal plain the plane's fall is roughly the land and sea breeze. The earlier,
  Lunigiana-only weather took the Lucido's axis (2.5 rad) by hand.

## The sun and the moon

`src/sim/sky/astro.ts` places the sun and the moon over the map's origin (`place()`) from the game
time, in degrees: azimuth clockwise from north, elevation geometric (no refraction).

- **Models.** The sun follows NOAA's Solar Calculator equations (Meeus, *Astronomical Algorithms*,
  ch. 25), the moon the Astronomical Almanac's low-precision series with the topocentric parallax
  (about 1°; without it the moon's elevation is off by up to 1.18° against JPL Horizons). Both turn
  to the horizon through Greenwich mean sidereal time; TT − UT (about 69 s) is ignored. `moonPhase`
  gives the lit fraction, the age (0 new, 0.5 full) and whether the moon waxes.
- **Accuracy.** `astro.test.ts` holds reference values from JPL Horizons and the USNO API for the
  reference site (44.16175 N, 10.13 E, whichever map is loaded): the sun within 0.02° on 22 October
  2026 at 09, 12 and 15 UTC; its highest elevation 69.3° on 21 June, 34.7° on 22 October and 22.4°
  on 21 December, to 0.02°; sunrise and sunset within 60 s of USNO on four dates; the moon within
  0.7° in azimuth, 0.4° in elevation and 0.01 in lit fraction at six instants; and the phase at
  USNO's new, first-quarter and full moons of October 2026.
- **Sunrise and sunset.** `sunTimes` (`src/sim/sky/day.ts`) finds them on a Rome calendar day: the
  sun's centre at −0.833° (the disc's radius plus the horizon's refraction, USNO's convention),
  scanned hour by hour from local midnight, then bisected to half a second. At the reference site
  on 22 October 2026 they are 07:42 and 18:24, on 21 June 05:36 and 21:06, on 21 December 07:51 and
  16:43. The dev menu's sunrise and sunset buttons jump to them.
- **The sky stays put when the view turns.** The renderer takes the real direction into three
  space as it is (`keyDirection`, `src/render/sky/light.ts`), whatever the view's yaw: a quarter
  turn, or the view following a car round a corner, moves the camera and never the shadows, the
  settled rule of [render.md](standards/render.md). Which walls are lit depends only on the date,
  the hour and the place: the home view looks south-east, so a morning sun shines toward the
  camera, and a turn shows the other side of the same light.

## The climate model

`src/sim/sky/climate.ts` holds Italy's climate as a small national model: the temperature normals
each month from the latitude, how they fall with height, the day's cycle, the day-to-day air mass,
the share of precipitation that falls as snow, and how much more falls higher up. The place enters
only through `place().lat` and the height asked about. Every number comes from a source in the
[record](#the-climate-sources-record) or is labelled a design value.

### Temperature with latitude, height and month

Each month has a daily mean at sea level that varies with latitude, one lapse rate, and a daily
range that varies with latitude and height (`normalsAt`). A day takes the straight line between the
two nearest mid-month values.

- **Sea level** (`SEA_LEVEL`): ISPRA SCIA's 1991–2020 normals at the stations at or below 800 m,
  each brought to sea level down the month's lapse rate and averaged in five latitude bands (37–39,
  39–41, 41–43, 43–44.5 and 44.5–47 N; 20, 41, 33, 26 and 118 stations), placed at the bands' mean
  latitudes 38.13, 40.08, 41.87, 43.87 and 45.58 N. A latitude takes the straight line between the
  two anchors around it and the outermost row beyond them (`atLatitude`). The table keeps the
  winter's bend that a straight line in latitude misses: the centre runs up to 0.9 °C warmer than
  the line in January.
- **The lapse rate** (`LAPSE`): 4.03 K/km in January, 4.68 in February, 5.19 in March, 5.67–5.84
  from April to September, 5.03 in October, 4.74 in November and 4.08 in December, the
  least-squares fit over the 296 SCIA stations with a complete 1991–2020 normal (36.8–46.9 N,
  0–2210 m), one rate a month and no knee. Winter's is gentler because valley inversions keep cold
  air low; Zandonai et al. (2025) find the same seasons in the Italian Alps (4.7 K/km in winter, 6.7
  in spring). The ICAO standard atmosphere's 6.5 K/km describes the free air and would leave slopes
  1–2 °C too cold at 1000 m in winter.
- **The daily range** (`RANGE`): mean maximum less mean minimum = `at42 + perDegree·(lat − 42) +
  perKm·z/1000`, the least-squares fit over the 328 SCIA stations with both normals (7.0–11.1 °C at
  42 N and sea level, widening 0.1–0.4 °C a degree northward and narrowing 0.4–1.3 °C a km up). It
  never falls under 1 °C (`RANGE_MIN`), which only happens above 5.2 km in any month at Italy's
  latitudes, so `celsiusAt` is a straight line in height over any Italian ground.

`climate.test.ts` checks that the mid-month normals give the tables back: the sea-level mean at each
anchor latitude, held beyond them, the lapse rate and the range's fit. The normals on the 15th,
before any weather (°C, maximum / minimum as the mean ± half the range):

| Month | 38 N, 0 m | 42 N, 0 m | 45.5 N, 0 m | Shipped map (44.16 N), 230 m | 1000 m | 1800 m |
|---|---|---|---|---|---|---|
| January | 14.4 / 8.3 | 12.3 / 5.1 | 8.1 / 0.0 | 8.9 / 1.3 | 5.6 / −1.7 | 2.3 / −4.8 |
| April | 19.9 / 11.6 | 19.5 / 9.9 | 19.1 / 8.2 | 17.7 / 7.5 | 12.9 / 3.5 | 8.0 / −0.6 |
| July | 31.5 / 21.7 | 31.4 / 20.3 | 30.4 / 18.1 | 29.3 / 17.6 | 24.5 / 13.5 | 19.5 / 9.2 |
| October | 24.4 / 16.5 | 22.4 / 13.7 | 19.6 / 10.1 | 19.4 / 10.4 | 15.2 / 6.9 | 10.8 / 3.2 |

### The day's cycle

`airAt` places each moment between the day's minimum (−0.5 of the range) and maximum (+0.5) on
Parton and Logan's (1981) curve, closed as Felber, Stoeckli and Calanca (2017) close it, and adds
the weather's anomaly; `celsiusAt` then takes it to a height.

- **By day** a sine rises from the minimum at sunrise to the maximum at 14:30 local solar time and
  falls on toward sunset. Felber et al.'s own fit puts the minimum 0.75 h after sunrise and the
  maximum at 14:43; the game keeps sunrise and 14:30, as designed.
- **By night** the curve decays toward the next sunrise's minimum as e^(−b·x) − x·e^(−b), x the
  share of the night gone: fast just after sunset, slowly toward dawn, as clear air radiates its
  heat away early. It meets the minimum at sunrise with no jump: no 10 s step over a day is more
  than 0.02 °C (asserted).
- **The weather's share of the range** (`rangeShare`): 0.4 under a full cloud cover, 1 under a clear
  sky in a wind, 1.15 clear and calm (calm at 2 m/s or less, windy from 6 m/s), as low ground cools
  most on still, clear nights. The night's decay b is 3.14 × that share: 3.61 clear and calm, 3.14
  clear in a wind, 1.26 overcast. 3.14 is Felber et al.'s generic fit to clear-sky days at Swiss
  stations below 800 m; a cloudy or windy night cools more evenly.
- **Over every sky, SCIA's range.** SCIA's range is the mean over all of a month's days, so the
  swing is the weather's share over the month's usual share (`usualShare`): the share under the
  month's mix of skies at the latitude, its clear-ish days half clear and half fair, its overcast
  days (the rain days and `OVERCAST_DRY` more) and the rest cloudy, each under its regime's cloud
  and wind. A clear, calm day then swings 1.2–1.6 times the normal range (1.5 in winter, least in
  the clear southern summers), a full cover about half of it. Over 30 simulated years the mean of
  each day's maximum less its minimum on the low ground is 0.96–1.04 of SCIA's range, month by
  month, at 38, 42 and 45.5 N and on the shipped map (asserted within 0.1).

On a clear 22 October at the Monzone spawn (209 m, wind 2 m/s, no anomaly; the normals there a
13.9 °C mean and an 8.7 °C range) the air reaches 20.5 °C at 15:33, falls to 18.4 °C at sunset
(18:24), 12.7 °C at 21:00 and 9.6 °C at midnight, and bottoms out at 7.2 °C at 07:44; under a full
overcast it is 14.4 °C at 21:00.

### The air mass and the day's warmth

The weather's `anomaly` eases (time constant 1 game hour) toward the sum of four parts, so a day
runs warmer or colder than the normal as real weather does:

1. **The air mass** (`plan.airMass`), a daily AR(1) drawn with each day's plan: 0.8 of yesterday's
   plus a Gaussian, 2.5 °C in the long run (`AIR_MASS`), so a departure falls by e in about 4.5
   days. Design values, rounded from ERA5 (a cross-check only, see the
   [record](#the-climate-sources-record)).
2. **The day's warmth** (`dayWarmth`): a wet day runs `WET_OFFSET` warmer than the normal, +0.5 °C
   in January, November and December (rain off the sea), 0 in February, −0.5 in March and October,
   −1 in April and September, −1.5 in May and August and −2 in June and July (storm outflow); a dry
   day runs f·offset/(1 − f) the other way, f the month's rain-day chance, so the month's mean stays
   on the normal. Design values, rounded from ERA5.
3. **The regime's own departure**: −2 °C in a strong wind, −2.5 °C in a cold front (the snow
   regime), 0 otherwise.
4. **Cooling under what falls** (`rainCooling`): falling precipitation cools the air toward its
   wet-bulb temperature, melting snow toward 0 °C, a thunderstorm's downdraft most: 1.5 °C from
   0.1 mm/h at sea level plus 0.3 °C a mm/h, at most 3.5 °C (design values). Without it the phase
   rule, applied to the day's air, snowed on the Apennines' 900–1200 m about a quarter as often as
   Capozzi et al. (2025) count. Nothing makes it up, so over 30 simulated years on the shipped map
   the air on the low ground runs 0.23 °C under the normal on average.

### Rain or snow

`snowShare` is the share of precipitation that falls as snow: all of it at or below 0.5 °C, none at
or above 1.5 °C, half at 1.0 °C (`HALF_SNOW`), where Jennings et al. (2018) find the rain–snow
threshold of the Northern Hemisphere's air temperature on average. The rule reads the temperature
only, as the simulation keeps no humidity. `freezingLevel` is the height where the air is at
1.0 °C, half snow, solved from the straight line in height and kept from −1000 to 8000 m. A snow
line of `NO_SNOW`, 6000 m, means none lies anywhere: it stands above every Italian summit (Monte
Bianco, 4808 m).

### More precipitation higher up

Precipitation is set at sea level and grows with height as `orographic(z)`: 0.6 more per km, so
×1.6 at 1000 m, held at ×2 from about 1670 m up. It is a national design value: no national
gradient was fitted, and the earlier Lunigiana fit, +0.95 per km from 250 m through 11 SCIA gauges
in Lunigiana, the Serchio valley and the Apuan Alps, comes from one of Italy's wettest slopes.

The day plan sets how much a wet day brings at sea level ([The day plan](#the-day-plan)). Over 30
simulated years a wet day brings 10.6–10.8 mm on average at sea level, inside SCIA's band normals
of about 8–16 mm a wet day, and a year 795 mm at 38 N, 876 at 42 N and 951 at 45.5 N.

## The national odds

`src/sim/sky/odds.ts` holds Italy's weather as odds: for each calendar month, the chance that a day
brings each event. `oddsAt(t, lat, z)` gives them for Rome's calendar month at `t` (`romeMonth`) at
latitude `lat`, snowfall at `z`; the day plan draws from the same rows and the dev menu shows them,
so each number has one home. The rows that vary with latitude are tables at a few anchor latitudes,
taken straight between them and held beyond the outermost (`atLatitude`).

| Row (`DayOdds`) | What a day counts | From |
|---|---|---|
| `rain` | at least 1 mm | SCIA 1991–2020 rain days at the stations at or below 500 m, five bands, anchors 38.0, 40.1, 41.7, 43.7 and 45.5 N (`RAIN_DAYS`) |
| `heavy`, `rainstorm` | at least 10 mm, at least 20 mm | the rain day's chance × ISPRA's national share of rain days reaching 10 and 20 mm (`HEAVY_SHARE`, `RAINSTORM_SHARE`): medians over 577 stations, 1991–2020, national constants, as the latitudes differ by less than the sites |
| `thunder` | a thunderstorm | 40 a year (`THUNDER_YEAR`, a design value, the user's choice) shared over the months by the Aeronautica Militare's share of observations with cumulonimbus at its lowland airports, four bands, anchors 38.47, 40.98, 43.5 and 45.47 N (`THUNDER_SHAPE`); never more than the rain days |
| `snow` | at least 1 mm of water as snow at `z` | worked out from the temperature model, not a table (below) |
| `fog` | fog on the low ground (mostly a morning's) | the Aeronautica Militare's fog days (visibility under 1 km), lowland airports, four bands, anchors 38.3, 40.9, 43.3 and 45.4 N (`FOG_DAYS`) |
| `clear` | clear-ish: at most 4/8 of cloud at 06 and 18 UTC | the Aeronautica Militare's share of such days, the same airports and bands (`CLEAR_SHARE`, climate.ts) |
| `overcast` | at least 7/8 at 06 and 18 UTC, the sky seen (a fog is its own row) | the rain days plus `OVERCAST_DRY`, 0.08 from October to March and 0.02 from April to September (`overcastChance`): a design value, as no licensed national count exists |
| `windy` | a wind over 20 knots on the low ground | 2 (`WINDY_DAY`, a design value: a one-day gale blows over 20 knots at about 2 of the 4 synoptic hours) × the Aeronautica Militare's share of observations over 20 knots, the mean of its four lowland groups (`STRONG_WIND`): one national row, as exposure sets it more than latitude |

- **Thunder.** No licensed source counts Italy's thunder days, so the total is a design value: most
  of Europe's lowlands have 20–40 a year and northern Italy's mountains over 60 (Morgenstern et al.
  2023). The shape moves with latitude: the north's storms peak in July over land, the south's from
  October to January off the sea, as lightning shows (Anderson and Klugmann 2014). Where a month's
  share would outnumber its rain days it is capped (June to August at 38–40 N, July and August at
  42–44 N, July at 45.5 N), so a year gets 38.3 at 38 N, 38.4 at 42 N and 39.2 at 45.5 N.
- **Snowfall** is a rain day whose air while it falls is under the phase rule's half point: the
  day's mean normal at `z`, the wet day's offset, the air mass as a Gaussian of 2.5 °C widened by
  the hour's swing under a full cover (`RAIN_SWING`, 0.17 of the range; 0.14–0.18 measured), and
  each event's own air and cooling at its usual rate: a thunderstorm, frontal rain or, from December
  to March with the air mass 1.5 °C or more under the normal, a cold front. It leaves out how much
  of a day's water is snow, so it reads the weather's own snowfall days within about a third
  (`calibration.test.ts` holds ×0.7–1.4).

At 42 N (the year in days; snowfall at sea level and 1000 m):

| Per day | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Days a year |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rain | 0.254 | 0.260 | 0.246 | 0.253 | 0.211 | 0.141 | 0.095 | 0.105 | 0.213 | 0.231 | 0.299 | 0.291 | 79 |
| Heavy rain | 0.071 | 0.070 | 0.076 | 0.073 | 0.063 | 0.045 | 0.029 | 0.035 | 0.081 | 0.086 | 0.117 | 0.096 | 26 |
| Rainstorm | 0.028 | 0.026 | 0.027 | 0.025 | 0.023 | 0.017 | 0.010 | 0.016 | 0.036 | 0.039 | 0.054 | 0.035 | 10 |
| Thunder | 0.064 | 0.080 | 0.085 | 0.099 | 0.105 | 0.116 | 0.095 | 0.105 | 0.145 | 0.150 | 0.124 | 0.092 | 38 |
| Fog | 0.149 | 0.108 | 0.090 | 0.068 | 0.059 | 0.033 | 0.021 | 0.034 | 0.051 | 0.107 | 0.126 | 0.138 | 30 |
| Clear-ish | 0.476 | 0.485 | 0.475 | 0.442 | 0.527 | 0.644 | 0.783 | 0.764 | 0.648 | 0.541 | 0.482 | 0.482 | 206 |
| Overcast | 0.334 | 0.340 | 0.326 | 0.273 | 0.231 | 0.161 | 0.115 | 0.125 | 0.233 | 0.311 | 0.379 | 0.371 | 97 |
| Windy | 0.061 | 0.057 | 0.059 | 0.048 | 0.023 | 0.019 | 0.015 | 0.012 | 0.017 | 0.028 | 0.044 | 0.061 | 13 |
| Snowfall, 0 m | 0.019 | 0.020 | 0.005 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.009 | 1.6 |
| Snowfall, 1000 m | 0.077 | 0.089 | 0.069 | 0.015 | 0.001 | 0 | 0 | 0 | 0 | 0 | 0.006 | 0.078 | 10.1 |

Latitude moves the year round. In January 38 N has 9.2 rain days, 3.5 thunder days and 0.9 fog
days, 45.5 N 5.4, 0.1 and 14.4; in July 38 N has 1.2 rain days and a 0.90 clear-ish share, 45.5 N
6.7 and 0.63. The shipped map (44.16 N) gets 88 rain days, 39 thunder days, 43 fog days, 13
strong-wind days and 6.1 snowfall days at sea level a year from the table.

## The day plan

At each Rome midnight the weather draws the day ahead from the odds at the map's latitude
(`src/sim/sky/plan.ts`), saved as `Weather.plan`; which regime the weather moves toward at each
moment is then a pure function of the plan and the time (`regimeAt`).

- **When.** A day is drawn when the clock reaches a new Rome day, in play at midnight or by a clock
  jump, and then the whole of it: a day entered at 09:00, 16:00 or 20:00 is the day entered at
  midnight. A new game's first step draws its first day, after its calm start.
- **From what.** A day's 17 numbers come from the weather seed and the day alone: a SplitMix32
  sequence (the golden-ratio step and murmur3's finaliser) from the seed and the day hashed
  together. The seed is `WeatherRng`'s first state, `(seed ^ 0x9e3779b9) >>> 0`, kept in
  `Weather.seed`; the plan never draws from `WeatherRng` itself, so the same seed plans the same
  days whatever the storms drew, and another seed plans others.
- **Wet or dry.** A two-state Markov chain keeps both the month's rain days and how they follow each
  other: after a wet day the next is wet with p11 (`WET_PERSISTENCE`, a national design value: 0.5
  from October to March, 0.45 in April, May and September, 0.4 in June and August, 0.3 in July),
  after a dry day with p01 = f(1 − p11)/(1 − f), f the month's rain-day chance, so the long run
  holds f. A jump of n days uses the exact n-step chain, P(wet | wet) = f + (1 − f)·λⁿ and
  P(wet | dry) = f·(1 − λⁿ) with λ = p11 − p01, and the air mass's 0.8ⁿ, so a long jump forgets
  yesterday. A day with none known before it (a new game's first, or a jump back) takes the
  chain's long run: wet at f, the air mass at its full spread.
- **A wet day's event.** A thunderstorm with the odds' thunder over rain days, capped at 1;
  otherwise, from December to March with the day's air mass at −1.5 °C or colder
  (`COLD_OUTBREAK`), a cold front (the snow regime); else frontal rain. Snow is not drawn: what
  falls is snow where the air at that height is cold enough.
- **How much.** The intensity takes ISPRA's national shares: a rainstorm (20 mm or more), heavy
  rain (10 mm or more) or ordinary. The day's total at sea level (`AMOUNT`, design values) is
  1.5–9 mm for ordinary rain, two thirds of them under 5 mm (of ISPRA's median rain days under
  10 mm a third reach 5); 11–18.5 mm for heavy rain; from 22 mm for a rainstorm, with an exponential
  tail averaging 34 mm, at most 80. The classes keep clear of their edges by more than an overcast
  day's drizzle (0.7 mm a day).
- **How long and when.** Thunderstorms rain 1–3 game hours (2–4 for a rainstorm), fronts 2–6,
  4–9 or 6–12 by class (`HOURS`), longer when the total would fall faster than 15 mm/h
  (`HEAVIEST`). From March to September a thunderstorm grows over land in the afternoon, starting
  between 13:00 and 18:00 (`CONVECTIVE`; Feudale et al. 2013 find north-east Italy's lightning
  peaking at 16–17 UTC); any other rain starts at any hour 1.5 h after midnight (`LEAD`), or at
  midnight when yesterday ended under a sky thick enough to rain. Each day's rain falls in one
  window inside its own day, so the day's total and class are its own.
- **Through midnight.** When today and tomorrow are both days of steady rain (frontal rain or a cold
  front), today's rain runs on to midnight with a chance of 0.5 (`RUNS_ON`, a design value) and
  tomorrow's goes on from it, so a spell of rain crosses days. Tomorrow is drawn ahead from the
  seed, so the look-ahead is the day that follows. Thunderstorms never run on.
- **A wet day's sky.** A wet day is overcast, with its drizzle, before and after its rain; a summer
  thunderstorm (March to September) grows out of a fair sky, cloudy from 1.5 h before it and after
  it.
- **A dry day's sky**, solved so the month's days come out as the table, counted as the Aeronautica
  Militare counts them at 06 and 18 UTC: clear-ish with the share the wet days leave (a summer
  thunderstorm's day counts fair at 06 and cloudy at 18, any other wet day overcast at both), half
  of them clear and half fair (`CLEAR_OF_CLEARISH`); otherwise overcast with the share the table's
  overcast days leave (less the hours a stratus hides), else cloudy.
- **Strong wind** comes on clear-ish dry days only, the `windy` regime for 6–14 game hours of the
  day (`WINDY_HOURS`), with the odds' windy days over the clear-ish dry ones.
- **Fog** comes on dry days without a strong wind, with the odds' fog days over those days: under a
  clear-ish sky a radiation-fog morning ([Fog](#fog)); under a cloudy or overcast one a low stratus
  (the `fog` regime) that lifts between 10:00 and 14:00, or holds all day in 0.3 of the cases from
  November to February (`STRATUS`). A plan that takes over after 01:00 (a new game's) brings no fog
  morning.
- **Summer time.** A plan's times count seconds since its Rome day's midnight, and a day lasts 23,
  24 or 25 hours, so on the days the clocks change a day's rain falls as long as drawn.

`plan.test.ts` holds the plan to the table over 300 simulated years at 38, 42 and 45.5 N, every
month's days of rain, heavy rain, rainstorms, thunder, fog, strong wind and overcast, the clear-ish
share and p11 within their slack or four standard errors; and it checks the calm start, the same
seed giving the same days, the wet day's shape, the rain at any hour and through midnight, the
clock jumps and the summer-time days.

## Regimes

The weather moves toward one of nine regimes (`REGIME_SPECS`, `src/sim/sky/regimes.ts`): each holds
the targets the `Weather` resource eases toward, with a label and a description for the menus. The
targets are design values; the day plan picks the regime hour by hour
([The day plan](#the-day-plan)), and the [calibration](#calibration) checks what the regimes then
make of the days.

| Regime | Label | Cloud | Precipitation at sea level (mm/h) | Storm | Wind (m/s) | Air moves toward | Gust factor | Fog | Anomaly (°C) |
|---|---|---|---|---|---|---|---|---|---|
| `clear` | Clear | 0.05 | 0 | 0 | 1.5 | the breeze | 1.4 | 0 | 0 |
| `fair` | Fair | 0.3 | 0 | 0 | 2.5 | the breeze | 1.5 | 0 | 0 |
| `cloudy` | Cloudy | 0.65 | 0 | 0 | 3 | north-east | 1.5 | 0 | 0 |
| `overcast` | Overcast | 0.95 | 0.03 | 0 | 2.5 | north-east | 1.4 | 0.15 | 0 |
| `fog` | Fog | 0.9 | 0 | 0 | 0.6 | the breeze | 1.3 | 0.9 | 0 |
| `rain` | Rain | 1 | 2 | 0 | 5 | north-east | 1.7 | 0.3 | 0 |
| `storm` | Thunderstorm | 1 | 5 | 1 | 6 | north-east | 2.3 | 0.2 | 0 |
| `windy` | Windy | 0.2 | 0 | 0 | 11 | south-west | 1.8 | 0 | −2 |
| `snow` | Snow | 1 | 1.5 | 0 | 4 | south-west | 1.6 | 0.4 | −2.5 |

- **Wind**: on the map's low ground at 10 m. Toward the north-east is a south-westerly off the sea,
  which brings the rain; toward the south-west a cold northerly or north-easterly. The breeze blows
  up the map's slope while the sun is up and down it at night, along
  `place().downslope`. A windy day's 11 m/s (21.4 knots) blows over the 20 knots the odds count,
  with gusts to 19.8 m/s on the low ground and a 27.5 m/s mean on exposed crests.
- **Precipitation** is at sea level; `orographic` scales it with height. A wet day's plan sets its
  own rate while its rain falls (`plan.precip`); the wet regimes' rates are about the plan's mean
  rates, 1.8 mm/h for rain, 4.7 for a thunderstorm and 1.6 for a cold front, and serve a regime the
  dev menu forces. Overcast's 0.03 mm/h is a drizzle that slowly wets the roads
  ([The ground](#the-ground-wetness-snow-and-meltwater)).
- **Anomaly** is the regime's own departure from the day's air
  ([The air mass](#the-air-mass-and-the-days-warmth)).
- **Snow** is a cold front: steady precipitation 2.5 °C colder than the day's air, cooled 1.95 °C
  more by its 1.5 mm/h. With the day's air mass at the normal, settled on 15 January at noon on the
  shipped map it brings the snow line down to 392 m; on 22 October the freezing level stays at
  2142 m and on 15 July at 3609 m, above the map's highest ground (1799 m), so it falls as a cold
  rain everywhere.

### Easing and forcing

The weather eases toward its regime's targets over game time, so a front builds on screen rather
than snapping, and the dev menu can force a regime over the plan.

- **Easing.** Every value eases toward the regime's target with a time constant in game time
  (`EASE`, `weather.ts`): cloud 30 min, precipitation 20 min, thunderstorm activity 15 min, wind
  (speed, direction the short way round, gusts) 20 min, fog 30 min, anomaly 1 h. At the normal clock
  30 game minutes are 30 real seconds. Precipitation and storms start only once the cloud passes 0.7
  (`RAINS_FROM`), so the rain waits for the sky to thicken. At rate 0 nothing eases: a clock moved
  by hand takes its day's plan and, unless the regime is forced, the regime that plan sets for the
  new hour.
- **A new game** starts clear and calm, at the clear regime's targets with no anomaly, on dry ground
  under the season's snow line (where the day's mean normal is 0 °C, none when that lies above the
  map: on the shipped map 1489 m on 15 January, 1521 m on 15 February, 1685 m on 15 December, none
  from March to November), with no storm near. Its plan holds clear and calm for 90 game minutes
  (`CALM_START`), so the first stretch of play (and the first frames of every scenario test) is
  calm.
- **Forcing.** `SetWeather { regime, settle? }` from the dev menu (`setWeather`, `weather.ts`)
  forces a regime over the plan (`forced`). With `settle` every value jumps to the regime's targets,
  the ground to the wetness it would settle at, and where it snows the snow line down to the
  freezing level; settling the plan's own rain takes the plan's rate. `regime: null` hands the
  weather back to the day's plan and its regime at once, settled on the plan's values with
  `settle`. A request applies under the plan of the day the clock is on, so a clock stopped and
  moved to another day settles on that day's plan. An unknown regime is dropped.

## Calibration

The weather as it falls is checked against the table it draws from. `calibration.test.ts` runs
`advanceWeather` for 30 simulated years in half-hour steps (seed 1) at sea level at 38, 42 and
45.5 N (and on the shipped map's place for its snow cover), recording each Rome day as the
Aeronautica Militare and SCIA count it:

- a rain day at 1 mm or more at sea level, heavy rain at 10 mm, a rainstorm at 20 mm, a thunder
  day at a storm activity of 0.25 or more, a fog morning at fog 0.5 or more on the low ground at
  08:00, a strong-wind day at 20 knots (10.29 m/s) on the low ground;
- clear-ish at a cloud cover of 0.5 or less, overcast at 7/8 or more outside the fog regime, at 06
  and 18 UTC.

It asserts:

- each day does what its plan said (at most one day in 200 differs, from half-hour steps at the
  intensity classes' edges);
- each month's days within the design's tolerance or four standard errors of the 30 years' mean,
  whichever is wider: rain ±1.5, heavy rain ±1, rainstorms ±0.75, thunder ±1, fog ±2, strong wind
  ±1; the clear-ish and overcast shares within ±0.07; p11 within ±0.08;
- the year's shares of rain days with 10 and 20 mm within 0.03 and 0.02 of ISPRA's national
  shares; thunder days 40 ± 4 a year;
- each month's mean daily range on the low ground within a tenth of SCIA's;
- no snow at sea level from June to September; the odds' snowfall within ×0.7–1.4 of the weather's
  own; and the snow targets below.

At 42 N, measured / table, days a month:

| | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Year |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rain | 8.0 / 7.9 | 6.7 / 7.3 | 7.1 / 7.6 | 7.4 / 7.6 | 5.6 / 6.5 | 5.1 / 4.2 | 3.0 / 2.9 | 3.3 / 3.3 | 6.9 / 6.4 | 7.1 / 7.2 | 8.8 / 9.0 | 9.6 / 9.0 | 78.5 / 78.9 |
| Heavy rain | 2.6 / 2.2 | 2.0 / 2.0 | 2.1 / 2.4 | 2.2 / 2.2 | 1.7 / 2.0 | 1.6 / 1.4 | 0.8 / 0.9 | 1.0 / 1.1 | 2.8 / 2.4 | 2.6 / 2.7 | 3.2 / 3.5 | 3.7 / 3.0 | 26.2 / 25.6 |
| Rainstorm | 1.0 / 0.9 | 0.8 / 0.7 | 1.0 / 0.8 | 0.9 / 0.8 | 0.7 / 0.7 | 0.6 / 0.5 | 0.4 / 0.3 | 0.5 / 0.5 | 1.2 / 1.1 | 1.3 / 1.2 | 1.6 / 1.6 | 1.6 / 1.1 | 11.7 / 10.2 |
| Thunder | 2.1 / 2.0 | 1.9 / 2.3 | 2.1 / 2.6 | 3.2 / 3.0 | 3.0 / 3.3 | 4.1 / 3.5 | 3.0 / 2.9 | 3.3 / 3.3 | 4.6 / 4.4 | 4.3 / 4.6 | 3.5 / 3.7 | 3.5 / 2.9 | 38.4 / 38.4 |
| Fog morning | 4.8 / 4.6 | 2.9 / 3.1 | 3.0 / 2.8 | 2.0 / 2.0 | 1.6 / 1.8 | 0.8 / 1.0 | 0.6 / 0.7 | 1.3 / 1.1 | 1.5 / 1.5 | 3.1 / 3.3 | 3.6 / 3.8 | 4.3 / 4.3 | 29.5 / 29.9 |
| Strong wind | 1.6 / 1.9 | 1.6 / 1.6 | 2.2 / 1.8 | 1.6 / 1.5 | 0.8 / 0.7 | 0.5 / 0.6 | 0.5 / 0.5 | 0.3 / 0.4 | 0.4 / 0.5 | 1.0 / 0.9 | 1.1 / 1.3 | 1.7 / 1.9 | 13.3 / 13.4 |
| Clear-ish share | 0.48 / 0.48 | 0.50 / 0.48 | 0.47 / 0.47 | 0.47 / 0.44 | 0.53 / 0.53 | 0.62 / 0.64 | 0.77 / 0.78 | 0.77 / 0.76 | 0.63 / 0.65 | 0.54 / 0.54 | 0.47 / 0.48 | 0.48 / 0.48 | |
| Overcast share | 0.35 / 0.33 | 0.32 / 0.34 | 0.34 / 0.33 | 0.26 / 0.27 | 0.21 / 0.23 | 0.18 / 0.16 | 0.11 / 0.11 | 0.14 / 0.13 | 0.25 / 0.23 | 0.31 / 0.31 | 0.38 / 0.38 | 0.38 / 0.37 | |
| p11 | 0.55 / 0.50 | 0.51 / 0.50 | 0.50 / 0.50 | 0.47 / 0.45 | 0.44 / 0.45 | 0.45 / 0.40 | 0.30 / 0.30 | 0.39 / 0.40 | 0.48 / 0.45 | 0.47 / 0.50 | 0.51 / 0.50 | 0.52 / 0.50 | |

The year, measured / table, counted the same way (seed 1; the shipped map's place is a probe run,
not asserted):

| Days a year | 38 N | 42 N | 45.5 N | Shipped map (44.16 N) |
|---|---|---|---|---|
| Rain | 71.6 / 72.1 | 78.5 / 78.9 | 86.5 / 86.2 | 86.9 / 88.1 |
| Heavy rain | 23.6 / 23.4 | 26.2 / 25.6 | 28.7 / 28.1 | 29.0 / 28.7 |
| Rainstorm | 10.7 / 9.4 | 11.7 / 10.2 | 12.1 / 11.3 | 12.3 / 11.5 |
| Thunder | 37.6 / 38.3 | 38.4 / 38.4 | 39.2 / 39.2 | 39.0 / 38.7 |
| Fog morning | 7.7 / 7.7 | 29.5 / 29.9 | 61.2 / 63.2 | 42.4 / 43.0 |
| Strong wind | 13.9 / 13.4 | 13.3 / 13.4 | 13.1 / 13.4 | 13.4 / 13.4 |

### Snow

Snowfall days (at least 1 mm of water as snow, about 1 cm of fresh snow) and snow-cover days (the
snow line at or under the height at 08:00), November to April, the mean of seeds 1–8:

| Place and height | Snowfall days | Target | Snow-cover days | Target (Capozzi et al.) |
|---|---|---|---|---|
| 38 N, 0 m | 0.19 | about none (0.3 at most) | | |
| 42 N, 0 m | 1.5 | | | |
| 42 N, 648 m | | | 10.5 (0.82×) | 12.9 ± 3.8 |
| 42 N, 815 m | | | 15.3 (0.69×) | 22.0 ± 3.0 |
| 42 N, 879 m | 7.5 (0.67×) | 11.2 ± 1.9 (Capozzi et al.) | | |
| 42 N, 1000 m | | | 22.1 (0.66×) | 33.4 ± 4.6 |
| 42 N, 1220 m | 12.6 (0.63×) | 20.0 ± 5.4 (Capozzi et al.) | | |
| 42 N, 1290 m | | | 38.5 (0.65×) | 59.4 ± 12.1 |
| 45.5 N, 0 m | 5.8 | 2–5 (the design's) | | |
| 45.5 N, 250 m | 8.0 | 2–5 below 300 m (the design's) | | |

- **The Apennines** (Capozzi et al.'s central and southern stations, about 40.5–42.8 N, 1971–2000)
  are held within half either way: their inland basins run 1–2 °C colder than a latitude and
  height model, and 1991–2020 runs 0.7–1 °C warmer than 1971–2000. The snow line's melt rate
  (`MELTING`, 1 m a game hour for each °C) was set for the cover days; at the earlier local fit's
  2.5 they were 0.4× Capozzi's.
- **The Po plain** runs a little snowy: 5.8 snowfall days a year at sea level (5.1–7.0 over the
  eight seeds; the odds 5.9) and 8.0 at 250 m (7.5–9.3), against the design's 2–5 below 300 m for
  today (5–8 in 1961–1990, 36 % less fresh snow since 1990). The cooling under falling
  precipitation that brings the Apennines to about 0.65× also snows on the plain, and a model of
  latitude and height cannot be both as cold as the inland basins and as mild as the plain. The
  accepted band is under 6 at sea level and 9 at 250 m, inside the plain's 1961–1990 range, and the
  test holds it there so it gets no worse ([Known limits](#known-limits)).
- **The far south's coasts** (38 N, sea level) see 0.19 a year, and no place sees snow at sea level
  from June to September.
- **The shipped map** (seed 1): snowfall 6.3 days a year on its floor (230 m), 10.5 at 600 m, 18.1
  at 1000 m, 29.8 at 1400 m and 44.9 on its top (1799 m); snow lies 56.7 days a year at 1100 m and
  124 at 1750 m (asserted 25–70 and 90–170).

## The climate sources record

Each source considered for the climate model, with what it gives and why it was taken or left,
following the licence rules in [the map standards](standards/map.md#data-sources-and-requests). The
README and both credit lines of `index.html` credit the accepted data sources; the papers are cited
here.

| Source | Used for | Licence or terms | Verdict |
|---|---|---|---|
| ISPRA SCIA, *valori climatici normali* 1991–2020 (<http://valori-climatici-normali.isprambiente.it/>), every station table of mean, maximum and minimum temperature and rain days | the sea-level means by latitude band (stations at or below 800 m), the monthly lapse rate (296 stations) and the daily range's fit (328 stations), the rain days by latitude band (stations at or below 500 m: 30, 113, 37, 94 and 90) | CC BY 4.0 (<https://www.isprambiente.gov.it/it/note-legali>) | accepted, credited |
| ISPRA, *I normali climatici 1991-2020 di temperatura e precipitazione in Italia*, Stato dell'Ambiente 99/2022 | Table 4: the national medians of days with 1, 5, 10, 20 and 50 mm or more over 577 stations, whose 10 and 20 mm shares the odds use; Table 3's daily ranges and frost days as cross-checks; the latitude and height regression behind ISPRA's own 1 km kriging, the same form as the game's | CC BY 4.0 (ISPRA's site; "Riproduzione autorizzata citando la fonte") | accepted, cited, credited with SCIA |
| Aeronautica Militare, *Atlante Climatico d'Italia* 1971–2000, 41 station sheets (terms: <https://www.meteoam.it/it/condizioni-utilizzo>) | from 31 lowland airports in four bands: the share of observations with cumulonimbus 1973–2000 (the thunder's months), fog days, clear-ish days (at most 4/8 at 06 and 18 UTC), observations with wind over 20 knots; the exposed capes, islands and hill stations for the wind's growth with height | free use with a mandatory credit line: "Informazioni elaborate utilizzando, tra l'altro, dati e prodotti del Servizio Meteorologico dell'Aeronautica Militare pubblicati sul sito www.meteoam.it" | accepted by the user, credited verbatim. The sheets were read from web-archive copies of `clima.meteoam.it`, which is offline; the cumulonimbus tables were read by OCR. Only band means are used: reporting cumulonimbus depends on the observer (Firenze 0.7–3.8 % against Pisa 3.3–9.4 %) |
| Jennings, Winchell, Livneh & Molotch (2018), *Nat. Commun.* 9:1148 (<https://doi.org/10.1038/s41467-018-03629-7>) | the rain–snow threshold of 1.0 °C | CC BY 4.0 | accepted, cited (a method) |
| Capozzi et al. (2025), *The Cryosphere* 19:565 (<https://tc.copernicus.org/articles/19/565/2025/>) | snowfall days and snow-cover days with height in the central and southern Apennines | CC BY 4.0 | accepted, cited (calibration targets) |
| Morgenstern, Stucke, Mayr, Zeileis & Simon (2023), *Weather Clim. Dynam.* 4:489 (<https://wcd.copernicus.org/articles/4/489/2023/>) | 20–40 thunder days a year over most of Europe's lowlands, over 60 on northern Italy's mountains (after Taszarek et al. 2019), and the seasons north and south | CC BY 4.0 | accepted, cited |
| Anderson & Klugmann (2014), *NHESS* 14:815 (<https://nhess.copernicus.org/articles/14/815/2014/>) | lightning by latitude band: 30–40 N peaks in September (20.8 % of the year's flashes), 40–50 N in July (26.3 %) | CC BY 3.0 | accepted, cited (checks the thunder's shape) |
| Feudale, Manzato & Micheletti (2013), *Adv. Sci. Res.* 10:77 (<https://asr.copernicus.org/articles/10/77/2013/>) | north-east Italy's lightning: April to November, peaking in July and August, daily at 16–17 UTC | CC BY 3.0 | accepted, cited (the afternoon storms) |
| Zandonai et al. (2025), *ARPHA Conference Abstracts* 8:e151348 (<https://doi.org/10.3897/aca.8.e151348>) | the Italian Alps' lapse rate, 4.7 K/km in winter and 6.7 in spring | CC BY 4.0 | accepted, cited (checks the lapse rate's seasons) |
| Felber, Stoeckli & Calanca (2017), *Int. J. Biometeorol.* 62:621 | the night's decay, b = 3.14 | CC BY 4.0 | accepted, cited (a method) |
| Parton & Logan (1981), *Agric. Meteorol.* 23:205 | the day's temperature curve | a published method | cited |
| ERA5 (Hersbach et al. 2023, <https://doi.org/10.24381/cds.adbb2d47>) through the Open-Meteo archive, daily precipitation and mean temperature 1991–2020 at 10 lowland cells (Milano, Bologna, Firenze, Pescara, Roma, Bari, Napoli, Cagliari, Palermo, Catania) | a cross-check of the persistence design values: p11 0.28–0.52 by month (the 10 cells' mean), the air mass's lag-one correlation 0.79–0.87 and spread 2.2–2.7 °C (a cell's; a station's runs 10–20 % more), wet days 0.3–0.5 °C warmer than normal from November to January and 1.5–2.2 °C colder from May to August. Each cell's wet threshold was first matched to SCIA's rain days: at 1 mm ERA5 counts 15–40 % more wet days than the stations, up to 3 times more in the southern summer (Napoli in July: 4.0 against 1.2) | CC BY 4.0 | a cross-check only: the game ships rounded design values (`WET_PERSISTENCE`, `AIR_MASS`, `WET_OFFSET`), none of its numbers, so no Open-Meteo or Copernicus credit is needed |
| Open-Meteo geocoding (GeoNames) | the latitudes of 732 of SCIA's 804 stations for the fits, from their names (town centres, a few km off) | CC BY 4.0 | an intermediate step: no coordinates ship |
| Caloiero & Coscarelli, Calabria's dry spells 1951–2006 | 6–8-day dry spells on the Tyrrhenian side, over 8 on the Ionian, against the chain's | licence not checked | facts only: a cross-check |
| Pifferetti, Cat Berro, Mercalli et al., *Nimbus*; press summaries of the Aeronautica Militare's 1961–1990 snow days | the Po plain's 5–8 snowfall days a year in 1961–1990 and 36 % less fresh snow in 1990–2017: the design's lowland band | all rights reserved | facts only: no table reproduced |
| Taszarek et al. (2019), *J. Climate* 32:1813 | the 20–40 thunder days | AMS copyright | a fact, cited through Morgenstern et al. |
| Spinoni, Brunetti, Maugeri & Simolo (2012), *Adv. Sci. Res.* 8:19 | considered for relative sunshine | CC BY 3.0 | not used: it gives radiation only |
| DWD lightning climatology (LINET) | considered for thunder days | CC BY 4.0 | not used: Germany and central Europe, and counts of strokes, not days |
| NOAA NCEI Global Surface Summary of the Day (GSOD) | thunder days, snow shares and the wind's growth with height were measured from it in research | no named licence; its non-US records are the Aeronautica Militare's stations through the WMO exchange, and NCEI has flagged non-US GSOD data for limits on commercial use | rejected by the user: none of its numbers ship |
| ECA&D and E-OBS | considered for station series | non-commercial | rejected |
| Servizio Idrologico Regionale Toscana (SIR) gauges | considered for rain gauges | CC BY-SA 4.0 | not used: share-alike; SCIA's normals, which take in SIR's stations, are used instead |
| it.wikipedia station pages | an index to the SCIA and Aeronautica Militare tables | CC BY-SA 4.0 | not a source: they hold copy errors (Sarzana-Luni's 1971–2000 precipitation row repeats Pisa's), so every number was read from the primary source |

The 31 lowland airports, by band: north of 44.2 N Bolzano, Udine Rivolto, Torino Caselle, Novara
Cameri, Bergamo Orio al Serio, Milano Linate, Piacenza San Damiano, Brescia Ghedi, Verona
Villafranca, Vicenza, Venezia Tessera and Bologna; 42–44.2 N Sarzana-Luni, Pisa San Giusto,
Firenze Peretola, Arezzo, Perugia Sant'Egidio, Falconara and Grosseto; 40–42 N Roma Ciampino,
Pratica di Mare, Bari Palese, Gioia del Colle, Brindisi, Lecce Galatina and Alghero; south of 40 N
Crotone, Palermo Boccadifalco, Reggio Calabria, Trapani Birgi and Cagliari Elmas. The exposed sites
are Capo Mele, Ponza, Pantelleria and Cozzo Spadaro, the hill stations Dobbiaco, Tarvisio,
Frontone, Campobasso, Potenza and Enna.

**The earlier local model.** The first version of this weather fitted the Lucido valley alone:
temperature from SCIA's Pontremoli depuratore and the Aeronautica Militare's Passo della Cisa and
Monte Cimone, wet days from Pontremoli depuratore and Gallicano, the orographic line from 11 SCIA
gauges, thunder from Sarzana-Luni's cumulonimbus, fog between Sarzana-Luni and Pisa, sunshine from
Pisa San Giusto (1961–1990), and facts from Piccini et al. (1999, the Apuan Alps' rainfall) and
Regione Toscana's landscape plan (the Val di Magra's fog). Giannecchini (2006, *NHESS* 6:357,
CC BY-NC-SA) was rejected as non-commercial. The national model replaced it so that any Italian map
works; against Pontremoli depuratore's 1991–2020 means it runs 0.7–1.0 °C colder in December and
January and 1.0–1.2 °C warmer from June to August.

The sun and moon are checked against JPL Horizons and the USNO API, reference values the tests hold;
the NOAA Solar Calculator is an algorithm, not data.

## The ground: wetness, snow and meltwater

The `Weather` resource keeps two ground values for the whole map, `wet` and `snowLine`, and
`groundAt` (`src/sim/sky/local.ts`) turns them into what a wheel or a foot meets at a point: how wet
and how snow-covered the ground is there, each 0 to 1.

- **Wetting.** Rain reaching the ground wets it with a time constant of 10 game minutes from 2 mm/h,
  proportionally slower in less (`WETTING`, `PRECIP_FULL`): settled rain on dry ground gives 0.63
  after 10 game minutes and 0.95 after 30. One value serves the whole map, because a regime's rain
  falls on all of it.
- **Drying.** The time constant runs from 6 game hours (cold, grey, calm) down to 2 (warm, sunny,
  windy): 6 h ÷ (1 + 0.08 × the °C on the map's floor + the sun's share + 0.15 × the wind in m/s),
  the sun's share being (1 − cloud) × the sun's elevation over 30°, at most 1. After rain on the
  shipped map, with the day's air mass at the normal, a clear October noon leaves 0.61, 0.37 and
  0.22 after one, two and three game hours (the fastest, 2 h); a clear January night 0.79, 0.64
  and 0.52 (about 4.2 h). Nothing dries while 0.05 mm/h or more falls (`DRIZZLE`), less while it
  drizzles.
- **Drizzle.** Where wetting and drying balance the ground settles: overcast's 0.03 mm/h damps dry
  roads to 0.08 after a game hour and 0.27–0.30 after six, toward a balance of 0.37 (22 October,
  08:00) to 0.41 (15 January, noon).
- **The snow line** is the lowest ground with snow cover (`NO_SNOW`, 6000 m, when none lies). While
  more than drizzle falls and the freezing level lies under the line, snow settles from the map's
  top (1799 m on the shipped map) down toward the freezing level at 150 m per game hour for each
  mm/h, × `orographic` at the line (`SNOWING`). Otherwise it rises by a degree-day melt of 1 m per
  game hour for each °C above 0 at the line, twice that under rain (`MELTING`), and once above the
  map's top no snow is left. It never falls below the map's lowest ground less 50 m (97 m on the
  shipped map), so all the map can lie white. The rates are design values fitted to Capozzi et al.'s
  snow-cover days ([Snow](#snow)).
- **The ragged edge.** Snow covers ground above the line's edge, fading in over ±10 m of height
  (`FEATHER`). The edge wanders by two octaves of value noise, ±45 m over 80 m cells plus ±15 m over
  20 m cells (`EDGE`), locked to the world and the same every game. Its lattice hash uses only
  32-bit integer arithmetic, so the renderer's shader draws the same edge (within 2 mm on the GPU)
  and the white line on screen is where the grip drops.
- **Meltwater.** Below the edge, a band 100 m deep (`MELT_BAND`) runs wet with meltwater where the
  air at that height is above 0 °C, fully from 1 °C (`MELT_FULL`), wetter toward the snow. Snowmelt
  wets only that band, never the map's `wet` (the lead's call): sunny valley roads 1000 m under the
  snow stay dry. On a clear 15 January on the shipped map, from the season's 1489 m snow line with
  the day's air mass at the normal, the map's `wet` stays 0 all day; by 11:00 (the line at 1.3 °C)
  the band wets 2.9 % of the map's 21,776 road vertices, the lowest at 1367 m, while the line climbs
  to 1517 m by 18:00. In a frost the band stays dry.
- **Where it falls short.** One wetness and one snow line serve the whole map, so tunnels and
  bridges get wet and white too.
- **The rivers** take the same precipitation: it fills their catchments and they rise and fall
  with it ([water.md](water.md#the-rivers-flow)).

`conditionsAt(t, weather, x, y, z)` gathers it all for one point: the air's temperature, the rain
and the snow falling (mm/h of water, the precipitation at sea level × `orographic(z)` split by
`snowShare`), the ground's wetness and snow cover, and the fog.

## Fog

`fogLayers` gives two layers over the map, the low ground's fog up to `valleyTop` at
`valleyDensity` and the cloud down to `cloudBase` at `cloudDensity`, both counted from the map's
floor; `fogAt(z)` blends each in over 50 m of height.

- **Radiation fog** fills the low ground up to 150 m over the floor (`FOG_TOP`) on the mornings the
  day's plan brings it ([The day plan](#the-day-plan)), while the sky stays clear (cloud under 0.25,
  gone by 0.55) and the air calm (wind under 2 m/s, gone by 3.5): it forms from 01:00, is thickest
  from 05:00 and burns off from 09:00 to 11:00. Which mornings bring it follows the weather seed,
  so another game has fog on other days. On a fog morning it stands 23 m over the floor at density
  0.16 at 02:00, 75 m at 0.5 at 03:00, 150 m at 1 from 05:00 to 09:00 (380 m on the shipped map),
  75 m at 0.5 at 10:00, and is gone at 11:00.
- **The fog regime** is a low stratus: the low ground's fog reaches 450 × fog m over the floor,
  405 m at its 0.9.
- **The cloud base**: the floor + 2400 m − 1500 × cloud + 250 × storm − 700 × the regime's mist, the
  mist being `smooth(0.3, 0.9, fog)` (`BASE`). Inside the cloud the fog reaches 0.6 of full
  thickness under a full cover (`CLOUD_FOG`), all of it only in the fog regime's mist. These design
  values keep the low ground out of the cloud in rain and in a storm, and hills 1500 m over the
  floor in it under any full cover (`weather.test.ts`). Settled:

  | Regime | Cloud base over the floor (m) | On the shipped map (m) | Density |
  |---|---|---|---|
  | clear | 2325 | 2555 | 0 |
  | fair | 1950 | 2180 | 0 |
  | cloudy | 1425 | 1655 | 0.19 |
  | overcast | 975 | 1205 | 0.60 |
  | fog | 350 | 580 | 1.00 |
  | rain | 900 | 1130 | 0.60 |
  | storm | 1150 | 1380 | 0.60 |
  | windy | 2100 | 2330 | 0 |
  | snow | 848 | 1078 | 0.63 |

## Wind

`Weather` holds the wind on the map's low ground at 10 m (`wind`, m/s), the way the air moves
(`windAngle`, rad counter-clockwise from east) and the gust factor (`gust`, peak over mean).
`windAt(weather, z)` gives the air's velocity at a height, stronger on exposed ground: ×1 on the
map's floor, rising in a straight line to ×2.5 at 1550 m over it (`WIND_UP`); on the shipped map
×1.36 at 600 m and ×1.78 at 1040 m. That is a national design value, ×2–2.5 on crests: the
Aeronautica Militare's exposed capes, islands and hill stations see a wind over 20 knots 2.7–3.9
times as often as its lowland airports, by month. The earlier local fit took the same ×2.5 from
Passo della Cisa (about 6.1 m/s at 1048 m) against Sarzana-Luni (3.0 m/s on the coast). Over 30
simulated years (seeds 1–4) the low-ground wind averages 2.5 m/s in October and 2.3–2.7 by month.
Text for people (the dev menu) names where the wind blows from, the opposite of `windAngle`.

## Lightning and the storm cell

A thunderstorm is a cell drifting over the map that throws lightning around itself, in real time:
`stormStep` (`weather.ts`) runs every step whatever the clock's rate, so a stopped clock still
storms.

- **No storm** under an activity of 0.01: no lightning, and the cell is sent 100 km off, so the next
  storm starts upwind again.
- **The cell** starts 6 km upwind of the player, up to 1 km to either side, and drifts downwind at
  90 m per real second: it comes closer, passes overhead and moves away within about 2.2 real
  minutes (12 km), and a new cell starts upwind once it is 6 km past the player or 9 km off while
  the storm lasts (a thunderstorm rains 1–3 game hours, 2–4 for a rainstorm: 60–240 real seconds
  at the normal clock).
- **Flashes** come at random, storm × 0.25 a real second (a draw each step). 40 % of them are ground
  strikes (`bolt`); the rest flash in the cloud and keep their place, on the map or off it. Flashes
  scatter around the cell (Gaussian, σ 2 km); a bolt drawn off the map is drawn again up to 4 times,
  then dropped, so bolts strike only the map and never its edge. With the cell within 4 km of the
  player, a quarter of the bolts strike in the strip the camera sees, up to 40 m to either side of
  the player and 60–600 m toward the camera (the driving view's, while the player drives:
  `restAxes` in `src/sim/view.ts`), where a vertical bolt crosses the whole screen.
- **Measured on the shipped map**, a settled storm, 8 seeds × 3 real minutes at each spot: Gragnola
  321 flashes, 105 of them bolts (33 %); Monzone 343 and 127 (37 %); Equi Terme 345 and 131 (38 %),
  so 0.22–0.24 flashes a real second once the bolts off the map are dropped. Near the map's edge
  more of the cloud flashes lie off the map: 78 % at Gragnola, 50 % at Monzone, 29 % at Equi. The
  cell is placed by the player, not the map, so a smaller map (Cesena's is 4 × 4 km) drops more
  bolts off its edges.
- **The event.** Each flash is a `Lightning` event: where, whether it is a bolt, its `power`
  (0.3–1), a `seed` for the bolt's shape and the thunder, and the step. The renderer draws it
  ([What it looks like](#what-it-looks-like)) and the audio thunders it
  ([How it sounds](#how-it-sounds)). It needs a player: without one the cell stands still and
  nothing flashes.
- The cell's and the lightning's draws come from `WeatherRng`, the weather's own saved random
  stream, so the weather never changes traffic, people, animals or parking; the day plan draws from
  the weather seed and the day alone, so a storm never changes the days that follow.

## Grip

Wet ground and snow cover take grip from the tyres, in the saved simulation, and the handling's
`weatherGrip` knob scales how much. The tables are in [gameplay.md](gameplay.md#the-body).

- **Per wheel.** `VehiclePhysics` asks `groundAt` for the wet and the snow at each wheel's contact,
  with the air worked out once a step (`airAt`) for the meltwater. Each surface's grip goes from dry
  toward its wet grip by the wetness, then toward packed snow (peak 0.3) by the snow cover, the
  difference from dry × `weatherGrip` (`weathered`, `src/sim/tyres.ts`).
- **What it costs.** At 1 (Simulation) a wet road keeps 0.72 of its dry peak and packed snow 0.27: a
  Panda braking from 50 km/h stops in 10.8 m dry, 14.2 m wet and 33.2 m on snow. Balanced takes 0.6
  of the loss, Arcade 0.3, and 0 drives as on a dry day.
- **Steering.** The lock at speed shrinks with the grip the wheels have left, so a held key on snow
  does not ask the tyres for more than they hold; braking, the handbrake or more speed in a bend
  still slide the car. The user approved this.
- **Traffic** drives slower by the square root of the grip left and looks and keeps further ahead
  ([gameplay.md](gameplay.md#traffic-ai)). People on foot are not slowed.
- **`Skid`** carries `snow`, the snow cover at that wheel, so the renderer lays slush ruts and white
  spray on snow.

## The HUD and the dev menu

The HUD shows the time and the weather where the player stands; the dev-only debug menu sets them
and shows the odds behind them. The layout and the store are in
[architecture.md](architecture.md#hud).

- **The clock**: Rome's wall-clock time as a 24-hour "HH:MM", the minutes cut as a clock cuts them
  (`clockText`, `src/hud/clock.ts`), top centre, or under the score on screens 600 px wide or less.
- **The readout**: a word and the air's temperature where the player stands, "Rain · 9 °C"
  (`weatherText`): `conditionsAt` at the player's ground height, rounded to the whole degree, and
  the word from `describeWeather` (`src/sim/sky/readout.ts`), what a person standing there sees
  rather than the regime the weather moves toward. It takes the first that applies:
  1. Storm: storm activity 0.3 or more and 0.5 mm/h or more falling.
  2. Snow, Sleet or Rain, from 0.2 mm/h falling: Snow when 70 % of it or more is snow, Sleet over
     30 %, else Rain.
  3. Fog: fog 0.5 or more around the player.
  4. Drizzle (Snow when it is snow), from 0.02 mm/h.
  5. Windy: a low-ground wind of 7 m/s or more.
  6. The cover: Clear under 0.2, Fair under 0.5, Cloudy under 0.85, else Overcast.

  On `DEFAULT_START`'s 22 October a new game at the spawn reads "08:00" and "Clear · 8 °C"
  (8.3 °C), before the anomaly eases toward the day's air mass. The words are English
  (`lang="en"`), and the readout is no live region, so screen readers are not told every minute.
- **The debug menu** (P, dev builds) has a Time and a Weather area above the handling.
  - Time: the rate (Stopped, Normal at 1 min/s, ×10, ×60 game seconds a step), the time of day, the
    date, sunrise and sunset buttons from `sunTimes`, and the sun and the moon over `place()`.
  - Weather: Auto (left to the day's plan: "each day is drawn from the month's odds with the
    weather seed, and its plan sets the regime hour by hour") and one button per regime; "Settle
    now", which in Auto sends one request, `{ regime: null, settle: true }`, handing the weather
    back to the day's plan and settling on its regime; and readouts of the regime ("Cloudy, next
    change in 4 h 14 min": until the plan takes over, then until its next change that day, else
    midnight; "Rain, held" when forced), the air, the ground, the snow line, the wind, the sky and
    the weather seed, the 32-bit state in hex (`?seed=1` reads 0x9e3779b8).
  - Odds (*month*): Rome's calendar month, the one a day's plan belongs to, with a line naming the
    map's latitude, then one row per `DayOdds` field from `oddsAt` at the map's latitude, snowfall
    at the player's ground height (the map's floor before there is a player): Rain "…, 1 mm or
    more", Heavy rain "…, 10 mm or more", Rainstorm "…, 20 mm or more", Thunder, Snowfall "… at
    209 m", Fog "…, on the low ground", Clear-ish "…, 4/8 cloud or less", Overcast "…, rain days
    included", Windy "…, over 20 knots". A chance reads whole from 10 %, to a tenth under it,
    "< 0.1 %" when above 0 but too small to show, "0 %" only at 0. On 23 October 2026 at the spawn
    (209 m) the rows read 27 %, 10 %, 4.6 %, 11 %, < 0.1 %, 15 %, 52 %, 35 % and 2.8 %; on
    15 January 23 %, 6.4 %, 2.5 %, 3.0 %, 6.8 %, 29 %, 45 %, 31 % and 6.1 %.

  The time and the weather set there are not kept across loads (the handling knobs are). In dev,
  `gta.sky` is the same store, for scripts.

## What it looks like

The renderer reads the clock, the weather and the lightning each frame and draws them with the same
sim functions; how the sky host, the materials and the post pass fit in the frame is in
[architecture.md](architecture.md#rendering), the settled look it keeps in
[render.md](standards/render.md).

- **Light.** One key light, the sun, or the moon once the sun is under −4° (fully by −8°, × its lit
  fraction^1.5), so the number of lights and every shader stay the same (`src/render/sky/light.ts`).
  A clear sky with the sun 50.4° up gives exactly the game's settled daytime look; a lower sun is
  redder and weaker, and the sky's light follows the sun's elevation from noon through the golden
  hour, the blue hour and the night. Shadows are cast from at least 20° up (a lower light breaks a
  shadow's edge into dashes on walls), and the light's aim moves in 0.75° steps, every 3–4 real
  seconds, so shadow edges do not crawl.
- **Night** stays readable: the exposure adapts part of the way, from 1 to at most 4, and dark
  texels move toward a scotopic blue (from the sun 3° up to 9° under), while lamps, lit windows and
  what they light keep their colour.
- **Weather.** An overcast sky dims and greys the light and casts no shadows; rain greys and dims it
  further, a thunderstorm darkens it more and turns the lamps on. Clouds cast shadows straight down,
  locked to the world and drifting at 2.5 × the wind; the shaded share of the ground equals the
  cloud cover, so a cloudy sky keeps sunny gaps. At night the weather dims the sky's light only 0.15
  as much, as low cloud glows with the valley's lights.
- **Fog** is drawn in the post pass from `fogLayers`, at most 0.6 at the focus (the player and the
  road stay readable) up to 0.92 for ground 400 m deeper, and thinner around the player. From a
  slope the low ground's fog reads as a white sea; it is lit mostly by the sky, so it turns warm
  only with the sun low (blue/red 0.70 with the sun 6° up, 0.92 at 10.7°). Rain and snow add a haze.
- **The ground.** Snow lies above the sim's ragged edge on faces flatter than the bare-rock cliffs,
  in a clumpy, world-locked stipple, with roads keeping 0.6 of it. Wet ground darkens (up to 0.4 of
  its albedo, walls less), flat roads gather puddles (about 11 % of them fully wet) that mirror the
  sky, and rain rings the rivers. Wetness and meltwater follow `groundAt`. Trees sway by whole
  texels from 2 m/s of wind, at most 0.12 m.
- **Rain and snow** fall as 1-texel streaks and 1–2-texel flakes over the whole view, slanted by the
  wind: 0.6 streaks per m² of the view at 10 mm/h, growing as the rate^0.6, and 0.7 flakes at 1 mm/h
  of water, as the rate^0.5, up to 12,288 streaks and 36,864 flakes; rain falls at 8 m/s and snow at
  1 m/s. Over the widest 1080p view they keep thickening past the heaviest the weather sends on
  high ground (the plan's 15 mm/h at sea level, ×2 from about 1670 m: 30 mm/h of water), rain to
  about 57 mm/h at 16:9 and 38 at 21:9, snow to about 54 and 33.
- **Night lights.** The lamps come on as the light falls from 0.125 to 0.08 of the settled noon's,
  about ten minutes after sunset, and in storms and thick fog. A home's windows are half lit, by a
  hash per window (21,201 panes over the map); sheds, garages and barns keep their shutters closed,
  and the panes are not drawn by day, so the daytime look is unchanged. 492 street lamps hang as
  lanterns on house walls, as in the villages here, where no lamp data exists: along tertiary,
  unclassified, residential and service roads among at least 4 buildings within 40 m, every 28 m or
  more and at least 18 m apart, 4.5 m up (lower under low eaves, never under 3 m), between two
  windows. 24 more stand on poles along the station platforms, every 18 m, their lanterns 4 m over
  the platform. Traffic and the player's car light their lamps, parked cars stay dark; 4 headlight
  beams (the player's car or train and the 3 nearest lit traffic cars or AI trains) and 8 lamp
  pools (the nearest street lamps) light the ground, fading over 0.35 s as they move between cars,
  trains and lamps.
- **Lightning.** A bolt is a jagged, seeded channel with branches that flickers in 2–4 strokes
  30–120 ms apart. The scene flashes once per flash, a smooth pulse (a 50 ms rise, then a 0.25 s
  decay), fainter with distance and at 0.6 for a flash in the cloud; the strokes move it by ±5 % at
  most, and a new pulse needs 0.4 s since the last (2.5 a second, under WCAG 2.3.1's three). Under
  `prefers-reduced-motion` the bolt does not flicker and the flash is halved. At night a near flash
  lights the scene to about daylight for a quarter of a second.

## How it sounds

The audio director reads the clock, the weather at the ears and the lightning; the sounds and their
levels are in [audio.md](audio.md).

- **Rain** is a bed outside from 0.1 mm/h, louder as it falls harder; inside a car it is the bed
  through the cabin plus the drumming on the roof.
- **Thunder** waits until its sound reaches the ears, at 340.4 m/s: a crack and a boom near, a low
  rumble far. At most two roll at once.
- **Wind** blows as much harder as the weather's low-ground wind (tuned on 3 m/s, a cloudy
  day's), in its gusts, and rises with the ears' height over the map's floor.
- **Birds** sing by the sun, a dawn chorus before sunrise and a last round at dusk, and fall quiet
  in rain; the tawny owl calls once it is dark. **Crickets** sing where the air at the ears is 10 °C
  or warmer and dry.
- **Bells** strike the game clock's hours, hours only, from 07:00 to 21:00: silent from 22:00 to
  07:00, as Tuscany's parishes keep the night.
- **Snow** hushes the valley, and steps crunch on it.
- **The night** is quieter: the stillest background falls from 35 dB(A) by day to 28 at night.

## Tuning

Where each part of the weather is set:

| Where | What |
|---|---|
| `src/sim/sky/place.ts` | `REFERENCE_PLACE`, the place without a map; how the floor and the slope are worked out (`placeFrom`) |
| `src/sim/sky/climate.ts` | the temperature normals (`SEA_LEVEL`, `LAPSE`, `RANGE`, `RANGE_MIN`), the sky tables shared with the odds (`RAIN_DAYS`, `CLEAR_SHARE`, `CLEAR_OF_CLEARISH`, `OVERCAST_DRY`), the air mass (`AIR_MASS`, `WET_OFFSET`), the cooling under rain (`COOLING`), the day's cycle (`WARMEST`, `NIGHT_DECAY`, `rangeShare`, `usualShare`), `snowShare`, `NO_SNOW`, `orographic` |
| `src/sim/sky/odds.ts` | `HEAVY_SHARE`, `RAINSTORM_SHARE`, `THUNDER_YEAR`, `THUNDER_SHAPE`, `FOG_DAYS`, `STRONG_WIND`, `WINDY_DAY`, `WET_PERSISTENCE`, `COLD_OUTBREAK`, `RAIN_SWING` |
| `src/sim/sky/plan.ts` | the day plan: `CALM_START`, `LEAD`, `CONVECTIVE`, `AMOUNT`, `HOURS`, `HEAVIEST`, `RUNS_ON`, `WINDY_HOURS`, `FOG_FORMS`, `STRATUS` |
| `src/sim/sky/regimes.ts` | `REGIME_SPECS`: each regime's targets; `RAINS_FROM` |
| `src/sim/sky/weather.ts` | `EASE`, `TOWARD`, `BREEZE_TURNS`; wetting and drying (`WETTING`, `PRECIP_FULL`, `DRYING`, `DRIZZLE`); the snow line (`SNOWING`, `MELTING`); the storm (`UPWIND`, `DRIFT`, `FLASHES`, `BOLTS`, `SCATTER`, `OVERHEAD`, `IN_VIEW`, `STRIP`, `REDRAWS`) |
| `src/sim/sky/local.ts` | the snow edge (`EDGE`, `FEATHER`), the meltwater band (`MELT_BAND`, `MELT_FULL`), the fog (`FOG_TOP`, `BASE`, `CLOUD_FOG`), the wind's growth over the floor (`WIND_UP`) |
| `src/sim/sky/readout.ts` | the readout's thresholds |
| `src/sim/tyres.ts`, `src/sim/handling.ts` | wet and snow grip (`WET`, `SNOW`), the `weatherGrip` knob and its presets |
| `src/render/sky/` | the look: `light.ts` (dimming, lamps, night), `post.ts` (fog, grades), `surface.ts` (snow, wet, clouds, sway), `precipitation.ts`, `lightning.ts`, `lamps.ts`, `night-lights.ts` |
| `src/audio/director/sky.ts` | how the time of day and the weather move the sounds |

## Tests

The simulation's weather tests, 60 of them, run in about 5.6 s, most of it the 30-year calibration
(5.5 s):

```sh
node --test src/sim/sky/__tests__/*.test.ts src/sim/__tests__/sky.test.ts
```

- `calendar.test.ts` and `astro.test.ts`: the calendar, Rome's summer time, and the sun and moon
  against JPL Horizons and USNO at the reference site.
- `climate.test.ts`: the normals give the national tables back, the day's cycle (coldest at
  sunrise, warmest at 14:30, a clear calm day wider than an overcast one, no jump at night), the
  phase rule, the freezing level, `orographic` and the cooling under rain.
- `odds.test.ts`: the table at 42 N, thunder at 40 a year under the rain days with the north's
  summer peak and the south's autumn one, snowfall growing with height and northward and never at
  sea level in summer, and Rome's calendar month.
- `plan.test.ts`: the calm start, the same seed giving the same days, a wet and a dry day's shape,
  rain at any hour and through midnight, clock jumps, the first day, the summer-time days, and 300
  years at three latitudes against the table.
- `calibration.test.ts`: the weather as it falls against the table, the daily range, and snow
  ([Calibration](#calibration)).
- `weather.test.ts`: the regimes' words and targets, the requests, easing, the stopped clock's new
  day, wetting and drying, drizzle, the snow line and meltwater, fog, the cloud bases, wind, the
  storm cell and lightning, the readout, and the map's place.
- `mapfree.test.ts`: the modules the schema and the HUD import decode no map, and the place once
  the map is decoded.
- `src/sim/__tests__/sky.test.ts`: the clock and the weather in a runtime, requests applied before
  the first update, a forced storm's lightning, the weather seed kept and replayed, the seed alone
  planning the days, `WeatherRng` kept apart from `Rng`, and a longer braking distance in the rain.
- Elsewhere: `handling.test.ts` (wet and snow braking, the lock following grip), `walls.test.ts`
  (traffic on a wet road), `index.test.ts` (determinism and saves at rate 600 with a forced storm),
  the render's `src/render/sky/__tests__/*.test.ts` (the sun and moon over the loaded map's place,
  the melt band's line against `celsiusAt`, the buffers at 30 mm/h), the audio's
  `director/__tests__/weather.test.ts` (the wind's height law from the map's floor, the usual wind
  against the weather's own), and the HUD's `clock.test.ts`, `sky.test.ts` (Auto heads for and
  settles on the day's plan), `debug-sky.test.ts` (the odds and seed text, the odds readout equal
  to `oddsAt`, the regime's countdown) and `title.test.ts`.

`pnpm check` runs them all.

## Known limits

What the model leaves out, or matches only roughly:

- **Same latitude, same climate.** The place enters only through its latitude and heights, so two
  maps at one latitude share a climate apart from height: Lunigiana (44.16 N) and Cesena (44.14 N,
  PR #37) get the same odds. The Po plain and the Adriatic's colder winters, their roughly halved
  rain, much more fog and the Bora are lost: SCIA's January mean is 3.3 °C at Bologna Borgo
  Panigale (49 m) and 4.0 °C at Cervia (10 m), against the model's 5.3 and 5.8. Tyrrhenian valleys
  run warmer in winter (Pontremoli depuratore, 290 m: 5.5 °C against 4.5), inland Apennine basins
  1–2 °C colder and the Ligurian Riviera up to 5 °C warmer than the national fit.
- **Fog is set by the place more than the latitude.** The Po plain has 46–91 fog days a year
  (Milano Linate 91), breezy coasts 0.4–12 (Palermo 0.4), inland basins and plateaus 30–72 (Gioia
  del Colle 72). The table interpolates lowland airports by latitude, so a northern coast gets the
  plain's fog and a southern basin too little. The counts are 1971–2000, and fog has fallen since.
- **Strong wind** is one national lowland row: exposed coasts, capes and the Bora's gulf blow more
  often than the game's 13 days a year.
- **Snow.** Mountain snowfall is about 0.65 of Capozzi et al.'s at 42 N and snow cover 0.65–0.82;
  wet days do not rise with height, as one plan serves the whole map. The Po plain's lowland
  snowfall (5.8 a year at sea level, 8.0 at 250 m) is above the design's 2–5 and awaits the user's
  call; a lever that meets both is a lapse rate steepening toward the moist-adiabatic 6 K/km while
  it rains, which would break the one-rate-a-month fit.
- **The day runs a little cold**: nothing makes up the cooling under rain, so the air on the low
  ground averages 0.2 °C under the normal.
- **One event a day.** A wet day's rain falls in one window inside its day (steady rain may run on
  through midnight; thunderstorms never do), and a frontal day stays overcast and drizzly after its
  rain until the next day's plan.
- **The tables step by calendar month**: the odds change on the 1st, while the temperature is
  interpolated between mid-months.
- **Thunder days** are a design value (40 a year): no licensed source counts them. Where they would
  outnumber the rain days they are capped, so a year gets 38–39. The Aeronautica Militare's
  cumulonimbus shares depend on the observer, so only band means are used.
- **Monthly rain amounts** are not SCIA's: a day's total comes from its class (national design
  values the same at every latitude and month), so a month's total follows its rain days and
  classes.
- **One wetness and one snow line** for the whole map: tunnels and bridges get wet and white too.
- **Storms on small maps.** The storm cell is placed by the player, so a small map drops more bolts
  off its edges; the bolt rates above are the shipped map's.
- **Lightning needs a player**; without one the cell does not move and nothing flashes.
- **The readout's temperature** is at the ground under the player: on a bridge that is the ground
  below, a few metres off.
- **The readout's words are English**, beside the HUD's Italian score labels.
