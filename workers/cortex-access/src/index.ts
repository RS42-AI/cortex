import { answerChatRequest, type ModelTelemetry } from "./chat"
import { errorResponse, corsHeaders, HttpError, jsonResponse, parseCsv } from "./http"
import { handleMcpRequest } from "./mcp"
import type { Env } from "./types"

async function enforceRateLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.RATE_LIMITER) return true
  const key = request.headers.get("cf-connecting-ip") ?? "unknown"
  return (await env.RATE_LIMITER.limit({ key })).success
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (env.CHAT_ENABLED === "false") {
    return errorResponse(
      503,
      "service_unavailable",
      "Cortex chat is not available on this service.",
    )
  }
  const headers = corsHeaders(request, parseCsv(env.CORTEX_ALLOWED_ORIGINS))
  if (headers === null) return errorResponse(403, "origin_forbidden", "Origin is not allowed.")
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST for this endpoint.", {
      ...headers,
      allow: "POST, OPTIONS",
    })
  }
  if (env.ENVIRONMENT === "production" && !env.RATE_LIMITER) {
    return errorResponse(503, "service_unconfigured", "Cortex chat is not configured yet.", headers)
  }
  if (!(await enforceRateLimit(request, env))) {
    return errorResponse(429, "rate_limited", "Too many requests. Try again later.", headers)
  }

  try {
    let telemetry: ModelTelemetry | undefined
    const body = await answerChatRequest(request, env, {
      fetcher: fetch,
      recordTelemetry(value) {
        telemetry = value
      },
    })
    const responseHeaders = new Headers(headers)
    if (env.ENVIRONMENT !== "production" && telemetry) {
      responseHeaders.set("server-timing", `cortex-model;dur=${telemetry.latencyMs}`)
      if (telemetry.inputTokens !== undefined) {
        responseHeaders.set("x-cortex-model-input-tokens", String(telemetry.inputTokens))
      }
      if (telemetry.outputTokens !== undefined) {
        responseHeaders.set("x-cortex-model-output-tokens", String(telemetry.outputTokens))
      }
      if (telemetry.totalTokens !== undefined) {
        responseHeaders.set("x-cortex-model-total-tokens", String(telemetry.totalTokens))
      }
      if (telemetry.evidenceTokens !== undefined) {
        responseHeaders.set("x-cortex-evidence-tokens", String(telemetry.evidenceTokens))
      }
      if (telemetry.retrievedChunks !== undefined) {
        responseHeaders.set("x-cortex-retrieved-chunks", String(telemetry.retrievedChunks))
      }
      if (telemetry.retrievalLatencyMs !== undefined) {
        responseHeaders.append(
          "server-timing",
          `cortex-retrieval;dur=${telemetry.retrievalLatencyMs}`,
        )
      }
    }
    return jsonResponse(body, 200, responseHeaders)
  } catch (error) {
    if (error instanceof HttpError)
      return errorResponse(error.status, error.code, error.message, headers)
    console.error("cortex_chat_failed", { errorCode: "CHAT_UNHANDLED" })
    return errorResponse(
      503,
      "service_unavailable",
      "Cortex chat is temporarily unavailable.",
      headers,
    )
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = Date.now()
    const url = new URL(request.url)
    const route = url.pathname === "/chat" || url.pathname === "/mcp" ? url.pathname : "other"
    let response: Response
    if (url.pathname === "/health" && request.method === "GET") {
      response = jsonResponse({ status: "ok", service: "cortex-access" })
    } else if (url.pathname === "/chat") {
      response = await handleChat(request, env)
    } else if (url.pathname === "/mcp") {
      response = await handleMcpRequest(request, env, ctx)
    } else {
      response = errorResponse(404, "not_found", "Route not found.")
    }

    const elapsed = Date.now() - startedAt
    console.log("cortex_access_request", {
      route,
      method: request.method,
      status: response.status,
      ...(response.headers.get("x-request-id")
        ? { requestId: response.headers.get("x-request-id") }
        : {}),
      latencyBucket: elapsed < 100 ? "lt100ms" : elapsed < 500 ? "lt500ms" : "gte500ms",
    })
    return response
  },
} satisfies ExportedHandler<Env>
