import { Effect, Schema, Schedule } from "effect";
import * as Schemas from "./schemas.js";

export type ClientConfig = {
    baseUrl: string
    headers?: Record<string, string>
    fetch?: typeof fetch
    auth?: AuthConfig
    interceptors?: Interceptors
    timeoutMs?: number
    retry?: RetryConfig
  };
export type OperationConfig = ClientConfig & {
    baseUrl?: string
  };
export type SecurityScheme = | { type: "http"; scheme: "bearer" | "basic"; description?: string }
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string; description?: string }
  | { type: "oauth2"; flows: unknown; description?: string }
  | { type: "openIdConnect"; openIdConnectUrl: string; description?: string };
export type RetryPredicate = (error: unknown) => boolean;
export type RetryConfig = {
    times: number
    delayMs?: number
    while?: RetryPredicate
  };
export type AuthConfig = | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; in: "header" | "query"; name: string; value: string };
export type RequestContext = {
    url: string
    method: string
    headers: Record<string, string>
    body?: BodyInit
  };
export type RequestInterceptor = (request: RequestContext) => Effect.Effect<RequestContext, unknown, never>;
export type ResponseInterceptor = (response: Response, request: RequestContext) => Effect.Effect<Response, unknown, never>;
export type Interceptors = {
    request?: RequestInterceptor[]
    response?: ResponseInterceptor[]
  };
export type ClientError = | { _tag: "InputError"; error: unknown }
  | { _tag: "RequestError"; error: unknown }
  | { _tag: "ResponseError"; error: unknown }
  | { _tag: "ResponseDecodeError"; status: number; error: unknown }
  | { _tag: "InterceptorError"; stage: "request" | "response"; error: unknown }
  | { _tag: "TimeoutError"; timeoutMs: number };
type SchemaType<S extends Schema.Schema.Any> = Schema.Schema.Type<S>;
type ResponseKind = "json" | "text" | "empty" | "binary" | "stream";
type StreamValue = ReadableStream<Uint8Array> | null;
type BinaryValue = ArrayBuffer;
type ResponseEntry = { schema: Schema.Schema.Any; kind: ResponseKind };
type ResponseValue<T extends ResponseEntry> = T["kind"] extends "stream" ? StreamValue : T["kind"] extends "binary" ? BinaryValue : SchemaType<T["schema"]>;
type ResponseSpec = Record<string, ResponseEntry>;
type ResponseUnion<T extends ResponseSpec> = {
    [K in keyof T]: K extends "default"
      ? { status: number; value: ResponseValue<T[K]> }
      : K extends `${infer N extends number}`
        ? { status: N; value: ResponseValue<T[K]> }
        : K extends number
          ? { status: K; value: ResponseValue<T[K]> }
          : { status: number; value: ResponseValue<T[K]> }
  }[keyof T];
export type HttpError<T extends ResponseSpec> = { _tag: "HttpError"; response: ResponseUnion<T> };
type ErrorChannel<T extends ResponseSpec | undefined> = HttpError<Exclude<T, undefined>>;

export const securitySchemes = {} as const;

function resolveFetch(custom?: typeof fetch): typeof fetch {
  if (custom) return custom
  if (typeof fetch === "function") return fetch
  throw new Error("fetch is not available in this runtime")
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function encodeQuery(query?: Record<string, unknown>): string {
  if (!query) return ""
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined) continue
        params.append(key, String(item))
      }

      continue
    }

    params.append(key, String(value))
  }

  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

function buildUrl(baseUrl: string, path: string, pathParams?: Record<string, unknown>, query?: Record<string, unknown>): string {
  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_match, key) => {
    const raw = pathParams?.[key]
    if (raw === undefined || raw === null) {
      throw new Error(`Missing path param: ${key}`)
    }

    return encodeURIComponent(String(raw))
  })
  const base = trimSlash(baseUrl)
  const url = `${base}${resolvedPath.startsWith("/") ? "" : "/"}${resolvedPath}`
  return `${url}${encodeQuery(query)}`
}

function encodeBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`
  if (typeof Buffer !== "undefined") {
    return Buffer.from(raw).toString("base64")
  }

  if (typeof btoa === "function") {
    return btoa(raw)
  }

  throw new Error("Basic auth encoding is not available in this runtime")
}

function applyAuth(auth: AuthConfig | undefined, headers: Record<string, string>, query?: Record<string, unknown>): { headers: Record<string, string>; query?: Record<string, unknown> } {
  if (!auth) return { headers, query }

  const nextHeaders: Record<string, string> = { ...headers }

  let nextQuery = query ? { ...query } : undefined
  if (auth.type === "bearer") {
    nextHeaders.authorization = `Bearer ${auth.token}`
  } else if (auth.type === "basic") {
    nextHeaders.authorization = `Basic ${encodeBasicAuth(auth.username, auth.password)}`
  } else if (auth.type === "apiKey") {
    if (auth.in === "header") {
      nextHeaders[auth.name] = auth.value
    } else {
      nextQuery = { ...(nextQuery ?? {}), [auth.name]: auth.value }

    }

  }

  return { headers: nextHeaders, query: nextQuery }
}

function applyRequestInterceptors(request: RequestContext, interceptors?: RequestInterceptor[]): Effect.Effect<RequestContext, ClientError, never> {
  return (interceptors ?? []).reduce<Effect.Effect<RequestContext, ClientError, never>>(
    (effect, interceptor) =>
      effect.pipe(
        Effect.flatMap((current) => interceptor(current)),
        Effect.mapError((error) => ({ _tag: "InterceptorError" as const, stage: "request" as const, error }))
      ),
    Effect.succeed(request)
  )
}

function applyResponseInterceptors(response: Response, request: RequestContext, interceptors?: ResponseInterceptor[]): Effect.Effect<Response, ClientError, never> {
  return (interceptors ?? []).reduce<Effect.Effect<Response, ClientError, never>>(
    (effect, interceptor) =>
      effect.pipe(
        Effect.flatMap((current) => interceptor(current, request)),
        Effect.mapError((error) => ({ _tag: "InterceptorError" as const, stage: "response" as const, error }))
      ),
    Effect.succeed(response)
  )
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600)
}

function defaultRetryPredicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const tagged = error as { _tag?: string; response?: { status?: number } }

  if (tagged._tag === "RequestError" || tagged._tag === "ResponseError") return true
  if (tagged._tag === "TimeoutError") return true
  if (tagged._tag === "HttpError") {
    const status = tagged.response?.status
    return typeof status === "number" && isRetryableStatus(status)
  }

  return false
}

function applyRetry<A, E, R>(effect: Effect.Effect<A, E, R>, retry?: RetryConfig): Effect.Effect<A, E, R> {
  return retry
    ? effect.pipe(
        Effect.retry({
          times: retry.times,
          while: retry.while ?? defaultRetryPredicate,
          schedule: retry.delayMs ? Schedule.fixed(retry.delayMs) : undefined
        })
      )
    : effect
}

function applyTimeout<A, E, R>(effect: Effect.Effect<A, E, R>, timeoutMs?: number): Effect.Effect<A, E | ClientError, R> {
  return timeoutMs === undefined
    ? effect
    : effect.pipe(
        Effect.timeoutFail({
          duration: timeoutMs,
          onTimeout: () => ({ _tag: "TimeoutError" as const, timeoutMs })
        })
      )
}

function applyResilience<A, E, R>(effect: Effect.Effect<A, E, R>, config: ClientConfig): Effect.Effect<A, E | ClientError, R> {
  return applyRetry(applyTimeout(effect, config.timeoutMs), config.retry)
}

function mergeHeaders(base?: Record<string, string>, extra?: Record<string, string>, contentType?: string, hasBody?: boolean): Record<string, string> {
  const headers: Record<string, string> = { ...(base ?? {}), ...(extra ?? {}) }

  if (hasBody && contentType && !contentType.toLowerCase().includes("multipart/form-data")) {
    headers["content-type"] = contentType
  }

  return headers
}

function encodeFormData(body: unknown): FormData {
  if (typeof FormData === "undefined") {
    throw new Error("FormData is not available in this runtime")
  }

  if (body instanceof FormData) return body
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("multipart/form-data body must be an object")
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined) continue
        if (item === null) {
          form.append(key, "")
          continue
        }

        if (typeof Blob !== "undefined" && item instanceof Blob) {
          form.append(key, item)
          continue
        }

        if (typeof item === "object") {
          form.append(key, JSON.stringify(item))
          continue
        }

        form.append(key, String(item))
      }

      continue
    }

    if (value === null) {
      form.append(key, "")
      continue
    }

    if (typeof Blob !== "undefined" && value instanceof Blob) {
      form.append(key, value)
      continue
    }

    if (typeof value === "object") {
      form.append(key, JSON.stringify(value))
      continue
    }

    form.append(key, String(value))
  }

  return form
}

function encodeBody(body: unknown, contentType?: string): BodyInit | undefined {
  if (body === undefined) return undefined
  const normalized = contentType?.toLowerCase()
  if (normalized && normalized.includes("multipart/form-data")) {
    return encodeFormData(body)
  }

  if (!normalized || normalized.includes("application/json")) {
    return JSON.stringify(body)
  }

  if (normalized.startsWith("text/")) {
    return String(body)
  }

  return JSON.stringify(body)
}

function executeRequest(fetcher: typeof fetch, method: string, url: string, headers: Record<string, string>, body?: BodyInit): Effect.Effect<Response, ClientError, unknown> {
  return Effect.tryPromise({
    try: () => fetcher(url, { method, headers, body }),
    catch: (error) => ({ _tag: "RequestError" as const, error })
  })
}

function decodeInput<S extends Schema.Schema.Any>(schema: S, input: unknown): Effect.Effect<Schema.Schema.Type<S>, ClientError, unknown> {
  return Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError((error) => ({ _tag: "InputError" as const, error }))
  )
}

function decodeResponse<TSuccess extends ResponseSpec, TError extends ResponseSpec | undefined>(response: Response, successSpec: TSuccess, errorSpec?: TError): Effect.Effect<ResponseUnion<TSuccess>, ClientError | ErrorChannel<TError>, unknown> {
  return Effect.tryPromise({
    try: async () => {
      const successEntry =
        (successSpec as Record<string, ResponseEntry>)[response.status] ?? successSpec.default
      const errorEntry =
        errorSpec ? (errorSpec as Record<string, ResponseEntry>)[response.status] ?? errorSpec.default : undefined
      const entry = successEntry ?? errorEntry
      if (!entry) {
        throw new Error(`Unexpected status: ${response.status}`)
      }

      let raw: unknown = undefined
      if (entry.kind === "json") {
        raw = await response.json()
      } else if (entry.kind === "text") {
        raw = await response.text()
      } else if (entry.kind === "binary") {
        raw = await response.arrayBuffer()
      } else if (entry.kind === "stream") {
        raw = response.body
      }

      return { status: response.status, schema: entry.schema, raw, isError: !successEntry, kind: entry.kind }

    },
    catch: (error) => ({ _tag: "ResponseError" as const, error })
  }).pipe(
    Effect.flatMap(({ status, schema, raw, isError, kind }) =>
      (kind === "stream" || kind === "binary")
        ? (() => {
            const decoded = { status, value: raw }

            return isError
              ? Effect.fail({ _tag: "HttpError" as const, response: decoded as ResponseUnion<Exclude<TError, undefined>> })
              : Effect.succeed(decoded as ResponseUnion<TSuccess>)
          })()
        : Schema.decodeUnknown(schema)(raw).pipe(
            Effect.map((value) => ({ status, value })),
            Effect.mapError((error) => ({ _tag: "ResponseDecodeError" as const, status, error }))
          ).pipe(
            Effect.flatMap((decoded) =>
              isError
                ? Effect.fail({ _tag: "HttpError" as const, response: decoded as ResponseUnion<Exclude<TError, undefined>> })
                : Effect.succeed(decoded as ResponseUnion<TSuccess>)
            )
          )
    )
  )
}

export const GetUserByIdInput = Schema.Struct({
    path: Schema.Struct({
      userId: Schema.String
    }),
    query: Schema.optional(Schema.Struct({
      include: Schema.optional(Schema.Array(Schema.String)),
      verbose: Schema.optional(Schema.Boolean)
    })),
    headers: Schema.optional(Schema.Struct({
      "x-trace-id": Schema.optional(Schema.String)
    }))
  });

export type GetUserByIdInput = SchemaType<typeof GetUserByIdInput>;

export const GetUserByIdResponseStatus200 = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
    status: Schema.Literal("active", "disabled", "pending"),
    tags: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
export const GetUserByIdResponseStatus204 = Schema.Undefined;
export const GetUserByIdResponseStatus404 = Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.String)
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const GetUserByIdSuccessSchemas = {
    "200": { schema: GetUserByIdResponseStatus200, kind: "json" },
    "204": { schema: GetUserByIdResponseStatus204, kind: "empty" },
  } as const;
const GetUserByIdErrorSchemas = {
    "404": { schema: GetUserByIdResponseStatus404, kind: "json" },
  } as const;

export type GetUserByIdSuccess = ResponseUnion<typeof GetUserByIdSuccessSchemas>;
export type GetUserByIdError = ResponseUnion<typeof GetUserByIdErrorSchemas>;
export type GetUserByIdResponse = GetUserByIdSuccess | GetUserByIdError;
export type GetUserByIdFailure = HttpError<typeof GetUserByIdErrorSchemas>;

export const UpdateUserInput = Schema.Struct({
    path: Schema.Struct({
      userId: Schema.String
    }),
    body: Schema.Struct({
      name: Schema.String,
      age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
      status: Schema.optional(Schema.Literal("active", "disabled", "pending"))
    }, Schema.Record({ key: Schema.String, value: Schema.Union() }))
  });

export type UpdateUserInput = SchemaType<typeof UpdateUserInput>;

export const UpdateUserResponseStatus200 = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
    status: Schema.Literal("active", "disabled", "pending"),
    tags: Schema.optional(Schema.Array(Schema.String)),
    metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
export const UpdateUserResponseStatus400 = Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.String)
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const UpdateUserSuccessSchemas = {
    "200": { schema: UpdateUserResponseStatus200, kind: "json" },
  } as const;
const UpdateUserErrorSchemas = {
    "400": { schema: UpdateUserResponseStatus400, kind: "json" },
  } as const;

export type UpdateUserSuccess = ResponseUnion<typeof UpdateUserSuccessSchemas>;
export type UpdateUserError = ResponseUnion<typeof UpdateUserErrorSchemas>;
export type UpdateUserResponse = UpdateUserSuccess | UpdateUserError;
export type UpdateUserFailure = HttpError<typeof UpdateUserErrorSchemas>;

export const ListPetsResponseStatus200 = Schema.Array(Schema.Union(Schema.Struct({
    type: Schema.Literal("cat"),
    meows: Schema.Boolean
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown })), Schema.Struct({
    type: Schema.Literal("dog"),
    barks: Schema.Boolean
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))));
const ListPetsSuccessSchemas = {
    "200": { schema: ListPetsResponseStatus200, kind: "json" },
  } as const;

export type ListPetsSuccess = ResponseUnion<typeof ListPetsSuccessSchemas>;
export type ListPetsError = never;
export type ListPetsResponse = ListPetsSuccess | ListPetsError;
export type ListPetsFailure = never;

export const SearchUsersInput = Schema.Struct({
    body: Schema.Struct({
      term: Schema.String,
      filter: Schema.optional(Schema.NullOr(Schema.Union(Schema.String, Schema.Number.pipe(Schema.int())))),
      tags: Schema.optional(Schema.Array(Schema.String)),
      status: Schema.optional(Schema.Literal("active", "disabled", "pending")),
      range: Schema.optional(Schema.Struct({
        min: Schema.optional(Schema.Number),
        max: Schema.optional(Schema.Number)
      }, Schema.Record({ key: Schema.String, value: Schema.Unknown })))
    }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))
  });

export type SearchUsersInput = SchemaType<typeof SearchUsersInput>;

export const SearchUsersResponseStatus200 = Schema.Struct({
    results: Schema.Array(Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int()))),
      status: Schema.Literal("active", "disabled", "pending"),
      tags: Schema.optional(Schema.Array(Schema.String)),
      metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
      preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
    }, Schema.Record({ key: Schema.String, value: Schema.Unknown }))),
    next: Schema.optional(Schema.NullOr(Schema.String)),
    facets: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) }))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const SearchUsersSuccessSchemas = {
    "200": { schema: SearchUsersResponseStatus200, kind: "json" },
  } as const;

export type SearchUsersSuccess = ResponseUnion<typeof SearchUsersSuccessSchemas>;
export type SearchUsersError = never;
export type SearchUsersResponse = SearchUsersSuccess | SearchUsersError;
export type SearchUsersFailure = never;

export const GetHealthResponseStatus200 = Schema.String;
const GetHealthSuccessSchemas = {
    "200": { schema: GetHealthResponseStatus200, kind: "text" },
  } as const;

export type GetHealthSuccess = ResponseUnion<typeof GetHealthSuccessSchemas>;
export type GetHealthError = never;
export type GetHealthResponse = GetHealthSuccess | GetHealthError;
export type GetHealthFailure = never;

export const CreateNoteInput = Schema.Struct({
    body: Schema.String
  });

export type CreateNoteInput = SchemaType<typeof CreateNoteInput>;

export const CreateNoteResponseStatus201 = Schema.Struct({
    id: Schema.String,
    body: Schema.String,
    meta: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Union() })),
    tags: Schema.optional(Schema.Array(Schema.String))
  }, Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const CreateNoteSuccessSchemas = {
    "201": { schema: CreateNoteResponseStatus201, kind: "json" },
  } as const;

export type CreateNoteSuccess = ResponseUnion<typeof CreateNoteSuccessSchemas>;
export type CreateNoteError = never;
export type CreateNoteResponse = CreateNoteSuccess | CreateNoteError;
export type CreateNoteFailure = never;

export const makeClient = (config: ClientConfig) => {
    const fetcher = resolveFetch(config.fetch)
    return {
      getUserById: (input: GetUserByIdInput) =>
        applyResilience(
          decodeInput(GetUserByIdInput, input).pipe(
            Effect.flatMap((decoded) => {
              const baseHeaders = mergeHeaders(config.headers, decoded.headers)
              const auth = applyAuth(config.auth, baseHeaders, decoded.query)
              const url = buildUrl(config.baseUrl, "/users/{userId}", decoded.path, auth.query)
              const request: RequestContext = { url, method: "GET", headers: auth.headers }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, GetUserByIdSuccessSchemas, GetUserByIdErrorSchemas))
          ),
          config
        ),
      updateUser: (input: UpdateUserInput) =>
        applyResilience(
          decodeInput(UpdateUserInput, input).pipe(
            Effect.flatMap((decoded) => {
              const hasBody = decoded.body !== undefined
              const body = encodeBody(decoded.body, "application/json")
              const baseHeaders = mergeHeaders(config.headers, undefined, "application/json", hasBody)
              const auth = applyAuth(config.auth, baseHeaders, undefined)
              const url = buildUrl(config.baseUrl, "/users/{userId}", decoded.path, auth.query)
              const request: RequestContext = { url, method: "PUT", headers: auth.headers, body }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, UpdateUserSuccessSchemas, UpdateUserErrorSchemas))
          ),
          config
        ),
      listPets: () =>
        applyResilience(
          Effect.sync(() => undefined).pipe(
            Effect.flatMap(() => {
              const baseHeaders = mergeHeaders(config.headers, undefined)
              const auth = applyAuth(config.auth, baseHeaders, undefined)
              const url = buildUrl(config.baseUrl, "/pets", undefined, auth.query)
              const request: RequestContext = { url, method: "GET", headers: auth.headers }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, ListPetsSuccessSchemas))
          ),
          config
        ),
      searchUsers: (input: SearchUsersInput) =>
        applyResilience(
          decodeInput(SearchUsersInput, input).pipe(
            Effect.flatMap((decoded) => {
              const hasBody = decoded.body !== undefined
              const body = encodeBody(decoded.body, "application/json")
              const baseHeaders = mergeHeaders(config.headers, undefined, "application/json", hasBody)
              const auth = applyAuth(config.auth, baseHeaders, undefined)
              const url = buildUrl(config.baseUrl, "/search", undefined, auth.query)
              const request: RequestContext = { url, method: "POST", headers: auth.headers, body }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, SearchUsersSuccessSchemas))
          ),
          config
        ),
      getHealth: () =>
        applyResilience(
          Effect.sync(() => undefined).pipe(
            Effect.flatMap(() => {
              const baseHeaders = mergeHeaders(config.headers, undefined)
              const auth = applyAuth(config.auth, baseHeaders, undefined)
              const url = buildUrl(config.baseUrl, "/health", undefined, auth.query)
              const request: RequestContext = { url, method: "GET", headers: auth.headers }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, GetHealthSuccessSchemas))
          ),
          config
        ),
      createNote: (input: CreateNoteInput) =>
        applyResilience(
          decodeInput(CreateNoteInput, input).pipe(
            Effect.flatMap((decoded) => {
              const hasBody = decoded.body !== undefined
              const body = encodeBody(decoded.body, "text/plain")
              const baseHeaders = mergeHeaders(config.headers, undefined, "text/plain", hasBody)
              const auth = applyAuth(config.auth, baseHeaders, undefined)
              const url = buildUrl(config.baseUrl, "/notes", undefined, auth.query)
              const request: RequestContext = { url, method: "POST", headers: auth.headers, body }
              return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                Effect.flatMap((prepared) =>
                  executeRequest(
                    fetcher,
                    prepared.method,
                    prepared.url,
                    prepared.headers,
                    prepared.body
                  ).pipe(
                    Effect.flatMap((response) =>
                      applyResponseInterceptors(response, prepared, config.interceptors?.response)
                    )
                  )
                )
              )
            }),
            Effect.flatMap((response) => decodeResponse(response, CreateNoteSuccessSchemas))
          ),
          config
        )
    }
  };
export const makeClients = (config: ClientConfig) => {
    return {
      default: (config: ClientConfig) => {
          const fetcher = resolveFetch(config.fetch)
          return {
              getUserById: (input: GetUserByIdInput) =>
                applyResilience(
                  decodeInput(GetUserByIdInput, input).pipe(
                    Effect.flatMap((decoded) => {
                      const baseHeaders = mergeHeaders(config.headers, decoded.headers)
                      const auth = applyAuth(config.auth, baseHeaders, decoded.query)
                      const url = buildUrl(config.baseUrl, "/users/{userId}", decoded.path, auth.query)
                      const request: RequestContext = { url, method: "GET", headers: auth.headers }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, GetUserByIdSuccessSchemas, GetUserByIdErrorSchemas))
                  ),
                  config
                ),
              updateUser: (input: UpdateUserInput) =>
                applyResilience(
                  decodeInput(UpdateUserInput, input).pipe(
                    Effect.flatMap((decoded) => {
                      const hasBody = decoded.body !== undefined
                      const body = encodeBody(decoded.body, "application/json")
                      const baseHeaders = mergeHeaders(config.headers, undefined, "application/json", hasBody)
                      const auth = applyAuth(config.auth, baseHeaders, undefined)
                      const url = buildUrl(config.baseUrl, "/users/{userId}", decoded.path, auth.query)
                      const request: RequestContext = { url, method: "PUT", headers: auth.headers, body }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, UpdateUserSuccessSchemas, UpdateUserErrorSchemas))
                  ),
                  config
                ),
              listPets: () =>
                applyResilience(
                  Effect.sync(() => undefined).pipe(
                    Effect.flatMap(() => {
                      const baseHeaders = mergeHeaders(config.headers, undefined)
                      const auth = applyAuth(config.auth, baseHeaders, undefined)
                      const url = buildUrl(config.baseUrl, "/pets", undefined, auth.query)
                      const request: RequestContext = { url, method: "GET", headers: auth.headers }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, ListPetsSuccessSchemas))
                  ),
                  config
                ),
              searchUsers: (input: SearchUsersInput) =>
                applyResilience(
                  decodeInput(SearchUsersInput, input).pipe(
                    Effect.flatMap((decoded) => {
                      const hasBody = decoded.body !== undefined
                      const body = encodeBody(decoded.body, "application/json")
                      const baseHeaders = mergeHeaders(config.headers, undefined, "application/json", hasBody)
                      const auth = applyAuth(config.auth, baseHeaders, undefined)
                      const url = buildUrl(config.baseUrl, "/search", undefined, auth.query)
                      const request: RequestContext = { url, method: "POST", headers: auth.headers, body }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, SearchUsersSuccessSchemas))
                  ),
                  config
                ),
              getHealth: () =>
                applyResilience(
                  Effect.sync(() => undefined).pipe(
                    Effect.flatMap(() => {
                      const baseHeaders = mergeHeaders(config.headers, undefined)
                      const auth = applyAuth(config.auth, baseHeaders, undefined)
                      const url = buildUrl(config.baseUrl, "/health", undefined, auth.query)
                      const request: RequestContext = { url, method: "GET", headers: auth.headers }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, GetHealthSuccessSchemas))
                  ),
                  config
                ),
              createNote: (input: CreateNoteInput) =>
                applyResilience(
                  decodeInput(CreateNoteInput, input).pipe(
                    Effect.flatMap((decoded) => {
                      const hasBody = decoded.body !== undefined
                      const body = encodeBody(decoded.body, "text/plain")
                      const baseHeaders = mergeHeaders(config.headers, undefined, "text/plain", hasBody)
                      const auth = applyAuth(config.auth, baseHeaders, undefined)
                      const url = buildUrl(config.baseUrl, "/notes", undefined, auth.query)
                      const request: RequestContext = { url, method: "POST", headers: auth.headers, body }
                      return applyRequestInterceptors(request, config.interceptors?.request).pipe(
                        Effect.flatMap((prepared) =>
                          executeRequest(
                            fetcher,
                            prepared.method,
                            prepared.url,
                            prepared.headers,
                            prepared.body
                          ).pipe(
                            Effect.flatMap((response) =>
                              applyResponseInterceptors(response, prepared, config.interceptors?.response)
                            )
                          )
                        )
                      )
                    }),
                    Effect.flatMap((response) => decodeResponse(response, CreateNoteSuccessSchemas))
                  ),
                  config
                )
            }
        }
    }
  };
