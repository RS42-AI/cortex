import type { CortexChunk, RetrievalResult } from "./types.ts"

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "give",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "just",
  "let",
  "make",
  "me",
  "more",
  "my",
  "not",
  "of",
  "on",
  "or",
  "should",
  "than",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "without",
  "you",
  "your",
])

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
}

function normalizeVariant(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1)
  return token
}

export function lexicalTerms(value: string): string[] {
  return (normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
    .map(normalizeVariant)
}

export function queryCorpusCoverage(chunks: CortexChunk[], query: string): number {
  const queryTerms = [...new Set(lexicalTerms(query))]
  if (queryTerms.length === 0) return 0
  const corpusTerms = new Set(
    chunks.flatMap((chunk) =>
      lexicalTerms(
        [chunk.title, chunk.heading ?? "", ...chunk.tags, ...chunk.aliases, chunk.text].join(" "),
      ),
    ),
  )
  return queryTerms.filter((term) => corpusTerms.has(term)).length / queryTerms.length
}

function termFrequencies(values: string[]): Map<string, number> {
  const frequencies = new Map<string, number>()
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
  return frequencies
}

export function rankBm25(chunks: CortexChunk[], query: string): RetrievalResult[] {
  const queryTerms = [...new Set(lexicalTerms(query))]
  if (queryTerms.length === 0 || chunks.length === 0) return []

  const documents = chunks.map((chunk) => {
    const bodyTerms = lexicalTerms(chunk.text)
    return {
      chunk,
      bodyTerms,
      bodyFrequency: termFrequencies(bodyTerms),
      titleTerms: new Set(lexicalTerms(chunk.title)),
      headingTerms: new Set(lexicalTerms(chunk.heading ?? "")),
      slugTerms: new Set(lexicalTerms(chunk.slug)),
      metadataTerms: new Set(lexicalTerms([...chunk.tags, ...chunk.aliases].join(" "))),
    }
  })
  const averageLength =
    documents.reduce((total, document) => total + document.bodyTerms.length, 0) / documents.length
  const documentFrequency = new Map<string, number>()
  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      documents.filter((document) => document.bodyFrequency.has(term)).length,
    )
  }

  const normalizedQuery = normalize(query).replace(/\s+/g, " ").trim()
  const k1 = 1.2
  const b = 0.75

  return documents
    .map((document) => {
      let score = 0
      for (const term of queryTerms) {
        const frequency = document.bodyFrequency.get(term) ?? 0
        const frequencyInCorpus = documentFrequency.get(term) ?? 0
        if (frequency > 0) {
          const inverseDocumentFrequency = Math.log(
            1 + (documents.length - frequencyInCorpus + 0.5) / (frequencyInCorpus + 0.5),
          )
          const denominator =
            frequency + k1 * (1 - b + b * (document.bodyTerms.length / Math.max(1, averageLength)))
          score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / denominator)
        }
        if (document.titleTerms.has(term)) score += 3.5
        if (document.headingTerms.has(term)) score += 2.5
        if (document.slugTerms.has(term)) score += 1.5
        if (document.metadataTerms.has(term)) score += 4
      }

      const normalizedTitle = normalize(document.chunk.title)
      if (normalizedTitle === normalizedQuery) score += 12
      else if (normalizedQuery.length >= 5 && normalizedTitle.includes(normalizedQuery)) score += 6

      return {
        chunk: document.chunk,
        score,
        ranks: {},
        channelScores: { lexical: score },
      }
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
    .map((result, index) => ({ ...result, ranks: { lexical: index + 1 } }))
}
