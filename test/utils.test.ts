import { describe, expect, it } from "vitest"
import {
  isValidIdentifier,
  quoteKey,
  toCamelCase,
  toCamelIdentifier,
  toIdentifier,
  toPascalCase,
  toPascalIdentifier
} from "../src/utils.js"

describe("utils", () => {
  it("converts to pascal/camel case", () => {
    expect(toPascalCase("user-id")).toBe("UserId")
    expect(toCamelCase("user-id")).toBe("userId")
    expect(toPascalCase("")).toBe("Unnamed")
  })

  it("produces valid identifiers", () => {
    expect(toIdentifier("123value")).toBe("_123value")
    expect(toPascalIdentifier("api token")).toBe("ApiToken")
    expect(toCamelIdentifier("api token")).toBe("apiToken")
    expect(isValidIdentifier("apiToken")).toBe(true)
    expect(isValidIdentifier("1token")).toBe(false)
  })

  it("quotes invalid keys", () => {
    expect(quoteKey("x-trace-id")).toBe('"x-trace-id"')
    expect(quoteKey("simple")).toBe("simple")
  })
})
