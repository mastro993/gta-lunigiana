// The OSM waterways' sizes by name and reach, measured on the 2010 orthophoto and the LiDAR: the
// thresholds on a way's mean ground where a stream's bed changes, and the sizes they pick
// (`extractWater` in features.ts reads them).

/** Mean ground (m) below which a Lucido or Caldanella way runs on the valley floor; above it, the stream is a wooded mountain gully. */
const MAIN_BELOW = 500
/**
 * Mean ground (m) below which a Torrente Aulella way runs in its open valley bed: halfway between
 * lucido's 788514356 (282.2 m), its last way under the Tassonaro's mouth, and 788514364 (294.3 m),
 * the first of the wooded gorge above it.
 */
const AULELLA_VALLEY_BELOW = 288
/** Mean ground (m) below which the Aulella's gorge keeps its bed: above it, past its first big tributary over Casola, its floor narrows to a headwater's (LiDAR 4–6.5 m against 6–8 m). */
const AULELLA_GORGE_BELOW = 350
/** Mean ground (m) below which the Torrente Mommio keeps its bed: its floor narrows between 766 m (way 788514696) and 782 m (788514702). */
const MOMMIO_GORGE_BELOW = 775
/**
 * Mean ground (m) below which a Torrente Bardine way runs in its open valley bed: halfway between
 * fosdinovo's 790365291 (87.8 m), its last above the Fosso del Lombardello's mouth by Bardine (OSM
 * node 7389111706), and 790365292 (81.8 m), the first below it: below that mouth its gravel bed
 * widens to the Aulella valley's (a median 27 m against the trunk's 15 m above).
 */
const BARDINE_VALLEY_BELOW = 85
/**
 * Mean ground (m) below which a Torrente Bardine way carries the Bardinello's water: halfway between
 * 797861302 (141.0 m), its first below the Bardinello's mouth (node 7462482431), and 797861301
 * (149.5 m), its 3.6 km² head down from the Canale del Vezzanello.
 */
const BARDINE_BED_BELOW = 145
/**
 * Mean ground (m) below which a Torrente Bardinello way runs in the Bardine's gravel bed: halfway
 * between 797861257 (150.4 m), its first below the Torrente Pesciola's mouth (node 7462482051, 33
 * km² there), and 797861254 (156.9 m, 15 km²), its last above it.
 */
const BARDINELLO_BED_BELOW = 154
/**
 * Mean ground (m) below which the Torrente Bardinello is a wooded torrent: halfway between 797860930
 * (265.7 m), its first below the Canale Caldia's mouth (node 7462477158), where it drains 9.3 km²
 * and its LiDAR floor widens from a headwater's 6 m to the wooded torrents' 7-7.5 m, and 797860907
 * (268.9 m, 7.0 km²).
 */
const BARDINELLO_GORGE_BELOW = 267
/**
 * Mean ground (m) below which a Torrente Osca way runs on its open gravel fan: halfway between
 * aulla's 789355086 (110.9 m), its last in closed woods, and 789355090 (109.0 m), its first below
 * an unnamed stream's mouth (OSM node 7380642386), where its bed opens.
 */
const OSCA_FAN_BELOW = 110
/**
 * Mean ground (m) below which the Torrente Osca is a wooded torrent: halfway between 789355149
 * (253.5 m), its first below the Canale di Borra Grande's mouth (node 7380643617), which takes it
 * from 4.9 to 7.4 km² and widens its LiDAR floor from a headwater's 6.5 m to 16-17 m, and 789355154
 * (269.3 m).
 */
const OSCA_GORGE_BELOW = 261
/**
 * Mean ground (m) below which a Torrente Penolo way runs on its open gravel fan: halfway between
 * 789354987 (89.6 m), its first below the Canale della Zoppa's mouth (node 7380640243, 12.9 km²),
 * where its gravel opens, and 789355011 (95.8 m), its last in a 5-9 m rocky bed.
 */
const PENOLO_FAN_BELOW = 93
/**
 * Mean ground (m) below which the Torrente Penolo is a wooded torrent: halfway between 789354799
 * (199.3 m), its first below an unnamed stream's mouth (node 7380637631, 8.3 km²), where its LiDAR
 * floor widens from a headwater's 4-6 m to 7-10 m, and 789354800 (204.3 m, 7.7 km²).
 */
