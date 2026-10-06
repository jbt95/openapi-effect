import { expect, it } from "vitest"
import { buildComponentNameMap } from "../../src/generator/code.js"
import type { GenerateOptions } from "../../src/generator/types.js"
import { normalizeOpenApi, type OpenApiSpec } from "../../src/openapi.js"
import { generateClient } from "../../src/client/generator.js"

const generateClientForSpec = (spec: OpenApiSpec, options?: GenerateOptions) => {
  const normalized = normalizeOpenApi(spec)

  return generateClient(normalized, buildComponentNameMap(normalized.components), options)
}

const responseErrorSpec: OpenApiSpec = {
  openapi: "3.0.0",
  components: {
    schemas: {
      User: { type: "string" },
      Error: { type: "string" }
    }
  },
  paths: {
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } }
            }
          },
          "404": {
            description: "Not Found",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } }
            }
          }
        }
      }
    }
  }
}

const multipartSpec: OpenApiSpec = {
  openapi: "3.0.0",
  paths: {
    "/upload": {
      post: {
        operationId: "uploadFile",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string" },
                  tags: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "OK",
            content: {
              "text/event-stream": {
                schema: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
}

const tagGroupsSpec: OpenApiSpec = {
  openapi: "3.0.0",
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        tags: ["Users"],
        responses: { "200": { description: "OK" } }
      },
      post: {
        operationId: "createUser",
        tags: ["Users"],
        responses: { "201": { description: "Created" } }
      }
    },
    "/posts": {
      get: {
        operationId: "listPosts",
        tags: ["Posts"],
        responses: { "200": { description: "OK" } }
      }
    },
    "/health": {
      get: {
        operationId: "healthCheck",
        responses: { "200": { description: "OK" } }
      }
    }
  }
}

const securitySchemesSpec: OpenApiSpec = {
  openapi: "3.0.0",
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer"
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key"
      }
    }
  },
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        responses: { "200": { description: "OK" } }
      }
    }
  }
}

it("derives error types from response schema maps", () => {
  const spec = responseErrorSpec

  const result = generateClientForSpec(spec)

  expect(result.code).toContain(
    "export type GetUserSuccess = ResponseUnion<typeof GetUserSuccessSchemas>"
  )
  expect(result.code).toContain(
    "export type GetUserError = ResponseUnion<typeof GetUserErrorSchemas>"
  )
  expect(result.code).toContain(
    "export type GetUserFailure = HttpError<typeof GetUserErrorSchemas>"
  )
})

it("supports multipart form data and streaming responses", () => {
  const spec = multipartSpec

  const result = generateClientForSpec(spec)

  expect(result.code).toContain("encodeFormData")
  expect(result.code).toContain("response.arrayBuffer()")
  expect(result.code).toContain("response.body")
  expect(result.code).toContain('"json" | "text" | "empty" | "binary" | "stream"')
  expect(result.warnings).toEqual([])
})

it("generates makeClients for tag-based grouping", () => {
  const spec = tagGroupsSpec

  const result = generateClientForSpec(spec)
  expect(result.code).not.toContain("function encodeBody")
  expect(result.code).toContain("(_config: ClientConfig)")

  expect(result.code).toContain("export const makeClients")
  expect(result.code).toContain("users:")
  expect(result.code).toContain("posts:")
  expect(result.code).toContain("default:")
  expect(result.code).toContain("listUsers")
  expect(result.code).toContain("createUser")
  expect(result.code).toContain("listPosts")
  expect(result.code).toContain("healthCheck")
  expect(result.code).toContain("export const makeClient")
})

it("supports operation-level baseUrl override", () => {
  const spec: OpenApiSpec = {
    openapi: "3.0.0",
    paths: {
      "/users": {
        get: {
          operationId: "listUsers",
          tags: ["Users"],
          servers: [{ url: "https://api.example.com/v2" }],
          responses: { "200": { description: "OK" } }
        }
      },
      "/posts": {
        get: {
          operationId: "listPosts",
          tags: ["Posts"],
          responses: { "200": { description: "OK" } }
        }
      }
    }
  }

  const result = generateClientForSpec(spec)

  expect(result.code).toContain('"https://api.example.com/v2" ?? config.baseUrl')
  expect(result.code).toContain("config.baseUrl")
  expect(result.code).toContain("export type OperationConfig")
})

it("exports SecurityScheme type and securitySchemes", () => {
  const spec = securitySchemesSpec

  const result = generateClientForSpec(spec)

  expect(result.code).toContain("export type SecurityScheme")
  expect(result.code).toContain("export const securitySchemes")
  expect(result.code).toContain("bearerAuth")
  expect(result.code).toContain("apiKey")
  expect(result.code).toContain('bearerAuth: {"type":"http","scheme":"bearer"}')
  expect(result.code).not.toContain("bearerAuth: SecurityScheme")
  expect(result.code).toContain("Effect.Effect<Response, ClientError, never>")
})
