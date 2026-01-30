import { describe, expect, it } from "vitest"
import { normalizeOpenApi, type OpenApiSpec } from "../src/openapi.js"

describe("normalizeOpenApi", () => {
  it("normalizes operations and warnings", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.1",
      paths: {
        "/items/{id}": {
          get: {
            operationId: "getItem",
            parameters: [
              { name: "id", in: "path", schema: { type: "string" } },
              { name: "trace", in: "cookie", schema: { type: "string" } },
              { name: "verbose", in: "query", schema: { type: "boolean" } }
            ],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "string" }
                  }
                }
              },
              "400": {
                description: "Bad",
                content: {
                  "text/plain": {
                    schema: { type: "string" }
                  }
                }
              }
            }
          },
          post: {
            operationId: "getItem",
            requestBody: {
              content: {
                "text/plain": {
                  schema: { type: "string" }
                }
              }
            },
            responses: {}
          },
          delete: {
            parameters: [{ name: "id", in: "path", schema: { type: "string" } }],
            responses: {
              "204": { description: "No Content" }
            }
          }
        }
      }
    }

    const result = normalizeOpenApi(spec)

    expect(result.operations).toHaveLength(3)
    expect(result.operations[0].id).toBe("getItem")
    expect(result.operations[1].id).toBe("getItem2")
    expect(result.operations[2].id).toBe("deleteItemsId")

    const getOp = result.operations[0]
    expect(getOp.params.path[0].required).toBe(true)
    expect(getOp.params.query[0].required).toBe(false)

    expect(result.warnings.some((warning) => warning.includes("cookie parameters"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("request content type"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("has no responses"))).toBe(true)
  })

  it("accepts OpenAPI 3.1", () => {
    const spec: OpenApiSpec = { openapi: "3.1.0", paths: {} }
    const result = normalizeOpenApi(spec)
    expect(result.operations).toEqual([])
  })

  it("rejects unsupported OpenAPI versions", () => {
    const spec: OpenApiSpec = { openapi: "2.0" }
    expect(() => normalizeOpenApi(spec)).toThrow("Unsupported OpenAPI version")
  })
})
