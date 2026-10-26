import { describe, expect, it, vi } from "vitest"
import { HttpError } from "../../src/http"
import { createVectorizeSemanticProvider } from "../../src/retrieval/vectorize.ts"
import type { CortexVectorizeIndex } from "../../src/types"

describe("Vectorize semantic candidate adapter", () => {
  it("embeds locally through the binding and filters candidates to the corpus version", async () => {
    const query = vi.fn(async () => ({
      matches: [
        {
          id: "vector-id",
          score: 0.88,
          metadata: { chunkId: "public-note::000::abc" },
        },
      ],
    }))
    const ai = {
      run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]], shape: [1, 3] })),
    } as unknown as Ai
    const provider = createVectorizeSemanticProvider(
      { AI: ai, CORTEX_VECTORIZE: { query } as CortexVectorizeIndex },
      "corpus-v1",
    )

    await expect(provider.retrieve("bounded retrieval", 12)).resolves.toEqual([
      { chunkId: "public-note::000::abc", score: 0.88 },
    ])
    expect(query).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      topK: 12,
      returnMetadata: "all",
      filter: { corpusVersion: "corpus-v1" },
    })
  })

  it("fails closed when semantic bindings are absent", () => {
    expect(() => createVectorizeSemanticProvider({}, "corpus-v1")).toThrow(HttpError)
  })
})
