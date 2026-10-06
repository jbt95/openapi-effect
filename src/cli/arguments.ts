import { Schema } from "effect"

export type GenerateCommand = {
  input: string
  output: string
  schemasOnly: boolean
  clientOnly: boolean
  formatMapPath?: string
}

export type ParseGenerateResult =
  | { kind: "valid"; command: GenerateCommand }
  | { kind: "invalid"; message: string; showHelp: boolean }

const getFlagValue = (args: string[], long: string, short?: string): string | undefined => {
  const longIndex = args.indexOf(long)

  if (longIndex !== -1) return args[longIndex + 1]

  if (short) {
    const shortIndex = args.indexOf(short)

    if (shortIndex !== -1) return args[shortIndex + 1]
  }

  return undefined
}

export const getOutputDirectory = (args: string[]): string =>
  getFlagValue(args, "--output", "-o") ?? "src/generated"

export const parseGenerateArgs = (args: string[]): ParseGenerateResult => {
  const input = getFlagValue(args, "--input", "-i")
  const output = getOutputDirectory(args)
  const schemasOnly = args.includes("--schemas-only")
  const clientOnly = args.includes("--client-only")

  if (!input) {
    return { kind: "invalid", message: "Missing --input argument.", showHelp: true }
  }

  if (schemasOnly && clientOnly) {
    return {
      kind: "invalid",
      message: "Cannot use --schemas-only and --client-only together.",
      showHelp: false
    }
  }

  return {
    kind: "valid",
    command: {
      input,
      output,
      schemasOnly,
      clientOnly,
      formatMapPath: getFlagValue(args, "--format-map")
    }
  }
}

const formatMapSchema = Schema.Record(Schema.String, Schema.String)

const isJsonObject = <Value>(value: Value): value is Value & object =>
  value !== null && !Array.isArray(value) && typeof value === "object"

export const parseFormatMap = <Value>(value: Value): Record<string, string> => {
  if (!isJsonObject(value)) throw new Error("--format-map must be a JSON object.")

  try {
    return Schema.decodeUnknownSync(formatMapSchema)(value)
  } catch {
    throw new Error("--format-map values must be strings.")
  }
}
