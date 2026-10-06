import type { SourceFile } from "ts-morph"
import type { NormalizedOperation, NormalizedResponse, NormalizedSpec } from "../openapi.js"
import type { ResponseKind, SchemaContext } from "./types.js"
import type { OperationInfo } from "../client/operation-info.js"
import { createCodeWriter, addTrailingComma, indentLines } from "./code.js"
import {
  buildParamStruct,
  formatStruct,
  inferResponseKind,
  schemaToExpression
} from "../schema/expression.js"
import { quoteKey, toCamelIdentifier, toPascalIdentifier } from "../utils.js"

type CodeWriter = ReturnType<typeof createCodeWriter>

type OperationNames = {
  opName: string
  opPascal: string
  inputSchemaName: string
  responseTypeName: string
}

type OperationInput = {
  inputSchemaName: string
  hasInput: boolean
  pathSchema?: string
  querySchema?: string
  headerSchema?: string
  bodySchema?: string
  fields: string[]
}

type NamedResponse = { status: string; name: string; kind: ResponseKind }

type ResponseGroups = {
  success: NamedResponse[]
  errors: NamedResponse[]
}

type ResponseInfo = {
  successMapName: string
  errorMapName: string
  responseTypeName: string
  hasErrors: boolean
}

const createOperationNames = (operation: NormalizedOperation): OperationNames => {
  const opPascal = toPascalIdentifier(operation.id)

  return {
    opName: toCamelIdentifier(operation.id),
    opPascal,
    inputSchemaName: `${opPascal}Input`,
    responseTypeName: `${opPascal}Response`
  }
}

const addInputField = (
  fields: string[],
  name: string,
  schema: string | undefined,
  required: boolean
): void => {
  if (!schema) return

  const expression = required ? schema : `Schema.optional(${schema})`
  fields.push(`${name}: ${expression}`)
}

type InputSchemaExpressions = Pick<
  OperationInput,
  "pathSchema" | "querySchema" | "headerSchema" | "bodySchema"
>

const createInputSchemaExpressions = (
  operation: NormalizedOperation,
  context: SchemaContext
): InputSchemaExpressions => ({
  pathSchema: buildParamStruct(operation.params.path, context),
  querySchema: buildParamStruct(operation.params.query, context),
  headerSchema: buildParamStruct(operation.params.header, context),
  bodySchema: operation.requestBody
    ? schemaToExpression(operation.requestBody.schema, context)
    : undefined
})

const createInputFields = (
  operation: NormalizedOperation,
  schemas: InputSchemaExpressions
): string[] => {
  const fields: string[] = []

  addInputField(fields, "path", schemas.pathSchema, true)
  addInputField(
    fields,
    "query",
    schemas.querySchema,
    operation.params.query.some((param) => param.required)
  )
  addInputField(
    fields,
    "headers",
    schemas.headerSchema,
    operation.params.header.some((param) => param.required)
  )
  addInputField(fields, "body", schemas.bodySchema, Boolean(operation.requestBody?.required))

  return fields
}

const createOperationInput = (
  operation: NormalizedOperation,
  context: SchemaContext,
  inputSchemaName: string
): OperationInput => {
  const schemas = createInputSchemaExpressions(operation, context)
  const fields = createInputFields(operation, schemas)

  return { inputSchemaName, hasInput: fields.length > 0, fields, ...schemas }
}

const addOperationInputSchema = (writer: CodeWriter, input: OperationInput): void => {
  if (!input.hasInput) return

  writer.addConst(input.inputSchemaName, formatStruct(input.fields), true)
  writer.addTypeAlias(input.inputSchemaName, `SchemaType<typeof ${input.inputSchemaName}>`, true)
}

const isNumericStatus = (status: string): boolean => /^\d+$/.test(status)

const isSuccessStatus = (status: string): boolean => {
  if (!isNumericStatus(status)) return false

  const code = Number(status)

  return code >= 200 && code < 300
}

const isSuccessResponse = (status: string, hasSuccessStatus: boolean): boolean => {
  if (!hasSuccessStatus) return true

  if (status === "default") return false

  return isSuccessStatus(status)
}

const responseSchemaName = (opPascal: string, status: string): string => {
  const statusLabel = status === "default" ? "Default" : `Status${status}`

  return `${opPascal}Response${toPascalIdentifier(statusLabel)}`
}

const responseSchemaExpression = (response: NormalizedResponse, context: SchemaContext): string =>
  response.schema ? schemaToExpression(response.schema, context) : "Schema.Undefined"

