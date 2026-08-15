# openapi-effect

Generate type-safe Effect Schema and HTTP clients from OpenAPI 4.0 specifications.

[![npm version](https://img.shields.io/npm/v/openapi-effect.svg)](https://www.npmjs.com/package/openapi-effect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

Building API clients manually is error-prone and tedious. This tool generates:

- **Runtime-validated schemas** using [Effect Schema](https://effect.website/docs/schema/introduction)
- **Fully typed HTTP clients** with proper error handling
- **Zero boilerplate** - just point it at your OpenAPI spec

## Quick Start

```bash
# Install
npm install openapi-effect

# Generate from OpenAPI spec
npx openapi-effect generate --input ./api.yaml --output ./src/generated
```

```typescript
import { Effect } from "effect"
import { makeClient } from "./src/generated/client.js"

const client = makeClient({ baseUrl: "https://api.example.com" })
const user = await Effect.runPromise(client.getUser({ path: { id: "123" } }))
```

## Installation

```bash
npm install openapi-effect
# or
yarn add openapi-effect
# or
pnpm add openapi-effect
```

**Requirements:**
- Node.js >= 18.0.0
- TypeScript >= 5.0

## CLI Usage

```bash
openapi-effect generate --input <path-or-url> --output <dir>

# Generate only schemas
openapi-effect generate -i ./openapi.json --schemas-only

# Generate only client
openapi-effect generate -i ./openapi.json --client-only

# Use custom format mappings
openapi-effect generate -i ./openapi.json --format-map ./format-map.json
```

### Options

| Option | Description |
|--------|-------------|
| `-i, --input` | OpenAPI 4.0 file path or URL |
| `-o, --output` | Output directory (default: `src/generated`) |
| `--schemas-only` | Only generate `schemas.ts` |
| `--client-only` | Only generate `client.ts` |
| `--format-map` | Path to JSON mapping custom formats |

## Programmatic API

```typescript
import { generateFromOpenApi } from "openapi-effect"

const { schemas, client, warnings } = await generateFromOpenApi("./openapi.json", {
  formatMap: {
    uuid: "Schema.String.check(Schema.isUUID())",
    "date-time": "Schema.DateFromString"
  }
})
```

## Generated Client Features

### Type-Safe Operations

```typescript
import { Effect } from "effect"
import { makeClient } from "./generated/client.js"

const client = makeClient({
  baseUrl: "https://api.example.com",
  auth: { type: "bearer", token: process.env.API_TOKEN! },
  timeoutMs: 5000,
  retry: { times: 3, delayMs: 200 }
})

// Fully typed - TypeScript knows the exact shape of inputs and outputs
const effect = client.getUser({
  path: { userId: "123" },        // Required path params
  query: { include: ["profile"] }, // Optional query params
  headers: { "x-request-id": "abc" }
})

const result = await Effect.runPromise(effect)
// result is typed as { status: 200, value: User }
```

### Error Handling

Every operation exposes discriminated types for success and error cases:

```typescript
import { makeClient, type GetUserSuccess, type GetUserFailure } from "./generated/client.js"

const result = await Effect.runPromise(
  client.getUser({ path: { userId: "123" } }).pipe(
    Effect.catchAll((error) => {
      if (error._tag === "HttpError") {
        const failure = error as GetUserFailure
        // Typed access to error responses (404, 500, etc.)
        console.log(failure.response.status)
        return Effect.succeed(null)
      }
      // Handle other errors (timeouts, network errors, etc.)
      return Effect.fail(error)
    })
  )
)
```

Generated types:
- `<Operation>Success` - 2xx responses with status as literal types
- `<Operation>Error` - Non-2xx responses with status as literal types
- `<Operation>Response` - Union of success and error
- `<Operation>Failure` - `HttpError` type for the error channel

Common client error tags:
- `InputError`
- `RequestError`
- `ResponseError`
- `ResponseDecodeError`
- `InterceptorError`
- `TimeoutError`

### Request/Response Interceptors

```typescript
const client = makeClient({
  baseUrl: "https://api.example.com",
  interceptors: {
    request: [
      (req) => Effect.succeed({
        ...req,
        headers: { ...req.headers, "x-trace-id": generateTraceId() }
      })
    ],
    response: [
      (res, req) => Effect.succeed(res)
    ]
  }
})
```

### Authentication

Built-in support for common auth schemes:

```typescript
// Bearer token
makeClient({
  baseUrl: "https://api.example.com",
  auth: { type: "bearer", token: "abc123" }
})

// Basic auth
makeClient({
  baseUrl: "https://api.example.com",
  auth: { type: "basic", username: "user", password: "pass" }
})

// API Key (header or query)
makeClient({
  baseUrl: "https://api.example.com",
  auth: { type: "apiKey", in: "header", name: "X-API-Key", value: "secret" }
})
```

Note: auth is configured per client instance via `makeClient({ auth: ... })`. Operation-specific security rules from the spec are normalized and exported as `securitySchemes`, but auth application is controlled by runtime config.

### Retries and Timeouts

```typescript
const client = makeClient({
  baseUrl: "https://api.example.com",
  timeoutMs: 3000,           // Per-request timeout
  retry: {
    times: 3,                // Max retry attempts
    delayMs: 200,            // Delay between retries
    while: (error) => {      // Retry condition
      return error._tag === "TimeoutError" ||
             (error._tag === "HttpError" && error.response.status >= 500)
    }
  }
})
```

### Tag-Based Client Grouping

For large APIs, generated output also includes `makeClients`, which groups operations by OpenAPI tag:

```typescript
import { makeClients } from "./generated/client.js"

const grouped = makeClients({
  baseUrl: "https://api.example.com"
})

const usersClient = grouped.users({ baseUrl: "https://api.example.com" })
const ordersClient = grouped.orders({ baseUrl: "https://api.example.com" })

const user = await Effect.runPromise(usersClient.getUser({ path: { id: "123" } }))
const order = await Effect.runPromise(ordersClient.createOrder({ body: { ... } }))
```

## Supported OpenAPI Features

### Schema Features
- ✅ `$ref` references to `#/components/schemas/*`
- ✅ All primitive types: `string`, `number`, `integer`, `boolean`, `array`, `object`
- ✅ `type` arrays (e.g., `["string", "null"]`) - OpenAPI 3.1
- ✅ `const` values - OpenAPI 3.1
- ✅ `enum`
- ✅ `nullable`
- ✅ `format` with built-in mappings: `uuid`, `date`, `date-time`
- ✅ Custom format mappings via `formatMap` option
- ✅ `oneOf`, `anyOf`, `allOf` (inline objects only)
- ✅ `additionalProperties`
- ✅ `prefixItems` / tuple arrays - OpenAPI 3.1
- ✅ `patternProperties` (approximated)
- ✅ `propertyNames` (applied to additional properties)
- ✅ `if`/`then`/`else` (approximated as union)
- ✅ `unevaluatedProperties` (approximated as additionalProperties)
- ✅ `contentEncoding` / `contentMediaType` (treated as string with warning)

### HTTP Features
- ✅ Path, query, header parameters
- ✅ Request/response body validation
- ✅ JSON request/response bodies
- ✅ `multipart/form-data` (FormData encoding)
- ✅ Text responses (`text/*`)
- ✅ Binary responses (`application/octet-stream`, images, audio, video)
- ✅ Streaming responses (`text/event-stream`, Server-Sent Events)
- ✅ Global and per-operation server URLs
- ✅ Exported OpenAPI security schemes (`securitySchemes`)

## Configuration

### Custom Format Mappings

Map OpenAPI format strings to Effect Schema types:

```typescript
const { schemas, client } = await generateFromOpenApi("./openapi.json", {
  formatMap: {
    email: "Schema.String",
    uri: "Schema.String",
    uuid: "Schema.String.check(Schema.isUUID())",
    "date-time": "Schema.DateFromString"
  },
  warnOnUnknownFormat: true  // Warn about unmapped formats
})
```

Default format mappings used by the generator:
- `uuid` -> `Schema.String.check(Schema.isUUID())`
- `date-time` -> `Schema.DateFromString`
- `date` -> `Schema.DateFromString`

## API Reference

### `generateFromOpenApi(input, options?)`

Generate schemas and client from an OpenAPI specification file or URL.

**Parameters:**
- `input: string` - Path to OpenAPI file or URL
- `options?: GenerateOptions`
  - `formatMap?: Record<string, string>` - Map OpenAPI formats to Schema types
  - `warnOnUnknownFormat?: boolean` - Warn about unmapped formats (default: true)

**Returns:** `Promise<GenerateResult>`
- `schemas: string` - Generated schema TypeScript code
- `client: string` - Generated client TypeScript code
- `warnings: string[]` - Any warnings during generation

### `generateFromSpec(spec, options?)`

Same as above but accepts a parsed OpenAPI specification object.

Returns synchronously: `GenerateResult`.

## Notes and Limitations

- `allOf` is only fully merged for inline object schemas.
- `patternProperties` and `propertyNames` are approximated for compatibility.
- `if` / `then` / `else` and `unevaluatedProperties` are approximated and emit warnings.
- Unsupported schema `format` values fall back to base schema types and can emit warnings.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm check

# Format code
pnpm format

# Build for publishing
pnpm build
```

## License

MIT
