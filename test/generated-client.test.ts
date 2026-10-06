import { Effect, Match } from "effect"
import { expect, it } from "vitest"
import { makeClient } from "./fixtures/generated/client.js"

type CyclicInput = { self?: unknown }

const runFailure = async <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, never>
): Promise<E> => {
  const result = await Effect.runPromise(Effect.result(effect))

  const failure = Match.value(result).pipe(
    Match.tag("Failure", ({ failure }) => failure),
    Match.orElse(() => undefined)
  )

  if (failure !== undefined) return failure

  throw new Error("Expected the Effect to fail")
}

it("aborts the fetch when the Effect is interrupted", async () => {
  let resolveStarted: (signal: AbortSignal | undefined) => void = () => {}

  const started = new Promise<AbortSignal | undefined>((resolve) => {
    resolveStarted = resolve
  })

  const controller = new AbortController()

  const client = makeClient({
    baseUrl: "https://api.example.com",
    fetch: (_input, init) => {
      resolveStarted(init?.signal ?? undefined)

      return new Promise<Response>(() => {})
    }
  })

  const exitPromise = Effect.runPromiseExit(client.getUserById({ path: { userId: "user-1" } }), {
    signal: controller.signal
  })

  const requestSignal = await started
  controller.abort()
  const exit = await exitPromise

  expect(exit._tag).toBe("Failure")
  expect(requestSignal?.aborted).toBe(true)
})

it("aborts an in-flight fetch when a timeout interrupts the request", async () => {
  let resolveStarted: (signal: AbortSignal | undefined) => void = () => {}

  const started = new Promise<AbortSignal | undefined>((resolve) => {
    resolveStarted = resolve
  })

  const client = makeClient({
    baseUrl: "https://api.example.com",
    timeoutMs: 20,
    fetch: (_input, init) => {
      resolveStarted(init?.signal ?? undefined)

      return new Promise<Response>(() => {})
    }
  })

  const errorPromise = runFailure(client.getUserById({ path: { userId: "user-1" } }))
  const requestSignal = await started
  const error = await errorPromise

  expect(error._tag).toBe("TimeoutError")
  expect(requestSignal?.aborted).toBe(true)
})

it("reports request encoding failures as typed input errors", async () => {
  const cyclic: CyclicInput = {}
  cyclic.self = cyclic
  let requests = 0

  const client = makeClient({
    baseUrl: "https://api.example.com",
    fetch: async () => {
      requests += 1

      return new Response(null, { status: 200 })
    }
  })

  const error = await runFailure(
    client.searchUsers({ body: Object.assign({ term: "query" }, { cyclic }) })
  )

  expect(error._tag).toBe("InputError")
  expect(requests).toBe(0)
})

it("retries idempotent requests by default", async () => {
  let requests = 0

  const client = makeClient({
    baseUrl: "https://api.example.com",
    retry: { times: 1 },
    fetch: async () => {
      requests += 1

      if (requests === 1) return Promise.reject(new Error("network failure"))

      return new Response(null, { status: 204 })
    }
  })

  const response = await Effect.runPromise(client.getUserById({ path: { userId: "user-1" } }))

  expect(response.status).toBe(204)
  expect(requests).toBe(2)
})

it("does not retry non-idempotent requests unless configured", async () => {
  let requests = 0

  const client = makeClient({
    baseUrl: "https://api.example.com",
    retry: { times: 1 },
    fetch: async () => {
      requests += 1

      return Promise.reject(new Error("network failure"))
    }
  })

  const error = await runFailure(client.searchUsers({ body: { term: "query" } }))

  expect(error._tag).toBe("RequestError")
  expect(requests).toBe(1)
})

it("allows a retry predicate to opt into retries for non-idempotent requests", async () => {
  let requests = 0

  const client = makeClient({
    baseUrl: "https://api.example.com",
    retry: { times: 1, while: () => true },
    fetch: async () => {
      requests += 1

      return Promise.reject(new Error("network failure"))
    }
  })

  const error = await runFailure(client.searchUsers({ body: { term: "query" } }))

  expect(error._tag).toBe("RequestError")
  expect(requests).toBe(2)
})
