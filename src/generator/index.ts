import { loadOpenApi, normalizeOpenApi } from "../openapi.js"
import type { OpenApiSpec } from "../openapi.js"
import type { GenerateOptions, GenerateResult } from "./types.js"
import { buildComponentNameMap } from "./code.js"
import { generateSchemas } from "../schema/generator.js"
import { generateClient } from "../client/generator.js"

export type { GenerateOptions, GenerateResult } from "./types.js"

export const generateFromSpec = (spec: OpenApiSpec, options?: GenerateOptions): GenerateResult => {
  const normalized = normalizeOpenApi(spec)
  const componentNames = buildComponentNameMap(normalized.components)
  const schemaResult = generateSchemas(normalized, componentNames, options)
  const clientResult = generateClient(normalized, componentNames, options)

  return {
    schemas: schemaResult.code,
    client: clientResult.code,
    warnings: [...normalized.warnings, ...schemaResult.warnings, ...clientResult.warnings]
  }
}

export const generateFromOpenApi = async (
  input: string,
  options?: GenerateOptions
): Promise<GenerateResult> => {
  const spec = await loadOpenApi(input)

  return generateFromSpec(spec, options)
}
