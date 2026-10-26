import bundledContent from "../src/generated/cortex-content.json" with { type: "json" }
import { corpusVersion, listUnits, validateContentIndex } from "../src/content.ts"

const index = validateContentIndex(bundledContent)
const units = listUnits(index)
if (units.length === 0) throw new Error("The bundled Cortex corpus contains no teaching units.")

console.log(
  JSON.stringify({
    records: Object.keys(index).length,
    units: units.length,
    version: await corpusVersion(index),
  }),
)
