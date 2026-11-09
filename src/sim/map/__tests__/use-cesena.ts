// Picks Cesena's built map for the test that imports this module on its first line: its global file
// and its tiles, read from disk beside it (src/sim/map/cesena.bin).

import { MAP_URL, useDiskMap } from "../source.ts"

useDiskMap(new URL("cesena.bin", MAP_URL))
