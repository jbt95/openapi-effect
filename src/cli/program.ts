import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseFormatMap, parseGenerateArgs } from "./arguments.js"
import type { GenerateCommand } from "./arguments.js"
import { generateFromOpenApi } from "../index.js"

type GeneratedOutput = Awaited<ReturnType<typeof generateFromOpenApi>>

export type CliRuntime = {
  cwd: () => string
  writeStdout: (text: string) => void
  writeStderr: (text: string) => void
}

const systemRuntime: CliRuntime = {
  cwd: () => process.cwd(),
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text)
}

const showHelp = (runtime: CliRuntime): void => {
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

  runtime.writeStdout(text)
}

const readFormatMap = async (
  path: string | undefined,
  cwd: string
): Promise<Record<string, string> | undefined> => {
  if (!path) return undefined

  const raw = await readFile(resolve(cwd, path), "utf8")
  const parsed: unknown = JSON.parse(raw)

  return parseFormatMap(parsed)
}

const writeGeneratedFiles = async (
  output: GeneratedOutput,
  command: GenerateCommand,
  cwd: string
): Promise<void> => {
  const outDir = resolve(cwd, command.output)
  await mkdir(outDir, { recursive: true })

  if (!command.clientOnly) {
    await writeFile(resolve(outDir, "schemas.ts"), output.schemas, "utf8")
  }

  if (!command.schemasOnly) {
    await writeFile(resolve(outDir, "client.ts"), output.client, "utf8")
  }
}

const writeWarnings = (warnings: string[], runtime: CliRuntime): void => {
  if (warnings.length === 0) return

  runtime.writeStderr("Warnings:\n")

  for (const warning of warnings) {
    runtime.writeStderr(`- ${warning}\n`)
  }
}

const runGenerateCommand = async (args: string[], runtime: CliRuntime): Promise<number> => {
  const parsed = parseGenerateArgs(args)

  if (parsed.kind === "invalid") {
    runtime.writeStderr(`${parsed.message}\n`)

    if (parsed.showHelp) showHelp(runtime)

    return 1
  }

  const cwd = runtime.cwd()
  const formatMap = await readFormatMap(parsed.command.formatMapPath, cwd)
  const output = await generateFromOpenApi(parsed.command.input, { formatMap })
  await writeGeneratedFiles(output, parsed.command, cwd)
  writeWarnings(output.warnings, runtime)

  return 0
}

const dispatch = async (args: string[], runtime: CliRuntime): Promise<number> => {
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    showHelp(runtime)

    return 0
  }

  if (command !== "generate") {
    runtime.writeStderr(`Unknown command: ${command}\n`)
    showHelp(runtime)

    return 1
  }

  return runGenerateCommand(args, runtime)
}

export const runCli = async (
  args: string[],
  runtime: CliRuntime = systemRuntime
): Promise<number> => {
  try {
    return await dispatch(args, runtime)
  } catch (error) {
    runtime.writeStderr(`${String(error)}\n`)

    return 1
  }
}
