import type { SourceFile } from "ts-morph"
import { createCodeWriter } from "../generator/code.js"

type RuntimeFunctionDefinition = Parameters<ReturnType<typeof createCodeWriter>["addFunction"]>[0]

const clientRuntimeFunctionDefinitions: RuntimeFunctionDefinition[] = [
  {
    name: "resolveFetch",
    parameters: [{ name: "custom?", type: "typeof fetch" }],
    returnType: "typeof fetch",
    statements: [
      "if (custom) return custom",
      'if (typeof fetch === "function") return fetch',
      'throw new Error("fetch is not available in this runtime")'
    ]
  },
  {
    name: "trimSlash",
    parameters: [{ name: "value", type: "string" }],
    returnType: "string",
    statements: ['return value.replace(/\\/+$/, "")']
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
      "    nextQuery = { ...nextQuery, [auth.name]: auth.value }",
      "  }",
      "}",
      "return { headers: nextHeaders, query: nextQuery }"
    ]
  },
  {
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
  },
  {
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
  },
  {
    name: "isRetryableStatus",
    parameters: [{ name: "status", type: "number" }],
    returnType: "boolean",
    statements: ["return status === 408 || status === 429 || (status >= 500 && status < 600)"]
  },
  {
    name: "isIdempotentMethod",
    parameters: [{ name: "method", type: "string" }],
    returnType: "boolean",
    statements: [
      'return method === "GET" || method === "HEAD" || method === "PUT" || method === "DELETE" || method === "OPTIONS" || method === "TRACE"'
    ]
  },
  {
    name: "defaultRetryPredicate",
    parameters: [
      { name: "method", type: "string" },
      { name: "error", type: "unknown" }
    ],
    returnType: "boolean",
    statements: [
      'if (!error || typeof error !== "object") return false',
      "if (!isIdempotentMethod(method)) return false",
      "const tagged = error as { _tag?: string; response?: { status?: number } }",
      'if (tagged._tag === "RequestError" || tagged._tag === "ResponseError") return true',
      'if (tagged._tag === "TimeoutError") return true',
      'if (tagged._tag === "HttpError") {',
      "  const status = tagged.response?.status",
      '  return typeof status === "number" && isRetryableStatus(status)',
      "}",
      "return false"
    ]
  },
  {
    name: "applyRetry",
    typeParameters: ["A", "E", "R"],
    parameters: [
      { name: "effect", type: "Effect.Effect<A, E, R>" },
      { name: "method", type: "string" },
      { name: "retry?", type: "RetryConfig" }
    ],
    returnType: "Effect.Effect<A, E, R>",
    statements: [
      "return retry",
      "  ? effect.pipe(",
      "      Effect.retry({",
      "        times: retry.times,",
      "        while: retry.while ?? ((error) => defaultRetryPredicate(method, error)),",
      "        schedule: retry.delayMs ? Schedule.fixed(retry.delayMs) : undefined",
      "      })",
      "    )",
      "  : effect"
    ]
  },
  {
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
  },
  {
    name: "applyResilience",
    typeParameters: ["A", "E", "R"],
    parameters: [
      { name: "effect", type: "Effect.Effect<A, E, R>" },
      { name: "config", type: "ClientConfig" },
      { name: "method", type: "string" }
    ],
    returnType: "Effect.Effect<A, E | ClientError, R>",
    statements: ["return applyRetry(applyTimeout(effect, config.timeoutMs), method, config.retry)"]
  },
  {
    name: "mergeHeaders",
    parameters: [
      { name: "base?", type: "Record<string, string>" },
      { name: "extra?", type: "Record<string, string>" },
      { name: "contentType?", type: "string" },
      { name: "hasBody?", type: "boolean" }
    ],
    returnType: "Record<string, string>",
    statements: [
      "const headers: Record<string, string> = { ...base, ...extra }",
      'if (hasBody && contentType && !contentType.toLowerCase().includes("multipart/form-data")) {',
      '  headers["content-type"] = contentType',
      "}",
      "return headers"
    ]
  },
  {
    name: "executeRequest",
    parameters: [
      { name: "fetcher", type: "typeof fetch" },
      { name: "method", type: "string" },
      { name: "url", type: "string" },
      { name: "headers", type: "Record<string, string>" },
      { name: "body?", type: "BodyInit" }
    ],
    returnType: "Effect.Effect<Response, ClientError, never>",
    statements: [
      "return Effect.tryPromise({",
      "  try: (signal) => fetcher(url, { method, headers, body, signal }),",
      '  catch: (error) => ({ _tag: "RequestError" as const, error })',
      "})"
    ]
  },
  {
    name: "decodeInput",
    typeParameters: ["S extends Schema.ConstraintDecoder<unknown, never>"],
    parameters: [
      { name: "schema", type: "S" },
      { name: "input", type: "unknown" }
    ],
    returnType: 'Effect.Effect<S["Type"], ClientError, never>',
    statements: [
      "return Schema.decodeUnknownEffect(schema)(input).pipe(",
      '  Effect.mapError((error) => ({ _tag: "InputError" as const, error }))',
      ")"
    ]
  },
  {
    name: "decodeResponse",
    typeParameters: ["TSuccess extends ResponseSpec", "TError extends ResponseSpec | undefined"],
    parameters: [
      { name: "response", type: "Response" },
      { name: "successSpec", type: "TSuccess" },
      { name: "errorSpec?", type: "TError" }
    ],
    returnType: "Effect.Effect<ResponseUnion<TSuccess>, ClientError | ErrorChannel<TError>, never>",
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
  }
]

export const addClientRuntimeFunctions = (sourceFile: SourceFile): void => {
  const { addFunction } = createCodeWriter(sourceFile)

  for (const definition of clientRuntimeFunctionDefinitions) {
    addFunction(definition)
  }
}
