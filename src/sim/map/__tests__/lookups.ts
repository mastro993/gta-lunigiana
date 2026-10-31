// Run by anchor.test.ts: node src/sim/map/__tests__/lookups.ts '<JSON [[x, y], ...]>'. Loads
// Lunigiana's map as built and prints, as JSON, `heightAt`, `terrainZ` and `coverAt` at each point:
// what the test compares a map whose anchor is not its first node with, to the bit (JSON keeps a
// number's bits).
import { coverAt } from "../cover.ts"
import { terrainZ } from "../ground.ts"
import { heightAt } from "../index.ts"

const points = JSON.parse(process.argv[2] ?? "[]") as ReadonlyArray<readonly [number, number]>
console.log(JSON.stringify(points.map(([x, y]) => [heightAt(x, y), terrainZ(x, y), coverAt(x, y)])))
