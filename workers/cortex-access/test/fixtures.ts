import type { CortexIndex } from "../src/types"

export const indexFixture: CortexIndex = {
  "01-memory/index": {
    slug: "01-memory/index",
    filePath: "01-memory/index.md",
    title: "Unit 1 — Memory",
    links: ["01-memory/shared-memory"],
    tags: [],
    content: "Memory gives an agent a durable record of the work.",
  },
  "01-memory/shared-memory": {
    slug: "01-memory/shared-memory",
    filePath: "01-memory/shared-memory.md",
    title: "Shared Memory",
    links: [],
    tags: [],
    content: "A knowledge graph is a shared, inspectable memory for people and agents.",
  },
}
