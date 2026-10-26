import bundledContent from "./generated/cortex-content.json" with { type: "json" }
import type { CortexIndex, CortexIndexEntry } from "./types"

const MAX_NOTE_BYTES = 32_000
const SLUG_PATTERN = /^(?:[a-z0-9]|[a-z0-9][a-z0-9/-]*[a-z0-9])$/

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isEntry(value: unknown): value is CortexIndexEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<CortexIndexEntry>
  return (
    typeof entry.slug === "string" &&
    typeof entry.filePath === "string" &&
    typeof entry.title === "string" &&
    isStringArray(entry.links) &&
    isStringArray(entry.tags) &&
    (entry.aliases === undefined || isStringArray(entry.aliases)) &&
    typeof entry.content === "string"
  )
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isSafeSlug(slug: string): boolean {
  return (
    slug.length <= 200 &&
    SLUG_PATTERN.test(slug) &&
    !slug.includes("..") &&
    !slug.includes("//") &&
    !slug.includes(":") &&
    !slug.includes("?") &&
    !slug.includes("#")
  )
}

export function validateContentIndex(value: unknown): CortexIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cortex content index must be a JSON object.")
  }

  const entries = Object.entries(value)
  if (entries.length === 0) throw new Error("Cortex content index is empty.")

  const validated: CortexIndex = {}
  for (const [key, entry] of entries) {
    if (!isEntry(entry)) throw new Error(`Invalid Cortex content entry: ${key}`)
    if (entry.slug !== key) throw new Error(`Cortex slug mismatch: ${key}`)
    if (!isSafeSlug(entry.slug)) throw new Error(`Unsafe Cortex slug: ${key}`)
    if (entry.filePath !== `${entry.slug}.md`) throw new Error(`Cortex file path mismatch: ${key}`)
    if (entry.title.length < 1 || entry.title.length > 200) {
      throw new Error(`Invalid Cortex title length: ${key}`)
    }
    if (utf8Bytes(entry.content) > MAX_NOTE_BYTES)
      throw new Error(`Cortex note is too large: ${key}`)
    if (entry.links.length > 100 || entry.tags.length > 50) {
      throw new Error(`Cortex metadata exceeds bounds: ${key}`)
    }
    validated[key] = entry
  }

  return validated
}

const validatedBundledContent = validateContentIndex(bundledContent)

export function loadContentIndex(): CortexIndex {
  return validatedBundledContent
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
}

function terms(query: string): string[] {
  return [...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [])].filter(
    (term) => term.length > 1,
  )
}

export interface SearchResult {
  slug: string
  title: string
  excerpt: string
  score: number
}

export interface CorpusSnapshot {
  index: CortexIndex
  version: string
}

function excerptFor(content: string, queryTerms: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  const lower = normalize(normalized)
  const firstMatch = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const start = Math.max(0, (firstMatch ?? 0) - 90)
  const excerpt = normalized.slice(start, start + 360)
  return `${start > 0 ? "…" : ""}${excerpt}${start + 360 < normalized.length ? "…" : ""}`
}

export function rankContent(index: CortexIndex, query: string): SearchResult[] {
  const queryTerms = terms(query)
  if (queryTerms.length === 0) return []

  return Object.values(index)
    .map((entry) => {
      const title = normalize(entry.title)
      const titleTerms = new Set(terms(entry.title))
      const slugTerms = new Set(terms(entry.slug))
      const body = normalize(entry.content)
      let score = 0
      for (const term of queryTerms) {
        if (titleTerms.has(term)) score += 8
        if (slugTerms.has(term)) score += 4
        const bodyMatches = body.split(term).length - 1
        score += Math.min(bodyMatches, 5)
        const neighborMatch = entry.links.some((linkedSlug) => {
          const linked = index[linkedSlug] ?? index[`${linkedSlug}/index`]
          return linked ? terms(linked.title).includes(term) : false
        })
        if (neighborMatch) score += 1
      }
      if (title === normalize(query)) score += 20
      else if (title.includes(normalize(query))) score += 12
      return { entry, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.slug.localeCompare(b.entry.slug))
    .map(({ entry, score }) => ({
      slug: entry.slug,
      title: entry.title,
      excerpt: excerptFor(entry.content, queryTerms),
      score,
    }))
}

export function searchContent(index: CortexIndex, query: string, limit = 5): SearchResult[] {
  return rankContent(index, query).slice(0, Math.max(1, Math.min(limit, 10)))
}

export function listUnits(index: CortexIndex): CortexIndexEntry[] {
  return Object.values(index)
    .filter((entry) => entry.slug.endsWith("/index") && /^Unit \d+/.test(entry.title))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
}

export function publicNoteUrl(slug: string): string {
  const path = slug.endsWith("/index") ? slug.slice(0, -"/index".length) : slug
  return `https://cortex.rs42.ai/${path}`
}

export function unitForSlug(index: CortexIndex, slug: string): string | null {
  const [unitSlug] = slug.split("/")
  if (!unitSlug || !/^\d{2}-/.test(unitSlug)) return null
  return index[`${unitSlug}/index`]?.title ?? null
}

export function resolvedLinks(index: CortexIndex, entry: CortexIndexEntry): CortexIndexEntry[] {
  return entry.links
    .map((slug) => {
      const normalized = slug.endsWith("/") ? `${slug}index` : slug
      return index[normalized] ?? index[`${normalized}/index`]
    })
    .filter((linked): linked is CortexIndexEntry => Boolean(linked))
}

export async function corpusVersion(index: CortexIndex): Promise<string> {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(index)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([slug, entry]) => [
          slug,
          {
            slug: entry.slug,
            title: entry.title,
            links: [...entry.links].sort(),
            tags: [...entry.tags].sort(),
            ...(entry.aliases ? { aliases: [...entry.aliases].sort() } : {}),
            content: entry.content,
            ...(entry.richContent ? { richContent: entry.richContent } : {}),
          },
        ]),
    ),
  )
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function loadCorpus(): Promise<CorpusSnapshot> {
  const index = loadContentIndex()
  return { index, version: await corpusVersion(index) }
}
