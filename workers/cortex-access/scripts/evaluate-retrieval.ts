import { readFile } from "node:fs/promises"
import { loadContentIndex, rankContent } from "../src/content.ts"
import {
  isInstructionBoundaryQuery,
  fuseResults,
  mapSemanticCandidates,
} from "../src/retrieval/hybrid.ts"
import { queryCorpusCoverage, rankBm25 } from "../src/retrieval/lexical.ts"
import { loadChunkManifest } from "../src/retrieval/manifest.ts"
import type { CortexChunk, RetrievalResult, SemanticCandidate } from "../src/retrieval/types.ts"
import { retrievalCases, retrievalQueryForCase } from "./retrieval-cases.ts"

const lexicalAbstentionFloor = Number(process.env.CORTEX_LEXICAL_ABSTENTION_FLOOR ?? "8")
const semanticAbstentionFloor = Number(process.env.CORTEX_SEMANTIC_ABSTENTION_FLOOR ?? "0.5")
const queryCoverageFloor = Number(process.env.CORTEX_QUERY_COVERAGE_FLOOR ?? "0.5")
const evidenceTokenBudget = Number(process.env.CORTEX_EVIDENCE_TOKEN_BUDGET ?? "2500")
const maxEvidenceChunks = Number(process.env.CORTEX_MAX_EVIDENCE_CHUNKS ?? "5")
const semanticResultsPath = process.env.CORTEX_SEMANTIC_RESULTS

interface SemanticSnapshot {
  engine: string
  model: string
  corpusVersion: string
  cases: Record<string, SemanticCandidate[]>
  latencyMs?: Record<string, number>
}

const manifest = loadChunkManifest()
const index = loadContentIndex()
const chunksBySlug = new Map<string, CortexChunk[]>()
for (const chunk of manifest.chunks) {
  const current = chunksBySlug.get(chunk.slug) ?? []
  current.push(chunk)
  chunksBySlug.set(chunk.slug, current)
}

let semanticSnapshot: SemanticSnapshot | undefined
if (semanticResultsPath) {
  semanticSnapshot = JSON.parse(await readFile(semanticResultsPath, "utf8")) as SemanticSnapshot
  if (semanticSnapshot.corpusVersion !== manifest.corpusVersion) {
    throw new Error("Semantic result snapshot does not match the current Cortex corpus.")
  }
}

function baselineResults(question: string): RetrievalResult[] {
  return rankContent(index, question).flatMap((result, rank) => {
    const chunk = chunksBySlug.get(result.slug)?.[0]
    return chunk
      ? [
          {
            chunk,
            score: result.score,
            ranks: { lexical: rank + 1 },
            channelScores: { lexical: result.score },
          },
        ]
      : []
  })
}

function selectUnderBudget(results: RetrievalResult[], preferSpecific = false): RetrievalResult[] {
  const selected: RetrievalResult[] = []
  let tokens = 0
  const ordered = preferSpecific
    ? [
        ...results.filter((result) => !result.chunk.isIndex),
        ...results.filter((result) => result.chunk.isIndex),
      ]
    : results
  for (const result of ordered) {
    if (selected.length >= maxEvidenceChunks) break
    if (tokens + result.chunk.estimatedTokens > evidenceTokenBudget) continue
    selected.push(result)
    tokens += result.chunk.estimatedTokens
  }
  return selected
}

function reciprocalRank(results: RetrievalResult[], expectedSlugs: string[]): number | null {
  if (expectedSlugs.length === 0) return null
  const first = results.findIndex((result) => expectedSlugs.includes(result.chunk.slug))
  return first < 0 ? 0 : 1 / (first + 1)
}

function resultReport(
  results: RetrievalResult[],
  expectedSlugs: string[],
  abstained: boolean,
  latencyMs: number,
  preferSpecific = false,
) {
  const selected = abstained ? [] : selectUnderBudget(results, preferSpecific)
  const selectedSlugs = selected.map((result) => result.chunk.slug)
  return {
    abstained,
    latencyMs: Number(latencyMs.toFixed(3)),
    top6: results.slice(0, 6).map((result) => ({
      slug: result.chunk.slug,
      chunkId: result.chunk.id,
      score: Number(result.score.toFixed(6)),
      lexicalScore: result.channelScores.lexical,
      semanticScore: result.channelScores.semantic,
      tokens: result.chunk.estimatedTokens,
      isIndex: result.chunk.isIndex,
    })),
    allRequiredAt: Object.fromEntries(
      [3, 4, 5, 6].map((limit) => [
        limit,
        expectedSlugs.length > 0 &&
          expectedSlugs.every((slug) =>
            results.slice(0, limit).some((result) => result.chunk.slug === slug),
          ),
      ]),
    ),
    reciprocalRank: reciprocalRank(results, expectedSlugs),
    selectedEvidenceTokens: selected.reduce((sum, result) => sum + result.chunk.estimatedTokens, 0),
    selectedChunks: selected.length,
    duplicateSlugs: selectedSlugs.length - new Set(selectedSlugs).size,
    rootIndexContamination: selected.filter((result) => result.chunk.isIndex).length,
  }
}

