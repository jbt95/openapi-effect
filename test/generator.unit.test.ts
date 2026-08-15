import { describe, expect, it } from "vitest"
import { generateFromSpec } from "../src/index.js"
import type { OpenApiSpec } from "../src/openapi.js"

describe("generateFromSpec", () => {
  it("warns on unsupported allOf refs", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.0",
      components: {
        schemas: {
          Foo: {
            allOf: [{ $ref: "#/components/schemas/Bar" }]
          },
          Bar: {
            type: "object",
            properties: {
              id: { type: "string" }
            }
          }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain("export const Foo = Schema.Unknown")
    expect(result.warnings.some((warning) => warning.includes("allOf"))).toBe(true)
  })

  it("maps known formats and warns on unknown formats", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.0",
      components: {
        schemas: {
          UserId: { type: "string", format: "uuid" },
          CreatedAt: { type: "string", format: "date-time" },
          Custom: { type: "string", format: "email" }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain("export const UserId = Schema.String.check(Schema.isUUID())")
    expect(result.schemas).toContain("export const CreatedAt = Schema.DateFromString")
    expect(result.schemas).toContain("export const Custom = Schema.String")
    expect(result.warnings.some((warning) => warning.includes("Unsupported schema format"))).toBe(
      true
    )
  })

  it("uses custom format map overrides", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.0",
      components: {
        schemas: {
          UserId: { type: "string", format: "uuid" }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec, {
      formatMap: { uuid: "Schema.String" },
      warnOnUnknownFormat: false
    })

    expect(result.schemas).toContain("export const UserId = Schema.String")
  })

  it("supports OpenAPI 3.1 type arrays and const", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          NullableString: { type: ["string", "null"] },
          StringOrInt: { type: ["string", "integer"] },
          ConstStatus: { const: "active" }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain("export const NullableString = Schema.NullOr(Schema.String)")
    expect(result.schemas).toContain(
      "export const StringOrInt = Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())])"
    )
    expect(result.schemas).toContain('export const ConstStatus = Schema.Literal("active")')
  })

  it("supports prefixItems and tuple items", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          TupleRest: {
            type: "array",
            prefixItems: [{ type: "string" }, { type: "integer" }],
            items: { type: "boolean" }
          },
          TupleFixed: {
            type: "array",
            prefixItems: [{ type: "string" }],
            items: false
          },
          TupleItemsArray: {
            type: "array",
            items: [{ type: "string" }, { type: "integer" }]
          }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain(
      "export const TupleRest = Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.Number.check(Schema.isInt())]), Schema.Boolean)"
    )
    expect(result.schemas).toContain("export const TupleFixed = Schema.Tuple([Schema.String])")
    expect(result.schemas).toContain(
      "export const TupleItemsArray = Schema.Tuple([Schema.String, Schema.Number.check(Schema.isInt())])"
    )
    expect(result.warnings.some((warning) => warning.includes("Tuple array items"))).toBe(true)
  })

  it("approximates conditional and unevaluatedProperties schemas", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          Conditional: {
            if: { type: "string" },
            then: { type: "string" },
            else: { type: "integer" }
          },
          Unevaluated: {
            type: "object",
            unevaluatedProperties: { type: "string" }
          }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain(
      "export const Conditional = Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())])"
    )
    expect(result.schemas).toContain(
      "export const Unevaluated = Schema.Record(Schema.String, Schema.String)"
    )
    expect(result.warnings.some((warning) => warning.includes("Conditional schemas"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("unevaluatedProperties"))).toBe(true)
  })

  it("supports patternProperties, propertyNames, and string content metadata", () => {
    const spec: OpenApiSpec = {
      openapi: "3.1.0",
      components: {
        schemas: {
          TaggedObject: {
            type: "object",
            properties: {
              id: { type: "string" }
            },
            propertyNames: { type: "string", format: "uuid" },
            patternProperties: {
              "^x-": { type: "string" },
              "^y-": { type: "integer" }
            },
            additionalProperties: false
          },
          EncodedPayload: {
            type: "string",
            contentEncoding: "base64",
            contentMediaType: "image/png"
          }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain("export const TaggedObject = Schema.Struct")
    expect(result.schemas).toContain(
      "Schema.Record(Schema.String.check(Schema.isUUID()), Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())]))"
    )
    expect(result.schemas).toContain("export const EncodedPayload = Schema.String")
    expect(result.warnings.some((warning) => warning.includes("patternProperties"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("propertyNames"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("contentEncoding"))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes("contentMediaType"))).toBe(true)
  })

  it("derives error types from response schema maps", () => {
    const spec: OpenApiSpec = {
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

    const result = generateFromSpec(spec)

    expect(result.client).toContain(
      "export type GetUserSuccess = ResponseUnion<typeof GetUserSuccessSchemas>"
    )
    expect(result.client).toContain(
      "export type GetUserError = ResponseUnion<typeof GetUserErrorSchemas>"
    )
    expect(result.client).toContain(
      "export type GetUserFailure = HttpError<typeof GetUserErrorSchemas>"
    )
  })

  it("supports multipart form data and streaming responses", () => {
    const spec: OpenApiSpec = {
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

    const result = generateFromSpec(spec)

    expect(result.client).toContain("encodeFormData")
    expect(result.client).toContain("response.arrayBuffer()")
    expect(result.client).toContain("response.body")
    expect(result.client).toContain('"json" | "text" | "empty" | "binary" | "stream"')
    expect(result.warnings).toEqual([])
  })

  it("generates makeClients for tag-based grouping", () => {
    const spec: OpenApiSpec = {
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

    const result = generateFromSpec(spec)
    expect(result.client).not.toContain("function encodeBody")
    expect(result.client).toContain("(_config: ClientConfig)")

    expect(result.client).toContain("export const makeClients")
    expect(result.client).toContain("users:")
    expect(result.client).toContain("posts:")
    expect(result.client).toContain("default:")
    expect(result.client).toContain("listUsers")
    expect(result.client).toContain("createUser")
    expect(result.client).toContain("listPosts")
    expect(result.client).toContain("healthCheck")
    expect(result.client).toContain("export const makeClient")
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

    const result = generateFromSpec(spec)

    expect(result.client).toContain('"https://api.example.com/v2" ?? config.baseUrl')
    expect(result.client).toContain("config.baseUrl")
    expect(result.client).toContain("export type OperationConfig")
  })

  it("handles recursive schemas and closed objects", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.0",
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              children: {
                type: "array",
                items: { $ref: "#/components/schemas/Node" }
              }
            }
          },
          Closed: {
            type: "object",
            properties: { id: { type: "string" } },
            additionalProperties: false
          }
        }
      },
      paths: {}
    }

    const result = generateFromSpec(spec)

    expect(result.schemas).toContain("export const Node: Schema.ConstraintDecoder<unknown, never>")
    expect(result.schemas).toContain("export const Closed = Schema.Struct")
    expect(result.schemas).not.toContain("Schema.Union([])")
  })

  it("exports SecurityScheme type and securitySchemes", () => {
    const spec: OpenApiSpec = {
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

    const result = generateFromSpec(spec)

    expect(result.client).toContain("export type SecurityScheme")
    expect(result.client).toContain("export const securitySchemes")
    expect(result.client).toContain("bearerAuth")
    expect(result.client).toContain("apiKey")
    expect(result.client).toContain('bearerAuth: {"type":"http","scheme":"bearer"}')
    expect(result.client).not.toContain("bearerAuth: SecurityScheme")
    expect(result.client).toContain("Effect.Effect<Response, ClientError, never>")
  })
})
