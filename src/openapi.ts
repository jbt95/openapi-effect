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
type HttpMethod = (typeof httpMethods)[number]

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

  return (await parser.dereference(input)) as OpenApiSpec
}

export const normalizeOpenApi = (spec: OpenApiSpec): NormalizedSpec => {
  const warnings: string[] = []
  const version = spec.openapi ?? ""
  if (!version.startsWith("3.0") && !version.startsWith("3.1")) {
    throw new Error(`Unsupported OpenAPI version: ${version || "unknown"}`)
  }

  const components = spec.components?.schemas ?? {}
  const operations: NormalizedOperation[] = []
  const usedOperationIds = new Set<string>()

  // Extract global baseUrl from first server
  const globalBaseUrl = spec.servers?.[0] ? resolveServerUrl(spec.servers[0]) : undefined

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue
    const commonParams = pathItem.parameters ?? []

    // Check for per-path server (overrides global)
    const pathBaseUrl = pathItem.servers?.[0] ? resolveServerUrl(pathItem.servers[0]) : undefined

    for (const method of httpMethods) {
      const operation = pathItem[method]
      if (!operation) continue

      const rawId = operation.operationId ?? inferOperationId(method, path)
      const id = ensureUniqueName(toCamelIdentifier(rawId), usedOperationIds)

      const params = [...commonParams, ...(operation.parameters ?? [])]
      const normalizedParams = {
        path: [] as NormalizedParameter[],
        query: [] as NormalizedParameter[],
        header: [] as NormalizedParameter[]
      }

      for (const param of params) {
        if (!param || !param.name || !param.in) continue
        const required = param.in === "path" ? true : Boolean(param.required)
        const normalized: NormalizedParameter = {
          name: param.name,
          required,
          schema: param.schema
        }
        if (param.in === "path") normalizedParams.path.push(normalized)
        else if (param.in === "query") normalizedParams.query.push(normalized)
        else if (param.in === "header") normalizedParams.header.push(normalized)
        else if (param.in === "cookie") {
          warnings.push(
            `Operation ${id} uses cookie parameters which are currently ignored (${param.name}).`
          )
        }
      }

      const requestBodyContent = pickContent(operation.requestBody?.content)
      const requestBody = requestBodyContent
        ? {
            required: Boolean(operation.requestBody?.required),
            schema: requestBodyContent.schema,
            contentType: requestBodyContent.contentType
          }
        : undefined

      if (requestBody?.contentType && !isSupportedRequestContentType(requestBody.contentType)) {
        warnings.push(
          `Operation ${id} uses request content type ${requestBody.contentType}; only JSON and multipart/form-data are fully supported.`
        )
      }

      const responses: NormalizedResponse[] = []
      const responseEntries = Object.entries(operation.responses ?? {}) as Array<
        [string, OpenApiResponse]
      >
      if (responseEntries.length === 0) {
        warnings.push(`Operation ${id} has no responses defined.`)
      }

      for (const [status, response] of responseEntries) {
        const responseContent = pickContent(response?.content)
        if (
          responseContent?.contentType &&
          !isSupportedResponseContentType(responseContent.contentType)
        ) {
          warnings.push(
            `Operation ${id} response ${status} uses content type ${responseContent.contentType}; only JSON, text, and binary streams are fully supported.`
          )
        }
        responses.push({
          status,
          schema: responseContent?.schema,
          contentType: responseContent?.contentType
        })
      }

      // Determine baseUrl: operation-level > path-level > global
      const operationBaseUrl = operation.servers?.[0]
        ? resolveServerUrl(operation.servers[0])
        : (pathBaseUrl ?? globalBaseUrl)

      operations.push({
        id,
        method,
        path,
        tags: operation.tags ?? [],
        baseUrl: operationBaseUrl,
        params: normalizedParams,
        requestBody,
        responses,
        security: operation.security
      })
    }
  }

  return {
    components,
    operations,
    warnings,
    baseUrl: globalBaseUrl,
    securitySchemes: spec.components?.securitySchemes ?? {},
    globalSecurity: spec.security
  }
}
