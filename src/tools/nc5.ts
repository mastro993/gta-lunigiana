// Adapter (c) on Regione Liguria's NC5 (DB Geotopografico National Core 1:5000, La Spezia's lot,
// CC BY 4.0; `liguria.ts`): the national schema of DM 10/11/2011, as the DBT 1:2000 (dbt.ts), in
// EPSG:25832, 3D, read into the survey record of ctr.ts from the files `fetch-lig` writes
// (data/raw/lig/<part>/nc5/<layer>.json.gz). A feature on two parts' boxes is in both their files and
// read once, by its source reference (`classref`, `subregid`).
// - Buildings: the footprints of L6871 ("Edificio", ingombro al suolo) and L6870 (minor buildings),
//   their kind from `edifc_*` or `edi_min_*` through the DBT's `kindOf`. A footprint's Z is its eave
//   (the restitution draws it at the eave): flat on 2,092 of the town's 2,098 L6871 footprints, each
//   part of a multipolygon at its own (five, stepped eaves), so each polygon is a building with the
//   highest Z of its rings as the eave; a minor building's Z is its eave too (on the sheds with a
//   spot height at their foot, 0.63–5.42 m over it). NC5 has no height field, no names and no
//   monument flag set.
// - Road surfaces: the carriageways of L6858 ("Area di circolazione veicolare"), but those in a
//   tunnel (`ac_vei_sed` 03), all paved (no field gives the surface) and unnamed. They leave out the
//   sidewalks (L6859), so they are narrower than the CTR's road surfaces.
// - The mapped area: L6945, the lot's restitution ("Porzione di territorio restituito").
// Ids (survey-ids.ts): the source `nc5`, the section its 1:5000 element (`classref`'s prefix,
// `element5k`) and the local number its serial and the polygon's place in the feature.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"

import { type BuildingSpec, buildingsOf, local, polygonsOf, type Survey, specOf } from "./ctr.ts"
import { kindOf } from "./dbt.ts"
import { TERRAIN_BOX } from "./geometry.ts"
import { NC5_LAYERS } from "./liguria.ts"
import type { Rect } from "./region.ts"
import type { ShpRecord } from "./shp.ts"
import { element5k, localOf, surveyId } from "./survey-ids.ts"

/** A layer's file as `fetch-lig` writes it. */
interface Nc5File {
  readonly features: ReadonlyArray<{
    readonly properties: Readonly<Record<string, string | number | null>>
    readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  }>
}

/** A feature's attributes as strings, as the DBT's `kindOf` reads them (no value: ""). */
type Attrs = Readonly<Record<string, string>>

/** A source reference ("248082_1707522"): its 1:5000 element's code and its serial. */
export const referenceOf = (ref: string): { readonly section: number; readonly serial: number } => {
  const m = /^(\d{6})_(\d{7})$/.exec(ref)
  if (m === null) throw new Error(`not an NC5 reference: ${ref}`)
  return { section: element5k(m[1]!), serial: Number(m[2]) }
}

/** The minor buildings' local ids start here, after the buildings'. */
const MINOR_FROM = 1e9

/** One polygon of a feature as a shapefile record: its rings in E, N. */
const recordOf = (rings: ReadonlyArray<ReadonlyArray<number>>, attrs: Attrs): ShpRecord => ({
  parts: rings.map((ring) => {
    const points: Array<readonly [number, number]> = []
    for (let i = 0; i + 2 < ring.length; i += 3) points.push([ring[i]!, ring[i + 1]!])
    return points
  }),
  attrs,
})

/** The highest Z of a polygon's rings, m. */
const topOf = (rings: ReadonlyArray<ReadonlyArray<number>>): number =>
  Math.max(...rings.flatMap((ring) => ring.filter((_, k) => k % 3 === 2)))

/** The spec of CTR code `code`, which `kindOf` only ever names from the CTR's building codes. */
const spec = (code: string): BuildingSpec => {
  const s = specOf(code)
  if (s === undefined) throw new Error(`no building code ${code}`)
  return s
}

/** The NC5 in the parts' folders `dirs` (data/raw/lig/<part>/nc5), clipped to `box`: see the module header. */
export const readNc5 = (dirs: ReadonlyArray<string>, box: Rect = TERRAIN_BOX): Survey => {
  /** Every feature of `layer` over the folders, each once by its reference `key`, attributes as strings. */
  const layer = (name: string, key: string) => {
    const seen = new Set<string>()
    return dirs.flatMap((dir) => {
      const path = join(dir, `${name}.json.gz`)
      if (!existsSync(path)) return []
      const file = JSON.parse(gunzipSync(readFileSync(path)).toString()) as Nc5File
      return file.features.flatMap(({ properties, polygons }) => {
        const attrs: Attrs = Object.fromEntries(
          Object.entries(properties).map(([k, v]) => [k, v === null ? "" : String(v)]),
        )
        const ref = attrs[key] ?? ""
        if (ref === "") throw new Error(`${name}: a feature without its ${key}`)
        if (seen.has(ref)) return []
        seen.add(ref)
        return [{ ref, attrs, polygons }]
      })
    })
  }
  /** The buildings of a footprint layer, each polygon at its own eave, minor ones' ids from `base`. */
  const footprints = (name: string, base: number, attrsOf: (a: Attrs) => Attrs) =>
    layer(name, "classref").flatMap(({ ref, attrs, polygons }) => {
      const code = kindOf(attrsOf(attrs))
      if (code === undefined) return []
      const { section, serial } = referenceOf(ref)
      return polygons.flatMap((rings, k) => {
        const outlines = polygonsOf(recordOf(rings, attrs), local, box)
        // One outer ring and its holes, so one building (or none, beyond the box).
        if (outlines.length > 1) throw new Error(`${name} ${ref}: polygon ${k} has two outer rings`)
        return buildingsOf(outlines, spec(code), topOf(rings), () =>
          surveyId("nc5", section, base + localOf(serial, k)),
        )
      })
    })
  const buildings = [
    ...footprints(NC5_LAYERS.buildings, 0, (a) => a),
    // A minor building's type and state, in the codes of the DBT's.
    ...footprints(NC5_LAYERS.minor, MINOR_FROM, (a) => ({
      edi_min_ty: a.edi_min_ty ?? "",
      edifc_stat: a.edi_min_st ?? "",
    })),
  ]
  const roadAreas = layer(NC5_LAYERS.carriageways, "subregid").flatMap(({ attrs, polygons }) =>
    attrs.ac_vei_sed === "03"
      ? []
      : polygons.flatMap((rings) =>
          polygonsOf(recordOf(rings, attrs), local, box).map((r) => ({ paved: true, rings: r })),
        ),
  )
  const mapped = layer(NC5_LAYERS.mapped, "classid").flatMap(({ attrs, polygons }) =>
    polygons.flatMap((rings) => polygonsOf(recordOf(rings, attrs), local, box).map((r) => r[0]!)),
  )
  return { buildings, roadAreas, mapped }
}
