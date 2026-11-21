// HUD district discs (`districtAt` in src/sim/map/index.ts): Monzone's named clusters, placed by
// hand, every OSM town, village and hamlet elsewhere, centred on its place node with a radius fitted to
// the buildings nearest it, and the mountains' and the coast's landmarks, placed by hand; those two
// lists where the region's inputs reach.
import type { District } from "../sim/map/index.ts"
import type { BuildingF } from "./features.ts"
import { centroid, r1, toLocal } from "./geometry.ts"
import type { Osm } from "./osm.ts"
import { inPlay } from "./play-area.ts"
import { REGION, inputParts, rectsBox } from "./region.ts"

/** Monzone's station, streets and hill clusters: OSM names only Monzone (Alto) and Aiola there. */
const MONZONE: ReadonlyArray<District> = [
  { name: "Monzone (Stazione)", x: -500, y: 480, r: 250 },
  { name: "Via Riolo", x: -200, y: 310, r: 160 },
  { name: "Immacolata", x: -90, y: 120, r: 120 },
  { name: "Santa Lucia", x: 44.6, y: 223.8, r: 130 },
  { name: "Via per Equi", x: 260, y: 370, r: 190 },
  { name: "Caldanella", x: 570, y: 510, r: 110 },
  { name: "Cimitero", x: -45, y: -70, r: 70 },
  { name: "Monzone Alto", x: -34.4, y: -300.3, r: 170 },
  { name: "Collecchia", x: -140, y: -480, r: 100 },
  { name: "Torrignana", x: -398.7, y: -99.1, r: 200 },
  { name: "Aiola", x: 720, y: 190, r: 240 },
  { name: "Castello di Aiola", x: 420, y: -260, r: 110 },
  { name: "Novicchia", x: -924.1, y: -397.1, r: 220 },
  { name: "Acquanera", x: 117.2, y: -95.6, r: 120 },
]

/**
 * The unpopulated mountains, so the HUD never names the nearest village on Monte Sagro or Cima
 * Belfiore: peaks, saddles, huts and castles on their OSM elements, quarries on their pits,
 * localities and ridges centred by hand on the slope they name. None overlaps a village disc but
 * Passo dei Carpinelli, inside Casone Carpinelli's, kept small enough to take none of its
 * buildings: the pass names its own district (issue #17); the Fortezza della Brunella, inside
 * Aulla's town disc (issue #19), and the Fortezza di Sarzanello, inside Sarzana's (issue #20); and
 * three the villages' larger discs reach since their cap went from 400 to 600 m (the user's choice,
 * issue #20), the overlap named by the nearest rim: Foce del Cucco's by Monte Carboli's 63 m,
 * Castello di Bigliolo's by Fertigliana's 89 m and Sarzanello's by Bradia's 68 m (map.map-test.ts
 * lists them). The Carrara and Massa sides of the ridge are in the rectangle too.
 * And the coast's: the Magra's mouth and the headland of Punta Bianca, which no village names.
 */