const warnUnsupportedJsonResponse = (
  operation: NormalizedOperation,
  response: NormalizedResponse,
  kind: ResponseKind,
  warnings: string[]
): void => {
  if (!response.contentType || kind !== "json" || response.contentType.includes("json")) return

  warnings.push(
    `Operation ${operation.id} response ${response.status} uses ${response.contentType}; treated as JSON.`
  )
}

const addResponseSchemaConstant = (
  writer: CodeWriter,
  operation: NormalizedOperation,
  response: NormalizedResponse,
  context: SchemaContext,
  warnings: string[],
  opPascal: string
): NamedResponse => {
  const name = responseSchemaName(opPascal, response.status)
  const expression = responseSchemaExpression(response, context)
  const kind = inferResponseKind(response.contentType, response.schema)

  warnUnsupportedJsonResponse(operation, response, kind, warnings)
  writer.addConst(name, expression, true)

  return { status: response.status, name, kind }
}

const addResponseSchemaConstants = (
  writer: CodeWriter,
  operation: NormalizedOperation,
  context: SchemaContext,
  warnings: string[],
  opPascal: string
): NamedResponse[] => {
  const responses: NormalizedResponse[] =
    operation.responses.length > 0 ? operation.responses : [{ status: "default" }]

  return responses.map((response) =>
    addResponseSchemaConstant(writer, operation, response, context, warnings, opPascal)
  )
}

const groupResponses = (responses: NamedResponse[]): ResponseGroups => {
  const hasSuccessStatus = responses.some((response) => isSuccessStatus(response.status))

  const success = responses.filter((response) =>
    isSuccessResponse(response.status, hasSuccessStatus)
  )

  const errors = responses.filter(
    (response) => !isSuccessResponse(response.status, hasSuccessStatus)
  )

  return { success, errors }
}

const formatResponseMapEntry = (
  response: NamedResponse,
  operation: NormalizedOperation,
  warnings: string[]
): string => {
  const numeric = isNumericStatus(response.status)
  const key = response.status === "default" || !numeric ? "default" : response.status

  if (response.status !== "default" && !numeric) {
    warnings.push(
      `Operation ${operation.id} response ${response.status} cannot be matched; using default.`
    )
  }

  return `  ${quoteKey(key)}: { schema: ${response.name}, kind: "${response.kind}" },`
}

const addResponseMap = (
  writer: CodeWriter,
  mapName: string,
  responses: NamedResponse[],
  operation: NormalizedOperation,
  warnings: string[]
): void => {
  const entries = responses
    .map((response) => formatResponseMapEntry(response, operation, warnings))
    .join("\n")

  writer.addConst(
    mapName,
    `{
${entries}
} as const`
  )
}

const addResponseTypeAliases = (
  writer: CodeWriter,
  opPascal: string,
  responseTypeName: string,
  successMapName: string,
  errorMapName: string,
  hasErrors: boolean
): void => {
  const successTypeName = `${opPascal}Success`
  const errorTypeName = `${opPascal}Error`
  writer.addTypeAlias(successTypeName, `ResponseUnion<typeof ${successMapName}>`, true)
  writer.addTypeAlias(
    errorTypeName,
    hasErrors ? `ResponseUnion<typeof ${errorMapName}>` : "never",
    true
  )
  writer.addTypeAlias(responseTypeName, `${successTypeName} | ${errorTypeName}`, true)
  writer.addTypeAlias(
    `${opPascal}Failure`,
    hasErrors ? `HttpError<typeof ${errorMapName}>` : "never",
    true
  )
}

type ResponseMapNames = { successMapName: string; errorMapName: string }

const createResponseMapNames = (opPascal: string): ResponseMapNames => ({
  successMapName: `${opPascal}SuccessSchemas`,
  errorMapName: `${opPascal}ErrorSchemas`
})

const addResponseMaps = (
  writer: CodeWriter,
  operation: NormalizedOperation,
  warnings: string[],
  groups: ResponseGroups,
  names: ResponseMapNames
): void => {
  addResponseMap(writer, names.successMapName, groups.success, operation, warnings)

  if (groups.errors.length > 0) {
    addResponseMap(writer, names.errorMapName, groups.errors, operation, warnings)
  }
}

const createResponseInfo = (
  names: ResponseMapNames,
  responseTypeName: string,
  hasErrors: boolean
): ResponseInfo => ({ ...names, responseTypeName, hasErrors })

const addOperationResponseSchemas = (
  writer: CodeWriter,
  operation: NormalizedOperation,
  context: SchemaContext,
  warnings: string[],
  names: OperationNames
): ResponseInfo => {
  const responses = addResponseSchemaConstants(writer, operation, context, warnings, names.opPascal)

  const groups = groupResponses(responses)
  const mapNames = createResponseMapNames(names.opPascal)
  const hasErrors = groups.errors.length > 0

  addResponseMaps(writer, operation, warnings, groups, mapNames)
  addResponseTypeAliases(
    writer,
    names.opPascal,
    names.responseTypeName,
    mapNames.successMapName,
    mapNames.errorMapName,
    hasErrors
  )

  return createResponseInfo(mapNames, names.responseTypeName, hasErrors)
}

