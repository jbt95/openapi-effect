import {
  loadOpenApi,
  normalizeOpenApi,
  type NormalizedSpec,
  type NormalizedOperation,
  type OpenApiSchema,
  type OpenApiSpec
} from "./openapi.js"
import { quoteKey, toCamelIdentifier, toPascalIdentifier } from "./utils.js"
import { IndentationText, NewLineKind, Project, QuoteKind, VariableDeclarationKind } from "ts-morph"

export type GenerateResult = {
  schemas: string
  client: string
  warnings: string[]
}

export type GenerateOptions = {
  formatMap?: Record<string, string>
  warnOnUnknownFormat?: boolean
}

type SchemaContext = {
  componentNames: Map<string, string>
  refPrefix: string
  warnings: string[]
  formatMap: Record<string, string>
  warnOnUnknownFormat: boolean
}

type ResponseKind = "json" | "text" | "empty" | "binary" | "stream"

const defaultFormatMap: Record<string, string> = {
  uuid: "Schema.String.check(Schema.isUUID())",
  "date-time": "Schema.DateFromString",
  date: "Schema.DateFromString"
}

const resolveFormatMap = (options?: GenerateOptions) => ({
  ...defaultFormatMap,
  ...(options?.formatMap ?? {})
})

const createSourceFile = (fileName: string) => {
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

const getSourceText = (sourceFile: ReturnType<typeof createSourceFile>) => {
  const text = sourceFile.getFullText().trimEnd()
  return text.length === 0 ? "" : `${text}\n`
}

const indentLines = (value: string, indent = "  ") =>
  value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n")

const addTrailingComma = (value: string) => {
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

const buildComponentNameMap = (components: Record<string, OpenApiSchema>) => {
  const used = new Set<string>()
  const map = new Map<string, string>()
  for (const key of Object.keys(components).sort()) {
    const base = toPascalIdentifier(key)
    map.set(key, ensureUniqueName(base, used))
  }
  return map
}

const resolveRef = (ref: string, context: SchemaContext) => {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/)
  if (!match) {
    context.warnings.push(`Unsupported $ref: ${ref}`)
    return "Schema.Unknown"
  }
  const name = context.componentNames.get(match[1])
  if (!name) {
    context.warnings.push(`Unknown component schema reference: ${ref}`)
    return "Schema.Unknown"
  }
  return `${context.refPrefix}${name}`
}

const mergeAllOf = (schemas: OpenApiSchema[]): OpenApiSchema | undefined => {
  const merged: OpenApiSchema & {
    properties: Record<string, OpenApiSchema>
    required: string[]
  } = {
    type: "object",
    properties: {},
    required: []
  }

  for (const schema of schemas) {
    if (schema.$ref) return undefined
    if (schema.type && schema.type !== "object" && !schema.properties) return undefined
    if (schema.properties) {
      Object.assign(merged.properties, schema.properties)
    }
    if (schema.required) {
      merged.required = [...new Set([...(merged.required ?? []), ...schema.required])]
    }
    if (schema.additionalProperties !== undefined) {
      merged.additionalProperties = schema.additionalProperties
    }
  }

  return merged
}

const formatStruct = (fields: string[], extra?: string) => {
  const formattedFields = fields.map((field) => {
    const indented = field.replace(/\n/g, "\n  ")
    return `  ${indented}`
  })
  const objectLiteral =
    formattedFields.length === 0
      ? "{}"
      : `{
${formattedFields.join(",\n")}
}`
  if (extra) {
    return `Schema.StructWithRest(Schema.Struct(${objectLiteral}), [${extra}])`
  }
  return `Schema.Struct(${objectLiteral})`
}

const schemaToExpression = (schema: OpenApiSchema | undefined, context: SchemaContext): string => {
  if (!schema) return "Schema.Unknown"

  const applyNullable = (expr: string) => (schema.nullable ? `Schema.NullOr(${expr})` : expr)

  if (schema.$ref) {
    const ref = resolveRef(schema.$ref, context)
    return `Schema.suspend(() => ${ref})`
  }

  if (schema.const !== undefined) {
    const base = `Schema.Literal(${JSON.stringify(schema.const)})`
    return applyNullable(base)
  }

  if (schema.enum && schema.enum.length > 0) {
    const literals = schema.enum.map((value) => JSON.stringify(value)).join(", ")
    const base = `Schema.Literals([${literals}])`
    return applyNullable(base)
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const members = schema.oneOf.map((member) => schemaToExpression(member, context))
    const base = `Schema.Union([${members.join(", ")}])`
    return applyNullable(base)
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const members = schema.anyOf.map((member) => schemaToExpression(member, context))
    const base = `Schema.Union([${members.join(", ")}])`
    return applyNullable(base)
  }

  if (schema.allOf && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema.allOf)
    if (!merged) {
      context.warnings.push("allOf is only supported for inline object schemas.")
      return "Schema.Unknown"
    }
    const base = schemaToExpression(merged, context)
    return applyNullable(base)
  }

  if (schema.if) {
    const thenExpr = schema.then ? schemaToExpression(schema.then, context) : undefined
    const elseExpr = schema.else ? schemaToExpression(schema.else, context) : undefined
    context.warnings.push("Conditional schemas (if/then/else) are approximated.")
    if (thenExpr && elseExpr) {
      return applyNullable(`Schema.Union([${thenExpr}, ${elseExpr}])`)
    }
    if (thenExpr) return applyNullable(thenExpr)
    if (elseExpr) return applyNullable(elseExpr)
    return "Schema.Unknown"
  }

  if (Array.isArray(schema.type)) {
    const types = Array.from(new Set(schema.type))
    if (types.length === 1) {
      return schemaToExpression({ ...schema, type: types[0] }, context)
    }
    const hasNull = types.includes("null")
    const nonNull = types.filter((type) => type !== "null")
    if (hasNull && nonNull.length === 1) {
      return schemaToExpression({ ...schema, type: nonNull[0], nullable: true }, context)
    }
    if (nonNull.length === 0) {
      return "Schema.Null"
    }
    const members = nonNull.map((type) =>
      schemaToExpression({ ...schema, type, nullable: false }, context)
    )
    const base = members.length === 1 ? members[0] : `Schema.Union([${members.join(", ")}])`
    return hasNull || schema.nullable ? `Schema.NullOr(${base})` : base
  }

  const format = schema.format
  const mappedFormat = format ? context.formatMap[format] : undefined
  if (mappedFormat) {
    return applyNullable(mappedFormat)
  }
  const warnUnknownFormat = Boolean(format && context.warnOnUnknownFormat)
  const withFormatWarning = (expr: string) => {
    if (warnUnknownFormat) {
      context.warnings.push(`Unsupported schema format: ${format}`)
    }
    return applyNullable(expr)
  }

  const type = schema.type

  if (type === "string") {
    if (schema.contentEncoding) {
      context.warnings.push(
        `contentEncoding ${schema.contentEncoding} is not validated beyond string content.`
      )
    }
    if (schema.contentMediaType) {
      context.warnings.push(
        `contentMediaType ${schema.contentMediaType} is not validated beyond string content.`
      )
    }
    const base = "Schema.String"
    return withFormatWarning(base)
  }

  if (type === "number") {
    const base = "Schema.Number"
    return withFormatWarning(base)
  }

  if (type === "integer") {
    const base = "Schema.Number.check(Schema.isInt())"
    return withFormatWarning(base)
  }

  if (type === "boolean") {
    const base = "Schema.Boolean"
    return withFormatWarning(base)
  }

  if (type === "array" || schema.items) {
    const prefixItems = schema.prefixItems ?? []
    const prefixExpressions = prefixItems.map((item) => schemaToExpression(item, context))

    const items = schema.items
    if (prefixExpressions.length > 0 || Array.isArray(items)) {
      if (Array.isArray(items)) {
        const tupleExpressions = items.map((item) => schemaToExpression(item, context))
        context.warnings.push("Tuple array items are approximated with Schema.Tuple.")
        const base = `Schema.Tuple([${tupleExpressions.join(", ")}])`
        return withFormatWarning(base)
      }

      if (items === false) {
        const base = `Schema.Tuple([${prefixExpressions.join(", ")}])`
        return withFormatWarning(base)
      }

      if (!items) {
        const base = `Schema.Tuple([${prefixExpressions.join(", ")}])`
        return withFormatWarning(base)
      }

      if (items === true) {
        if (prefixExpressions.length === 0) {
          const base = "Schema.Array(Schema.Unknown)"
          return withFormatWarning(base)
        }
        const base = `Schema.TupleWithRest(Schema.Tuple([${prefixExpressions.join(", ")}]), Schema.Unknown)`
        return withFormatWarning(base)
      }

      if (prefixExpressions.length === 0) {
        const base = `Schema.Array(${schemaToExpression(items, context)})`
        return withFormatWarning(base)
      }

      const restSchema = schemaToExpression(items, context)
      const base = `Schema.TupleWithRest(Schema.Tuple([${prefixExpressions.join(", ")}]), ${restSchema})`
      return withFormatWarning(base)
    }

    if (items === false) {
      const base = "Schema.Tuple([])"
      return withFormatWarning(base)
    }

    if (items === true || items === undefined) {
      const base = "Schema.Array(Schema.Unknown)"
      return withFormatWarning(base)
    }

    const base = `Schema.Array(${schemaToExpression(items, context)})`
    return withFormatWarning(base)
  }

  if (
    type === "object" ||
    schema.properties ||
    schema.additionalProperties !== undefined ||
    schema.patternProperties ||
    schema.propertyNames
  ) {
    const properties = schema.properties ?? {}
    const required = new Set(schema.required ?? [])
    const fields = Object.entries(properties).map(([name, propertySchema]) => {
      const expression = schemaToExpression(propertySchema, context)
      const wrapped = required.has(name) ? expression : `Schema.optional(${expression})`
      return `${quoteKey(name)}: ${wrapped}`
    })

    const hasProperties = fields.length > 0
    const keySchema = schema.propertyNames
      ? schemaToExpression(schema.propertyNames, context)
      : "Schema.String"
    if (schema.propertyNames && hasProperties) {
      context.warnings.push(
        "propertyNames is only enforced for additional properties in this generator."
      )
    }

    const patternSchemas = schema.patternProperties
      ? Object.values(schema.patternProperties).map((patternSchema) =>
          schemaToExpression(patternSchema, context)
        )
      : []
    if (patternSchemas.length > 0) {
      context.warnings.push(
        "patternProperties are approximated as additionalProperties without key pattern enforcement."
      )
    }
    const patternUnion =
      patternSchemas.length === 0
        ? undefined
        : patternSchemas.length === 1
          ? patternSchemas[0]
          : `Schema.Union([${patternSchemas.join(", ")}])`

    const additional =
      schema.additionalProperties !== undefined
        ? schema.additionalProperties
        : schema.unevaluatedProperties
    if (schema.unevaluatedProperties !== undefined) {
      context.warnings.push("unevaluatedProperties is approximated as additionalProperties.")
    }
    const additionalSchema =
      additional === true
        ? "Schema.Unknown"
        : additional === false
          ? undefined
          : additional
            ? schemaToExpression(additional, context)
            : undefined

    const recordValueSchemas: string[] = []
    if (additionalSchema) recordValueSchemas.push(additionalSchema)
    if (patternUnion) recordValueSchemas.push(patternUnion)
    if (recordValueSchemas.length === 0 && additional === undefined) {
      recordValueSchemas.push("Schema.Unknown")
    }
    const recordValue = recordValueSchemas.includes("Schema.Unknown")
      ? "Schema.Unknown"
      : recordValueSchemas.length === 1
        ? recordValueSchemas[0]
        : `Schema.Union([${recordValueSchemas.join(", ")}])`

    if (!hasProperties && recordValue) {
      const base = `Schema.Record(${keySchema}, ${recordValue})`
      return withFormatWarning(base)
    }

    const recordExpr = recordValue
      ? `Schema.Record(${keySchema}, ${recordValue})`
      : undefined
    const base = formatStruct(fields, recordExpr)
    return withFormatWarning(base)
  }

  if (type === "null") {
    return "Schema.Null"
  }

  return "Schema.Unknown"
}

