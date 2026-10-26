import bundledManifest from "../generated/cortex-chunks.json" with { type: "json" }
import type { CortexChunk, CortexChunkManifest } from "./types.ts"

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isChunk(value: unknown): value is CortexChunk {
  if (!value || typeof value !== "object") return false
  const chunk = value as Partial<CortexChunk>
  return (
    typeof chunk.id === "string" &&
    typeof chunk.corpusVersion === "string" &&
    typeof chunk.slug === "string" &&
    typeof chunk.title === "string" &&
    (chunk.heading === null || typeof chunk.heading === "string") &&
    isStringArray(chunk.aliases) &&
    isStringArray(chunk.tags) &&
    typeof chunk.url === "string" &&
    (chunk.unit === null || typeof chunk.unit === "string") &&
    typeof chunk.contentHash === "string" &&
    Number.isSafeInteger(chunk.chunkIndex) &&
    typeof chunk.text === "string" &&
    Number.isSafeInteger(chunk.estimatedTokens) &&
    typeof chunk.isIndex === "boolean"
  )
}

export function validateChunkManifest(value: unknown): CortexChunkManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Cortex chunk manifest.")
  const manifest = value as Partial<CortexChunkManifest>
  if (
    manifest.version !== 1 ||
    typeof manifest.corpusVersion !== "string" ||
    !Number.isSafeInteger(manifest.generatedFromRecords) ||
    !Array.isArray(manifest.chunks) ||
    !manifest.chunks.every(isChunk)
  ) {
    throw new Error("Invalid Cortex chunk manifest.")
  }
  if (manifest.chunks.some((chunk) => chunk.corpusVersion !== manifest.corpusVersion)) {
    throw new Error("Cortex chunk manifest mixes corpus versions.")
  }
  if (new Set(manifest.chunks.map((chunk) => chunk.id)).size !== manifest.chunks.length) {
    throw new Error("Cortex chunk manifest contains duplicate IDs.")
  }
  return manifest as CortexChunkManifest
}

const validatedBundledManifest = validateChunkManifest(bundledManifest)

export function loadChunkManifest(): CortexChunkManifest {
  return validatedBundledManifest
}
