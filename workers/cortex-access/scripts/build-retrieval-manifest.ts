import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContentIndex } from "../src/content.ts"
import { buildChunkManifest } from "../src/retrieval/chunking.ts"

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/generated/cortex-chunks.json",
)
const manifest = await buildChunkManifest(loadContentIndex())

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(
  JSON.stringify({
    output,
    corpusVersion: manifest.corpusVersion,
    records: manifest.generatedFromRecords,
    chunks: manifest.chunks.length,
    estimatedTokens: manifest.chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0),
  }),
)
