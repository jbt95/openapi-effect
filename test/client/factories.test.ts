import { expect, it } from "vitest"
import { addClientFactories } from "../../src/client/factories.js"
import type { OperationInfo } from "../../src/client/operation-info.js"
import { createSourceFile, getSourceText } from "../../src/generator/code.js"
import { normalizeOpenApi } from "../../src/openapi.js"

const spec = normalizeOpenApi({
  openapi: "3.0.0",
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        tags: ["users"],
        responses: { "200": { description: "OK" } }
      }
    },
    "/posts": {
      get: {
        operationId: "listPosts",
        tags: ["posts"],
        responses: { "200": { description: "OK" } }
      }
    }
  }
})

const operationInfos: OperationInfo[] = [
  {
    opName: "listUsers",
    tag: "users",
    hasInput: false,
    successMapName: "ListUsersSuccessSchemas",
    responseTypeName: "ListUsersResponse",
    effectBody: "Effect.succeed(undefined)"
  },
  {
    opName: "listPosts",
    tag: "posts",
    hasInput: false,
    successMapName: "ListPostsSuccessSchemas",
    responseTypeName: "ListPostsResponse",
    effectBody: "Effect.succeed(undefined)"
  }
]

it("creates a client factory and tag-grouped client factories", () => {
  const sourceFile = createSourceFile("factories.ts")

  addClientFactories(sourceFile, spec, operationInfos)

  const output = getSourceText(sourceFile)

  expect(output).toContain("export const makeClient")
  expect(output).toContain("export const makeClients")
  expect(output).toContain("listUsers")
  expect(output).toContain("listPosts")
  expect(output).toContain("users:")
  expect(output).toContain("posts:")
})
