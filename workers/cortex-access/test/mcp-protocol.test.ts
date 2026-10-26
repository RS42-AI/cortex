import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import worker from "../src/index"

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext

async function verifyProtocol(versionNegotiation?: { mode: "auto" | "legacy" }) {
  const localFetch = async (input: string | URL | Request, init?: RequestInit) =>
    worker.fetch(new Request(input, init), { ENVIRONMENT: "development" }, ctx)

  const client = new Client(
    { name: "cortex-test", version: "1.0.0" },
    versionNegotiation ? { versionNegotiation } : undefined,
  )
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("https://api.test/mcp"), {
        fetch: localFetch as typeof fetch,
      }),
    )
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "search_cortex",
      "read_cortex_note",
      "list_cortex_units",
    ])

    const search = await client.callTool({
      name: "search_cortex",
      arguments: { query: "shared memory", limit: 1 },
    })
    const searchContent = search.structuredContent as
      | { results?: Array<{ slug?: string }> }
      | undefined
    const slug = searchContent?.results?.[0]?.slug
    expect(slug).toBe("01-memory-and-knowledge-graphs/a-knowledge-graph-is-shared-memory")

    const read = await client.callTool({ name: "read_cortex_note", arguments: { slug } })
    expect(read.isError).not.toBe(true)
    expect((read.structuredContent as { slug?: string } | undefined)?.slug).toBe(slug)
  } finally {
    await client.close()
  }
}

describe("Cortex MCP protocol", () => {
  afterEach(() => vi.restoreAllMocks())

  it("completes the modern stateless discovery and search-to-read flow", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    await verifyProtocol({ mode: "auto" })
    expect(JSON.stringify(log.mock.calls)).not.toContain("shared memory")
  })

  it("retains the stateless legacy compatibility lane", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    await verifyProtocol({ mode: "legacy" })
  })
})
