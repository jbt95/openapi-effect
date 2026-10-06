import { expect, it } from "vitest"
import { addClientTypeDeclarations } from "../../src/client/runtime-types.js"
import { createSourceFile, getSourceText } from "../../src/generator/code.js"
import { normalizeOpenApi } from "../../src/openapi.js"

it("renders shared client types and security scheme declarations", () => {
  const spec = normalizeOpenApi({
    openapi: "3.0.0",
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" }
      }
    }
  })

  const sourceFile = createSourceFile("runtime-types.ts")

  addClientTypeDeclarations(sourceFile, spec)

  const output = getSourceText(sourceFile)

  expect(output).toContain("export type ClientConfig")
  expect(output).toContain("export type AuthConfig")
  expect(output).toContain("export type HttpError")
  expect(output).toContain('bearerAuth: {"type":"http","scheme":"bearer"}')
})
