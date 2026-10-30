import assert from "node:assert/strict"
import { test } from "node:test"

import { CATEGORIES, parseArgs } from "../map-diff-args.ts"

test("the command line: two maps, and --except with a comma list of categories anywhere; anything else is refused", () => {
  assert.deepEqual(parseArgs(["a.bin", "b.bin"]), { a: "a.bin", b: "b.bin", except: new Set() })
  assert.deepEqual(parseArgs(["--except", "trees,top level", "a.bin", "b.bin"]), {
    a: "a.bin",
    b: "b.bin",
    except: new Set(["trees", "top level"]),
  })
  assert.deepEqual(
    parseArgs(["a.bin", "b.bin", "--except", CATEGORIES.join(",")]).except,
    new Set(CATEGORIES),
  )
  assert.throws(() => parseArgs(["a.bin"]), /^Error: usage/)
  assert.throws(() => parseArgs(["a.bin", "b.bin", "c.bin"]), /^Error: usage/)
  assert.throws(() => parseArgs(["a.bin", "b.bin", "--except"]), /--except takes a category list/)
  assert.throws(
    () => parseArgs(["a.bin", "b.bin", "--except", "trees,tree"]),
    /--except: no category "tree"; the categories: unhandled keys, top level, tiles/,
  )
})
