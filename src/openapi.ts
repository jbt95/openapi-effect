import SwaggerParser from "@apidevtools/swagger-parser"
import { toCamelIdentifier } from "./utils.js"

export type OpenApiSchema = {
  $ref?: string
  type?: string | string[]
  format?: string
  const?: string | number | boolean | null
  enum?: Array<string | number | boolean | null>
  nullable?: boolean
  items?: OpenApiSchema | OpenApiSchema[] | boolean
  prefixItems?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  patternProperties?: Record<string, OpenApiSchema>
  propertyNames?: OpenApiSchema
  required?: string[]
  allOf?: OpenApiSchema[]
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  if?: OpenApiSchema
  then?: OpenApiSchema
  else?: OpenApiSchema
  additionalProperties?: boolean | OpenApiSchema
  unevaluatedProperties?: boolean | OpenApiSchema
  contentEncoding?: string
  contentMediaType?: string
}

export type OpenApiParameter = {
  name: string
  in: "path" | "query" | "header" | "cookie"
  required?: boolean
  schema?: OpenApiSchema
}

export type OpenApiRequestBody = {
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchema }>
}

export type OpenApiResponse = {
  description?: string
  content?: Record<string, { schema?: OpenApiSchema }>
}

export type OpenApiServer = {
  url: string
  description?: string
  variables?: Record<string, { default?: string; enum?: string[] }>
}

export type OpenApiSecurityScheme =
  | { type: "http"; scheme: "bearer" | "basic"; description?: string }
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; description?: string }
  | { type: "oauth2"; flows: unknown; description?: string }
  | { type: "openIdConnect"; openIdConnectUrl: string; description?: string }

export type OpenApiOperation = {
  operationId?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
  security?: Array<Record<string, string[]>>
  servers?: OpenApiServer[]
}

export type OpenApiPathItem = {
  parameters?: OpenApiParameter[]
  servers?: OpenApiServer[]
  get?: OpenApiOperation
  post?: OpenApiOperation
  put?: OpenApiOperation
  patch?: OpenApiOperation
  delete?: OpenApiOperation
  head?: OpenApiOperation
  options?: OpenApiOperation
  trace?: OpenApiOperation
}

export type OpenApiSpec = {
  openapi?: string
  info?: { title?: string; version?: string }
  servers?: OpenApiServer[]
  paths?: Record<string, OpenApiPathItem>
  security?: Array<Record<string, string[]>>
  components?: {
    schemas?: Record<string, OpenApiSchema>
    securitySchemes?: Record<string, OpenApiSecurityScheme>
  }
}

export type NormalizedParameter = {
  name: string
  required: boolean
  schema?: OpenApiSchema
}

export type NormalizedRequestBody = {
  required: boolean
  schema?: OpenApiSchema
  contentType?: string
}

export type NormalizedResponse = {
  status: string
  schema?: OpenApiSchema
  contentType?: string
}

export type NormalizedOperation = {
  id: string
  method: string
  path: string
  tags: string[]
  baseUrl?: string
  params: {
    path: NormalizedParameter[]
    query: NormalizedParameter[]
    header: NormalizedParameter[]
  }
  requestBody?: NormalizedRequestBody
  responses: NormalizedResponse[]
  security?: Array<Record<string, string[]>>
}

export type NormalizedSpec = {
  components: Record<string, OpenApiSchema>
  operations: NormalizedOperation[]
  baseUrl?: string
  securitySchemes: Record<string, OpenApiSecurityScheme>
  globalSecurity?: Array<Record<string, string[]>>
  warnings: string[]
}

const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const

const pickContent = (content?: Record<string, { schema?: OpenApiSchema }>) => {
  if (!content) return undefined

  if (content["application/json"]) {
    return { contentType: "application/json", schema: content["application/json"].schema }
  }

  const firstType = Object.keys(content)[0]

  if (!firstType) return undefined

  return { contentType: firstType, schema: content[firstType]?.schema }
}

const isJsonContentType = (contentType: string) => {
  const normalized = contentType.toLowerCase()

  return normalized.includes("application/json") || normalized.endsWith("+json")
}

const isTextContentType = (contentType: string) => contentType.toLowerCase().startsWith("text/")

const isMultipartContentType = (contentType: string) =>
  contentType.toLowerCase().startsWith("multipart/form-data")

const isBinaryContentType = (contentType: string) => {
  const normalized = contentType.toLowerCase()

  return (
    normalized === "application/octet-stream" ||
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/")
  )
}

const isSupportedRequestContentType = (contentType: string) =>
  isJsonContentType(contentType) || isMultipartContentType(contentType)

const isSupportedResponseContentType = (contentType: string) =>
  isJsonContentType(contentType) ||
  isTextContentType(contentType) ||
  isBinaryContentType(contentType)

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

