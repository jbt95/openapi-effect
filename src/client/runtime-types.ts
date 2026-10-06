import type { SourceFile } from "ts-morph"
import type { NormalizedSpec } from "../openapi.js"
import { createCodeWriter } from "../generator/code.js"
import { quoteKey } from "../utils.js"

type CodeWriter = ReturnType<typeof createCodeWriter>

const addClientCoreTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias(
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
  writer.addTypeAlias(
    "OperationConfig",
    `ClientConfig & {
  baseUrl?: string
}`,
    true
  )
  writer.addTypeAlias(
    "SecurityScheme",
    [
      '| { type: "http"; scheme: "bearer" | "basic"; description?: string }',
      '| { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; description?: string }',
      '| { type: "oauth2"; flows: unknown; description?: string }',
      '| { type: "openIdConnect"; openIdConnectUrl: string; description?: string }'
    ].join("\n"),
    true
  )
}

const addRetryAndAuthTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias("RetryPredicate", "(error: unknown) => boolean", true)
  writer.addTypeAlias(
    "RetryConfig",
    `{
  times: number
  delayMs?: number
  while?: RetryPredicate
}`,
    true
  )
  writer.addTypeAlias(
    "AuthConfig",
    [
      '| { type: "bearer"; token: string }',
      '| { type: "basic"; username: string; password: string }',
      '| { type: "apiKey"; in: "header" | "query"; name: string; value: string }'
    ].join("\n"),
    true
  )
}

const addInterceptorTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias(
    "RequestContext",
    `{
  url: string
  method: string
  headers: Record<string, string>
  body?: BodyInit
}`,
    true
  )
  writer.addTypeAlias(
    "RequestInterceptor",
    "(request: RequestContext) => Effect.Effect<RequestContext, unknown, never>",
    true
  )
  writer.addTypeAlias(
    "ResponseInterceptor",
    "(response: Response, request: RequestContext) => Effect.Effect<Response, unknown, never>",
    true
  )
  writer.addTypeAlias(
    "Interceptors",
    `{
  request?: RequestInterceptor[]
  response?: ResponseInterceptor[]
}`,
    true
  )
}

const addClientErrorTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias(
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
  writer.addTypeAlias("SchemaType<S extends Schema.ConstraintDecoder<unknown, never>>", 'S["Type"]')
}

const addResponseValueTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias("ResponseKind", '"json" | "text" | "empty" | "binary" | "stream"')
  writer.addTypeAlias("StreamValue", "ReadableStream<Uint8Array> | null")
  writer.addTypeAlias("BinaryValue", "ArrayBuffer")
  writer.addTypeAlias(
    "ResponseEntry",
    "{ schema: Schema.ConstraintDecoder<unknown, never>; kind: ResponseKind }"
  )
  writer.addTypeAlias(
    "ResponseValue<T extends ResponseEntry>",
    'T["kind"] extends "stream" ? StreamValue : T["kind"] extends "binary" ? BinaryValue : SchemaType<T["schema"]>'
  )
  writer.addTypeAlias("ResponseSpec", "Record<string, ResponseEntry>")
}

const addResponseUnionTypes = (writer: CodeWriter): void => {
  writer.addTypeAlias(
    "ResponseUnion<T extends ResponseSpec>",
    `{
  [K in keyof T]: K extends "default"
    ? { status: number; value: ResponseValue<T[K]> }
    : K extends \`\${infer N extends number}\`
      ? { status: N; value: ResponseValue<T[K]> }
      : K extends number
        ? { status: K; value: ResponseValue<T[K]> }
        : { status: number; value: ResponseValue<T[K]> }
}[keyof T]`
  )
  writer.addTypeAlias(
    "HttpError<T extends ResponseSpec>",
    `{ _tag: "HttpError"; response: ResponseUnion<T> }`,
    true
  )
  writer.addTypeAlias(
    "ErrorChannel<T extends ResponseSpec | undefined>",
    "HttpError<Exclude<T, undefined>>"
  )
}

const addSecuritySchemes = (writer: CodeWriter, spec: NormalizedSpec): void => {
  const entries = Object.entries(spec.securitySchemes)

  if (entries.length === 0) {
    writer.addConst("securitySchemes", "{} as const", true)

    return
  }

  const fields = entries.map(([name, scheme]) => `  ${quoteKey(name)}: ${JSON.stringify(scheme)}`)
  writer.addConst(
    "securitySchemes",
    `{
${fields.join(",\n")}
} as const`,
    true
  )
}

export const addClientTypeDeclarations = (sourceFile: SourceFile, spec: NormalizedSpec): void => {
  const writer = createCodeWriter(sourceFile)

  addClientCoreTypes(writer)
  addRetryAndAuthTypes(writer)
  addInterceptorTypes(writer)
  addClientErrorTypes(writer)
  addResponseValueTypes(writer)
  addResponseUnionTypes(writer)
  addSecuritySchemes(writer, spec)
}
