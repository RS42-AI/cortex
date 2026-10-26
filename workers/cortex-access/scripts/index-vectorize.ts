import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadChunkManifest } from "../src/retrieval/manifest.ts"

/**
 * Embeds the committed public chunk manifest and writes a Vectorize NDJSON payload.
 *
 * This script never mutates the Vectorize index. It only calls the Workers AI
 * embedding model and writes a local file, so index creation and insertion stay
 * explicit `wrangler vectorize` commands run by a human.
 *
 *   pnpm index:vectorize -- --probe   # embed one string, report the true dimension
 *   pnpm index:vectorize              # embed the corpus, write the NDJSON payload
 */

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const model = process.env.RETRIEVAL_EMBEDDING_MODEL ?? "@cf/baai/bge-m3"
const batchSize = Number(process.env.CORTEX_EMBED_BATCH_SIZE ?? "10")
const probeOnly = process.argv.includes("--probe")

if (!accountId || !apiToken) {
  console.error(
    [
      "Missing Cloudflare credentials. This is setup, not a crash.",
      "",
      "  export CLOUDFLARE_ACCOUNT_ID=...",
      "  export CLOUDFLARE_API_TOKEN=...",
      "",
      "This script needs Workers AI (run) permission; it does not write to Vectorize.",
      "Create one at: https://dash.cloudflare.com/profile/api-tokens",
    ].join("\n"),
  )
  process.exit(1)
}

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.wrangler/cortex-vectors.ndjson",
)

async function embed(texts: string[]): Promise<number[][]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: texts }),
    },
  )

  const payload = (await response.json()) as {
    success?: boolean
    result?: { data?: number[][] }
    errors?: { code?: number; message?: string }[]
  }

  if (!response.ok || !payload.success) {
    const detail = payload.errors?.map((error) => `${error.code}: ${error.message}`).join("; ")
    throw new Error(`Workers AI embedding failed (${response.status}). ${detail ?? ""}`.trim())
  }

  const data = payload.result?.data
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error("Workers AI returned an unexpected embedding batch shape.")
  }
  for (const vector of data) {
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
      throw new Error("Workers AI returned an invalid embedding vector.")
    }
  }
  return data
}

if (probeOnly) {
  const [vector] = await embed(["Cortex dimension probe."])
  console.log(JSON.stringify({ model, dimensions: vector.length }))
  process.exit(0)
}

const manifest = loadChunkManifest()
const vectors: number[][] = []

for (let index = 0; index < manifest.chunks.length; index += batchSize) {
  const batch = manifest.chunks.slice(index, index + batchSize)
  const embedded = await embed(batch.map((chunk) => chunk.text))
  vectors.push(...embedded)
  console.error(`embedded ${vectors.length}/${manifest.chunks.length}`)
}

const dimensions = vectors[0]?.length ?? 0
if (!vectors.every((vector) => vector.length === dimensions)) {
  throw new Error("Workers AI returned embeddings with inconsistent dimensions.")
}

// Vectorize caps vector IDs at 64 bytes and our chunk IDs run to 93, so the
// vector ID is a deterministic digest of the chunk ID. The retrieval adapter
// reads the real chunk ID back out of metadata, falling back to this digest.
const vectorId = (chunkId: string) =>
  createHash("sha256").update(chunkId).digest("hex").slice(0, 32)

const ids = manifest.chunks.map((chunk) => vectorId(chunk.id))
if (new Set(ids).size !== ids.length) {
  throw new Error("Vector ID digest collision. Widen the digest slice.")
}
for (const id of ids) {
  if (Buffer.byteLength(id) > 64) throw new Error(`Vector ID exceeds 64 bytes: ${id}`)
}

const lines = manifest.chunks.map((chunk, index) =>
  JSON.stringify({
    id: ids[index],
    values: vectors[index],
    metadata: {
      chunkId: chunk.id,
      corpusVersion: chunk.corpusVersion,
      slug: chunk.slug,
    },
  }),
)

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${lines.join("\n")}\n`, "utf8")

console.log(
  JSON.stringify({
    output,
    model,
    corpusVersion: manifest.corpusVersion,
    chunks: manifest.chunks.length,
    dimensions,
  }),
)
