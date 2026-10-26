import { corpusVersion, publicNoteUrl, unitForSlug } from "../content.ts"
import type { CortexIndex, CortexIndexEntry } from "../types.ts"
import type { CortexChunk, CortexChunkManifest } from "./types.ts"

export const DEFAULT_MIN_CHUNK_TOKENS = 400
export const DEFAULT_MAX_CHUNK_TOKENS = 800

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

interface Section {
  heading: string | null
  text: string
}

function markdownSections(value: string): Section[] {
  const sections: Section[] = []
  let heading: string | null = null
  let lines: string[] = []

  const flush = () => {
    const text = lines.join("\n").trim()
    if (text) sections.push({ heading, text })
    lines = []
  }

  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (!match) {
      lines.push(line)
      continue
    }
    flush()
    heading = match[1]
    lines.push(line)
  }
  flush()
  return sections
}

function splitOversizedSection(section: Section, maxTokens: number): Section[] {
  if (estimateTokens(section.text) <= maxTokens) return [section]

  const paragraphs = section.text.split(/\n\s*\n/).filter(Boolean)
  const parts: Section[] = []
  let buffer = ""

  const flush = () => {
    if (!buffer) return
    parts.push({ heading: section.heading, text: buffer.trim() })
    buffer = ""
  }

  for (const paragraph of paragraphs) {
    if (estimateTokens(paragraph) > maxTokens) {
      flush()
      const words = paragraph.split(/\s+/)
      let wordBuffer: string[] = []
      for (const word of words) {
        const candidate = [...wordBuffer, word].join(" ")
        if (wordBuffer.length > 0 && estimateTokens(candidate) > maxTokens) {
          parts.push({ heading: section.heading, text: wordBuffer.join(" ") })
          wordBuffer = [word]
        } else {
          wordBuffer.push(word)
        }
      }
      if (wordBuffer.length > 0)
        parts.push({ heading: section.heading, text: wordBuffer.join(" ") })
      continue
    }

    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (buffer && estimateTokens(candidate) > maxTokens) flush()
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
  }
  flush()
  return parts
}

export function splitIntoPassages(
  value: string,
  minTokens = DEFAULT_MIN_CHUNK_TOKENS,
  maxTokens = DEFAULT_MAX_CHUNK_TOKENS,
): Section[] {
  const normalized = value.trim()
  if (!normalized) return []
  if (estimateTokens(normalized) <= maxTokens) return [{ heading: null, text: normalized }]

  const sections = markdownSections(normalized).flatMap((section) =>
    splitOversizedSection(section, maxTokens),
  )
  const passages: Section[] = []
  let current: Section | undefined

  for (const section of sections) {
    if (!current) {
      current = { ...section }
      continue
    }
    const combined = `${current.text}\n\n${section.text}`
    if (estimateTokens(current.text) < minTokens && estimateTokens(combined) <= maxTokens) {
      current = {
        heading: current.heading ?? section.heading,
        text: combined,
      }
    } else {
      passages.push(current)
      current = { ...section }
    }
  }
  if (current) passages.push(current)
  return passages
}

function entryAliases(entry: CortexIndexEntry): string[] {
  return entry.aliases ?? []
}

export async function buildChunkManifest(index: CortexIndex): Promise<CortexChunkManifest> {
  const version = await corpusVersion(index)
  const chunks: CortexChunk[] = []

  for (const entry of Object.values(index).sort((left, right) =>
    left.slug.localeCompare(right.slug),
  )) {
    const passages = splitIntoPassages(entry.richContent ?? entry.content)
    for (const [chunkIndex, passage] of passages.entries()) {
      const contentHash = await sha256(passage.text)
      chunks.push({
        id: `${entry.slug}::${String(chunkIndex).padStart(3, "0")}::${contentHash.slice(0, 12)}`,
        corpusVersion: version,
        slug: entry.slug,
        title: entry.title,
        heading: passage.heading,
        aliases: [...entryAliases(entry)].sort(),
        tags: [...entry.tags].sort(),
        url: publicNoteUrl(entry.slug),
        unit: unitForSlug(index, entry.slug),
        contentHash,
        chunkIndex,
        text: passage.text,
        estimatedTokens: estimateTokens(passage.text),
        isIndex: entry.slug === "index" || entry.slug.endsWith("/index"),
      })
    }
  }

  return {
    version: 1,
    corpusVersion: version,
    generatedFromRecords: Object.keys(index).length,
    chunks,
  }
}
