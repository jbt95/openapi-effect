#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { generateFromOpenApi } from "./index.js"

const showHelp = () => {
  const text = `openapi-effect

Usage:
  openapi-effect generate --input <path|url> --output <dir>

Options:
  --input, -i         OpenAPI 3.0 file path or URL
  --output, -o        Output directory (default: src/generated)
  --schemas-only      Only generate schemas.ts
  --client-only       Only generate client.ts
  --format-map        Path to JSON mapping of OpenAPI formats to Schema expressions
  --help              Show help
`
  process.stdout.write(text)
}

const getFlagValue = (args: string[], long: string, short?: string) => {
  const longIndex = args.indexOf(long)
  if (longIndex !== -1) return args[longIndex + 1]
  if (short) {
    const shortIndex = args.indexOf(short)
    if (shortIndex !== -1) return args[shortIndex + 1]
  }
  return undefined
}

const main = async () => {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    showHelp()
    return
  }

  if (command !== "generate") {
    process.stderr.write(`Unknown command: ${command}\n`)
    showHelp()
    process.exitCode = 1
    return
  }

  const input = getFlagValue(args, "--input", "-i")
  const output = getFlagValue(args, "--output", "-o") ?? "src/generated"
  const schemasOnly = args.includes("--schemas-only")
  const clientOnly = args.includes("--client-only")
  const formatMapPath = getFlagValue(args, "--format-map")

  if (!input) {
    process.stderr.write("Missing --input argument.\n")
    showHelp()
    process.exitCode = 1
    return
  }

  if (schemasOnly && clientOnly) {
    process.stderr.write("Cannot use --schemas-only and --client-only together.\n")
    process.exitCode = 1
    return
  }

  let formatMap: Record<string, string> | undefined
  if (formatMapPath) {
    const raw = await readFile(resolve(process.cwd(), formatMapPath), "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      process.stderr.write("--format-map must be a JSON object.\n")
      process.exitCode = 1
      return
    }
    const entries = Object.entries(parsed)
    const invalid = entries.find(([, value]) => typeof value !== "string")
    if (invalid) {
      process.stderr.write("--format-map values must be strings.\n")
      process.exitCode = 1
      return
    }
    formatMap = Object.fromEntries(entries) as Record<string, string>
  }

  const result = await generateFromOpenApi(input, { formatMap })
  const outDir = resolve(process.cwd(), output)
  await mkdir(outDir, { recursive: true })

  if (!clientOnly) {
    await writeFile(resolve(outDir, "schemas.ts"), result.schemas, "utf8")
  }
  if (!schemasOnly) {
    await writeFile(resolve(outDir, "client.ts"), result.client, "utf8")
  }

  if (result.warnings.length > 0) {
    process.stderr.write("Warnings:\n")
    for (const warning of result.warnings) {
      process.stderr.write(`- ${warning}\n`)
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
