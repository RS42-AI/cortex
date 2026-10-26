import { describe, expect, it } from "vitest"
import {
  listUnits,
  corpusVersion,
  loadContentIndex,
  publicNoteUrl,
  resolvedLinks,
  searchContent,
  validateContentIndex,
} from "../src/content"
import { indexFixture } from "./fixtures"
import type { CortexIndex } from "../src/types"

describe("Cortex content", () => {
  it("validates the generated Quartz index contract", () => {
    expect(validateContentIndex(indexFixture)).toEqual(indexFixture)
    expect(() => validateContentIndex({ bad: { title: "Missing fields" } })).toThrow(
      "Invalid Cortex content entry",
    )
  })

  it("loads the build-validated bundled public index", () => {
    const index = loadContentIndex()
    expect(Object.keys(index).length).toBeGreaterThan(0)
    expect(listUnits(index).length).toBeGreaterThan(0)
  })

  it("searches notes and lists ordered units", () => {
    expect(searchContent(indexFixture, "knowledge graph", 2)[0].slug).toBe(
      "01-memory/shared-memory",
    )
    expect(listUnits(indexFixture).map((entry) => entry.slug)).toEqual(["01-memory/index"])
  })

  it("builds canonical public note URLs", () => {
    expect(publicNoteUrl("01-memory/index")).toBe("https://cortex.rs42.ai/01-memory")
    expect(publicNoteUrl("01-memory/shared-memory")).toBe(
      "https://cortex.rs42.ai/01-memory/shared-memory",
    )
  })

  it("computes a stable corpus version", async () => {
    expect(await corpusVersion(indexFixture)).toHaveLength(64)
    expect(await corpusVersion(indexFixture)).toBe(await corpusVersion({ ...indexFixture }))
    expect(await corpusVersion(indexFixture)).not.toBe(
      await corpusVersion({
        ...indexFixture,
        "01-memory/shared-memory": {
          ...indexFixture["01-memory/shared-memory"],
          aliases: ["collective context"],
        },
      }),
    )
  })

  it("resolves simplified Quartz links to unit indexes", () => {
    const index: CortexIndex = {
      ...indexFixture,
      "02-connections/index": {
        slug: "02-connections/index",
        filePath: "02-connections/index.md",
        title: "Unit 2 — Connections",
        links: [],
        tags: [],
        content: "Connections let an agent reach approved systems.",
      },
    }
    index["01-memory/index"] = { ...index["01-memory/index"], links: ["02-connections"] }
    expect(resolvedLinks(index, index["01-memory/index"]).map((entry) => entry.slug)).toEqual([
      "02-connections/index",
    ])
  })
})
