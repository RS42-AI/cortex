import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadChunkManifest } from "../src/retrieval/manifest.ts"
import type { SemanticCandidate } from "../src/retrieval/types.ts"
import { retrievalCases, retrievalQueryForCase } from "./retrieval-cases.ts"

interface QmdResult {
  score?: number
  file?: string
  filepath?: string
  path?: string
  docid?: string
}

const qmd = process.env.CORTEX_QMD_BIN ?? "qmd"
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const output = resolve(
  process.argv[2] ?? join(scriptDirectory, "../test/fixtures/qmd-semantic-results.json"),
)
const workspace = await mkdtemp(join(tmpdir(), "cortex-qmd-semantic-"))
const corpusDirectory = join(workspace, "corpus")
const fileToChunk = new Map<string, string>()
const manifest = loadChunkManifest()

function run(args: string[]): string {
  return execFileSync(qmd, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      INDEX_PATH: join(workspace, "cortex.sqlite"),
      QMD_CONFIG_DIR: join(workspace, "config"),
    },
    stdio: ["ignore", "pipe", "inherit"],
  })
}

function resultPath(result: QmdResult): string | undefined {
  return result.filepath ?? result.file ?? result.path ?? result.docid
}

try {
  await mkdir(corpusDirectory, { recursive: true })
  for (const [index, chunk] of manifest.chunks.entries()) {
    const filename = `${String(index).padStart(3, "0")}.md`
    fileToChunk.set(filename, chunk.id)
    const metadata = [...chunk.tags, ...chunk.aliases].join(", ")
    const heading = chunk.heading ? `\n## ${chunk.heading}` : ""
    await writeFile(
      join(corpusDirectory, filename),
      `# ${chunk.title}${heading}\n\n${metadata ? `Keywords: ${metadata}\n\n` : ""}${chunk.text}\n`,
      "utf8",
    )
  }

  run([
    "--index",
    "cortex-semantic",
    "collection",
    "add",
    corpusDirectory,
    "--name",
    "cortex",
    "--mask",
    "**/*.md",
  ])
  run(["--index", "cortex-semantic", "update"])
  run(["--index", "cortex-semantic", "embed"])

  const cases: Record<string, SemanticCandidate[]> = {}
  const latencyMs: Record<string, number> = {}
  for (const testCase of retrievalCases) {
    const startedAt = performance.now()
    const raw = run([
      "--index",
      "cortex-semantic",
      "vsearch",
      retrievalQueryForCase(testCase),
      "-c",
      "cortex",
      "--json",
      "-n",
      "12",
    ])
    const parsed = JSON.parse(raw) as QmdResult[]
    const candidates: SemanticCandidate[] = []
    const seen = new Set<string>()
    for (const result of parsed) {
      const path = resultPath(result)
      const chunkId = path ? fileToChunk.get(basename(path)) : undefined
      if (!chunkId || seen.has(chunkId) || typeof result.score !== "number") continue
      seen.add(chunkId)
      candidates.push({ chunkId, score: result.score })
    }
    cases[testCase.id] = candidates
    latencyMs[testCase.id] = Math.round(performance.now() - startedAt)
  }

  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify(
      {
        engine: "QMD vector search with local query expansion",
        model: "embeddinggemma-300M-Q8_0",
        corpusVersion: manifest.corpusVersion,
        cases,
        latencyMs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  console.log(JSON.stringify({ output, cases: Object.keys(cases).length }))
} finally {
  await rm(workspace, { recursive: true, force: true })
}
