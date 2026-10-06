import { VariableDeclarationKind } from "ts-morph"
import type { NormalizedSpec } from "../openapi.js"
import type { GenerateOptions, SchemaContext } from "../generator/types.js"
import { createSourceFile, getSourceText } from "../generator/code.js"
import { findRecursiveComponents, schemaToExpression } from "./expression.js"

const defaultFormatMap = {
  uuid: "Schema.String.check(Schema.isUUID())",
  "date-time": "Schema.DateFromString",
  date: "Schema.DateFromString"
} satisfies Record<string, string>

export const createSchemaContext = (
  componentNames: Map<string, string>,
  refPrefix: string,
  warnings: string[],
  options?: GenerateOptions
): SchemaContext => ({
  componentNames,
  refPrefix,
  warnings,
  formatMap: { ...defaultFormatMap, ...options?.formatMap },
  warnOnUnknownFormat: options?.warnOnUnknownFormat ?? true
})

const addSchemaDeclaration = (
  sourceFile: ReturnType<typeof createSourceFile>,
  componentKey: string,
  schema: NormalizedSpec["components"][string],
  componentNames: Map<string, string>,
  recursiveComponents: Set<string>,
  context: SchemaContext
): void => {
  const name = componentNames.get(componentKey)

  if (!name) return

  sourceFile.addVariableStatement({
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name,
        type: recursiveComponents.has(componentKey)
          ? "Schema.ConstraintDecoder<unknown, never>"
          : undefined,
        initializer: schemaToExpression(schema, context)
      }
    ]
  })
  sourceFile.addTypeAlias({
    isExported: true,
    name,
    type: `typeof ${name}.Type`
  })
}

export const generateSchemas = (
  spec: NormalizedSpec,
  componentNames: Map<string, string>,
  options?: GenerateOptions
) => {
  const warnings: string[] = []
  const context = createSchemaContext(componentNames, "", warnings, options)
  const sourceFile = createSourceFile("schemas.ts")

  sourceFile.addImportDeclaration({
    namedImports: ["Schema"],
    moduleSpecifier: "effect"
  })

  const recursiveComponents = findRecursiveComponents(spec.components)
  const components = Object.entries(spec.components).sort(([a], [b]) => a.localeCompare(b))

  for (const [key, schema] of components) {
    addSchemaDeclaration(sourceFile, key, schema, componentNames, recursiveComponents, context)
  }

  return { code: getSourceText(sourceFile), warnings }
}
