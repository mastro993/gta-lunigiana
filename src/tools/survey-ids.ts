// The ids of the surveyed buildings (ctr.ts, dbt.ts, nc5.ts): negative, so they never meet an OSM
// id, and unique across every source and section the map may read. An id is −(local + 2^32 · slot):
// - `local`, under 2^31, numbers the record within its sheet or section as the 2019 CTR's ids always
//   did (sheet number, layer, record, polygon; `localOf`), or by the source's own serial in the DBT
//   and the NC5 (dbt.ts, nc5.ts), so `id | 0` and `-(id | 0)`, which seed a building's look (its
//   tint in features.ts, its roof, shutters and windows in the renderer), give what they gave
//   before the sources and sections were added;
// - `slot` is the source (`SOURCES`) times 2^16 plus its section's code, fixed by the section's name
//   alone, so adding a part never renumbers a building another part already holds.
// The largest slot, 2^21 − 1, keeps every id a safe integer (2^21 · 2^32 = 2^53).

/** Each survey source's number in the ids: one block of 2^16 sections each. */
export const SOURCES = { ctr2019: 1, dbt2k: 2, ctr2009: 3, ctr10k: 4, nc5: 5 } as const

/** A survey source of buildings, road surfaces and mapped areas. */
export type SurveySource = keyof typeof SOURCES

/** A record's number within its section is under this; the polygons of a record step by it. */
const UNIT = 1e7
/** At most this many polygons a record, so a local id stays under 1e9 < 2^31. */
const POLYGONS = 100

/** A 1:2000 sheet's section and number: "23D11" is section 23D, sheet 11. */
export const sheet2k = (sheet: string): { readonly section: number; readonly sheet: number } => {
  const m = /^(\d\d)([A-Z])(\d\d)$/.exec(sheet)
  if (m === null) throw new Error(`not a 1:2000 sheet name: ${sheet}`)
  return { section: Number(m[1]) * 26 + m[2]!.codePointAt(0)! - 65, sheet: Number(m[3]) }
}

/** A 1:10 000 section's code: "249020" is the 2nd of the 16 sections of 1:50 000 sheet 249. */
export const section10k = (section: string): number => {
  const m = /^(\d{3})(\d{3})$/.exec(section),
    k = Number(m?.[2]) / 10
  if (m === null || !Number.isInteger(k) || k < 1 || k > 16)
    throw new Error(`not a 1:10 000 section name: ${section}`)
  return Number(m[1]) * 16 + k - 1
}

/** A 1:5000 element's code: "248082" is the 2nd of the 4 elements of 1:10 000 section 248080. */
export const element5k = (element: string): number => {
  const m = /^(\d{5})([1-4])$/.exec(element)
  if (m === null) throw new Error(`not a 1:5000 element name: ${element}`)
  return section10k(`${m[1]}0`) * 4 + Number(m[2]) - 1
}

/** A comune's code from its ISTAT number: "045014" is comune 14 of province 45 (provinces under 128, comuni under 512, so the code fits a section's 2^16). */
export const comune = (istat: string): number => {
  const m = /^(\d{3})(\d{3})$/.exec(istat)
  if (m === null || Number(m[1]) >= 128 || Number(m[2]) >= 512)
    throw new Error(`not an ISTAT comune code: ${istat}`)
  return Number(m[1]) * 512 + Number(m[2])
}

/** The local number of polygon `k` of record `unit` (its sheet, layer and index already folded in). */
export const localOf = (unit: number, k: number): number => {
  if (!Number.isInteger(unit) || unit < 0 || unit >= UNIT)
    throw new Error(`record number ${unit} out of 0…${UNIT - 1}`)
  if (k >= POLYGONS) throw new Error(`record ${unit} has more than ${POLYGONS} polygons`)
  return unit + k * UNIT
}

/** Sections a source: 2^16 (written out, as the build calls no `**`: map-key.test.ts). */
const SECTIONS = 65536
/** A slot's step in an id: 2^32, so the slot leaves `id | 0` alone. */
const SLOT = 4294967296

/** The id of a building of `source` in section `section` (its code) with local number `local`. */
export const surveyId = (source: SurveySource, section: number, local: number): number => {
  if (!Number.isInteger(section) || section < 0 || section >= SECTIONS)
    throw new Error(`section code ${section} out of 0…${SECTIONS - 1}`)
  return -(local + SLOT * (SOURCES[source] * SECTIONS + section))
}
