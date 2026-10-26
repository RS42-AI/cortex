import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContentIndex } from "../src/content.ts"
import { buildChunkManifest } from "../src/retrieval/chunking.ts"
import { validateChunkManifest } from "../src/retrieval/manifest.ts"

const path = resolve(dirname(fileURLToPath(import.meta.url)), "../src/generated/cortex-chunks.json")
const actual = validateChunkManifest(JSON.parse(await readFile(path, "utf8")))
const expected = await buildChunkManifest(loadContentIndex())

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error("Generated Cortex chunk manifest is stale. Run pnpm build:retrieval-manifest.")
}

console.log(
  JSON.stringify({
    path,
    corpusVersion: actual.corpusVersion,
    records: actual.generatedFromRecords,
    chunks: actual.chunks.length,
    estimatedTokens: actual.chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0),
  }),
)
