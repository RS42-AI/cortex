import { HttpError } from "../http.ts"
import type { Env } from "../types.ts"
import type { SemanticCandidateProvider } from "./types.ts"

interface EmbeddingPayload {
  data?: number[][]
  shape?: number[]
}

export function createVectorizeSemanticProvider(
  env: Env,
  corpusVersion: string,
): SemanticCandidateProvider {
  if (!env.AI || !env.CORTEX_VECTORIZE) {
    throw new HttpError(
      503,
      "retrieval_unconfigured",
      "Cortex semantic retrieval is not configured yet.",
    )
  }

  return {
    async retrieve(query, limit) {
      let embedding: number[] | undefined
      try {
        const payload = (await env.AI!.run(
          (env.RETRIEVAL_EMBEDDING_MODEL ?? "@cf/baai/bge-m3") as "@cf/baai/bge-m3",
          { text: [query] },
        )) as EmbeddingPayload
        embedding = payload.data?.[0]
      } catch {
        throw new HttpError(502, "retrieval_error", "Cortex retrieval failed.")
      }
      if (!embedding || embedding.length === 0 || !embedding.every(Number.isFinite)) {
        throw new HttpError(502, "retrieval_error", "Cortex retrieval returned invalid data.")
      }

      try {
        const result = await env.CORTEX_VECTORIZE!.query(embedding, {
          topK: limit,
          returnMetadata: "all",
          filter: { corpusVersion },
        })
        return result.matches.flatMap((match) => {
          const metadataChunkId = match.metadata?.chunkId
          const chunkId = typeof metadataChunkId === "string" ? metadataChunkId : match.id
          return typeof chunkId === "string" && Number.isFinite(match.score)
            ? [{ chunkId, score: match.score }]
            : []
        })
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(502, "retrieval_error", "Cortex retrieval failed.")
      }
    },
  }
}