const inferOperationId = (method: string, path: string) => {
  const segments = path
    .replace(/[{}]/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  const base = [method, ...segments].join(" ")

  return toCamelIdentifier(base)
}

const resolveServerUrl = (server: OpenApiServer): string => {
  let url = server.url
  const variables = server.variables ?? {}

  for (const [variableName, variable] of Object.entries(variables)) {
    const defaultValue = variable?.default ?? ""
    url = url.replaceAll(`{${variableName}}`, defaultValue)
  }

  return url
}

export const loadOpenApi = async (input: string): Promise<OpenApiSpec> => {
  const parser = new SwaggerParser()
  const parsed = await parser.parse(input)

  // SAFETY: SwaggerParser validates and dereferences the OpenAPI document; this type models its supported subset.
  return parsed as OpenApiSpec
}

const warnIgnoredCookieParameter = (
  operationId: string,
  name: string,
  warnings: string[]
): void => {
  warnings.push(
    `Operation ${operationId} uses cookie parameters which are currently ignored (${name}).`
  )
}

const addNormalizedParameter = (
  param: OpenApiParameter,
  operationId: string,
  normalized: NormalizedOperation["params"],
  warnings: string[]
): void => {
  if (!param || !param.name || !param.in) return

  if (param.in === "cookie") {
    warnIgnoredCookieParameter(operationId, param.name, warnings)

    return
  }

  normalized[param.in].push({
    name: param.name,
    required: param.in === "path" || Boolean(param.required),
    schema: param.schema
  })
}

const normalizeParameters = (
  params: OpenApiParameter[],
  operationId: string,
  warnings: string[]
): NormalizedOperation["params"] => {
  const normalized: NormalizedOperation["params"] = { path: [], query: [], header: [] }

  for (const param of params) {
    addNormalizedParameter(param, operationId, normalized, warnings)
  }

  return normalized
}

const normalizeRequestBody = (
  operation: OpenApiOperation,
  operationId: string,
  warnings: string[]
): NormalizedRequestBody | undefined => {
  const content = pickContent(operation.requestBody?.content)

  if (!content) return undefined

  if (content.contentType && !isSupportedRequestContentType(content.contentType)) {
    warnings.push(
      `Operation ${operationId} uses request content type ${content.contentType}; only JSON and multipart/form-data are fully supported.`
    )
  }

  return {
    required: Boolean(operation.requestBody?.required),
    schema: content.schema,
    contentType: content.contentType
  }
}

const normalizeResponses = (
  operation: OpenApiOperation,
  operationId: string,
  warnings: string[]
): NormalizedResponse[] => {
  const entries = Object.entries(operation.responses ?? {})
  const responses: NormalizedResponse[] = []

  if (entries.length === 0) warnings.push(`Operation ${operationId} has no responses defined.`)

  for (const [status, response] of entries) {
    const content = pickContent(response?.content)

    if (content?.contentType && !isSupportedResponseContentType(content.contentType)) {
      warnings.push(
        `Operation ${operationId} response ${status} uses content type ${content.contentType}; only JSON, text, and binary streams are fully supported.`
      )
    }

    responses.push({
      status,
      schema: content?.schema,
      contentType: content?.contentType
    })
  }

  return responses
}

const normalizeOperationId = (
  operation: OpenApiOperation,
  method: (typeof httpMethods)[number],
  path: string,
  usedOperationIds: Set<string>
): string => {
  const rawId = operation.operationId ?? inferOperationId(method, path)

  return ensureUniqueName(toCamelIdentifier(rawId), usedOperationIds)
}

const resolveOperationBaseUrl = (
  operation: OpenApiOperation,
  pathBaseUrl: string | undefined,
  globalBaseUrl: string | undefined
): string | undefined =>
  operation.servers?.[0] ? resolveServerUrl(operation.servers[0]) : (pathBaseUrl ?? globalBaseUrl)

const normalizeOperation = (
  method: (typeof httpMethods)[number],
  path: string,
  pathItem: OpenApiPathItem,
  operation: OpenApiOperation,
  pathBaseUrl: string | undefined,
  globalBaseUrl: string | undefined,
  usedOperationIds: Set<string>,
  warnings: string[]
): NormalizedOperation => {
  const id = normalizeOperationId(operation, method, path, usedOperationIds)

  return {
    id,
    method,
    path,
    tags: operation.tags ?? [],
    baseUrl: resolveOperationBaseUrl(operation, pathBaseUrl, globalBaseUrl),
    params: normalizeParameters(
      [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])],
      id,
      warnings
    ),
    requestBody: normalizeRequestBody(operation, id, warnings),
    responses: normalizeResponses(operation, id, warnings),
    security: operation.security
  }
}

const normalizePathItemOperations = (
  path: string,
  pathItem: OpenApiPathItem,
  globalBaseUrl: string | undefined,
  usedOperationIds: Set<string>,
  warnings: string[]
): NormalizedOperation[] => {
  const pathBaseUrl = pathItem.servers?.[0] ? resolveServerUrl(pathItem.servers[0]) : undefined
  const operations: NormalizedOperation[] = []

  for (const method of httpMethods) {
    const operation = pathItem[method]

    if (!operation) continue

    operations.push(
      normalizeOperation(
        method,
        path,
        pathItem,
        operation,
        pathBaseUrl,
        globalBaseUrl,
        usedOperationIds,
        warnings
      )
    )
  }

  return operations
}

const normalizePaths = (
  paths: Record<string, OpenApiPathItem>,
  globalBaseUrl: string | undefined,
  usedOperationIds: Set<string>,
  warnings: string[]
): NormalizedOperation[] => {
  const operations: NormalizedOperation[] = []

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue

    operations.push(
      ...normalizePathItemOperations(path, pathItem, globalBaseUrl, usedOperationIds, warnings)
    )
  }

  return operations
}

const ensureSupportedVersion = (version: string): void => {
  if (version.startsWith("3.0") || version.startsWith("3.1")) return

  throw new Error(`Unsupported OpenAPI version: ${version || "unknown"}`)
}

export const normalizeOpenApi = (spec: OpenApiSpec): NormalizedSpec => {
  const warnings: string[] = []
  ensureSupportedVersion(spec.openapi ?? "")

  const components = spec.components?.schemas ?? {}
  const usedOperationIds = new Set<string>()
  const globalBaseUrl = spec.servers?.[0] ? resolveServerUrl(spec.servers[0]) : undefined

  const operations = normalizePaths(spec.paths ?? {}, globalBaseUrl, usedOperationIds, warnings)

  return {
    components,
    operations,
    warnings,
    baseUrl: globalBaseUrl,
    securitySchemes: spec.components?.securitySchemes ?? {},
    globalSecurity: spec.security
  }
}
