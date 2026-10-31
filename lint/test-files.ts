/**
 * The `test-files` oxlint plugin: where the tests live. Registered in `.oxlintrc.json` as
 * `"jsPlugins": ["./lint/test-files.ts"]`; each plugin in `lint/` is its own file, named after it.
 *
 * @module lint/test-files
 */
import { basename, dirname } from "node:path"

import { definePlugin, defineRule } from "@oxlint/plugins"

/**
 * Whether `filename` is a test (`*.test.ts`, or a map check `*.map-test.ts`) that does not sit
 * directly in a `__tests__` folder.
 */
export const misplacedTest = (filename: string): boolean =>
  /\.(test|map-test)\.ts$/.test(filename) && basename(dirname(filename)) !== "__tests__"

/** A test sits in a `__tests__` folder beside the module it tests. */
const inTestsFolder = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Keep each test in a `__tests__` folder beside the module it tests." },
    messages: {
      move: "Move this test into a `__tests__` folder beside the module it tests: `src/a/b.ts` is tested by `src/a/__tests__/b.test.ts`.",
    },
    schema: [],
  },
  create: (context) => ({
    Program: (node) => {
      if (misplacedTest(context.filename)) context.report({ node, messageId: "move" })
    },
  }),
})

export default definePlugin({
  meta: { name: "test-files" },
  rules: { "in-tests-folder": inTestsFolder },
})
