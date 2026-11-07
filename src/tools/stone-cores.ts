// The historic stone cores' discs (runbook step 5 in issue #3), which `genericStyle` in features.ts
// makes stone: hand-traced on Regione Toscana's orthophotos with the built buildings over them
// (`pnpm ortho`).

/**
 * Historic stone cores (x, y, r), traced on the 2010 orthophoto (dense irregular blocks around the
 * church or castle); newer houses along the main roads are plaster.
 */
export const STONE_CORES: ReadonlyArray<readonly [number, number, number]> = [
  [-20, -300, 170], // Monzone Alto
  [720, 170, 220], // Aiola, with its eastern houses
  [420, -260, 120], // Castellaccio
  [-1730, 3350, 95], // Gragnola, the borgo by the Lucido
  [-1309, 3278, 40], // Castello dell'Aquila, Gragnola (one OSM footprint, centred on its vertex mean)
  [1797, 665, 80], // Equi Terme, the old village under the church
  [-2300, 55, 80], // Viano
  [-2025, 855, 50], // Pieve di Viano
  [-2205, 1540, 70], // Campiglione
  [-2540, 1370, 90], // Vezzanello
  [-1725, 1135, 60], // Colognola
  [-1550, 645, 80], // Terma
  [-1030, 490, 70], // Isolano
  [-1050, 1135, 40], // La Rocca di Monzone
  [65, 1140, 75], // Monte dei Bianchi
  [705, 1215, 65], // Mezzana
  [415, 2025, 60], // Fazzano
  [-245, 2035, 70], // La Giunca-Mozzano
  [-790, 2355, 85], // Folegnano
  [-1462, 1955, 50], // the borgo west of Pian del Molino
  [-1860, 2540, 65], // Cortila
  [-2270, 2790, 50], // La Traggiara
  [1605, 3195, 100], // Codiponte, the borgo south of the Aulella
  [1735, 3180, 55], // Codiponte, the eastern houses
  [2050, 2300, 120], // Casciana
  [2275, -2630, 115], // Vinca, the borgo around Sant'Andrea
  [2165, -2565, 48], // Vinca, the old houses along the upper street west of the core
  [-2212, -865, 65], // Tenerano, the ring borgo
  [4130, 1445, 55], // Ugliancaldo, the castle ring
  [4205, 1405, 60], // Ugliancaldo, the borgo along the ridge
  [4270, 1320, 65], // Ugliancaldo, the borgo down to Sant'Andrea
  [4805, 3225, 65], // Argigliano, the borgo below Santa Maria
  // Fivizzano's part (#17): each core traced as an outline on rt_ofc.2k10 crops (checked on
  // rt_ofc.5k23.32bit, CC BY 4.0) with the built buildings over them, each disc the smallest, to
  // 5 m, holding the outline's buildings, but where a comment says it was grown so the borgo
  // carries its hamlet's one style (HAMLET). OSM maps no city walls: Fivizzano's are traced.
  [-630, 8340, 95], // Fivizzano, the walls' south-west round Piazza Garibaldi
  [-565, 8450, 105], // Fivizzano, the walled centre round Piazza Medicea
  [-520, 8575, 60], // Fivizzano, the walls' north, Via Pognana up to the gate
  [-450, 8505, 60], // Fivizzano, the walls' east, the Via Roma row
  [485, 8990, 45], // Verrucola, the fortress and the church below it
  [565, 8995, 50], // Verrucola, the borgo east to the road's bend
  [3610, 4200, 50], // Casola, the borgo round Santa Felicita
  [3670, 4200, 35], // Casola, the borgo's eastern houses
  [-5025, 4830, 70], // Soliera, the castle borgo on Via Soleria di Castello
  [-4905, 5060, 75], // Soliera, the borgo along Via del Convento
  [-3055, 4700, 85], // Gassano, the borgo round its church
  [-3305, 6600, 95], // Moncigoli, the borgo round its church
  [5055, 9840, 40], // Mommio, the borgo at the village node
  [5015, 9965, 40], // Mommio, the houses round the church
  [5095, 9910, 40], // Mommio, the eastern lane's row: untraced, so the borgo carries its 104 (63 stone)
  [5285, 4970, 95], // Pugliano, the borgo round its two churches
  [5330, 3585, 70], // Pieve San Lorenzo by the station: its outline's 55 m grown to carry the hamlet
  [5405, 3425, 75], // Pieve San Lorenzo round the pieve: its outline's 65 m grown to carry the hamlet
  // Fosdinovo's part (#18), traced as Fivizzano's: an outline on rt_ofc.2k10 crops (checked on
  // rt_ofc.5k23.32bit, CC BY 4.0) with the built buildings over them, each disc the smallest, to
  // 5 m, holding the outline's buildings, but where a comment says it was grown. Castelpoggio is
  // traced on 5k23 and checked on rt_ofc.2k09: the 2010 flight has no image there. Ponzanello's castle is a ruined ring
  // in the woods with no building, so no disc reaches it.
  [-9000, -3135, 50], // Fosdinovo, the borgo's west end round Piazza Cairoli
  [-8915, -3125, 55], // Fosdinovo, Piazza Garibaldi and the lower Via Roma
  [-8875, -3025, 50], // Fosdinovo, the upper Via Roma round the Annunziata and Piazza Matteotti
  [-8790, -2980, 50], // Fosdinovo, Via Papiriana and Via Rocca, up from San Remigio
  [-8740, -2895, 55], // Fosdinovo, the Castello Malaspina on its crag and the houses at its gate
  [-10390, 410, 40], // Ponzanello, the borgo's south-west end at the SP57's bend
  [-10320, 465, 45], // Ponzanello, the borgo round San Martino
  [-10275, 535, 40], // Ponzanello, the borgo's north end below the castle's ruined ring
  [-7375, -75, 35], // Tendola, the borgo's south end on Via Collo
  [-7315, -20, 45], // Tendola, the borgo along Via Alfieri
  [-7285, 55, 55], // Tendola, the borgo round Santa Caterina
  [-4185, -1635, 75], // Marciaso, the borgo's ring on its knoll
  [-6755, -1710, 40], // Pulica, the borgo round San Giovanni Battista and the Oratorio
  [-6735, -1650, 35], // Pulica, the borgo's two lanes north, Via Galliano and Via Toselli
  [-9175, 2935, 65], // Bardine, the old houses north of the node: its outline's 45 m grown to carry the hamlet
  [-5290, 1740, 80], // Bardine di San Terenzo, the borgo on both sides of Via Verdi
  [-6465, 1305, 40], // San Terenzo Monti, the western borgo's ring
  [-6435, 1265, 35], // San Terenzo Monti, the western borgo's row down to the road
  [-6385, 1290, 55], // San Terenzo Monti, the borgo round San Terenzio
  [-6330, 1200, 55], // San Terenzo Monti, the borgo south of the road
  [-6590, 3320, 50], // Ceserano, the western borgo round San Bartolommeo on Via Castello
  [-6450, 3380, 25], // Ceserano, the old houses above the road mid-village
  [-6045, 3365, 35], // Ceserano, the eastern borgo's west rows at the village node
  [-6005, 3415, 35], // Ceserano, the eastern borgo's houses up the hill
  [-5965, 3395, 40], // Ceserano, the eastern borgo's east terraces
  [-8620, -4305, 40], // Gignago, the borgo along Via Gignago
  [-4475, -5620, 55], // Castelpoggio, the borgo's west terraces above Via Trento
  [-4410, -5615, 55], // Castelpoggio, the borgo round Piazza Santa Maria
  [-4350, -5670, 40], // Castelpoggio, the spur's tip round the church
]
