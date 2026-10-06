import { fileURLToPath } from "node:url"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { runCli } from "../../src/cli/program.js"

const fixturePath = fileURLToPath(new URL("../../fixtures/simple.json", import.meta.url))

const withTempDirectory = async <Value>(
  run: (directory: string) => Promise<Value>
): Promise<Value> => {
  const directory = await mkdtemp(join(tmpdir(), "openapi-effect-cli-"))

  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const invokeCli = async (cwd: string, args: string[]) => {
  const stdout: string[] = []
  const stderr: string[] = []

  const exitCode = await runCli(args, {
    cwd: () => cwd,
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text)
  })

  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") }
}

it("prints help without failing", async () => {
  const result = await invokeCli(process.cwd(), ["--help"])

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain("Usage:")
  expect(result.stderr).toBe("")
})

it("generates only the requested source file in the selected output directory", async () => {
  await withTempDirectory(async (directory) => {
    const result = await invokeCli(directory, [
      "generate",
      "--input",
      fixturePath,
      "--output",
      "generated",
      "--schemas-only"
    ])

    const outputDirectory = join(directory, "generated")
    const files = await readdir(outputDirectory)
    const schemas = await readFile(join(outputDirectory, "schemas.ts"), "utf8")

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(files).toEqual(["schemas.ts"])
    expect(schemas).toContain("export const User = Schema.Struct")
  })
})

it("reports invalid command arguments and returns a failure code", async () => {
  const result = await invokeCli(process.cwd(), ["generate"])

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("Missing --input argument.")
  expect(result.stdout).toContain("Usage:")
})