export const LANDMARKS: ReadonlyArray<District> = [
  { name: "Torre di Monzone", x: 300, y: -2560, r: 380 },
  { name: "Alpe di Monzone", x: -530, y: -2386, r: 200 },
  { name: "Rocca di Tenerano", x: -728, y: -3012, r: 300 },
  { name: "Balzone", x: 900, y: -3700, r: 360 },
  { name: "Monte Borla", x: 495, y: -4789, r: 250 },
  { name: "Cava Castelbaito", x: 800, y: -4320, r: 200 },
  { name: "Cava Fratteta", x: 1040, y: -4450, r: 100 },
  { name: "Cava Bardiglio", x: 1531, y: -4536, r: 50 },
  { name: "Cava Vittoria", x: 1401, y: -4795, r: 240 },
  { name: "Cave Crespina", x: 1284, y: -5241, r: 280 },
  { name: "Foce di Pianza", x: 907, y: -5154, r: 130 },
  { name: "Capanne del Sagro", x: 1796, y: -5497, r: 120 },
  { name: "Monte Sagro", x: 2364, y: -5129, r: 450 },
  { name: "Foce di Vinca", x: 3083, y: -5035, r: 200 },
  { name: "Capanna Garnerone", x: 4100, y: -4530, r: 200 },
  { name: "Cresta Garnerone", x: 4570, y: -4050, r: 250 },
  { name: "Foce di Giovo", x: 4511, y: -3252, r: 200 },
  { name: "Capanne di Giovo", x: 4090, y: -3150, r: 220 },
  { name: "Pizzo d'Uccello", x: 4210, y: -2454, r: 300 },
  { name: "Cresta di Capradossa", x: 4600, y: -1950, r: 250 },
  { name: "Pizzo dell'Aquila", x: 2391, y: -1592, r: 300 },
  { name: "Cave del Cantonaccio", x: 4042, y: -1744, r: 160 },
  { name: "Cava Col Pelato", x: 3673, y: -1271, r: 200 },
  { name: "Cava di Poggio di Sante", x: 3812, y: -979, r: 60 },
  { name: "Alpe d'Ugliano", x: 4662, y: -681, r: 250 },
  { name: "Cava Cattani", x: 3263, y: -768, r: 230 },
  { name: "Solco di Equi", x: 2850, y: 0, r: 420 },
  { name: "Monte Puntone", x: -2371, y: -2956, r: 250 },
  { name: "Passo della Gabellaccia", x: -2529, y: -4225, r: 200 },
  { name: "Canal d'Abbia", x: -1800, y: -4850, r: 200 },
  { name: "Piastriccioni", x: -1450, y: -5700, r: 300 },
  { name: "Cava Lorano", x: -640, y: -5760, r: 260 },
  { name: "Cave del Morlungo", x: 270, y: -5203, r: 310 },
  { name: "Il Boscaccio", x: 1140, y: -5900, r: 350 },
  { name: "Capanne di Navola", x: 3460, y: -5560, r: 350 },
  // Fivizzano's part (#17): on their OSM nodes, radii fitted on rt_ofc.5k23.32bit with the built
  // terrain's contours over it. The Fortezza della Verrucola stands in the hamlet's own disc.
  { name: "Passo dei Carpinelli", x: 8127, y: 4287, r: 70 }, // saddle 1449319916, in Casone Carpinelli's disc: its pass, and none of its buildings or spots
  { name: "Passo di Tea", x: 7993, y: 6034, r: 200 }, // saddle 577776308: the road's loop and the Spedale di Tea's ruins
  { name: "Passo del Romito", x: 2854, y: 10936, r: 200 }, // saddle 2453324916: the SS63's hairpin by the old road house
  { name: "Cima Belfiore", x: 9706, y: 12014, r: 400 }, // peak 577763720: the summit meadow, its Emilia side out of play
  { name: "Monte Tondo", x: 10006, y: 10324, r: 400 }, // peak 577763716: the summit meadow, its east half past the play area
  { name: "Monte Cucu", x: 8184, y: 9997, r: 260 }, // peak 2453127410: a knoll in beech wood; past 260 m the ridge climbs over it
  { name: "Monte Chiaro", x: 1083, y: 6242, r: 300 }, // Castello di Monte Chiaro's node 12089556144, on the hilltop (OSM's peak 72 m east)
  // Fosdinovo's part (#18): on their OSM nodes, radii fitted on rt_ofc.5k23.32bit with the built
  // terrain's contours over it. The Castello Malaspina stands in Fosdinovo's own disc; the Castello
  // di Ponzanello, 67 m past Ponzanello's, takes the hamlet's name by the nearest rim.
  { name: "Foce del Cucco", x: -8448, y: -1684, r: 200 }, // saddle 251988270: the SP72's and SP9's junction on the pass and its 17 houses; Monte Carboli's disc 47 m off at the 400 m cap, 63 m over it at 600
  { name: "La Pizza", x: -3774, y: -4254, r: 300 }, // peak 4884214211: the wooded cone down to about its 800 m contour, and the Campo Cecina road's bends under its faces
  { name: "Monte La Pianaccia", x: -4815, y: -4449, r: 300 }, // peak 4878663147: the wooded dome, the Campo Cecina road across its south flank and its picnic site; past 300 m east the saddle holds Maestà's houses
  { name: "Monte Grugola", x: -7395, y: -3672, r: 250 }, // peak 4885328769: the wooded top and the SP73 under its west flank; past 250 m the ridge climbs to Monte Primicerri
  // Aulla's part (#19): on their OSM elements, radii fitted on rt_ofc.5k23.32bit with the built
  // terrain's contours over it. The Fortezza della Brunella stands inside Aulla's town disc and
  // names its hill alone, the town round it keeping Aulla's name. The Pieve di Santa Maria di
  // Venelia stands 194 m inside Monti di Licciana's disc, among its houses, so it is left to the
  // village. Passo Alpicella lies 365 m past the play area, in Liguria, where the RT photo has all
  // but stopped: its disc is fitted on the contours alone, and names the play area's Tuscan flank
  // below it by the nearest rim.
  { name: "Fortezza della Brunella", x: -12550, y: 5236, r: 150 }, // relation 9701877's outer way 698125674, its box's centre: the fortress and its wooded hill to the foot, under 70 m at 126–164 m west to south
  { name: "Castello di Giovagallo", x: -19888, y: 7334, r: 120 }, // ruin 700011600: the castle's wooded knob; past 106–118 m south and south-west the ridge climbs over its 462 m
  { name: "Castello di Bigliolo", x: -6329, y: 9169, r: 130 }, // castle 6703673726: the ruin's spur, under 200 m at 70–116 m south-west to south; north and east the ridge climbs to Fertigliana, whose disc was 11 m off at the 400 m cap and is 89 m over it at 600
  { name: "Passo Alpicella", x: -21897, y: 8680, r: 150 }, // saddle 577382401, out of play in Liguria: the col; Monte Alpicella's slope passes 730 m at 92–106 m south and south-west, the flanks drop under 680 m at 58–90 m east and north-west
  { name: "Monte Borra Grande", x: -21833, y: 11192, r: 200 }, // peak 2539782572: the wooded dome to about its 900 m contour (109–267 m out, inside 200 m on 10 of 15 rays) and the forest track round its flanks; its Liguria side out of play
  // Sarzana's part (#20): on their OSM elements, radii fitted on the built terrain's contours, over
  // rt_ofc.5k23.32bit in Tuscany; in Liguria, where of the traceable RT flights only 1954's and
  // 1978's reach, at Sarzanello alone (rt_ofc.10k54, 10k78), over OSM and Regione Liguria's NC5
  // footprints. The Fortezza di Sarzanello, OSM's Fortezza Castracani (its Wikipedia article and
  // its own site name it so; OSM's Sarzanello is the neighbourhood 1.8 km south-east), stands
  // inside Sarzana's town disc and names its hill alone, as the Fortezza della Brunella does in
  // Aulla's. Forte Bastia's rim names the houses on its hill's roads (the user's choice, issue #20).
  // The castles of Trebiano and Bibola, 105 and 18 m from their villages' nodes, and Canarbino's
  // fort are left to their discs. Castello della Brina and Monte Zecchino get none: at 150 m their
  // rims would name 432 buildings of the Magra plain below the one and 57 on Bolano's ridge road
  // by the other.
  { name: "Fortezza di Sarzanello", x: -12694, y: -5172, r: 150 }, // castle 89665866, its box's centre: the fortress, its outer wall 233737328 (to 86 m) and its hilltop, under 80 m at 90–125 m on 11 of 16 rays; 37 m inside Sarzana's rim, so its own rim names nothing; Bradia's disc 68 m over it
  { name: "Forte Bastia", x: -20850, y: -2468, r: 200 }, // castle 980696353: the fort (its wall 157086371; NC5's four houses and two sheds within 46 m) and its hilltop to about its 250 m contour, inside 200 m on 12 of 16 rays (125–300 m out); with its rim it names 196 buildings and 21 parked spots out to 731 m, along Via Bastia, the road OSM names Forte Bastia and the SP16
  { name: "Monte Grosso", x: -13587, y: 1920, r: 200 }, // peak 9485751677 (665 m): the wooded dome to about its 600 m contour, inside 200 m on 10 of 16 rays (115–330 m out), the ridge north-west holding 600 m to 530 m
  { name: "Monte Boscoleto", x: -12720, y: 675, r: 150 }, // peak 10555505668 (599 m): the wooded top to about its 560 m contour, inside 150 m on 12 of 16 rays (80–195 m out), the ridges west-north-west and east-south-east holding it to 495 and 370 m
  // The coast (#13): on OSM's coastline and its place nodes. Bocca di Magra, Fiumaretta, Marinella
  // di Sarzana, Montemarcello and Luni Mare are OSM villages, with discs of their own.
  { name: "Foce del Magra", x: -11297.7, y: -12785.1, r: 160 }, // the middle of the coastline's 322 m closure across the mouth (ways 1379669802 and 1379669801), between the jetties' heads: the mouth and its last reach; Bocca di Magra's node 321 m west
  { name: "Punta Bianca", x: -12162.7, y: -13987.1, r: 150 }, // locality 3200895827: the headland's tip, the sea 35 m east and south of it, its rocky beach (way 176721000) out to 134 m west
]

