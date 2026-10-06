import type { SourceFile } from "ts-morph"
import type { NormalizedOperation, NormalizedSpec } from "../openapi.js"
import type { OperationInfo } from "./operation-info.js"
import { createCodeWriter, indentLines } from "../generator/code.js"
import { quoteKey, toCamelIdentifier } from "../utils.js"

type GroupedOperations = Map<string, NormalizedOperation[]>

const groupOperationsByTag = (operations: NormalizedOperation[]): GroupedOperations => {
  const groups = new Map<string, NormalizedOperation[]>()

  for (const operation of operations) {
    const tag = operation.tags[0] ?? "default"
    const existing = groups.get(tag) ?? []
    existing.push(operation)
    groups.set(tag, existing)
  }

  return groups
}

const createOperationSignature = (info: OperationInfo): string => {
  if (!info.hasInput) return `${info.opName}: () =>`

  return `${info.opName}: (input: ${info.inputSchemaName!}) =>`
}

const formatOperationEntry = (info: OperationInfo): string =>
  `${createOperationSignature(info)}\n${indentLines(info.effectBody, "  ")}`

const formatOperationEntries = (infos: OperationInfo[], indentation: string): string =>
  indentLines(infos.map(formatOperationEntry).join(",\n"), indentation)

const addMakeClient = (
  writer: ReturnType<typeof createCodeWriter>,
  operationInfos: OperationInfo[]
): void => {
  const body = [
    "const fetcher = resolveFetch(config.fetch)",
    "return {",
    formatOperationEntries(operationInfos, "  "),
    "}"
  ]

  const initializer = ["(config: ClientConfig) => {", indentLines(body.join("\n"), "  "), "}"].join(
    "\n"
  )

  writer.addConst("makeClient", initializer, true)
}

const operationsForTag = (
  operations: NormalizedOperation[],
  operationInfos: OperationInfo[]
): OperationInfo[] => {
  const operationNames = new Set(operations.map((operation) => toCamelIdentifier(operation.id)))

  return operationInfos.filter((info) => operationNames.has(info.opName))
}

const createTagClientEntry = (
  tag: string,
  operations: NormalizedOperation[],
  operationInfos: OperationInfo[]
): string => {
  const tagClientName = toCamelIdentifier(tag)
  const taggedOperations = operationsForTag(operations, operationInfos)

  const body = [
    "const fetcher = resolveFetch(config.fetch)",
    "return {",
    formatOperationEntries(taggedOperations, "    "),
    "  }"
  ].join("\n")

  return `${quoteKey(tagClientName)}: (config: ClientConfig) => {\n${indentLines(body, "    ")}\n  }`
}

const addMakeClients = (
  writer: ReturnType<typeof createCodeWriter>,
  operations: NormalizedOperation[],
  operationInfos: OperationInfo[]
): void => {
  const groups = groupOperationsByTag(operations)

  if (groups.size === 0) return

  const entries = [...groups].map(([tag, tagOperations]) =>
    createTagClientEntry(tag, tagOperations, operationInfos)
  )

  const initializer = [
    "(_config: ClientConfig) => {",
    indentLines(`return {\n${indentLines(entries.join(",\n"), "  ")}\n}`, "  "),
    "}"
  ].join("\n")

  writer.addConst("makeClients", initializer, true)
}

export const addClientFactories = (
  sourceFile: SourceFile,
  spec: NormalizedSpec,
  operationInfos: OperationInfo[]
): void => {
  const writer = createCodeWriter(sourceFile)

  addMakeClient(writer, operationInfos)
  addMakeClients(writer, spec.operations, operationInfos)
}
