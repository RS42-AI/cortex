export interface CortexIndexEntry {
  slug: string
  filePath: string
  title: string
  links: string[]
  tags: string[]
  aliases?: string[]
  content: string
  richContent?: string
}

export type CortexIndex = Record<string, CortexIndexEntry>

export interface CortexCitation {
  slug: string
  title: string
  url: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatRequest {
  question: string
  history: ChatMessage[]
}

export interface ChatResponse {
  answer: string
  citations: CortexCitation[]
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface CortexVectorizeMatch {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

export interface CortexVectorizeIndex {
  query(
    vector: number[],
    options: {
      topK: number
      returnMetadata: "all"
      filter: { corpusVersion: string }
    },
  ): Promise<{ matches: CortexVectorizeMatch[] }>
}

export interface Env {
  AI?: Ai
  CORTEX_VECTORIZE?: CortexVectorizeIndex
  CHAT_ENABLED?: string
  ENVIRONMENT?: "development" | "production"
  MCP_ENABLED?: string
  CORTEX_ALLOWED_ORIGINS?: string
  MCP_ALLOWED_HOSTNAMES?: string
  MCP_ALLOWED_ORIGINS?: string
  MODEL_API_URL?: string
  MODEL_API_GATEWAY_ID?: string
  MODEL_API_TOKEN?: string
  MODEL_NAME?: string
  RETRIEVAL_EMBEDDING_MODEL?: string
  RETRIEVAL_SEMANTIC_FLOOR?: string
  RATE_LIMITER?: RateLimiter
}
