import { describe, expect, it } from "vitest"
import { listUnitResults } from "../src/mcp"
import { indexFixture } from "./fixtures"

describe("Cortex MCP tools", () => {
  it("lists units in curriculum order with their notes", () => {
    expect(listUnitResults(indexFixture, true)).toEqual([
      {
        slug: "01-memory/index",
        title: "Unit 1 — Memory",
        url: "https://cortex.rs42.ai/01-memory",
        position: 1,
        noteCount: 2,
        notes: [
          {
            slug: "01-memory/index",
            title: "Unit 1 — Memory",
            url: "https://cortex.rs42.ai/01-memory",
          },
          {
            slug: "01-memory/shared-memory",
            title: "Shared Memory",
            url: "https://cortex.rs42.ai/01-memory/shared-memory",
          },
        ],
      },
    ])
  })

  it("can omit note details without changing counts", () => {
    expect(listUnitResults(indexFixture, false)[0]).toMatchObject({ noteCount: 2, notes: [] })
  })
})
