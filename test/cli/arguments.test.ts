import { expect, it } from "vitest"
import { getOutputDirectory, parseFormatMap, parseGenerateArgs } from "../../src/cli/arguments.js"

it("parses required arguments, aliases, and output-mode flags", () => {
  expect(parseGenerateArgs([])).toEqual({
    kind: "invalid",
    message: "Missing --input argument.",
    showHelp: true
  })
  expect(
    parseGenerateArgs([
      "-i",
      "openapi.json",
      "-o",
      "sdk",
      "--client-only",
      "--format-map",
      "map.json"
    ])
  ).toEqual({
    kind: "valid",
    command: {
      input: "openapi.json",
      output: "sdk",
      schemasOnly: false,
      clientOnly: true,
      formatMapPath: "map.json"
    }
  })
  expect(getOutputDirectory([])).toBe("src/generated")
})

it("rejects mutually exclusive output modes", () => {
  expect(parseGenerateArgs(["--input", "openapi.json", "--schemas-only", "--client-only"])).toEqual(
    {
      kind: "invalid",
      message: "Cannot use --schemas-only and --client-only together.",
      showHelp: false
    }
  )
})

it("decodes format maps as string-valued objects", () => {
  expect(parseFormatMap({ uuid: "Schema.String" })).toEqual({ uuid: "Schema.String" })
  expect(parseFormatMap({})).toEqual({})
  expect(() => parseFormatMap(null)).toThrow("--format-map must be a JSON object.")
  expect(() => parseFormatMap(["Schema.String"])).toThrow("--format-map must be a JSON object.")
  expect(() => parseFormatMap({ uuid: 1 })).toThrow("--format-map values must be strings.")
})
