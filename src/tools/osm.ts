// OSM API 0.6 XML reader (regex based; the file comes from the API via fetch-osm.ts, so the layout is fixed)
// and multipolygon ring assembly. Ported from .research/scratch-osm-monzone/{lib,geo}.ts.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

export type Tags = Record<string, string>
interface OsmNode {
  readonly id: string
  readonly lat: number
  readonly lon: number
  readonly tags: Tags
}
export interface OsmWay {
  readonly id: string
  readonly nds: ReadonlyArray<string>
  readonly tags: Tags
}
interface OsmMember {
  readonly type: string
  readonly ref: string
  readonly role: string
}
interface OsmRelation {
  readonly id: string
  readonly members: ReadonlyArray<OsmMember>
  readonly tags: Tags
}
export interface Osm {
  readonly nodes: Map<string, OsmNode>
  readonly ways: Map<string, OsmWay>
  readonly relations: Map<string, OsmRelation>
}

const NAMED: Tags = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" }
const unescape = (s: string) =>
  s.replaceAll(
    /&(quot|amp|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,
    (_, e: string) =>
      NAMED[e] ??
      String.fromCodePoint(
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      ),
  )

const attrs = (s: string): Tags => {
  const out: Tags = {}
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = unescape(m[2]!)
  return out
}

/**
 * A copy of `s`, a match in the file's text, that holds none of it: a match is a slice of the text,
 * so a value the build keeps (a road's name) would keep the whole text alive (18.6 M characters,
 * 37 MB, for Lunigiana) until the map is written.
 */
const own = (s: string) => Buffer.from(s).toString()

const tagsOf = (body: string): Tags => {
  const t: Tags = {}
  for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g))
    t[unescape(m[1]!)] = own(unescape(m[2]!))
  return t
}

const parseOsm = (xml: string): Osm => {
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  for (const m of xml.matchAll(/<(node|way|relation)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const a = attrs(m[2]!)
    const body = m[3] ?? ""
    const tags = tagsOf(body)
    const id = a.id!
    if (m[1] === "node") osm.nodes.set(id, { id, lat: +a.lat!, lon: +a.lon!, tags })
    else if (m[1] === "way")
      osm.ways.set(id, { id, nds: [...body.matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]!), tags })
    else
      osm.relations.set(id, {
        id,
        tags,
        members: [...body.matchAll(/<member\s([^>]*)\/>/g)].map((x) => {
          const ma = attrs(x[1]!)
          return { type: ma.type!, ref: ma.ref!, role: ma.role ?? "" }
        }),
      })
  }
  return osm
}

/** Reads an OSM XML file, gzipped when the name ends in .gz. */
export const readOsm = (path: string): Osm => {
  const raw = readFileSync(path)
  return parseOsm((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"))
}

/** Joins a relation's member ways with `role` into closed rings of node ids (first id repeated last). Unclosed chains are dropped. */
export const assembleRings = (osm: Osm, rel: OsmRelation, role: string): Array<Array<string>> => {
  const chains = rel.members
    .filter((m) => m.type === "way" && m.role === role && osm.ways.has(m.ref))
    .map((m) => [...osm.ways.get(m.ref)!.nds])
  const rings: Array<Array<string>> = []
  while (chains.length > 0) {
    let cur = chains.shift()!
    for (let grown = true; cur[0] !== cur.at(-1) && grown;) {
      grown = false
      for (let i = 0; i < chains.length; i++) {
        const c = chains[i]!
        if (c[0] === cur.at(-1)) cur = cur.concat(c.slice(1))
        else if (c.at(-1) === cur.at(-1)) cur = cur.concat(c.slice(0, -1).reverse())
        else if (c.at(-1) === cur[0]) cur = c.concat(cur.slice(1))
        else if (c[0] === cur[0]) cur = c.slice(1).reverse().concat(cur)
        else continue
        chains.splice(i, 1)
        grown = true
        break
      }
    }
    if (cur[0] === cur.at(-1)) rings.push(cur)
  }
  return rings
}
