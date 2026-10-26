import type { ChatRequest } from "../types.ts"

const MAX_RETRIEVAL_HISTORY_CHARS = 1_200

export function buildRetrievalQuery(request: ChatRequest): string {
  const history: string[] = []
  let historyCharacters = 0
  for (const message of [...request.history].reverse()) {
    const remaining = MAX_RETRIEVAL_HISTORY_CHARS - historyCharacters
    if (remaining <= 0) break
    const content = message.content.slice(0, remaining)
    history.unshift(`${message.role}: ${content}`)
    historyCharacters += content.length
  }
  return [...history, `user: ${request.question}`].join("\n")
}
