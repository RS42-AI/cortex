import { afterEach, describe, expect, it, vi } from "vitest"
import worker from "../src/index"

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext

describe("Cortex access routes", () => {
  afterEach(() => vi.restoreAllMocks())

  it("reports health without touching the corpus or model", async () => {
    const response = await worker.fetch(new Request("https://api.test/health"), {}, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", service: "cortex-access" })
  })

  it("rejects unapproved chat browser origins", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/chat", {
        method: "POST",
        headers: { origin: "https://lookalike.example", "content-type": "application/json" },
        body: JSON.stringify({ question: "What is Cortex?" }),
      }),
      { CORTEX_ALLOWED_ORIGINS: "https://cortex.rs42.ai" },
      ctx,
    )
    expect(response.status).toBe(403)
  })

  it("disables chat independently on the MCP-only Worker", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What is Cortex?" }),
      }),
      { CHAT_ENABLED: "false" },
      ctx,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: "service_unavailable" } })
  })

  it("fails closed when semantic retrieval is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What is Cortex?" }),
      }),
      { MODEL_NAME: "test-model" },
      ctx,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: "retrieval_unconfigured" } })
  })

  it("returns deterministic MCP transport errors", async () => {
    const getResponse = await worker.fetch(new Request("https://api.test/mcp"), {}, ctx)
    expect(getResponse.status).toBe(405)
    expect(getResponse.headers.get("allow")).toBe("POST")

    const batchResponse = await worker.fetch(
      new Request("https://api.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }),
      {},
      ctx,
    )
    expect(batchResponse.status).toBe(400)
    expect(await batchResponse.json()).toMatchObject({ error: "BAD_REQUEST" })
  })

  it("fails closed when the MCP hostname or rate limiter is unconfigured", async () => {
    const response = await worker.fetch(
      new Request("https://cortex-mcp-preview.example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { ENVIRONMENT: "production" },
      ctx,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: "SERVICE_UNAVAILABLE" })
  })

  it("enforces the exact MCP hostname, origin, and rate limit", async () => {
    const configuredEnv = {
      ENVIRONMENT: "production" as const,
      MCP_ALLOWED_HOSTNAMES: "cortex-mcp-preview.example.workers.dev",
      MCP_ALLOWED_ORIGINS: "",
      RATE_LIMITER: { limit: async () => ({ success: true }) },
    }
    const request = (url: string, origin?: string) =>
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: "{}",
      })

    const wrongHost = await worker.fetch(
      request("https://lookalike.example.workers.dev/mcp"),
      configuredEnv,
      ctx,
    )
    expect(wrongHost.status).toBe(403)

    const browserOrigin = await worker.fetch(
      request("https://cortex-mcp-preview.example.workers.dev/mcp", "https://cortex.rs42.ai"),
      configuredEnv,
      ctx,
    )
    expect(browserOrigin.status).toBe(403)

    const limited = await worker.fetch(
      request("https://cortex-mcp-preview.example.workers.dev/mcp"),
      { ...configuredEnv, RATE_LIMITER: { limit: async () => ({ success: false }) } },
      ctx,
    )
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
  })

  it("disables MCP independently with the emergency switch", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { MCP_ENABLED: "false" },
      ctx,
    )
    expect(response.status).toBe(503)
  })

  it("logs only bounded request metadata and the MCP request ID", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const response = await worker.fetch(new Request("https://api.test/mcp"), {}, ctx)
    const requestId = response.headers.get("x-request-id")
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).toContain(requestId)
    expect(serialized).not.toContain("shared memory")
    expect(serialized).not.toContain("cf-connecting-ip")
  })
})
