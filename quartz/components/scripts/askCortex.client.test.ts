import test, { describe } from "node:test"
import assert from "node:assert/strict"
import {
  CortexChatError,
  boundHistory,
  buildChatRequest,
  mockChat,
  requestChat,
  validateChatResponse,
} from "./askCortex.client"

describe("Ask Cortex client contract", () => {
  test("bounds history to the Worker's six-message contract", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
    }))

    assert.deepEqual(
      boundHistory(history).map((message) => message.content),
      ["message 2", "message 3", "message 4", "message 5", "message 6", "message 7"],
    )
    assert.equal(
      boundHistory([{ role: "assistant", content: "x".repeat(2_000) }])[0].content.length,
      1_500,
    )
  })

  test("trims questions and rejects empty or oversized input", () => {
    assert.deepEqual(buildChatRequest("  What is Cortex?  ", []), {
      question: "What is Cortex?",
      history: [],
    })
    assert.throws(() => buildChatRequest("   ", []), CortexChatError)
    assert.throws(() => buildChatRequest("x".repeat(1_001), []), CortexChatError)
  })

  test("keeps only unique citations with a matching trusted note URL", () => {
    const response = validateChatResponse(
      {
        answer: "Grounded answer.",
        citations: [
          { slug: "start-here", title: "Start Here", url: "/start-here" },
          { slug: "start-here", title: "Duplicate", url: "/start-here" },
          { slug: "start-here", title: "Wrong path", url: "/about" },
          { slug: "about", title: "Outside", url: "https://example.com/about" },
        ],
      },
      "http://localhost:8080/current",
      ["http://localhost:8080", "https://cortex.rs42.ai"],
    )

    assert.deepEqual(response, {
      answer: "Grounded answer.",
      citations: [
        {
          slug: "start-here",
          title: "Start Here",
          url: "http://localhost:8080/start-here",
        },
      ],
    })
  })

  test("posts the documented question and history shape", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      assert.equal(init?.method, "POST")
      assert.deepEqual(JSON.parse(String(init?.body)), {
        question: "What is Cortex?",
        history: [{ role: "user", content: "Hello" }],
      })
      return new Response(
        JSON.stringify({
          answer: "A published knowledge graph.",
          citations: [{ slug: "start-here", title: "Start Here", url: "/start-here" }],
        }),
        { headers: { "content-type": "application/json" } },
      )
    }

    const response = await requestChat({
      endpoint: "/chat",
      question: "What is Cortex?",
      history: [{ role: "user", content: "Hello" }],
      baseUrl: "http://localhost:8080/",
      allowedCitationOrigins: ["http://localhost:8080"],
      fetcher,
    })
    assert.equal(response.answer, "A published knowledge graph.")
    assert.equal(response.citations[0].slug, "start-here")
  })

  test("returns deterministic grounded mock responses", () => {
    assert.deepEqual(mockChat("Why does memory matter?"), mockChat("Why does memory matter?"))
    assert.equal(
      mockChat("What does MCP make possible?").citations[0].slug,
      "02-connections-mcp/mcp-a-universal-port-for-ai",
    )
    assert.equal(mockChat("Something broad").citations[0].slug, "start-here")
  })
})
