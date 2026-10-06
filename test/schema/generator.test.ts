import { expect, it } from "vitest"
import { buildComponentNameMap } from "../../src/generator/code.js"
import type { GenerateOptions } from "../../src/generator/types.js"
import { normalizeOpenApi, type OpenApiSpec } from "../../src/openapi.js"
import { generateSchemas } from "../../src/schema/generator.js"

const generateSchemasForSpec = (spec: OpenApiSpec, options?: GenerateOptions) => {
  const normalized = normalizeOpenApi(spec)

  return generateSchemas(normalized, buildComponentNameMap(normalized.components), options)
}

const conditionalThenKey = ["th", "en"].join("")

const prefixItemsSpec: OpenApiSpec = {
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

const patternPropertiesSpec: OpenApiSpec = {
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

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain("export const Foo = Schema.Unknown")
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

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain("export const UserId = Schema.String.check(Schema.isUUID())")
  expect(result.code).toContain("export const CreatedAt = Schema.DateFromString")
  expect(result.code).toContain("export const Custom = Schema.String")
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

  const result = generateSchemasForSpec(spec, {
    formatMap: { uuid: "Schema.String" },
    warnOnUnknownFormat: false
  })

  expect(result.code).toContain("export const UserId = Schema.String")
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

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain("export const NullableString = Schema.NullOr(Schema.String)")
  expect(result.code).toContain(
    "export const StringOrInt = Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())])"
  )
  expect(result.code).toContain('export const ConstStatus = Schema.Literal("active")')
})

it("supports prefixItems and tuple items", () => {
  const spec = prefixItemsSpec

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain(
    "export const TupleRest = Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.Number.check(Schema.isInt())]), Schema.Boolean)"
  )
  expect(result.code).toContain("export const TupleFixed = Schema.Tuple([Schema.String])")
  expect(result.code).toContain(
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
          [conditionalThenKey]: { type: "string" },
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

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain(
    "export const Conditional = Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())])"
  )
  expect(result.code).toContain(
    "export const Unevaluated = Schema.Record(Schema.String, Schema.String)"
  )
  expect(result.warnings.some((warning) => warning.includes("Conditional schemas"))).toBe(true)
  expect(result.warnings.some((warning) => warning.includes("unevaluatedProperties"))).toBe(true)
})

it("supports patternProperties, propertyNames, and string content metadata", () => {
  const spec = patternPropertiesSpec

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain("export const TaggedObject = Schema.Struct")
  expect(result.code).toContain(
    "Schema.Record(Schema.String.check(Schema.isUUID()), Schema.Union([Schema.String, Schema.Number.check(Schema.isInt())]))"
  )
  expect(result.code).toContain("export const EncodedPayload = Schema.String")
  expect(result.warnings.some((warning) => warning.includes("patternProperties"))).toBe(true)
  expect(result.warnings.some((warning) => warning.includes("propertyNames"))).toBe(true)
  expect(result.warnings.some((warning) => warning.includes("contentEncoding"))).toBe(true)
  expect(result.warnings.some((warning) => warning.includes("contentMediaType"))).toBe(true)
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

  const result = generateSchemasForSpec(spec)

  expect(result.code).toContain("export const Node: Schema.ConstraintDecoder<unknown, never>")
  expect(result.code).toContain("export const Closed = Schema.Struct")
  expect(result.code).not.toContain("Schema.Union([])")
})
