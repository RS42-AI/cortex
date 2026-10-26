import { queryCorpusCoverage, rankBm25 } from "./lexical.ts"
import type {
  CortexChunk,
  EvidenceSelection,
  RetrievalResult,
  SemanticCandidate,
  SemanticCandidateProvider,
} from "./types.ts"

const INSTRUCTION_BOUNDARY =
  /(?:ignore|disregard|override).{0,60}(?:instruction|note|system|prompt)|(?:reveal|show|print).{0,40}(?:system prompt|hidden instruction)|private knowledge/i

export interface HybridOptions {
  lexicalLimit: number
  semanticLimit: number
  fusionLimit: number
  maxChunks: number
  evidenceTokenBudget: number
  minimumLexicalScore: number
  minimumSemanticScore: number
  strongSemanticScore: number
  minimumQueryCoverage: number
  reciprocalRankConstant: number
}

export const DEFAULT_HYBRID_OPTIONS: HybridOptions = {
  lexicalLimit: 12,
  semanticLimit: 12,
  fusionLimit: 12,
  maxChunks: 6,
  evidenceTokenBudget: 2_500,
  minimumLexicalScore: 8,
  // Calibrated against the live bge-m3 Vectorize index (2026-08-25). Supported
  // questions bottom out at 0.510 and unsupported ones top out at 0.410, so the
  // floor sits mid-gap. Raising it to 0.52 produces a false abstention.
  minimumSemanticScore: 0.46,
  strongSemanticScore: 0.65,
  minimumQueryCoverage: 0.5,
  reciprocalRankConstant: 30,
}

export function isInstructionBoundaryQuery(query: string): boolean {
  return INSTRUCTION_BOUNDARY.test(query)
}

export function mapSemanticCandidates(
  chunks: CortexChunk[],
  candidates: SemanticCandidate[],
): RetrievalResult[] {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const seen = new Set<string>()
  return candidates.flatMap((candidate, index) => {
    const chunk = chunksById.get(candidate.chunkId)
    if (!chunk || seen.has(chunk.id) || !Number.isFinite(candidate.score)) return []
    seen.add(chunk.id)
    return [
      {
        chunk,
        score: candidate.score,
        ranks: { semantic: index + 1 },
        channelScores: { semantic: candidate.score },
      },
    ]
  })
}

export function fuseResults(
  lexical: RetrievalResult[],
  semantic: RetrievalResult[],
  limit = DEFAULT_HYBRID_OPTIONS.fusionLimit,
  reciprocalRankConstant = DEFAULT_HYBRID_OPTIONS.reciprocalRankConstant,
): RetrievalResult[] {
  const fused = new Map<string, RetrievalResult>()
  const add = (result: RetrievalResult, channel: "lexical" | "semantic", rank: number) => {
    const current = fused.get(result.chunk.id) ?? {
      chunk: result.chunk,
      score: 0,
      ranks: {},
      channelScores: {},
    }
    current.score += 1 / (reciprocalRankConstant + rank)
    current.ranks[channel] = rank
    current.channelScores[channel] = result.channelScores[channel]
    fused.set(result.chunk.id, current)
  }

  lexical.forEach((result, index) => add(result, "lexical", index + 1))
  semantic.forEach((result, index) => add(result, "semantic", index + 1))

  return [...fused.values()]
    .map((result) => ({
      ...result,
      score: result.chunk.isIndex ? result.score * 0.75 : result.score,
    }))
    .sort((left, right) => {
      return right.score - left.score || left.chunk.id.localeCompare(right.chunk.id)
    })
    .slice(0, limit)
}

function isConfident(
  result: RetrievalResult,
  queryCoverage: number,
  options: HybridOptions,
): boolean {
  const lexical = result.channelScores.lexical ?? 0
  const semantic = result.channelScores.semantic ?? 0
  const agrees = result.ranks.lexical !== undefined && result.ranks.semantic !== undefined
  const semanticSupport =
    semantic >= options.minimumSemanticScore &&
    (queryCoverage >= options.minimumQueryCoverage || semantic >= options.strongSemanticScore)
  const lexicalSupport =
    lexical >= options.minimumLexicalScore && queryCoverage >= options.minimumQueryCoverage
  return semanticSupport || lexicalSupport || (agrees && semantic >= options.strongSemanticScore)
}

export async function retrieveHybridEvidence(
  chunks: CortexChunk[],
  query: string,
  semanticProvider: SemanticCandidateProvider,
  overrides: Partial<HybridOptions> = {},
): Promise<EvidenceSelection> {
  const options = { ...DEFAULT_HYBRID_OPTIONS, ...overrides }
  if (isInstructionBoundaryQuery(query)) {
    return { supported: false, reason: "instruction_boundary", results: [], evidenceTokens: 0 }
  }

  const lexical = rankBm25(chunks, query).slice(0, options.lexicalLimit)
  const semantic = mapSemanticCandidates(
    chunks,
    await semanticProvider.retrieve(query, options.semanticLimit),
  )
  const fused = fuseResults(lexical, semantic, options.fusionLimit, options.reciprocalRankConstant)
  if (fused.length === 0) {
    return { supported: false, reason: "no_candidates", results: [], evidenceTokens: 0 }
  }
  if (!isConfident(fused[0], queryCorpusCoverage(chunks, query), options)) {
    return { supported: false, reason: "low_confidence", results: [], evidenceTokens: 0 }
  }

  const results: RetrievalResult[] = []
  let evidenceTokens = 0
  const evidenceOrder = [
    ...fused.filter((result) => !result.chunk.isIndex),
    ...fused.filter((result) => result.chunk.isIndex),
  ]
  for (const result of evidenceOrder) {
    if (results.length >= options.maxChunks) break
    if (evidenceTokens + result.chunk.estimatedTokens > options.evidenceTokenBudget) continue
    results.push(result)
    evidenceTokens += result.chunk.estimatedTokens
  }

  return results.length === 0
    ? { supported: false, reason: "no_candidates", results: [], evidenceTokens: 0 }
    : { supported: true, reason: "supported", results, evidenceTokens }
}
