import { createServer } from "node:http"

const host = "127.0.0.1"
const port = Number(process.env.CORTEX_MOCK_MODEL_PORT ?? "8899")
const maxBodyBytes = 128_000

const responses = [
  {
    matches: /memor|knowledge graph|context/i,
    answer:
      "This deterministic local answer passed through the Cortex Worker. Memory preserves decisions, source material, and next steps so an agent can resume work without reconstructing context.",
    slug: "01-memory-and-knowledge-graphs/why-memory-changes-everything",
  },
  {
    matches: /\bmcp\b|connect|integration/i,
    answer:
      "This deterministic local answer passed through the Cortex Worker. MCP provides a shared interface for bounded tools and resources while leaving permissions and review explicit.",
    slug: "02-connections-mcp/mcp-a-universal-port-for-ai",
  },
]

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maxBodyBytes) throw new Error("request_too_large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: "not_found" })
    return
  }

  try {
    const body = await readJson(request)
    const messages = Array.isArray(body.messages) ? body.messages : []
    const question = [...messages]
      .reverse()
      .find((message) => message?.role === "user" && typeof message.content === "string")?.content

    if (body.model !== "mock-deterministic-model" || !question) {
      sendJson(response, 400, { error: "invalid_mock_request" })
      return
    }

    const match = responses.find((candidate) => candidate.matches.test(question)) ?? responses[0]
    const systemPrompt = messages.find(
      (message) => message?.role === "system" && typeof message.content === "string",
    )?.content
    const escapedSlug = match.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const sourceId =
      typeof systemPrompt === "string"
        ? systemPrompt.match(
            new RegExp(
              `<evidence source="(S\\d+)" url="https://cortex\\.rs42\\.ai/${escapedSlug}"`,
            ),
          )?.[1]
        : undefined
    sendJson(response, 200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: match.answer,
              citations: [sourceId ?? "S01"],
            }),
          },
        },
      ],
    })
  } catch (error) {
    sendJson(response, error instanceof SyntaxError ? 400 : 413, {
      error: error instanceof SyntaxError ? "invalid_json" : "request_too_large",
    })
  }
})

server.listen(port, host, () => {
  console.log(`Cortex mock model listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