const buildParamStruct = (
  params: { name: string; required: boolean; schema?: OpenApiSchema }[],
  context: SchemaContext
) => {
  if (params.length === 0) return undefined
  const fields = params.map((param) => {
    const expression = schemaToExpression(param.schema, context)
    const wrapped = param.required ? expression : `Schema.optional(${expression})`
    return `${quoteKey(param.name)}: ${wrapped}`
  })
  return formatStruct(fields)
}

const inferResponseKind = (contentType?: string, schema?: OpenApiSchema) => {
  if (!contentType) return "empty" as const
  const normalized = contentType.toLowerCase()
  if (normalized.includes("text/event-stream")) return "stream" as const
  if (
    normalized.includes("application/octet-stream") ||
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/")
  ) {
    return "binary" as const
  }
  if (!schema) return "empty" as const
  if (normalized.includes("application/json") || normalized.endsWith("+json"))
    return "json" as const
  if (normalized.startsWith("text/")) return "text" as const
  return "json" as const
}

const generateSchemas = (
  spec: NormalizedSpec,
  componentNames: Map<string, string>,
  options?: GenerateOptions
) => {
  const warnings: string[] = []
  const context: SchemaContext = {
    componentNames,
    refPrefix: "",
    warnings,
    formatMap: resolveFormatMap(options),
    warnOnUnknownFormat: options?.warnOnUnknownFormat ?? true
  }
  const sourceFile = createSourceFile("schemas.ts")

  sourceFile.addImportDeclaration({
    namedImports: ["Schema"],
    moduleSpecifier: "effect"
  })

  for (const [key, schema] of Object.entries(spec.components).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const name = componentNames.get(key)
    if (!name) continue
    const expression = schemaToExpression(schema, context)
    sourceFile.addVariableStatement({
      isExported: true,
      declarationKind: VariableDeclarationKind.Const,
      declarations: [{ name, initializer: expression }]
    })
    sourceFile.addTypeAlias({
      isExported: true,
      name,
      type: `typeof ${name}.Type`
    })
  }

  return { code: getSourceText(sourceFile), warnings }
}

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

