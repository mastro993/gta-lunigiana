// How a part tool's picks differ from a list in the part's manifest (`manifest.ts`): what
// `pick-sheets` and `pick-lidar` print before `--write` replaces the list.

/** The names the picks add, those they drop, and the common ones whose place in the order changed. */
interface ListDiff {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
  /** Each with its 1-based place in the manifest's list and in the picks. */
  readonly moved: ReadonlyArray<{
    readonly name: string
    readonly from: number
    readonly to: number
  }>
}

/**
 * The difference from `listed` (the manifest) to `picks`. A common name is moved when it falls
 * outside the longest run both lists hold in the same order, so one moved name reports only itself.
 */
export const diffList = (listed: ReadonlyArray<string>, picks: ReadonlyArray<string>): ListDiff => {
  const inPicks = new Set(picks),
    inListed = new Set(listed)
  const a = listed.filter((n) => inPicks.has(n)),
    b = picks.filter((n) => inListed.has(n))
  // Longest common subsequence of a and b: lcs[i][j] for the suffixes a[i..], b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const inOrder = new Set<string>()
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) {
      inOrder.add(a[i]!)
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++
    else j++
  return {
    added: picks.filter((n) => !inListed.has(n)),
    removed: listed.filter((n) => !inPicks.has(n)),
    moved: b
      .filter((n) => !inOrder.has(n))
      .map((name) => ({ name, from: listed.indexOf(name) + 1, to: picks.indexOf(name) + 1 })),
  }
}

/** The lines that describe `diff` against the manifest at `path` (repo-relative). */
export const diffLines = (diff: ListDiff, path: string): Array<string> =>
  diff.added.length + diff.removed.length + diff.moved.length === 0
    ? [`same as ${path}`]
    : [
        `against ${path}:`,
        ...diff.added.map((n) => `  added   ${n}`),
        ...diff.removed.map((n) => `  removed ${n}`),
        ...diff.moved.map((m) => `  moved   ${m.name} (#${m.from} there, #${m.to} here)`),
      ]
