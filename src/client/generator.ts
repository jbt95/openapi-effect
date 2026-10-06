import type { NormalizedSpec } from "../openapi.js"
import type { GenerateOptions } from "../generator/types.js"
import { createSourceFile, getSourceText } from "../generator/code.js"
import { createSchemaContext } from "../schema/generator.js"
import { addClientTypeDeclarations } from "./runtime-types.js"
import { addClientRuntimeFunctions } from "./runtime-functions.js"
import { generateOperationDefinitions } from "../generator/operations.js"
import { addClientFactories } from "./factories.js"

export const generateClient = (
  spec: NormalizedSpec,
  componentNames: Map<string, string>,
  options?: GenerateOptions
) => {
  const warnings: string[] = []
  const context = createSchemaContext(componentNames, "Schemas.", warnings, options)
  const sourceFile = createSourceFile("client.ts")
  sourceFile.addImportDeclaration({
    namedImports: ["Effect", "Schema", "Schedule"],
    moduleSpecifier: "effect"
  })
  sourceFile.addImportDeclaration({
    namespaceImport: "Schemas",
    moduleSpecifier: "./schemas.js"
  })

  addClientTypeDeclarations(sourceFile, spec)
  addClientRuntimeFunctions(sourceFile)
  const operationInfos = generateOperationDefinitions(sourceFile, spec, context, warnings)
  addClientFactories(sourceFile, spec, operationInfos)

  return { code: getSourceText(sourceFile), warnings }
}
