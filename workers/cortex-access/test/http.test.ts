import { describe, expect, it, vi } from "vitest"
import { jsonResponse, readTextBody } from "../src/http"

function streamedRequest(chunks: string[], onCancel: () => void): Request {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunk))
      index += 1
    },
    cancel() {
      onCancel()
    },
  })
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" }
  return new Request("https://api.cortex.test/chat", init)
}

describe("bounded streaming request bodies", () => {
  it("reads a streamed body without Content-Length when it is within the limit", async () => {
    const request = streamedRequest(['{"question":', '"hello"}'], () => {})
    expect(await readTextBody(request, 64)).toBe('{"question":"hello"}')
  })

  it("cancels an oversized stream as soon as it crosses the limit", async () => {
    const cancelled = vi.fn()
    const request = streamedRequest(["1234", "5678", "90"], cancelled)
    await expect(readTextBody(request, 8)).rejects.toMatchObject({
      status: 413,
      code: "request_too_large",
    })
    expect(cancelled).toHaveBeenCalledOnce()
  })
})

describe("JSON responses", () => {
  it("preserves headers supplied as a Headers instance", () => {
    const headers = new Headers({
      "access-control-allow-origin": "https://cortex.example",
      "server-timing": "cortex-model;dur=42",
    })
    const response = jsonResponse({ ok: true }, 200, headers)

    expect(response.headers.get("access-control-allow-origin")).toBe("https://cortex.example")
    expect(response.headers.get("server-timing")).toBe("cortex-model;dur=42")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
