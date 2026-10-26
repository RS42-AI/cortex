import { McpServer } from "@modelcontextprotocol/server"
import { createMcpHandler } from "agents/mcp/server"
import { z } from "zod"
import {
  listUnits,
  loadCorpus,
  publicNoteUrl,
  rankContent,
  resolvedLinks,
  unitForSlug,
} from "./content"
import { HttpError, parseCsv, readTextBody } from "./http"
import type { CortexIndex, Env } from "./types"

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const linkSchema = z.object({
  slug: z.string(),
  title: z.string(),
  url: z.url(),
})

const searchOutputSchema = z.object({
  query: z.string(),
  corpusVersion: z.string(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  results: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      url: z.url(),
      unit: z.string().nullable(),
      excerpt: z.string().max(400),
      score: z.number().min(0).max(1),
    }),
  ),
})

const readOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  url: z.url(),
  unit: z.string().nullable(),
  content: z.string().max(32_000),
  links: z.array(linkSchema),
  tags: z.array(z.string()),
  corpusVersion: z.string(),
})

const unitNoteSchema = z.object({ slug: z.string(), title: z.string(), url: z.url() })
const unitsOutputSchema = z.object({
  corpusVersion: z.string(),
  units: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      url: z.url(),
      position: z.number().int().positive(),
      noteCount: z.number().int().nonnegative(),
      notes: z.array(unitNoteSchema),
    }),
  ),
})

const domainErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
})

function toolOutputSchema<T extends z.ZodType>(successSchema: T) {
  return z.union([successSchema, domainErrorSchema])
}

function successResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function errorResult(code: string, message: string, requestId: string) {
  const value = { error: { code, message, requestId } }
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

export function listUnitResults(index: CortexIndex, includeNotes: boolean) {
  return listUnits(index).map((unit, indexPosition) => {
    const prefix = unit.slug.slice(0, -"/index".length)
    const notes = Object.values(index)
      .filter((entry) => entry.slug === unit.slug || entry.slug.startsWith(`${prefix}/`))
      .sort((left, right) => {
        if (left.slug === unit.slug) return -1
        if (right.slug === unit.slug) return 1
        return left.slug.localeCompare(right.slug)
      })
      .map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        url: publicNoteUrl(entry.slug),
      }))

    return {
      slug: unit.slug,
      title: unit.title,
      url: publicNoteUrl(unit.slug),
      position: indexPosition + 1,
      noteCount: notes.length,
      notes: includeNotes ? notes : [],
    }
  })
}

export function createCortexServer(requestId: string): McpServer {
  const server = new McpServer({ name: "cortex", version: "0.1.0" })

  server.registerTool(
    "search_cortex",
    {
      description:
        "Search the published Cortex notes. Returns ranked excerpts and canonical public URLs without synthesizing an answer.",
      inputSchema: z.object({
        query: z.string().trim().min(2).max(200),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      outputSchema: toolOutputSchema(searchOutputSchema),
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ query, limit }) => {
      let corpus
      try {
        corpus = await loadCorpus()
      } catch {
        return errorResult(
          "CONTENT_UNAVAILABLE",
          "The published Cortex corpus is unavailable.",
          requestId,
        )
      }
      const { index, version } = corpus
      const matches = rankContent(index, query)
      const maxScore = matches[0]?.score ?? 1
      const results = matches.slice(0, limit).map((result) => ({
        slug: result.slug,
        title: result.title,
        url: publicNoteUrl(result.slug),
        unit: unitForSlug(index, result.slug),
        excerpt: result.excerpt,
        score: Number((result.score / maxScore).toFixed(4)),
      }))
      return successResult({
        query,
        corpusVersion: version,
        total: matches.length,
        truncated: matches.length > results.length,
        results,
      })
    },
  )

  server.registerTool(
    "read_cortex_note",
    {
      description: "Read one published Cortex note by its exact indexed slug.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .max(200)
          .regex(/^(?:[a-z0-9]|[a-z0-9][a-z0-9/-]*[a-z0-9])$/),
      }),
      outputSchema: toolOutputSchema(readOutputSchema),
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ slug }) => {
      let corpus
      try {
        corpus = await loadCorpus()
      } catch {
        return errorResult(
          "CONTENT_UNAVAILABLE",
          "The published Cortex corpus is unavailable.",
          requestId,
        )
      }
      const { index, version } = corpus
      const note = index[slug]
      if (!note) {
        return errorResult(
          "NOTE_NOT_FOUND",
          "No published Cortex note exists for that slug.",
          requestId,
        )
      }

      return successResult({
        slug: note.slug,
        title: note.title,
        url: publicNoteUrl(note.slug),
        unit: unitForSlug(index, note.slug),
        content: note.content,
        links: resolvedLinks(index, note).map((linked) => ({
          slug: linked.slug,
          title: linked.title,
          url: publicNoteUrl(linked.slug),
        })),
        tags: note.tags,
        corpusVersion: version,
      })
    },
  )

  server.registerTool(
    "list_cortex_units",
    {
      description: "List the published Cortex teaching units in curriculum order.",
      inputSchema: z.object({ includeNotes: z.boolean().default(true) }),
      outputSchema: toolOutputSchema(unitsOutputSchema),
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ includeNotes }) => {
      let corpus
      try {
        corpus = await loadCorpus()
      } catch {
        return errorResult(
          "CONTENT_UNAVAILABLE",
          "The published Cortex corpus is unavailable.",
          requestId,
        )
      }
      const { index, version } = corpus
      return successResult({ corpusVersion: version, units: listUnitResults(index, includeNotes) })
    },
  )

  return server
}

