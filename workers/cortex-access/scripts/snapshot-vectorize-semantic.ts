import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadChunkManifest } from "../src/retrieval/manifest.ts"
import type { SemanticCandidate } from "../src/retrieval/types.ts"
import { retrievalCases, retrievalQueryForCase } from "./retrieval-cases.ts"

/**
 * Queries the live Vectorize preview index for every retrieval case and writes a
 * semantic-results snapshot in the same shape `evaluate-retrieval.ts` already
 * consumes. This lets the committed evaluator score real `bge-m3` candidates
 * without a second harness, so the offline and live comparisons stay identical.
 *
 * Read-only against Vectorize. It never inserts, updates, or deletes vectors.
 */

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const model = process.env.RETRIEVAL_EMBEDDING_MODEL ?? "@cf/baai/bge-m3"
const indexName = process.env.CORTEX_VECTORIZE_INDEX
const topK = Number(process.env.CORTEX_SEMANTIC_TOP_K ?? "12")

if (!accountId || !apiToken || !indexName) {
  console.error(
    [
      "Missing Cloudflare credentials or CORTEX_VECTORIZE_INDEX. This is setup, not a crash.",
      "",
      "  export CLOUDFLARE_ACCOUNT_ID=...",
      "  export CLOUDFLARE_API_TOKEN=...",
      "  export CORTEX_VECTORIZE_INDEX=your-index-name",
    ].join("\n"),
  )
  process.exit(1)
}

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
const headers = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" }

async function call<T>(url: string, body: unknown, label: string): Promise<T> {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
  const payload = (await response.json()) as {
    success?: boolean
    result?: T
    errors?: { code?: number; message?: string }[]
  }
  if (!response.ok || !payload.success || payload.result === undefined) {
    const detail = payload.errors?.map((error) => `${error.code}: ${error.message}`).join("; ")
    throw new Error(`${label} failed (${response.status}). ${detail ?? ""}`.trim())
  }
  return payload.result
}

async function embed(text: string): Promise<number[]> {
  const result = await call<{ data?: number[][] }>(
    `${base}/ai/run/${model}`,
    { text: [text] },
    "Embedding",
  )
  const vector = result.data?.[0]
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new Error("Workers AI returned an invalid embedding vector.")
  }
  return vector
}

const manifest = loadChunkManifest()
const knownChunkIds = new Set(manifest.chunks.map((chunk) => chunk.id))
const cases: Record<string, SemanticCandidate[]> = {}
const latencyMs: Record<string, number> = {}
let unmatched = 0

for (const testCase of retrievalCases) {
  const startedAt = performance.now()
  const vector = await embed(retrievalQueryForCase(testCase))
  const result = await call<{ matches?: { id: string; score: number; metadata?: unknown }[] }>(
    `${base}/vectorize/v2/indexes/${indexName}/query`,
    {
      vector,
      topK,
      returnMetadata: "all",
      filter: { corpusVersion: manifest.corpusVersion },
    },
    "Vectorize query",
  )

  const candidates: SemanticCandidate[] = []
  const seen = new Set<string>()
  for (const match of result.matches ?? []) {
    const metadata = match.metadata as { chunkId?: unknown } | undefined
    const chunkId = typeof metadata?.chunkId === "string" ? metadata.chunkId : match.id
    if (!knownChunkIds.has(chunkId)) {
      unmatched += 1
      continue
    }
    if (seen.has(chunkId) || !Number.isFinite(match.score)) continue
    seen.add(chunkId)
    candidates.push({ chunkId, score: match.score })
  }

  cases[testCase.id] = candidates
  latencyMs[testCase.id] = Math.round(performance.now() - startedAt)
  console.error(`${testCase.id}: ${candidates.length} candidates`)
}

const emptyCases = Object.entries(cases).filter(([, candidates]) => candidates.length === 0)
if (emptyCases.length === retrievalCases.length) {
  throw new Error(
    "Every case returned zero candidates. The corpusVersion metadata filter is probably " +
      "not applied — confirm the metadata index existed before the vectors were inserted.",
  )
}

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.wrangler/vectorize-semantic-results.json",
)
await mkdir(dirname(output), { recursive: true })
await writeFile(
  output,
  `${JSON.stringify(
    {
      engine: `Cloudflare Vectorize (${indexName})`,
      model,
      corpusVersion: manifest.corpusVersion,
      cases,
      latencyMs,
    },
    null,
    2,
  )}\n`,
  "utf8",
)

const latencies = Object.values(latencyMs)
console.log(
  JSON.stringify({
    output,
    cases: Object.keys(cases).length,
    emptyCases: emptyCases.length,
    unmatchedChunkIds: unmatched,
    meanLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    maxLatencyMs: Math.max(...latencies),
  }),
)