const getRequestArguments = (input: OperationInput) => ({
  path: input.pathSchema ? "decoded.path" : "undefined",
  query: input.querySchema ? "decoded.query" : "undefined",
  headers: input.headerSchema ? "decoded.headers" : "undefined",
  body: input.bodySchema ? "decoded.body" : "undefined"
})

const getBaseUrlExpression = (operation: NormalizedOperation): string =>
  operation.baseUrl ? `(${JSON.stringify(operation.baseUrl)} ?? config.baseUrl)` : "config.baseUrl"

const createRequestLine = (method: string, hasBody: boolean): string =>
  `const request: RequestContext = { url, method: ${method}, headers: auth.headers${hasBody ? ", body" : ""} }`

const createRequestUrlLine = (
  operation: NormalizedOperation,
  args: ReturnType<typeof getRequestArguments>
): string =>
  `const url = buildUrl(${getBaseUrlExpression(operation)}, ${JSON.stringify(operation.path)}, ${args.path}, auth.query)`

const createBodyRequestSetup = (
  args: ReturnType<typeof getRequestArguments>,
  contentType: string,
  method: string,
  url: string
): string[] => [
  `const hasBody = ${args.body} !== undefined`,
  `const body = encodeBody(${args.body}, ${contentType})`,
  `const baseHeaders = mergeHeaders(config.headers, ${args.headers}, ${contentType}, hasBody)`,
  `const auth = applyAuth(config.auth, baseHeaders, ${args.query})`,
  url,
  createRequestLine(method, true)
]

const createBodylessRequestSetup = (
  args: ReturnType<typeof getRequestArguments>,
  method: string,
  url: string
): string[] => [
  `const baseHeaders = mergeHeaders(config.headers, ${args.headers})`,
  `const auth = applyAuth(config.auth, baseHeaders, ${args.query})`,
  url,
  createRequestLine(method, false)
]

const createRequestSetupLines = (
  operation: NormalizedOperation,
  input: OperationInput
): string[] => {
  const args = getRequestArguments(input)

  const contentType = input.bodySchema
    ? JSON.stringify(operation.requestBody?.contentType ?? "application/json")
    : "undefined"

  const method = JSON.stringify(operation.method.toUpperCase())
  const url = createRequestUrlLine(operation, args)

  if (input.bodySchema) return createBodyRequestSetup(args, contentType, method, url)

  return createBodylessRequestSetup(args, method, url)
}

const createRequestPipeline = (setupLines: string[]): string =>
  [
    "Effect.try({",
    "  try: () => {",
    ...indentLines(setupLines.join("\n"), "    ").split("\n"),
    "    return request",
    "  },",
    '  catch: (error) => ({ _tag: "InputError" as const, error })',
    "}).pipe(",
    "  Effect.flatMap((request) =>",
    "    applyRequestInterceptors(request, config.interceptors?.request).pipe(",
    "      Effect.flatMap((prepared) =>",
    "        executeRequest(",
    "          fetcher,",
    "          prepared.method,",
    "          prepared.url,",
    "          prepared.headers,",
    "          prepared.body",
    "        ).pipe(",
    "          Effect.flatMap((response) =>",
    "            applyResponseInterceptors(response, prepared, config.interceptors?.response)",
    "          )",
    "        )",
    "      )",
    "    )",
    "  )",
    ")"
  ].join("\n")

const createAttemptFlow = (
  requestPipeline: string,
  hasInput: boolean,
  response: ResponseInfo
): string => {
  const responseCall = response.hasErrors
    ? `decodeResponse(response, ${response.successMapName}, ${response.errorMapName})`
    : `decodeResponse(response, ${response.successMapName})`

  if (hasInput) {
    return [
      `${requestPipeline}.pipe(`,
      `  Effect.flatMap((response) => ${responseCall})`,
      ")"
    ].join("\n")
  }

  return [
    "Effect.succeed(undefined).pipe(",
    `  Effect.flatMap(() => ${requestPipeline}),`,
    `  Effect.flatMap((response) => ${responseCall})`,
    ")"
  ].join("\n")
}

