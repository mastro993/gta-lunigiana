/**
 * Browser entry: turns the title card into a loading screen, downloads the map's global file with
 * byte progress (gunzipping it as it arrives), hands it to the sim, then downloads the tiles round
 * the start in parallel the same way, hands them over too, and imports the game a few modules at a
 * time so the bar moves between the heavy ones. `main.ts` builds the rest and opens the card once
 * the first frame is drawn; from then on `src/stream.ts` brings the tiles in as the player moves.
 * Any failure stays on the card with a retry.
 *
 * @module boot
 */
import { loadFailed, loading, step } from "./hud/title.ts"
import { mapForSearch } from "./maps.ts"
import { provideMap } from "./sim/map/packed.ts"
import { fetchFile, gunzipped, NEAR } from "./stream.ts"

/** Shares of the bar the global file's download and the start tiles' fill; the build steps share the rest. */
const GLOBAL = 0.36
const DOWNLOAD = 0.6
const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

/**
 * The files at `urls`, downloaded in parallel and gunzipped, moving the bar from `from` to `to` by
 * the bytes received against their summed Content-Length under step `name` (only bytes when a host
 * sends none; when it compresses the files again, the two differ slightly: clamped).
 */
const download = async (
  urls: ReadonlyArray<URL>,
  name: string,
  from: number,
  to: number,
): Promise<Array<Uint8Array>> => {
  const responses = await Promise.all(urls.map((url) => fetchFile(url)))
  const lengths = responses.map((response) => Number(response.headers.get("content-length") ?? 0))
  const total = lengths.every((length) => length > 0) ? lengths.reduce((a, b) => a + b, 0) : 0
  let received = 0
  const count = (bytes: number) => {
    received += bytes
    const detail =
      total > 0 ? `${mb(Math.min(received, total))} / ${mb(total)} MB` : `${mb(received)} MB`
    loading(
      document,
      name,
      total > 0 ? from + (to - from) * Math.min(1, received / total) : from,
      detail,
    )
  }
  return Promise.all(responses.map((response) => gunzipped(response, count)))
}

try {
  const map = mapForSearch(location.search)
  document.title = `Grand Theft Auto: ${map.name}`
  document.getElementById("title-place")!.textContent = map.name
  document.getElementById("title-subtitle")!.textContent = map.subtitle
  if (map.id === "cesena")
    for (const credit of document.querySelectorAll(".credits, .fine"))
      credit.textContent =
        "Map data © OpenStreetMap contributors (ODbL) · Terrain: Regione Emilia-Romagna, DTM 5x5 - ultima edizione (CC BY 4.0) · Dati climatici: ISPRA SCIA (CC BY 4.0) · Informazioni elaborate utilizzando, tra l'altro, dati e prodotti del Servizio Meteorologico dell'Aeronautica Militare pubblicati sul sito www.meteoam.it"
  for (const link of document.querySelectorAll<HTMLAnchorElement>("#map-choice a")) {
    const url = new URL(link.href)
    const seed = new URLSearchParams(location.search).get("seed")
    if (seed !== null) url.searchParams.set("seed", seed)
    link.href = url.href
    if (url.searchParams.get("map") === map.id) link.setAttribute("aria-current", "page")
  }
  loading(document, "Downloading map", 0)
  const [global] = await download([map.url], "Downloading map", 0, GLOBAL)
  provideMap(global!)
  // Each import evaluates only what the earlier ones left: the global map, then the tiles round the
  // start (every one the first steps and the first view read), then the traffic lanes every vehicle
  // model can use, then the rest of the game.
  await step(document, "Decoding map", GLOBAL)
  const { MAP } = await import("./sim/map/index.ts")
  const { provideTile, tilesOver } = await import("./sim/map/tiles.ts")
  const { x, y } = MAP.spawns.player
  const start = tilesOver(x - NEAR, y - NEAR, x + NEAR, y + NEAR)
  const tiles = await download(start.map(map.tileUrl), "Downloading terrain", GLOBAL, DOWNLOAD)
  await step(document, "Decoding terrain", DOWNLOAD)
  for (const tile of tiles) provideTile(tile)
  await step(document, "Planning traffic", 0.68)
  await import("./sim/route.ts")
  await step(document, "Loading the game", 0.74)
  await import("./main.ts")
} catch (error) {
  loadFailed(document, error)
}