const rows: Array<{
  id: string
  partition: "development" | "holdout"
  category: string
  question: string
  expectedSlugs: string[]
  expectAbstention: boolean
  methods: Record<string, ReturnType<typeof resultReport>>
}> = []
for (const testCase of retrievalCases) {
  const query = retrievalQueryForCase(testCase)

  let startedAt = performance.now()
  const baseline = baselineResults(testCase.question)
  const baselineLatency = performance.now() - startedAt

  startedAt = performance.now()
  const bm25 = rankBm25(manifest.chunks, query)
  const bm25Latency = performance.now() - startedAt

  const methods: Record<string, ReturnType<typeof resultReport>> = {
    baseline: resultReport(
      baseline,
      testCase.expectedSlugs,
      baseline.length === 0,
      baselineLatency,
    ),
    bm25: resultReport(
      bm25,
      testCase.expectedSlugs,
      isInstructionBoundaryQuery(query) || (bm25[0]?.score ?? 0) < lexicalAbstentionFloor,
      bm25Latency,
    ),
  }

  if (semanticSnapshot) {
    startedAt = performance.now()
    const semantic = mapSemanticCandidates(
      manifest.chunks,
      semanticSnapshot.cases[testCase.id] ?? [],
    )
    const semanticLatency =
      semanticSnapshot.latencyMs?.[testCase.id] ?? performance.now() - startedAt
    const semanticAbstained =
      isInstructionBoundaryQuery(query) ||
      (semantic[0]?.channelScores.semantic ?? 0) < semanticAbstentionFloor
    methods.semantic = resultReport(
      semantic,
      testCase.expectedSlugs,
      semanticAbstained,
      semanticLatency,
    )

    startedAt = performance.now()
    const hybrid = fuseResults(bm25.slice(0, 12), semantic.slice(0, 12))
    const hybridLatency = performance.now() - startedAt + bm25Latency + semanticLatency
    const hybridAbstained =
      isInstructionBoundaryQuery(query) ||
      (((hybrid[0]?.channelScores.semantic ?? 0) < semanticAbstentionFloor ||
        (queryCorpusCoverage(manifest.chunks, query) < queryCoverageFloor &&
          (hybrid[0]?.channelScores.semantic ?? 0) < 0.65)) &&
        ((hybrid[0]?.channelScores.lexical ?? 0) < lexicalAbstentionFloor ||
          queryCorpusCoverage(manifest.chunks, query) < queryCoverageFloor))
    methods.hybrid = resultReport(
      hybrid,
      testCase.expectedSlugs,
      hybridAbstained,
      hybridLatency,
      true,
    )
  }

  rows.push({
    id: testCase.id,
    partition: testCase.partition,
    category: testCase.category,
    question: testCase.question,
    expectedSlugs: testCase.expectedSlugs,
    expectAbstention: Boolean(testCase.expectAbstention),
    methods,
  })
}

function summarize(partition: "development" | "holdout", method: string) {
  const partitionRows = rows.filter((row) => row.partition === partition && row.methods[method])
  const supported = partitionRows.filter((row) => row.expectedSlugs.length > 0)
  const unsupported = partitionRows.filter((row) => row.expectAbstention)
  const methodRows = partitionRows.map((row) => row.methods[method])
  return {
    cases: partitionRows.length,
    supportedCases: supported.length,
    unsupportedCases: unsupported.length,
    allRequiredRecall: Object.fromEntries(
      [3, 4, 5, 6].map((limit) => {
        const hits = supported.filter((row) => row.methods[method].allRequiredAt[limit]).length
        return [limit, { hits, total: supported.length, rate: hits / supported.length }]
      }),
    ),
    meanReciprocalRank:
      supported.reduce((sum, row) => sum + (row.methods[method].reciprocalRank ?? 0), 0) /
      Math.max(1, supported.length),
    abstention: {
      correct: unsupported.filter((row) => row.methods[method].abstained).length,
      total: unsupported.length,
      falseAbstentions: supported.filter((row) => row.methods[method].abstained).length,
    },
    evidenceTokens: {
      min: Math.min(...methodRows.map((row) => row.selectedEvidenceTokens)),
      max: Math.max(...methodRows.map((row) => row.selectedEvidenceTokens)),
      mean:
        methodRows.reduce((sum, row) => sum + row.selectedEvidenceTokens, 0) /
        Math.max(1, methodRows.length),
    },
    duplicateSlugs: methodRows.reduce((sum, row) => sum + row.duplicateSlugs, 0),
    rootIndexContamination: methodRows.reduce((sum, row) => sum + row.rootIndexContamination, 0),
    meanRetrievalLatencyMs:
      methodRows.reduce((sum, row) => sum + row.latencyMs, 0) / Math.max(1, methodRows.length),
  }
}

const methods = semanticSnapshot ? ["baseline", "bm25", "semantic", "hybrid"] : ["baseline", "bm25"]
const summary = Object.fromEntries(
  (["development", "holdout"] as const).map((partition) => [
    partition,
    Object.fromEntries(methods.map((method) => [method, summarize(partition, method)])),
  ]),
)

process.stdout.write(
  `${JSON.stringify(
    {
      corpus: {
        version: manifest.corpusVersion,
        records: manifest.generatedFromRecords,
        chunks: manifest.chunks.length,
        fullCorpusEstimatedTokens: manifest.chunks.reduce(
          (sum, chunk) => sum + chunk.estimatedTokens,
          0,
        ),
      },
      thresholds: {
        lexicalAbstentionFloor,
        semanticAbstentionFloor,
        queryCoverageFloor,
        evidenceTokenBudget,
        maxEvidenceChunks,
      },
      semantic: semanticSnapshot
        ? { engine: semanticSnapshot.engine, model: semanticSnapshot.model }
        : null,
      summary,
      rows,
    },
    null,
    2,
  )}\n`,
)
