import { describe, expect, it } from "vitest"
import semanticSnapshot from "../fixtures/qmd-semantic-results.json" with { type: "json" }
import {
  DEFAULT_HYBRID_OPTIONS,
  fuseResults,
  mapSemanticCandidates,
  retrieveHybridEvidence,
} from "../../src/retrieval/hybrid.ts"
import { rankBm25 } from "../../src/retrieval/lexical.ts"
import { loadChunkManifest } from "../../src/retrieval/manifest.ts"
import type { SemanticCandidate } from "../../src/retrieval/types.ts"
import { retrievalCases, retrievalQueryForCase } from "../../scripts/retrieval-cases.ts"

const manifest = loadChunkManifest()
const semanticCases = semanticSnapshot.cases as Record<string, SemanticCandidate[]>

describe("offline retrieval quality gate", () => {
  it("meets the predeclared development and holdout top-five recall gates", () => {
    for (const partition of ["development", "holdout"] as const) {
      const supported = retrievalCases.filter(
        (testCase) => testCase.partition === partition && testCase.expectedSlugs.length > 0,
      )
      const hits = supported.filter((testCase) => {
        const query = retrievalQueryForCase(testCase)
        const semantic = mapSemanticCandidates(manifest.chunks, semanticCases[testCase.id] ?? [])
        const hybrid = fuseResults(rankBm25(manifest.chunks, query).slice(0, 12), semantic)
        return testCase.expectedSlugs.every((slug) =>
          hybrid.slice(0, 5).some((result) => result.chunk.slug === slug),
        )
      })

      expect(hits).toHaveLength(supported.length)
    }
  })

  it("abstains on every unsupported case without false abstentions or budget leaks", async () => {
    for (const testCase of retrievalCases) {
      const selection = await retrieveHybridEvidence(
        manifest.chunks,
        retrievalQueryForCase(testCase),
        {
          async retrieve() {
            return semanticCases[testCase.id] ?? []
          },
        },
      )

      expect(selection.supported).toBe(!testCase.expectAbstention)
      expect(selection.evidenceTokens).toBeLessThanOrEqual(2_500)
      expect(selection.results.length).toBeLessThanOrEqual(DEFAULT_HYBRID_OPTIONS.maxChunks)
      expect(selection.results.every((result) => !result.chunk.isIndex)).toBe(true)
      expect(new Set(selection.results.map((result) => result.chunk.slug)).size).toBe(
        selection.results.length,
      )
    }
  })
})
