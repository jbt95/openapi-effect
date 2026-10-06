import { expect, it } from "vitest"
import { addClientRuntimeFunctions } from "../../src/client/runtime-functions.js"
import { createSourceFile, getSourceText } from "../../src/generator/code.js"

it("renders the client runtime helper functions", () => {
  const sourceFile = createSourceFile("runtime-functions.ts")

  addClientRuntimeFunctions(sourceFile)

  const output = getSourceText(sourceFile)

  expect(output).toContain("function resolveFetch")
  expect(output).toContain("function buildUrl")
  expect(output).toContain("function applyRetry")
  expect(output).toContain("function executeRequest")
  expect(output).toContain("function decodeResponse")
  expect(output).toContain("fetch is not available in this runtime")
})
