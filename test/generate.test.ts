import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { generateFromOpenApi } from "../src/index.js"

const fixturePath = fileURLToPath(new URL("../fixtures/simple.json", import.meta.url))
const complexFixturePath = fileURLToPath(new URL("../fixtures/complex.json", import.meta.url))
const jiraSpecUrl =
  "https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json?_v=1.8516.81"

describe("generateFromOpenApi", () => {
  it("generates schema and client outputs", async () => {
    const result = await generateFromOpenApi(fixturePath)

    expect(result.schemas).toContain("export const User = Schema.Struct")
    expect(result.schemas).toContain("export type User")
    expect(result.client).toContain("export const makeClient")
    expect(result.client).toContain("getUser")
    expect(result.client).toContain("auth?: AuthConfig")
    expect(result.client).toContain("timeoutMs?: number")
    expect(result.client).toContain("retry?: RetryConfig")
    expect(result.client).toContain("export type HttpError")
    expect(result.warnings).toEqual([])
  })

  it("handles complex schemas and clients", async () => {
    const result = await generateFromOpenApi(complexFixturePath)

    expect(result.schemas).toContain("Schema.Union")
    expect(result.schemas).toContain("Schema.NullOr")
    expect(result.schemas).toContain("Schema.Literal")
    expect(result.schemas).toContain("Schema.Array")
    expect(result.schemas).toContain("Schema.Record(Schema.String")
    expect(result.client).toContain("listPets")
    expect(result.client).toContain("searchUsers")
    expect(result.client).toContain("updateUser")
    expect(result.client).toContain("getHealth")
    expect(
      result.warnings.some((warning) => warning.includes("only JSON and multipart/form-data"))
    ).toBe(true)
  })

  it.skipIf(!process.env.RUN_REMOTE_SMOKE_TESTS)(
    "generates a client from the Jira OpenAPI specification",
    async () => {
      const result = await generateFromOpenApi(jiraSpecUrl)

      expect(result.schemas).toContain("export const ")
      expect(result.client).toContain("export const makeClient")
    },
    300_000
  )
})