function mcpError(status: number, code: string, requestId: string): Response {
  return new Response(JSON.stringify({ error: code, requestId }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
  })
}

async function boundedMcpRequest(request: Request, requestId: string): Promise<Request | Response> {
  if (request.method !== "POST") {
    const response = mcpError(405, "METHOD_NOT_ALLOWED", requestId)
    response.headers.set("allow", "POST")
    return response
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return mcpError(415, "UNSUPPORTED_MEDIA_TYPE", requestId)
  }
  let body: string
  try {
    body = await readTextBody(request, 32_768)
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) {
      return mcpError(413, "PAYLOAD_TOO_LARGE", requestId)
    }
    return mcpError(400, "BAD_REQUEST", requestId)
  }
  try {
    if (Array.isArray(JSON.parse(body))) return mcpError(400, "BAD_REQUEST", requestId)
  } catch {
    return mcpError(400, "BAD_REQUEST", requestId)
  }
  return new Request(request, { body })
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const requestId = crypto.randomUUID()
  if (env.MCP_ENABLED === "false") return mcpError(503, "SERVICE_UNAVAILABLE", requestId)
  if (
    env.ENVIRONMENT === "production" &&
    (!env.RATE_LIMITER || parseCsv(env.MCP_ALLOWED_HOSTNAMES).length === 0)
  ) {
    return mcpError(503, "SERVICE_UNAVAILABLE", requestId)
  }
  if (env.RATE_LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown"
    if (!(await env.RATE_LIMITER.limit({ key })).success) {
      const response = mcpError(429, "RATE_LIMITED", requestId)
      response.headers.set("retry-after", "60")
      return response
    }
  }
  const allowedHosts = parseCsv(env.MCP_ALLOWED_HOSTNAMES)
  const hostname = new URL(request.url).hostname
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    return mcpError(403, "ORIGIN_FORBIDDEN", requestId)
  }

  const origin = request.headers.get("origin")
  if (origin && !parseCsv(env.MCP_ALLOWED_ORIGINS).includes(origin)) {
    return mcpError(403, "ORIGIN_FORBIDDEN", requestId)
  }

  const bounded = await boundedMcpRequest(request, requestId)
  if (bounded instanceof Response) return bounded

  const handler = createMcpHandler(() => createCortexServer(requestId), {
    route: "/mcp",
    legacy: "stateless",
    responseMode: "json",
    corsOptions: false,
    allowedOriginHostnames: "*",
    onerror() {
      console.error("cortex_mcp_failed", { requestId, errorCode: "MCP_HANDLER_ERROR" })
    },
  })
  const response = await handler(bounded, env, ctx)
  const headers = new Headers(response.headers)
  headers.set("x-request-id", requestId)
  headers.set("x-content-type-options", "nosniff")
  headers.set("cache-control", "no-store")
  return new Response(response.body, { status: response.status, headers })
}