const PENOLO_GORGE_BELOW = 202
/**
 * Mean ground (m) below which a Torrente Amola way runs on its open gravel fan across the plain:
 * halfway between sarzana's 206634001 (117.7 m), its one way from its source at (-13276, -153) to
 * the foot of its hills at (-14524, -3411), and 917637857 (36.9 m), its first on the plain, where
 * the NC5's riverbed widens from a 3-10 m channel to 15-30 m.
 */
const AMOLA_FAN_BELOW = 77
/**
 * Mean ground (m) below which a Torrente Amola way runs in its banked channel to the Magra: halfway
 * between 238383122 (29.3 m), its last on the fan, and 238383121 (14.6 m), whose NC5 channel is
 * 4.8-7.3 m (OSM's est_width 3.5).
 */
const AMOLA_CHANNEL_BELOW = 22

/**
 * Water width, gravel-bed half-width and depth, m, from the way's name, kind and mean ground `z`
 * (LiDAR, over its vertices). The rivers are measured on the 2010 orthophoto: the Aulella runs in
 * a 25-35 m gravel bed at Gragnola (a wooded 10 m channel at Codiponte), the Lucido in a 22 m one
 * below Monzone, the Rosaro in a 10-28 m one (median 13-15 m, its water 2-8 m) from Fivizzano to
 * Soliera. The Bardine runs in an 18-47 m one (median 27 m, its water 4-18 m, median 10) from
 * Bardine to the map's edge, as wide as the Aulella; above, from the Bardinello's mouth, and the
 * Bardinello below the Pesciola's, in a 6-32 m one (median 15 m, its water 2.5-12 m, upper quartile
 * 7), as the Rosaro (issue #18). The Taverone runs in a 6-55 m one (median 17 m, its water 4-10 m,
 * median 5) from the map's north edge to the Magra, as the Rosaro: its top 1.5 km, a wooded 6-11 m
 * rocky bed, is of its one way 700556145 above (-12205, 7165) and takes its class (issue #19). The
 * Aulella keeps its valley bed down to Aulla: 8-21 m of water (median 11) in a 15-45 m bed (median
 * 30) from Fivizzano's west edge to x -8164, where the OSM river polygon draws its bed. The Osca and
 * the Penolo below their woods spread 8-47 m of gravel (median 28-32) round little water: the Osca's
 * 2.5-4.5 m, the Penolo's dry on both flights but at the head of its fan, where the 2010 one shows a
 * 12 m pool and a 7-14 m channel at (-15329, 8657) and (-15226, 8552). Their water is a named
 * stream's, their gravel the valley bed's (`fan`). The Fiume Magra's water is 18-37 m wide (median
 * 25) on both flights from Barbarasco to below the Aulella's mouth, in a gravel bed of 29-282 m that
 * the OSM river polygon draws and carves over its whole course on the map: its line takes the water
 * alone, as Cesena's rivers do between their banks. The Lucido's Vinca branch and the Caldanella (from Equi) are the
 * main streams on the valley floor (5-16 m of open marble gravel below 400 m). The Aulella's gorge
 * above the Tassonaro's mouth, the Rosaro above Fivizzano, the Mommio, the Bardinello above the
 * Pesciola's mouth and the Torrente Pesciola, all its drawn course (8.9-18 km²), are torrents of
 * 9-49 km² in closed woods, whose canopy gaps show 3-10 m of bed over a LiDAR floor of 7-7.5 m
 * (`wooded`, issue #17). The Pesciola's gaps on the 2010 orthophoto show 7 m of bed at 797860993
 * (-6064, -1211), 8 m at 797861030 (-6281, -698) and 797861109 (-6485, -9), 10 m at 797861231
 * (-5916, 1052) and 7 m at 797861233 (-5550, 1172), over a LiDAR floor of a median 8-9 m: at its
 * mouth it drains 18 km² to the Bardinello's 15 (issue #18). Above Vinca the Lucido runs in a
 * beech-wood gully with only 3-6 m of bed showing, like the other named streams (4 m); unnamed ones
 * are 2 m. In Liguria, where Regione Toscana's recent photos stop, the widths are read on the
 * NC5's watercourses (Area bagnata di corso d'acqua and Alveo, 1:5000: M2052 layers L6896, L6919
 * and L6920), each a channel between its banks (issue #20). The Vara's is 12-139 m across its
 * channels (median 34) at 17 sections from the play area's north edge to Fornola, in a gravel bed
 * of 100-290 m that its OSM river polygon draws and carves all its course on the map: as the
 * Magra's, its line takes the water alone. The Amola on the plain, from the foot of its hills to
 * 238383122, crosses a riverbed of 15-30 m (median 20) round a 5.8-24 m channel (median 8), 18-25 m
 * of bright gravel on the 1978 flight: a fan's. The Durasca, 11.0 km² across the play area's west
 * edge and 13.5 at the Vara, runs in a 4.3-12.8 m channel between its banks (median 8) down to
 * x -21085 and a 10.5-18 m one (median 15) below, over a LiDAR floor of 12-21 m: a wooded
 * torrent's, as the Pesciola's. The Canale Lunense is a lined channel 3.3-6.3 m between its walls
 * (median 5.3, 80 sections; OSM tags its Sarzana stretches width=8), 4-7 m of water on the 2010
 * orthophoto by Albiano. The Calcandola keeps a named stream's 4 m: its LiDAR floor in Fosdinovo's
 * woods is a headwater's (median 6 m), and on its fan the OSM river polygon draws the 10-40 m of
 * gravel the 2010 flight shows dry but for a 2-4 m channel; so does the Amola in its hills (a
 * 3-10 m channel, median 6) and to the Magra (4.8-7.3 m, median 6.7). The depths are the classes'
 * own, as no photo shows them and Liguria's DTM, 5 m cells of whole metres interpolated from the
 * NC5's heights, shows none of these channels.
 */
