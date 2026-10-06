import { expect, it } from "vitest"
import { createSchemaContext } from "../../src/schema/generator.js"
import { buildComponentNameMap, createSourceFile, getSourceText } from "../../src/generator/code.js"
import { generateOperationDefinitions } from "../../src/generator/operations.js"
import { normalizeOpenApi, type OpenApiSpec } from "../../src/openapi.js"

const input: OpenApiSpec = {
  openapi: "3.0.0",
  paths: {
    "/items/{itemId}": {
      get: {
        operationId: "getItem",
        parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Item",
            content: { "application/json": { schema: { type: "string" } } }
          },
          "404": { description: "Not found" }
        }
      }
    }
  }
}

const spec = normalizeOpenApi(input)

const generateOperations = () => {
  const warnings: string[] = []

  const componentNames = buildComponentNameMap(spec.components)

  const context = createSchemaContext(componentNames, "Schemas.", warnings)

  const sourceFile = createSourceFile("operations.ts")

  const infos = generateOperationDefinitions(sourceFile, spec, context, warnings)

  return { infos, output: getSourceText(sourceFile) }
}

it("builds operation schemas, response types, and request effects", () => {
  const { infos, output } = generateOperations()
  const info = infos[0]

  expect(info).toMatchObject({
    opName: "getItem",
    hasInput: true,
    inputSchemaName: "GetItemInput",
    successMapName: "GetItemSuccessSchemas",
    errorMapName: "GetItemErrorSchemas",
    responseTypeName: "GetItemResponse"
  })
  expect(info?.effectBody).toContain("buildUrl")
  expect(output).toContain("export const GetItemInput = Schema.Struct")
  expect(output).toContain("export type GetItemFailure = HttpError<typeof GetItemErrorSchemas>")
})
