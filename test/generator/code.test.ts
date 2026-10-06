import { expect, it } from "vitest"
import {
  addTrailingComma,
  buildComponentNameMap,
  createCodeWriter,
  createSourceFile,
  getSourceText,
  indentLines
} from "../../src/generator/code.js"

it("indents lines and adds a trailing comma", () => {
  expect(indentLines("first\nsecond", "  ")).toBe("  first\n  second")
  expect(addTrailingComma("first\nsecond")).toBe("first\nsecond,")
  expect(addTrailingComma("")).toBe(",")
})

it("creates a source file and writes TypeScript declarations", () => {
  const sourceFile = createSourceFile("writer.ts")
  const writer = createCodeWriter(sourceFile)

  writer.addTypeAlias("Identifier", "string", true)
  writer.addConst("value", "1")
  writer.addFunction({
    name: "getValue",
    returnType: "number",
    statements: ["return 1"],
    isExported: true
  })

  const source = getSourceText(sourceFile)

  expect(source).toContain("export type Identifier = string")
  expect(source).toContain("const value = 1")
  expect(source).toContain("export function getValue(): number")
  expect(source.endsWith("\n")).toBe(true)
})

it("creates stable unique component names", () => {
  const names = buildComponentNameMap({ "a-b": {}, "a b": {}, "123": {} })

  expect(names.get("a b")).toBe("AB")
  expect(names.get("a-b")).toBe("AB2")
  expect(names.get("123")).toBe("_123")
})
