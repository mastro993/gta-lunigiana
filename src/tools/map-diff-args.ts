// The command line of map-diff.ts: the categories its report has, and the two maps and the
// categories `--except` accepts, whose differences are printed but leave the exit code 0.

/** Every category `diffMaps` reports, in its order: the names `--except` takes. */
export const CATEGORIES = [
  "unhandled keys",
  "top level",
  "tiles",
  "heightmap",
  "cover",
  "walls",
  "coarse",
  "trees",
  "roads",
  "buildings",
  "water",
  "rail",
  "railway",
  "areas",
  "barriers",
  "pois",
  "districts",
  "spawns",
  "graph",
  "lanes",
  "farms",
  "lamps",
] as const

/** A category of `diffMaps` (map-diff.ts). */
export type Category = (typeof CATEGORIES)[number]

/** 0 when every category that differs is `accepted`, 1 when another differs: the exit code. */
export const exitCodeOf = (
  blocks: ReadonlyArray<{ readonly category: Category }>,
  accepted: ReadonlySet<Category>,
): 0 | 1 => (blocks.every((block) => accepted.has(block.category)) ? 0 : 1)

const USAGE = "usage: node src/tools/map-diff.ts <a.bin> <b.bin> [--except <category,...>]"

/** The two map paths and the categories `--except` accepts, from the command line's arguments; throws on anything else. */
export const parseArgs = (
  args: ReadonlyArray<string>,
): { readonly a: string; readonly b: string; readonly except: ReadonlySet<Category> } => {
  const paths: Array<string> = [],
    except = new Set<Category>()
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!
    if (arg !== "--except") {
      paths.push(arg)
      continue
    }
    const list = args[++k]
    if (list === undefined) throw new Error(`--except takes a category list; ${USAGE}`)
    for (const name of list.split(",").map((s) => s.trim())) {
      const category = CATEGORIES.find((c) => c === name)
      if (category === undefined)
        throw new Error(`--except: no category "${name}"; the categories: ${CATEGORIES.join(", ")}`)
      except.add(category)
    }
  }
  const [a, b, ...rest] = paths
  if (a === undefined || b === undefined || rest.length > 0) throw new Error(USAGE)
  return { a, b, except }
}
