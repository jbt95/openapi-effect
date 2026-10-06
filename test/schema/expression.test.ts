import { expect, it } from "vitest"
import {
  schemaToExpression,
  buildParamStruct,
  findRecursiveComponents,
  formatStruct,
  inferResponseKind
} from "../../src/schema/expression.js"
import type { SchemaContext } from "../../src/generator/types.js"

const makeContext = (): SchemaContext => ({
  componentNames: new Map([["User", "User"]]),
  refPrefix: "Schemas.",
  warnings: [],
  formatMap: { uuid: "Schema.String.check(Schema.isUUID())" },
  warnOnUnknownFormat: true
})

it("renders primitive, reference, and unsupported-format schemas", () => {
  const context = makeContext()

  expect(schemaToExpression({ type: "array", items: { type: "string" } }, context)).toBe(
    "Schema.Array(Schema.String)"
  )
  expect(schemaToExpression({ $ref: "#/components/schemas/User" }, context)).toBe(
    "Schema.suspend(() => Schemas.User)"
  )
  expect(schemaToExpression({ type: "string", format: "email" }, context)).toBe("Schema.String")
  expect(context.warnings).toEqual(["Unsupported schema format: email"])
  expect(schemaToExpression(undefined, context)).toBe("Schema.Unknown")
})

it("formats object fields and parameter structs", () => {
  const parameters = buildParamStruct(
    [
      { name: "x-trace-id", required: true, schema: { type: "string" } },
      { name: "limit", required: false, schema: { type: "integer" } }
    ],
    makeContext()
  )

  expect(parameters).toContain('"x-trace-id": Schema.String')
  expect(parameters).toContain("limit: Schema.optional(Schema.Number.check(Schema.isInt()))")
  expect(buildParamStruct([], makeContext())).toBeUndefined()
  expect(formatStruct([])).toBe("Schema.Struct({})")
})

it("infers response kinds from content types", () => {
  expect(inferResponseKind()).toBe("empty")
  expect(inferResponseKind("text/plain", { type: "string" })).toBe("text")
  expect(inferResponseKind("application/octet-stream", { type: "string" })).toBe("binary")
  expect(inferResponseKind("text/event-stream", { type: "string" })).toBe("stream")
  expect(inferResponseKind("application/problem+json", { type: "object" })).toBe("json")
})

it("finds every component participating in a recursive cycle", () => {
  const recursive = findRecursiveComponents({
    User: { properties: { team: { $ref: "#/components/schemas/Team" } } },
    Team: { properties: { owner: { $ref: "#/components/schemas/User" } } },
    Label: { type: "string" }
  })

  expect(recursive).toEqual(new Set(["User", "Team"]))
})
