import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import semanticSnapshot from "../fixtures/qmd-semantic-results.json" with { type: "json" }
import { answerChatRequest } from "../../src/chat.ts"
import type { SemanticCandidate } from "../../src/retrieval/types.ts"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const semanticCases = semanticSnapshot.cases as Record<string, SemanticCandidate[]>

describe("deterministic retrieval loopback", () => {
  it("passes bounded evidence through the localhost mock and validates its citation", async () => {
    const port = 9_000 + (process.pid % 500)
    const server = spawn(
      process.execPath,
      [resolve(testDirectory, "../../scripts/mock-model-server.mjs")],
      {
        env: { ...process.env, CORTEX_MOCK_MODEL_PORT: String(port) },
        stdio: ["ignore", "pipe", "inherit"],
      },
    )

    try {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error("Mock model did not start.")), 5_000)
        server.once("exit", (code) => reject(new Error(`Mock model exited with ${code}.`)))
        server.stdout.on("data", (chunk) => {
          if (!String(chunk).includes("Cortex mock model listening")) return
          clearTimeout(timeout)
          resolveReady()
        })
      })

      const response = await answerChatRequest(
        new Request("https://api.test/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question:
              "Why is a project artifact a safer memory than keeping a separate weekly status document?",
          }),
        }),
        {
          MODEL_API_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
          MODEL_API_TOKEN: "local-loopback-only",
          MODEL_NAME: "mock-deterministic-model",
        },
        {
          semanticProvider: {
            async retrieve() {
              return semanticCases["direct-artifact-memory"] ?? []
            },
          },
        },
      )

      expect(response.answer).toContain("deterministic local answer")
      expect(response.citations.map((citation) => citation.slug)).toEqual([
        "01-memory-and-knowledge-graphs/why-memory-changes-everything",
      ])
    } finally {
      server.kill("SIGTERM")
    }
  })
})
