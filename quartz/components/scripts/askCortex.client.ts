export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface CortexCitation {
  slug: string
  title: string
  url: string
}

export interface ChatResponse {
  answer: string
  citations: CortexCitation[]
}

export interface ChatRequest {
  question: string
  history: ChatMessage[]
}

const MAX_QUESTION_CHARS = 1_000
const MAX_HISTORY_ITEMS = 6
const MAX_HISTORY_ITEM_CHARS = 1_500
const MAX_ANSWER_CHARS = 6_000
const MAX_CITATIONS = 12
const MAX_CITATION_FIELD_CHARS = 200

export class CortexChatError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export function boundHistory(history: ChatMessage[]): ChatMessage[] {
  return history
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_HISTORY_ITEM_CHARS),
    }))
    .slice(-MAX_HISTORY_ITEMS)
}

export function buildChatRequest(question: string, history: ChatMessage[]): ChatRequest {
  const trimmedQuestion = question.trim()
  if (!trimmedQuestion) throw new CortexChatError("Enter a question to continue.")
  if (trimmedQuestion.length > MAX_QUESTION_CHARS) {
    throw new CortexChatError("Keep your question to 1,000 characters or fewer.")
  }

  return { question: trimmedQuestion, history: boundHistory(history) }
}

function citationUrl(
  citation: { slug?: unknown; title?: unknown; url?: unknown },
  baseUrl: string,
  allowedOrigins: string[],
): CortexCitation | null {
  if (
    typeof citation.slug !== "string" ||
    !/^[a-z0-9][a-z0-9/_-]*$/i.test(citation.slug) ||
    citation.slug.length > MAX_CITATION_FIELD_CHARS ||
    typeof citation.title !== "string" ||
    !citation.title.trim() ||
    citation.title.length > MAX_CITATION_FIELD_CHARS ||
    typeof citation.url !== "string" ||
    citation.url.length > 2_000
  ) {
    return null
  }

  let url: URL
  try {
    url = new URL(citation.url, baseUrl)
  } catch {
    return null
  }

  const normalizedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin, baseUrl).origin))
  const expectedPath = `/${citation.slug}`.replace(/\/{2,}/g, "/")
  let decodedPath: string
  try {
    decodedPath = decodeURI(url.pathname).replace(/\/$/, "")
  } catch {
    return null
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !normalizedOrigins.has(url.origin) ||
    decodedPath !== expectedPath
  ) {
    return null
  }

  return {
    slug: citation.slug,
    title: citation.title.trim(),
    url: url.toString(),
  }
}

export function validateChatResponse(
  value: unknown,
  baseUrl: string,
  allowedOrigins: string[],
): ChatResponse {
  if (!value || typeof value !== "object") {
    throw new CortexChatError("Cortex returned an invalid response.")
  }

  const response = value as { answer?: unknown; citations?: unknown }
  if (
    typeof response.answer !== "string" ||
    !response.answer.trim() ||
    response.answer.length > MAX_ANSWER_CHARS
  ) {
    throw new CortexChatError("Cortex returned an invalid answer.")
  }
  if (!Array.isArray(response.citations) || response.citations.length > MAX_CITATIONS) {
    throw new CortexChatError("Cortex returned invalid sources.")
  }

  const seen = new Set<string>()
  const citations = response.citations.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return []
    const citation = citationUrl(candidate, baseUrl, allowedOrigins)
    if (!citation || seen.has(citation.slug)) return []
    seen.add(citation.slug)
    return [citation]
  })

  return { answer: response.answer.trim(), citations }
}

export async function requestChat(options: {
  endpoint: string
  question: string
  history: ChatMessage[]
  baseUrl: string
  allowedCitationOrigins: string[]
  fetcher?: typeof fetch
  signal?: AbortSignal
}): Promise<ChatResponse> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildChatRequest(options.question, options.history)),
    signal: options.signal,
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new CortexChatError("Cortex returned unreadable data.", response.status)
  }

  if (!response.ok) {
    const errorBody = body as { error?: { message?: unknown } }
    const message =
      typeof errorBody?.error?.message === "string"
        ? errorBody.error.message
        : "Cortex is temporarily unavailable."
    throw new CortexChatError(message, response.status)
  }

  return validateChatResponse(body, options.baseUrl, options.allowedCitationOrigins)
}

const mockResponses: Array<{
  matches: RegExp
  response: ChatResponse
}> = [
  {
    matches: /memor|knowledge graph|context/i,
    response: {
      answer:
        "Memory turns a one-off conversation into durable work. Cortex describes a maintained project record—decisions, source material, and the next question—as the context an agent can reliably return to instead of asking you to reconstruct it.",
      citations: [
        {
          slug: "01-memory-and-knowledge-graphs/why-memory-changes-everything",
          title: "Why Memory Changes Everything",
          url: "/01-memory-and-knowledge-graphs/why-memory-changes-everything",
        },
      ],
    },
  },
  {
    matches: /\bmcp\b|connect|reach|integration/i,
    response: {
      answer:
        "MCP gives AI applications a shared way to discover tools, resources, and prompts. The reusable connection matters, but Cortex emphasizes that permissions, safe exposure, and human review still have to be designed deliberately.",
      citations: [
        {
          slug: "02-connections-mcp/mcp-a-universal-port-for-ai",
          title: "MCP: A Universal Port for AI",
          url: "/02-connections-mcp/mcp-a-universal-port-for-ai",
        },
      ],
    },
  },
  {
    matches: /autonom|review|operator|human/i,
    response: {
      answer:
        "Cortex frames autonomy as a shift from operator to reviewer: the human chooses the work, defines standards and boundaries, and reviews results. A narrow trigger, visible output, and an independent acceptance check come before unattended execution.",
      citations: [
        {
          slug: "04-autonomy/from-operator-to-reviewer",
          title: "From Operator to Reviewer",
          url: "/04-autonomy/from-operator-to-reviewer",
        },
      ],
    },
  },
]

export function mockChat(question: string): ChatResponse {
  const match = mockResponses.find((candidate) => candidate.matches.test(question))
  return (
    match?.response ?? {
      answer:
        "Cortex organizes the path from durable knowledge, to safe connections, to repeatable skills, bounded autonomy, and practical leverage. Try asking about one of those ideas, or use site search for a specific phrase.",
      citations: [{ slug: "start-here", title: "Start Here", url: "/start-here" }],
    }
  )
}