/**
 * Populated places only: a `locality` (a named hillside, a field) would claim the village's
 * buildings around it. Fivizzano, Aulla, Sarzana, Arcola and Santo Stefano di Magra are OSM's towns
 * in Lunigiana's play area. A town's neighbourhoods, suburbs and quarters are villages here: OSM
 * tags Albiano Magra (1,907 people) and Sarzana's quarters so, and without them the HUD named
 * Albiano after Santo Stefano di Magra across the Magra and Sarzana's east after Caniparola, a
 * village of Fosdinovo's (issue #20).
 */
const PLACES: ReadonlySet<string> = new Set([
  "town",
  "village",
  "hamlet",
  "suburb",
  "quarter",
  "neighbourhood",
])
/** A building farther than this (m) from every village and hamlet node is no village's. */
const REACH = 600
/**
 * A town's reach (m): its streets run on past a village's, Aulla's 1.5 km up the Aulella from its
 * node. At 1000 m its disc (840 m) left 203 of the town's buildings to the Fortezza della
 * Brunella's by the nearest rim; at 1200 m (1030 m) the fortress names its hill's 21 alone.
 */
const TOWN_REACH = 1200
/** Share of a place's buildings its disc covers; the rest are outliers. */
const FIT = 0.9
/**
 * A disc's radius (m); a town's reaches past `max`, as far as its buildings (issue #19). At 400 m
 * the cap held 53 of Sarzana's part's 62 discs, and the plain's sprawl between them fell to the
 * nearest rim (the user's choice of 600 m, issue #20).
 */
