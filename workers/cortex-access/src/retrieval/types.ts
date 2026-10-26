export interface CortexChunk {
  id: string
  corpusVersion: string
  slug: string
  title: string
  heading: string | null
  aliases: string[]
  tags: string[]
  url: string
  unit: string | null
  contentHash: string
  chunkIndex: number
  text: string
  estimatedTokens: number
  isIndex: boolean
}

export interface CortexChunkManifest {
  version: 1
  corpusVersion: string
  generatedFromRecords: number
  chunks: CortexChunk[]
}

export interface RetrievalResult {
  chunk: CortexChunk
  score: number
  ranks: {
    lexical?: number
    semantic?: number
  }
  channelScores: {
    lexical?: number
    semantic?: number
  }
}

export interface SemanticCandidate {
  chunkId: string
  score: number
}

export interface SemanticCandidateProvider {
  retrieve(query: string, limit: number): Promise<SemanticCandidate[]>
}

export interface EvidenceSelection {
  supported: boolean
  reason: "supported" | "instruction_boundary" | "low_confidence" | "no_candidates"
  results: RetrievalResult[]
  evidenceTokens: number
}