export const waterSize = (
  name: string | undefined,
  kind: "river" | "stream",
  z: number,
): { readonly w: number; readonly bed: number; readonly depth: number } => {
  if (
    (name === "Torrente Aulella" && z < AULELLA_VALLEY_BELOW) ||
    (name === "Torrente Bardine" && z < BARDINE_VALLEY_BELOW)
  )
    return { w: 12, bed: 13, depth: 2.5 }
  if (name === "Fiume Magra" || name === "Fiume Vara") return { w: 25, bed: 13.5, depth: 2.5 }
  if (name === "Torrente Lucido" && kind === "river") return { w: 14, bed: 11, depth: 2.5 }
  if (
    (name === "Torrente Rosaro" && kind === "river") ||
    name === "Torrente Taverone" ||
    (name === "Torrente Bardine" && z < BARDINE_BED_BELOW) ||
    (name === "Torrente Bardinello" && z < BARDINELLO_BED_BELOW)
  )
    return { w: 7, bed: 7, depth: 2.5 }
  const fan =
    (name === "Torrente Osca" && z < OSCA_FAN_BELOW) ||
    (name === "Torrente Penolo" && z < PENOLO_FAN_BELOW) ||
    (name === "Torrente Amola" && z < AMOLA_FAN_BELOW && z >= AMOLA_CHANNEL_BELOW)
  if (fan) return { w: 4, bed: 13, depth: 1.5 }
  const main = (name === "Torrente Lucido" || name === "Torrente Caldanella") && z < MAIN_BELOW
  const wooded =
    (name === "Torrente Aulella" && z < AULELLA_GORGE_BELOW) ||
    name === "Torrente Rosaro" ||
    (name === "Torrente Mommio" && z < MOMMIO_GORGE_BELOW) ||
    (name === "Torrente Bardinello" && z < BARDINELLO_GORGE_BELOW) ||
    name === "Torrente Pesciola" ||
    (name === "Torrente Osca" && z < OSCA_GORGE_BELOW) ||
    (name === "Torrente Penolo" && z < PENOLO_GORGE_BELOW) ||
    name === "Durasca"
  const w = main ? 8 : wooded ? 6 : name === "Canale Lunense" ? 5 : name === undefined ? 2 : 4
  return {
    w,
    bed: Math.max(w / 2 + 1, 3),
    depth: kind === "river" ? 2.5 : main || wooded ? 1.5 : 1,
  }
}
