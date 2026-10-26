import { describe, expect, it } from "vitest"
import { loadContentIndex } from "../../src/content"
import {
  buildChunkManifest,
  estimateTokens,
  splitIntoPassages,
} from "../../src/retrieval/chunking.ts"

describe("Cortex retrieval chunking", () => {
  it("preserves the current short public notes as stable atomic chunks", async () => {
    const index = loadContentIndex()
    const first = await buildChunkManifest(index)
    const second = await buildChunkManifest(index)

    expect(first).toEqual(second)
    expect(first.generatedFromRecords).toBe(22)
    expect(first.chunks).toHaveLength(22)
    expect(first.chunks.every((chunk) => chunk.chunkIndex === 0)).toBe(true)
    expect(first.chunks.every((chunk) => chunk.corpusVersion === first.corpusVersion)).toBe(true)
    expect(first.chunks.every((chunk) => chunk.url.startsWith("https://cortex.rs42.ai/"))).toBe(
      true,
    )
  })

  it("splits future long notes at headings within the approximate token ceiling", () => {
    const paragraph = Array.from({ length: 180 }, (_, index) => `word${index}`).join(" ")
    const markdown = `# First section\n\n${paragraph}\n\n## Second section\n\n${paragraph}\n\n## Third section\n\n${paragraph}`
    const passages = splitIntoPassages(markdown, 100, 220)

    expect(passages.length).toBeGreaterThan(1)
    expect(passages.every((passage) => estimateTokens(passage.text) <= 220)).toBe(true)
    expect(passages.some((passage) => passage.heading === "Second section")).toBe(true)
  })
})
