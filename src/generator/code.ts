import { IndentationText, NewLineKind, Project, QuoteKind, VariableDeclarationKind } from "ts-morph"
import type { SourceFile } from "ts-morph"
import type { OpenApiSchema } from "../openapi.js"
import { toPascalIdentifier } from "../utils.js"

export const createSourceFile = (fileName: string) => {
  const project = new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Double,
      newLineKind: NewLineKind.LineFeed
    }
  })

  return project.createSourceFile(fileName, "", { overwrite: true })
}

export const getSourceText = (sourceFile: ReturnType<typeof createSourceFile>) => {
  const text = sourceFile.getFullText().trimEnd()

  return text.length === 0 ? "" : `${text}\n`
}

export const indentLines = (value: string, indent = "  ") =>
  value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n")

export const addTrailingComma = (value: string) => {
  const lines = value.split("\n")

  if (lines.length === 0) return value
  lines[lines.length - 1] = `${lines[lines.length - 1]},`

  return lines.join("\n")
}

const ensureUniqueName = (base: string, used: Set<string>) => {
  let name = base
  let index = 1

  while (used.has(name)) {
    index += 1
    name = `${base}${index}`
  }

  used.add(name)

  return name
}

export const buildComponentNameMap = (components: Record<string, OpenApiSchema>) => {
  const used = new Set<string>()
  const map = new Map<string, string>()

  for (const key of Object.keys(components).sort()) {
    const base = toPascalIdentifier(key)
    map.set(key, ensureUniqueName(base, used))
  }

  return map
}

type FunctionOptions = {
  name: string
  parameters?: { name: string; type?: string }[]
  typeParameters?: string[]
  returnType?: string
  statements: string[]
  isExported?: boolean
}

export const createCodeWriter = (sourceFile: SourceFile) => ({
  addTypeAlias: (name: string, type: string, isExported = false) =>
    sourceFile.addTypeAlias({ name, type, isExported }),
  addConst: (name: string, initializer: string, isExported = false) =>
    sourceFile.addVariableStatement({
      isExported,
      declarationKind: VariableDeclarationKind.Const,
      declarations: [{ name, initializer }]
    }),
  addFunction: (options: FunctionOptions) =>
    sourceFile.addFunction({
      name: options.name,
      parameters: options.parameters ?? [],
      typeParameters: options.typeParameters,
      returnType: options.returnType,
      statements: options.statements,
      isExported: options.isExported ?? false
    })
})
