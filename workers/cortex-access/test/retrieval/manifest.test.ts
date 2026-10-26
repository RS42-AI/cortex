import { describe, expect, it } from "vitest"
import bundledManifest from "../../src/generated/cortex-chunks.json" with { type: "json" }
import { validateChunkManifest } from "../../src/retrieval/manifest.ts"

describe("Cortex chunk manifest", () => {
  it("validates the generated manifest and rejects duplicate chunk IDs", () => {
    const manifest = validateChunkManifest(bundledManifest)
    expect(manifest.chunks.length).toBeGreaterThan(0)

    expect(() =>
      validateChunkManifest({
        ...manifest,
        chunks: [...manifest.chunks, manifest.chunks[0]],
      }),
    ).toThrow("duplicate IDs")
  })
})