const RADIUS = { min: 80, max: 600 }

/**
 * MONZONE, then a disc per OSM place outside it, in node id order, then LANDMARKS, those two lists
 * where the region's inputs reach (the box round its input parts: a test region of the coast holds
 * none of the mountains', Lunigiana none of the coast's). Each building outside MONZONE goes to the
 * nearest place node within its reach (REACH, a town's TOWN_REACH); the disc covers FIT of them
 * (plus 10 m), clamped to RADIUS (a town's to its minimum alone) and rounded to 10 m.
 */
export const fitDistricts = (osm: Osm, buildings: ReadonlyArray<BuildingF>): Array<District> => {
  if (REGION.id === "cesena")
    return [...osm.nodes.values()].flatMap((node) => {
      const [x, y] = toLocal(node.lat, node.lon)
      const name = node.tags.name
      return name !== undefined &&
        ["city", "suburb", "neighbourhood", "village", "hamlet"].includes(node.tags.place ?? "") &&
        inPlay(x, y)
        ? [{ name, x: r1(x), y: r1(y), r: node.tags.place === "city" ? 1000 : 500 }]
        : []
    })
  const [x0, y0, x1, y1] = rectsBox(inputParts(REGION).flatMap((p) => p.rects))
  const reached = (ds: ReadonlyArray<District>) =>
    ds.filter(({ x, y }) => x >= x0 && x <= x1 && y >= y0 && y <= y1)
  const monzone = reached(MONZONE)
  const inMonzone = (x: number, y: number) =>
    monzone.some((d) => Math.hypot(x - d.x, y - d.y) <= d.r)
  const places = [...osm.nodes.values()].flatMap((n) => {
    const [x, y] = toLocal(n.lat, n.lon)
    const name = n.tags.name
    return PLACES.has(n.tags.place ?? "") && name !== undefined && inPlay(x, y) && !inMonzone(x, y)
      ? [{ name, x, y, town: n.tags.place === "town", near: [] as Array<number> }]
      : []
  })
  for (const b of buildings) {
    const [cx, cy] = centroid(b.outer)
    if (inMonzone(cx, cy)) continue
    let best: (typeof places)[number] | undefined,
      bestD = Infinity
    for (const p of places) {
      const d = Math.hypot(p.x - cx, p.y - cy)
      if (d < bestD && d < (p.town ? TOWN_REACH : REACH)) [best, bestD] = [p, d]
    }
    best?.near.push(bestD)
  }
  return [
    ...monzone,
    ...places.map(({ name, x, y, town, near }) => {
      near.sort((a, b) => a - b)
      const fit = Math.max(RADIUS.min, (near[Math.floor(FIT * (near.length - 1))] ?? 0) + 10)
      return {
        name,
        x: r1(x),
        y: r1(y),
        r: Math.round((town ? fit : Math.min(RADIUS.max, fit)) / 10) * 10,
      }
    }),
    ...reached(LANDMARKS),
  ]
}