const generateClient = (
  spec: NormalizedSpec,
  componentNames: Map<string, string>,
  options?: GenerateOptions
) => {
  const warnings: string[] = []
  const context: SchemaContext = {
    componentNames,
    refPrefix: "Schemas.",
    warnings,
    formatMap: resolveFormatMap(options),
    warnOnUnknownFormat: options?.warnOnUnknownFormat ?? true
  }
  const sourceFile = createSourceFile("client.ts")
  sourceFile.addImportDeclaration({
    namedImports: ["Effect", "Schema", "Schedule"],
    moduleSpecifier: "effect"
  })
  sourceFile.addImportDeclaration({
    namespaceImport: "Schemas",
    moduleSpecifier: "./schemas.js"
  })

  const addTypeAlias = (name: string, type: string, isExported = false) => {
    sourceFile.addTypeAlias({ name, type, isExported })
  }
  const addConst = (name: string, initializer: string, isExported = false) => {
    sourceFile.addVariableStatement({
      isExported,
      declarationKind: VariableDeclarationKind.Const,
      declarations: [{ name, initializer }]
    })
  }
  const addFunction = (options: {
    name: string
    parameters?: { name: string; type?: string }[]
    typeParameters?: string[]
    returnType?: string
    statements: string[]
    isExported?: boolean
  }) => {
    sourceFile.addFunction({
      name: options.name,
      parameters: options.parameters ?? [],
      typeParameters: options.typeParameters,
      returnType: options.returnType,
      statements: options.statements,
      isExported: options.isExported ?? false
    })
  }

  addTypeAlias(
    "ClientConfig",
    `{
  baseUrl: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  auth?: AuthConfig
  interceptors?: Interceptors
  timeoutMs?: number
  retry?: RetryConfig
}`,
    true
  )
  addTypeAlias(
    "OperationConfig",
    `ClientConfig & {
  baseUrl?: string
}`,
    true
  )
  addTypeAlias(
    "SecurityScheme",
    [
      '| { type: "http"; scheme: "bearer" | "basic"; description?: string }',
      '| { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; description?: string }',
      '| { type: "oauth2"; flows: unknown; description?: string }',
      '| { type: "openIdConnect"; openIdConnectUrl: string; description?: string }'
    ].join("\n"),
    true
  )
  addTypeAlias("RetryPredicate", "(error: unknown) => boolean", true)
  addTypeAlias(
    "RetryConfig",
    `{
  times: number
  delayMs?: number
  while?: RetryPredicate
}`,
    true
  )
  addTypeAlias(
    "AuthConfig",
    [
      '| { type: "bearer"; token: string }',
      '| { type: "basic"; username: string; password: string }',
      '| { type: "apiKey"; in: "header" | "query"; name: string; value: string }'
    ].join("\n"),
    true
  )
  addTypeAlias(
    "RequestContext",
    `{
  url: string
  method: string
  headers: Record<string, string>
  body?: BodyInit
}`,
    true
  )
  addTypeAlias(
    "RequestInterceptor",
    "(request: RequestContext) => Effect.Effect<RequestContext, unknown, never>",
    true
  )
  addTypeAlias(
    "ResponseInterceptor",
    "(response: Response, request: RequestContext) => Effect.Effect<Response, unknown, never>",
    true
  )
  addTypeAlias(
    "Interceptors",
    `{
  request?: RequestInterceptor[]
  response?: ResponseInterceptor[]
}`,
    true
  )
  addTypeAlias(
    "ClientError",
    [
      '| { _tag: "InputError"; error: unknown }',
      '| { _tag: "RequestError"; error: unknown }',
      '| { _tag: "ResponseError"; error: unknown }',
      '| { _tag: "ResponseDecodeError"; status: number; error: unknown }',
      '| { _tag: "InterceptorError"; stage: "request" | "response"; error: unknown }',
      '| { _tag: "TimeoutError"; timeoutMs: number }'
    ].join("\n"),
    true
  )
  addTypeAlias("SchemaType<S extends Schema.Codec<unknown>>", "S[\"Type\"]")
  addTypeAlias("ResponseKind", '"json" | "text" | "empty" | "binary" | "stream"')
  addTypeAlias("StreamValue", "ReadableStream<Uint8Array> | null")
  addTypeAlias("BinaryValue", "ArrayBuffer")
  addTypeAlias("ResponseEntry", "{ schema: Schema.Codec<unknown>; kind: ResponseKind }")
  addTypeAlias(
    "ResponseValue<T extends ResponseEntry>",
    'T["kind"] extends "stream" ? StreamValue : T["kind"] extends "binary" ? BinaryValue : SchemaType<T["schema"]>'
  )
  addTypeAlias("ResponseSpec", "Record<string, ResponseEntry>")
  addTypeAlias(
    "ResponseUnion<T extends ResponseSpec>",
    `{
  [K in keyof T]: K extends \"default\"
    ? { status: number; value: ResponseValue<T[K]> }
    : K extends \`\${infer N extends number}\`
      ? { status: N; value: ResponseValue<T[K]> }
      : K extends number
        ? { status: K; value: ResponseValue<T[K]> }
        : { status: number; value: ResponseValue<T[K]> }
}[keyof T]`
  )
  addTypeAlias(
    "HttpError<T extends ResponseSpec>",
    `{ _tag: \"HttpError\"; response: ResponseUnion<T> }`,
    true
  )
  addTypeAlias(
    "ErrorChannel<T extends ResponseSpec | undefined>",
    "HttpError<Exclude<T, undefined>>"
  )

  // Export security schemes from spec
  const securitySchemeEntries = Object.entries(spec.securitySchemes)
  if (securitySchemeEntries.length > 0) {
    const securityFields = securitySchemeEntries
      .map(([name]) => `  ${quoteKey(name)}: SecurityScheme`)
      .join(",\n")
    addConst(
      "securitySchemes",
      `{
${securityFields}
} as const`,
      true
    )
  } else {
    addConst("securitySchemes", "{} as const", true)
  }

  addFunction({
    name: "resolveFetch",
    parameters: [{ name: "custom?", type: "typeof fetch" }],
    returnType: "typeof fetch",
    statements: [
      "if (custom) return custom",
      'if (typeof fetch === "function") return fetch',
      'throw new Error("fetch is not available in this runtime")'
    ]
  })
  addFunction({
    name: "trimSlash",
    parameters: [{ name: "value", type: "string" }],
    returnType: "string",
    statements: ['return value.replace(/\\/+$/, "")']
  })
  addFunction({
    name: "encodeQuery",
    parameters: [{ name: "query?", type: "Record<string, unknown>" }],
    returnType: "string",
    statements: [
      'if (!query) return ""',
      "const params = new URLSearchParams()",
      "for (const [key, value] of Object.entries(query)) {",
      "  if (value === undefined) continue",
      "  if (Array.isArray(value)) {",
      "    for (const item of value) {",
      "      if (item === undefined) continue",
      "      params.append(key, String(item))",
      "    }",
      "    continue",
      "  }",
      "  params.append(key, String(value))",
      "}",
      "const qs = params.toString()",
      'return qs ? `?${qs}` : ""'
    ]
  })
  addFunction({
    name: "buildUrl",
    parameters: [
      { name: "baseUrl", type: "string" },
      { name: "path", type: "string" },
      { name: "pathParams?", type: "Record<string, unknown>" },
      { name: "query?", type: "Record<string, unknown>" }
    ],
    returnType: "string",
    statements: [
      "const resolvedPath = path.replace(/\\{([^}]+)\\}/g, (_match, key) => {",
      "  const raw = pathParams?.[key]",
      "  if (raw === undefined || raw === null) {",
      "    throw new Error(`Missing path param: ${key}`)",
      "  }",
      "  return encodeURIComponent(String(raw))",
      "})",
      "const base = trimSlash(baseUrl)",
      'const url = `${base}${resolvedPath.startsWith("/") ? "" : "/"}${resolvedPath}`',
      "return `${url}${encodeQuery(query)}`"
    ]
  })
  addFunction({
    name: "encodeBasicAuth",
    parameters: [
      { name: "username", type: "string" },
      { name: "password", type: "string" }
    ],
    returnType: "string",
    statements: [
      "const raw = `${username}:${password}`",
      'if (typeof Buffer !== "undefined") {',
      '  return Buffer.from(raw).toString("base64")',
      "}",
      'if (typeof btoa === "function") {',
      "  return btoa(raw)",
      "}",
      'throw new Error("Basic auth encoding is not available in this runtime")'
    ]
  })
  addFunction({
    name: "applyAuth",
    parameters: [
      { name: "auth", type: "AuthConfig | undefined" },
      { name: "headers", type: "Record<string, string>" },
      { name: "query?", type: "Record<string, unknown>" }
    ],
    returnType: "{ headers: Record<string, string>; query?: Record<string, unknown> }",
    statements: [
      "if (!auth) return { headers, query }",
      "const nextHeaders: Record<string, string> = { ...headers }",
      "let nextQuery = query ? { ...query } : undefined",
      'if (auth.type === "bearer") {',
      "  nextHeaders.authorization = `Bearer ${auth.token}`",
      '} else if (auth.type === "basic") {',
      "  nextHeaders.authorization = `Basic ${encodeBasicAuth(auth.username, auth.password)}`",
      '} else if (auth.type === "apiKey") {',
      '  if (auth.in === "header") {',
      "    nextHeaders[auth.name] = auth.value",
      "  } else {",
      "    nextQuery = { ...(nextQuery ?? {}), [auth.name]: auth.value }",
      "  }",
      "}",
      "return { headers: nextHeaders, query: nextQuery }"
    ]
  })
  addFunction({
    name: "applyRequestInterceptors",
    parameters: [
      { name: "request", type: "RequestContext" },
      { name: "interceptors?", type: "RequestInterceptor[]" }
    ],
    returnType: "Effect.Effect<RequestContext, ClientError, never>",
    statements: [
      "return (interceptors ?? []).reduce<Effect.Effect<RequestContext, ClientError, never>>(",
      "  (effect, interceptor) =>",
      "    effect.pipe(",
      "      Effect.flatMap((current) => interceptor(current)),",
      '      Effect.mapError((error) => ({ _tag: "InterceptorError" as const, stage: "request" as const, error }))',
      "    ),",
      "  Effect.succeed(request)",
      ")"
    ]
  })
  addFunction({
    name: "applyResponseInterceptors",
    parameters: [
      { name: "response", type: "Response" },
      { name: "request", type: "RequestContext" },
      { name: "interceptors?", type: "ResponseInterceptor[]" }
    ],
    returnType: "Effect.Effect<Response, ClientError, never>",
    statements: [
      "return (interceptors ?? []).reduce<Effect.Effect<Response, ClientError, never>>(",
      "  (effect, interceptor) =>",
      "    effect.pipe(",
      "      Effect.flatMap((current) => interceptor(current, request)),",
      '      Effect.mapError((error) => ({ _tag: "InterceptorError" as const, stage: "response" as const, error }))',
      "    ),",
      "  Effect.succeed(response)",
      ")"
    ]
  })
  addFunction({
    name: "isRetryableStatus",
    parameters: [{ name: "status", type: "number" }],
    returnType: "boolean",
    statements: ["return status === 408 || status === 429 || (status >= 500 && status < 600)"]
  })
  addFunction({
    name: "defaultRetryPredicate",
    parameters: [{ name: "error", type: "unknown" }],
    returnType: "boolean",
    statements: [
      'if (!error || typeof error !== "object") return false',
      "const tagged = error as { _tag?: string; response?: { status?: number } }",
      'if (tagged._tag === "RequestError" || tagged._tag === "ResponseError") return true',
      'if (tagged._tag === "TimeoutError") return true',
      'if (tagged._tag === "HttpError") {',
      "  const status = tagged.response?.status",
      '  return typeof status === "number" && isRetryableStatus(status)',
      "}",
      "return false"
    ]
  })
  addFunction({
    name: "applyRetry",
    typeParameters: ["A", "E", "R"],
    parameters: [
      { name: "effect", type: "Effect.Effect<A, E, R>" },
      { name: "retry?", type: "RetryConfig" }
    ],
    returnType: "Effect.Effect<A, E, R>",
    statements: [
      "return retry",
      "  ? effect.pipe(",
      "      Effect.retry({",
      "        times: retry.times,",
      "        while: retry.while ?? defaultRetryPredicate,",
      "        schedule: retry.delayMs ? Schedule.fixed(retry.delayMs) : undefined",
      "      })",
      "    )",
      "  : effect"
    ]
  })
  addFunction({
    name: "applyTimeout",
    typeParameters: ["A", "E", "R"],
    parameters: [
      { name: "effect", type: "Effect.Effect<A, E, R>" },
      { name: "timeoutMs?", type: "number" }
    ],
    returnType: "Effect.Effect<A, E | ClientError, R>",
    statements: [
      "return timeoutMs === undefined",
      "  ? effect",
      "  : effect.pipe(",
      "      Effect.timeoutOrElse({",
      "        duration: timeoutMs,",
      '        orElse: () => Effect.fail({ _tag: "TimeoutError" as const, timeoutMs })',
      "      })",
      "    )"
    ]
  })
  addFunction({
    name: "applyResilience",
    typeParameters: ["A", "E", "R"],
    parameters: [
      { name: "effect", type: "Effect.Effect<A, E, R>" },
      { name: "config", type: "ClientConfig" }
    ],
    returnType: "Effect.Effect<A, E | ClientError, R>",
    statements: ["return applyRetry(applyTimeout(effect, config.timeoutMs), config.retry)"]
  })
  addFunction({
    name: "mergeHeaders",
    parameters: [
      { name: "base?", type: "Record<string, string>" },
      { name: "extra?", type: "Record<string, string>" },
      { name: "contentType?", type: "string" },
      { name: "hasBody?", type: "boolean" }
    ],
    returnType: "Record<string, string>",
    statements: [
      "const headers: Record<string, string> = { ...(base ?? {}), ...(extra ?? {}) }",
      'if (hasBody && contentType && !contentType.toLowerCase().includes("multipart/form-data")) {',
      '  headers["content-type"] = contentType',
      "}",
      "return headers"
    ]
  })
  addFunction({
    name: "encodeFormData",
    parameters: [{ name: "body", type: "unknown" }],
    returnType: "FormData",
    statements: [
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
  })
  addFunction({
    name: "encodeBody",
    parameters: [
      { name: "body", type: "unknown" },
      { name: "contentType?", type: "string" }
    ],
    returnType: "BodyInit | undefined",
    statements: [
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
  })
  addFunction({
    name: "executeRequest",
    parameters: [
      { name: "fetcher", type: "typeof fetch" },
      { name: "method", type: "string" },
      { name: "url", type: "string" },
      { name: "headers", type: "Record<string, string>" },
      { name: "body?", type: "BodyInit" }
    ],
    returnType: "Effect.Effect<Response, ClientError, unknown>",
    statements: [
      "return Effect.tryPromise({",
      "  try: () => fetcher(url, { method, headers, body }),",
      '  catch: (error) => ({ _tag: "RequestError" as const, error })',
      "})"
    ]
  })
  addFunction({
    name: "decodeInput",
    typeParameters: ["S extends Schema.Codec<unknown>"],
    parameters: [
      { name: "schema", type: "S" },
      { name: "input", type: "unknown" }
    ],
    returnType: "Effect.Effect<S[\"Type\"], ClientError, unknown>",
    statements: [
      "return Schema.decodeUnknownEffect(schema)(input).pipe(",
      '  Effect.mapError((error) => ({ _tag: "InputError" as const, error }))',
      ")"
    ]
  })
  addFunction({
    name: "decodeResponse",
    typeParameters: ["TSuccess extends ResponseSpec", "TError extends ResponseSpec | undefined"],
    parameters: [
      { name: "response", type: "Response" },
      { name: "successSpec", type: "TSuccess" },
      { name: "errorSpec?", type: "TError" }
    ],
    returnType:
      "Effect.Effect<ResponseUnion<TSuccess>, ClientError | ErrorChannel<TError>, unknown>",
    statements: [
      "return Effect.tryPromise({",
      "  try: async () => {",
      "    const successEntry =",
      "      (successSpec as Record<string, ResponseEntry>)[response.status] ?? successSpec.default",
      "    const errorEntry =",
      "      errorSpec ? (errorSpec as Record<string, ResponseEntry>)[response.status] ?? errorSpec.default : undefined",
      "    const entry = successEntry ?? errorEntry",
      "    if (!entry) {",
      "      throw new Error(`Unexpected status: ${response.status}`)",
      "    }",
      "    let raw: unknown = undefined",
      '    if (entry.kind === "json") {',
      "      raw = await response.json()",
      '    } else if (entry.kind === "text") {',
      "      raw = await response.text()",
      '    } else if (entry.kind === "binary") {',
      "      raw = await response.arrayBuffer()",
      '    } else if (entry.kind === "stream") {',
      "      raw = response.body",
      "    }",
      "    return { status: response.status, schema: entry.schema, raw, isError: !successEntry, kind: entry.kind }",
      "  },",
      '  catch: (error) => ({ _tag: "ResponseError" as const, error })',
      "}).pipe(",
      "  Effect.flatMap(({ status, schema, raw, isError, kind }) =>",
      '    (kind === "stream" || kind === "binary")',
      "      ? (() => {",
      "          const decoded = { status, value: raw }",
      "          return isError",
      '            ? Effect.fail({ _tag: "HttpError" as const, response: decoded as ResponseUnion<Exclude<TError, undefined>> })',
      "            : Effect.succeed(decoded as ResponseUnion<TSuccess>)",
      "        })()",
      "      : Schema.decodeUnknownEffect(schema)(raw).pipe(",
      "          Effect.map((value) => ({ status, value })),",
      '          Effect.mapError((error) => ({ _tag: "ResponseDecodeError" as const, status, error }))',
      "        ).pipe(",
      "          Effect.flatMap((decoded) =>",
      "            isError",
      '              ? Effect.fail({ _tag: "HttpError" as const, response: decoded as ResponseUnion<Exclude<TError, undefined>> })',
      "              : Effect.succeed(decoded as ResponseUnion<TSuccess>)",
      "          )",
      "        )",
      "  )",
      ")"
    ]
  })

  type OperationInfo = {
    opName: string
    tag: string
    hasInput: boolean
    inputSchemaName?: string
    successMapName: string
    errorMapName?: string
    responseTypeName: string
    effectBody: string
  }

  const operationInfos: OperationInfo[] = []

  for (const operation of spec.operations) {
    const opName = toCamelIdentifier(operation.id)
    const opPascal = toPascalIdentifier(operation.id)
    const inputSchemaName = `${opPascal}Input`
    const responseTypeName = `${opPascal}Response`

    const pathSchema = buildParamStruct(operation.params.path, context)
    const querySchema = buildParamStruct(operation.params.query, context)
    const headerSchema = buildParamStruct(operation.params.header, context)
    const bodySchema = operation.requestBody
      ? schemaToExpression(operation.requestBody.schema, context)
      : undefined

    const queryRequired = operation.params.query.some((param) => param.required)
    const headerRequired = operation.params.header.some((param) => param.required)
    const bodyRequired = Boolean(operation.requestBody?.required)

    const inputFields: string[] = []
    if (pathSchema) inputFields.push(`path: ${pathSchema}`)
    if (querySchema) {
      inputFields.push(`query: ${queryRequired ? querySchema : `Schema.optional(${querySchema})`}`)
    }
    if (headerSchema) {
      inputFields.push(
        `headers: ${headerRequired ? headerSchema : `Schema.optional(${headerSchema})`}`
      )
    }
    if (bodySchema) {
      inputFields.push(`body: ${bodyRequired ? bodySchema : `Schema.optional(${bodySchema})`}`)
    }

    const hasInput = inputFields.length > 0
    if (hasInput) {
      addConst(inputSchemaName, formatStruct(inputFields), true)
      addTypeAlias(inputSchemaName, `SchemaType<typeof ${inputSchemaName}>`, true)
    }

    const responses =
      operation.responses.length > 0
        ? operation.responses
        : [{ status: "default", schema: undefined, contentType: undefined }]

    const responseSchemaNames: Array<{ status: string; name: string; kind: ResponseKind }> = []
    for (const response of responses) {
      const statusLabel = response.status === "default" ? "Default" : `Status${response.status}`
      const name = `${opPascal}Response${toPascalIdentifier(statusLabel)}`
      const expression = response.schema
        ? schemaToExpression(response.schema, context)
        : "Schema.Undefined"
      const kind = inferResponseKind(response.contentType, response.schema)
      if (response.contentType && kind === "json" && !response.contentType.includes("json")) {
        warnings.push(
          `Operation ${operation.id} response ${response.status} uses ${response.contentType}; treated as JSON.`
        )
      }
      addConst(name, expression, true)
      responseSchemaNames.push({ status: response.status, name, kind })
    }

    const isNumericStatus = (status: string) => /^\d+$/.test(status)
    const isSuccessStatus = (status: string) => {
      if (!isNumericStatus(status)) return false
      const code = Number(status)
      return code >= 200 && code < 300
    }
    const hasSuccessStatus = responseSchemaNames.some((entry) => isSuccessStatus(entry.status))
    const isSuccessResponse = (status: string) => {
      if (!hasSuccessStatus) return true
      if (status === "default") return false
      return isSuccessStatus(status)
    }

    const successSchemaNames = responseSchemaNames.filter((entry) =>
      isSuccessResponse(entry.status)
    )
    const errorSchemaNames = responseSchemaNames.filter((entry) => !isSuccessResponse(entry.status))

    const successMapName = `${opPascal}SuccessSchemas`
    const successEntries = successSchemaNames
      .map((entry) => {
        const isNumeric = isNumericStatus(entry.status)
        const key = entry.status === "default" || !isNumeric ? "default" : entry.status
        if (entry.status !== "default" && !isNumeric) {
          warnings.push(
            `Operation ${operation.id} response ${entry.status} cannot be matched; using default.`
          )
        }
        return `  ${quoteKey(key)}: { schema: ${entry.name}, kind: \"${entry.kind}\" },`
      })
      .join("\n")
    addConst(
      successMapName,
      `{
${successEntries}
} as const`
    )

    const errorMapName = `${opPascal}ErrorSchemas`
    if (errorSchemaNames.length > 0) {
      const errorEntries = errorSchemaNames
        .map((entry) => {
          const isNumeric = isNumericStatus(entry.status)
          const key = entry.status === "default" || !isNumeric ? "default" : entry.status
          if (entry.status !== "default" && !isNumeric) {
            warnings.push(
              `Operation ${operation.id} response ${entry.status} cannot be matched; using default.`
            )
          }
          return `  ${quoteKey(key)}: { schema: ${entry.name}, kind: \"${entry.kind}\" },`
        })
        .join("\n")
      addConst(
        errorMapName,
        `{
${errorEntries}
} as const`
      )
    }

    const successTypeName = `${opPascal}Success`
    const errorTypeName = `${opPascal}Error`
    addTypeAlias(successTypeName, `ResponseUnion<typeof ${successMapName}>`, true)

    if (errorSchemaNames.length > 0) {
      addTypeAlias(errorTypeName, `ResponseUnion<typeof ${errorMapName}>`, true)
    } else {
      addTypeAlias(errorTypeName, "never", true)
    }

    addTypeAlias(responseTypeName, `${successTypeName} | ${errorTypeName}`, true)

    if (errorSchemaNames.length > 0) {
      addTypeAlias(`${opPascal}Failure`, `HttpError<typeof ${errorMapName}>`, true)
    } else {
      addTypeAlias(`${opPascal}Failure`, "never", true)
    }

    const pathArg = pathSchema ? "decoded.path" : "undefined"
    const queryArg = querySchema ? "decoded.query" : "undefined"
    const headerArg = headerSchema ? "decoded.headers" : "undefined"
    const bodyArg = bodySchema ? "decoded.body" : "undefined"
    const contentType = bodySchema
      ? JSON.stringify(operation.requestBody?.contentType ?? "application/json")
      : "undefined"
    const decodeResponseCall =
      errorSchemaNames.length > 0
        ? `decodeResponse(response, ${successMapName}, ${errorMapName})`
        : `decodeResponse(response, ${successMapName})`

    const requestSetupLines: string[] = []
    const baseUrlExpression = operation.baseUrl
      ? `(${JSON.stringify(operation.baseUrl)} ?? config.baseUrl)`
      : "config.baseUrl"
    if (bodySchema) {
      requestSetupLines.push(`const hasBody = ${bodyArg} !== undefined`)
      requestSetupLines.push(`const body = encodeBody(${bodyArg}, ${contentType})`)
      requestSetupLines.push(
        `const baseHeaders = mergeHeaders(config.headers, ${headerArg}, ${contentType}, hasBody)`
      )
      requestSetupLines.push(`const auth = applyAuth(config.auth, baseHeaders, ${queryArg})`)
      requestSetupLines.push(
        `const url = buildUrl(${baseUrlExpression}, ${JSON.stringify(operation.path)}, ${pathArg}, auth.query)`
      )
      requestSetupLines.push(
        `const request: RequestContext = { url, method: ${JSON.stringify(
          operation.method.toUpperCase()
        )}, headers: auth.headers, body }`
      )
    } else {
      requestSetupLines.push(`const baseHeaders = mergeHeaders(config.headers, ${headerArg})`)
      requestSetupLines.push(`const auth = applyAuth(config.auth, baseHeaders, ${queryArg})`)
      requestSetupLines.push(
        `const url = buildUrl(${baseUrlExpression}, ${JSON.stringify(operation.path)}, ${pathArg}, auth.query)`
      )
      requestSetupLines.push(
        `const request: RequestContext = { url, method: ${JSON.stringify(
          operation.method.toUpperCase()
        )}, headers: auth.headers }`
      )
    }

    const requestPipeline = [
      ...requestSetupLines,
      "return applyRequestInterceptors(request, config.interceptors?.request).pipe(",
      "  Effect.flatMap((prepared) =>",
      "    executeRequest(",
      "      fetcher,",
      "      prepared.method,",
      "      prepared.url,",
      "      prepared.headers,",
      "      prepared.body",
      "    ).pipe(",
      "      Effect.flatMap((response) =>",
      "        applyResponseInterceptors(response, prepared, config.interceptors?.response)",
      "      )",
      "    )",
      "  )",
      ")"
    ].join("\n")

    const effectFlow = hasInput
      ? [
          `decodeInput(${inputSchemaName}, input).pipe(`,
          "  Effect.flatMap((decoded) => {",
          indentLines(requestPipeline, "    "),
          "  }),",
          `  Effect.flatMap((response) => ${decodeResponseCall})`,
          ")"
        ].join("\n")
      : [
          "Effect.sync(() => undefined).pipe(",
          "  Effect.flatMap(() => {",
          indentLines(requestPipeline, "    "),
          "  }),",
          `  Effect.flatMap((response) => ${decodeResponseCall})`,
          ")"
        ].join("\n")

    const applyResilienceBlock = [
      "applyResilience(",
      indentLines(addTrailingComma(effectFlow), "  "),
      "  config",
      ")"
    ].join("\n")

    operationInfos.push({
      opName,
      tag: operation.tags[0] ?? "default",
      hasInput,
      inputSchemaName: hasInput ? inputSchemaName : undefined,
      successMapName,
      errorMapName: errorSchemaNames.length > 0 ? errorMapName : undefined,
      responseTypeName,
      effectBody: applyResilienceBlock
    })
  }

  // Generate makeClient (backward compatible - all operations)
  const makeClientBody = [
    "const fetcher = resolveFetch(config.fetch)",
    "return {",
    indentLines(
      operationInfos
        .map((info) => {
          const signature = info.hasInput
            ? `${info.opName}: (input: ${info.inputSchemaName!}) =>`
            : `${info.opName}: () =>`
          return `${signature}\n${indentLines(info.effectBody, "  ")}`
        })
        .join(",\n"),
      "  "
    ),
    "}"
  ]

  const makeClientInitializer = [
    "(config: ClientConfig) => {",
    indentLines(makeClientBody.join("\n"), "  "),
    "}"
  ].join("\n")
  addConst("makeClient", makeClientInitializer, true)

  // Generate makeClients (tag-based grouping)
  const grouped = groupOperationsByTag(spec.operations)
  if (grouped.size > 0) {
    const tagEntries: string[] = []
    for (const [tag, operations] of grouped) {
      const tagOpNames = new Set(operations.map((op) => toCamelIdentifier(op.id)))
      const tagOperations = operationInfos.filter((info) => tagOpNames.has(info.opName))
      const tagClientName = toCamelIdentifier(tag)

      const tagClientBody = [
        "const fetcher = resolveFetch(config.fetch)",
        "return {",
        indentLines(
          tagOperations
            .map((info) => {
              const signature = info.hasInput
                ? `${info.opName}: (input: ${info.inputSchemaName!}) =>`
                : `${info.opName}: () =>`
              return `${signature}\n${indentLines(info.effectBody, "  ")}`
            })
            .join(",\n"),
          "    "
        ),
        "  }"
      ].join("\n")

      tagEntries.push(`${quoteKey(tagClientName)}: (config: ClientConfig) => {
${indentLines(tagClientBody, "    ")}
  }`)
    }

    const makeClientsBody = [
      "(config: ClientConfig) => {",
      indentLines(`return {\n${indentLines(tagEntries.join(",\n"), "  ")}\n}`, "  "),
      "}"
    ].join("\n")

    addConst("makeClients", makeClientsBody, true)
  }

  return { code: getSourceText(sourceFile), warnings }
}

export const generateFromSpec = (spec: OpenApiSpec, options?: GenerateOptions): GenerateResult => {
  const normalized = normalizeOpenApi(spec)
  const componentNames = buildComponentNameMap(normalized.components)
  const schemaResult = generateSchemas(normalized, componentNames, options)
  const clientResult = generateClient(normalized, componentNames, options)
  return {
    schemas: schemaResult.code,
    client: clientResult.code,
    warnings: [...normalized.warnings, ...schemaResult.warnings, ...clientResult.warnings]
  }
}

export const generateFromOpenApi = async (
  input: string,
  options?: GenerateOptions
): Promise<GenerateResult> => {
  const spec = await loadOpenApi(input)
  return generateFromSpec(spec, options)
}