const createOperationEffectBody = (
  operation: NormalizedOperation,
  input: OperationInput,
  response: ResponseInfo
): string => {
  const setup = createRequestSetupLines(operation, input)
  const pipeline = createRequestPipeline(setup)
  const attempt = createAttemptFlow(pipeline, input.hasInput, response)

  const resilience = [
    "applyResilience(",
    indentLines(addTrailingComma(attempt), "  "),
    "  config,",
    `  ${JSON.stringify(operation.method.toUpperCase())}`,
    ")"
  ].join("\n")

  if (!input.hasInput) return resilience

  return [
    `decodeInput(${input.inputSchemaName}, input).pipe(`,
    "  Effect.flatMap((decoded) =>",
    indentLines(resilience, "    "),
    "  )",
    ")"
  ].join("\n")
}

const createOperationInfo = (
  writer: CodeWriter,
  operation: NormalizedOperation,
  context: SchemaContext,
  warnings: string[]
): OperationInfo => {
  const names = createOperationNames(operation)
  const input = createOperationInput(operation, context, names.inputSchemaName)
  addOperationInputSchema(writer, input)

  const response = addOperationResponseSchemas(writer, operation, context, warnings, names)
  const effectBody = createOperationEffectBody(operation, input, response)

  return {
    opName: names.opName,
    tag: operation.tags[0] ?? "default",
    hasInput: input.hasInput,
    inputSchemaName: input.hasInput ? input.inputSchemaName : undefined,
    successMapName: response.successMapName,
    errorMapName: response.hasErrors ? response.errorMapName : undefined,
    responseTypeName: response.responseTypeName,
    effectBody
  }
}

const encodeFormDataStatements = [
  'if (typeof FormData === "undefined") {',
  '  throw new Error("FormData is not available in this runtime")',
  "}",
  "if (body instanceof FormData) return body",
  'if (!body || typeof body !== "object" || Array.isArray(body)) {',
  '  throw new Error("multipart/form-data body must be an object")',
  "}",
  "const form = new FormData()",
  "for (const [key, value] of Object.entries(body as Record<string, unknown>)) {",
  "  if (value === undefined) continue",
  "  if (Array.isArray(value)) {",
  "    for (const item of value) {",
  "      if (item === undefined) continue",
  "      if (item === null) {",
  '        form.append(key, "")',
  "        continue",
  "      }",
  '      if (typeof Blob !== "undefined" && item instanceof Blob) {',
  "        form.append(key, item)",
  "        continue",
  "      }",
  '      if (typeof item === "object") {',
  "        form.append(key, JSON.stringify(item))",
  "        continue",
  "      }",
  "      form.append(key, String(item))",
  "    }",
  "    continue",
  "  }",
  "  if (value === null) {",
  '    form.append(key, "")',
  "    continue",
  "  }",
  '  if (typeof Blob !== "undefined" && value instanceof Blob) {',
  "    form.append(key, value)",
  "    continue",
  "  }",
  '  if (typeof value === "object") {',
  "    form.append(key, JSON.stringify(value))",
  "    continue",
  "  }",
  "  form.append(key, String(value))",
  "}",
  "return form"
]

const encodeBodyStatements = [
  "if (body === undefined) return undefined",
  "const normalized = contentType?.toLowerCase()",
  'if (normalized && normalized.includes("multipart/form-data")) {',
  "  return encodeFormData(body)",
  "}",
  'if (!normalized || normalized.includes("application/json")) {',
  "  return JSON.stringify(body)",
  "}",
  'if (normalized.startsWith("text/")) {',
  "  return String(body)",
  "}",
  "return JSON.stringify(body)"
]

const addEncodeFormDataFunction = (writer: CodeWriter): void => {
  writer.addFunction({
    name: "encodeFormData",
    parameters: [{ name: "body", type: "unknown" }],
    returnType: "FormData",
    statements: encodeFormDataStatements
  })
}

const addEncodeBodyFunction = (writer: CodeWriter): void => {
  writer.addFunction({
    name: "encodeBody",
    parameters: [
      { name: "body", type: "unknown" },
      { name: "contentType?", type: "string" }
    ],
    returnType: "BodyInit | undefined",
    statements: encodeBodyStatements
  })
}

const addRequestBodyFunctions = (writer: CodeWriter): void => {
  addEncodeFormDataFunction(writer)
  addEncodeBodyFunction(writer)
}

export const generateOperationDefinitions = (
  sourceFile: SourceFile,
  spec: NormalizedSpec,
  context: SchemaContext,
  warnings: string[]
): OperationInfo[] => {
  const writer = createCodeWriter(sourceFile)

  const operationInfos = spec.operations.map((operation) =>
    createOperationInfo(writer, operation, context, warnings)
  )

  if (spec.operations.some((operation) => operation.requestBody !== undefined)) {
    addRequestBodyFunctions(writer)
  }

  return operationInfos
}
