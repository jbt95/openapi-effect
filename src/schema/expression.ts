import { Match } from "effect"
import type { OpenApiSchema } from "../openapi.js"
import type { SchemaContext } from "../generator/types.js"
import { quoteKey } from "../utils.js"

type SchemaRenderer = (schema: OpenApiSchema | undefined, context: SchemaContext) => string

type SchemaHandler = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
) => string | undefined

const resolveRef = (ref: string, context: SchemaContext): string => {
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

type MergedOpenApiSchema = OpenApiSchema & {
  properties: Record<string, OpenApiSchema>
  required: string[]
}

const mergeAllOfMember = (merged: MergedOpenApiSchema, schema: OpenApiSchema): boolean => {
  if (schema.$ref) return false

  if (schema.type && schema.type !== "object" && !schema.properties) return false

  if (schema.properties) Object.assign(merged.properties, schema.properties)

  if (schema.required) merged.required = [...new Set([...merged.required, ...schema.required])]

  if (schema.additionalProperties !== undefined) {
    merged.additionalProperties = schema.additionalProperties
  }

  return true
}

const mergeAllOf = (schemas: OpenApiSchema[]): OpenApiSchema | undefined => {
  const merged: MergedOpenApiSchema = { type: "object", properties: {}, required: [] }

  for (const schema of schemas) {
    if (!mergeAllOfMember(merged, schema)) return undefined
  }

  return merged
}

export const formatStruct = (fields: string[], extra?: string): string => {
  const formattedFields = fields.map((field) => `  ${field.replace(/\n/g, "\n  ")}`)

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

const withNullable = (schema: OpenApiSchema, expression: string): string =>
  schema.nullable ? `Schema.NullOr(${expression})` : expression

const withFormatWarning = (
  schema: OpenApiSchema,
  context: SchemaContext,
  expression: string
): string => {
  if (schema.format && context.warnOnUnknownFormat) {
    context.warnings.push(`Unsupported schema format: ${schema.format}`)
  }

  return withNullable(schema, expression)
}

const renderReference: SchemaHandler = (schema, context) => {
  if (!schema.$ref) return undefined

  const ref = resolveRef(schema.$ref, context)

  return `Schema.suspend(() => ${ref})`
}

const renderConst: SchemaHandler = (schema, _context) => {
  if (schema.const === undefined) return undefined

  return withNullable(schema, `Schema.Literal(${JSON.stringify(schema.const)})`)
}

const renderEnum: SchemaHandler = (schema, _context) => {
  if (!schema.enum || schema.enum.length === 0) return undefined

  const literals = schema.enum.map((value) => JSON.stringify(value)).join(", ")

  return withNullable(schema, `Schema.Literals([${literals}])`)
}

const renderChoice = (
  schemas: OpenApiSchema[],
  context: SchemaContext,
  render: SchemaRenderer
): string => `Schema.Union([${schemas.map((member) => render(member, context)).join(", ")}])`

const renderOneOf: SchemaHandler = (schema, context, render) => {
  if (!schema.oneOf || schema.oneOf.length === 0) return undefined

  return withNullable(schema, renderChoice(schema.oneOf, context, render))
}

const renderAnyOf: SchemaHandler = (schema, context, render) => {
  if (!schema.anyOf || schema.anyOf.length === 0) return undefined

  return withNullable(schema, renderChoice(schema.anyOf, context, render))
}

const renderAllOf: SchemaHandler = (schema, context, render) => {
  if (!schema.allOf || schema.allOf.length === 0) return undefined

  const merged = mergeAllOf(schema.allOf)

  if (!merged) {
    context.warnings.push("allOf is only supported for inline object schemas.")

    return "Schema.Unknown"
  }

  return withNullable(schema, render(merged, context))
}

const renderConditional: SchemaHandler = (schema, context, render) => {
  if (!schema.if) return undefined

  const thenExpression = schema.then ? render(schema.then, context) : undefined
  const elseExpression = schema.else ? render(schema.else, context) : undefined
  context.warnings.push("Conditional schemas (if/then/else) are approximated.")

  if (thenExpression && elseExpression) {
    return withNullable(schema, `Schema.Union([${thenExpression}, ${elseExpression}])`)
  }

  if (thenExpression) return withNullable(schema, thenExpression)

  if (elseExpression) return withNullable(schema, elseExpression)

  return "Schema.Unknown"
}

const renderTypeArray: SchemaHandler = (schema, context, render) => {
  if (!Array.isArray(schema.type)) return undefined

  const types = Array.from(new Set(schema.type))

  if (types.length === 1) return render({ ...schema, type: types[0] }, context)

  const hasNull = types.includes("null")
  const nonNull = types.filter((type) => type !== "null")

  if (hasNull && nonNull.length === 1) {
    return render({ ...schema, type: nonNull[0], nullable: true }, context)
  }

  if (nonNull.length === 0) return "Schema.Null"

  const members = nonNull.map((type) => render({ ...schema, type, nullable: false }, context))
  const base = members.length === 1 ? members[0] : `Schema.Union([${members.join(", ")}])`

  return hasNull || schema.nullable ? `Schema.NullOr(${base})` : base
}

const renderMappedFormat: SchemaHandler = (schema, context) => {
  const mappedFormat = schema.format ? context.formatMap[schema.format] : undefined

  return mappedFormat ? withNullable(schema, mappedFormat) : undefined
}

const renderStringSchema = (schema: OpenApiSchema, context: SchemaContext): string | undefined => {
  if (schema.type !== "string") return undefined

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

  return withFormatWarning(schema, context, "Schema.String")
}

const renderPrimitive: SchemaHandler = (schema, context) => {
  const stringExpression = renderStringSchema(schema, context)

  if (stringExpression !== undefined) return stringExpression

  if (schema.type === "number") return withFormatWarning(schema, context, "Schema.Number")

  if (schema.type === "integer") {
    return withFormatWarning(schema, context, "Schema.Number.check(Schema.isInt())")
  }

  if (schema.type === "boolean") return withFormatWarning(schema, context, "Schema.Boolean")

  return undefined
}

const renderTupleItems = (
  items: OpenApiSchema[],
  context: SchemaContext,
  render: SchemaRenderer
): string => {
  const expressions = items.map((item) => render(item, context))
  context.warnings.push("Tuple array items are approximated with Schema.Tuple.")

  return `Schema.Tuple([${expressions.join(", ")}])`
}

const renderTupleRest = (prefix: string[], rest: string): string =>
  `Schema.TupleWithRest(Schema.Tuple([${prefix.join(", ")}]), ${rest})`

const renderTupleArray = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
): string | undefined => {
  const prefix = (schema.prefixItems ?? []).map((item) => render(item, context))
  const items = schema.items

  if (prefix.length === 0 && !Array.isArray(items)) return undefined

  if (Array.isArray(items)) return renderTupleItems(items, context, render)

  if (items === false || items === undefined) return `Schema.Tuple([${prefix.join(", ")}])`

  if (items === true) {
    return prefix.length === 0
      ? "Schema.Array(Schema.Unknown)"
      : renderTupleRest(prefix, "Schema.Unknown")
  }

  const rest = render(items, context)

  return prefix.length === 0 ? `Schema.Array(${rest})` : renderTupleRest(prefix, rest)
}

const renderArrayItems = (
  items: OpenApiSchema | OpenApiSchema[] | boolean | undefined,
  context: SchemaContext,
  render: SchemaRenderer
): string => {
  if (items === false) return "Schema.Tuple([])"

  if (items === true || items === undefined) return "Schema.Array(Schema.Unknown)"

  if (Array.isArray(items)) return renderTupleItems(items, context, render)

  return `Schema.Array(${render(items, context)})`
}

const renderArraySchema: SchemaHandler = (schema, context, render) => {
  if (schema.type !== "array" && schema.items === undefined) return undefined

  const tupleExpression = renderTupleArray(schema, context, render)
  const expression = tupleExpression ?? renderArrayItems(schema.items, context, render)

  return withFormatWarning(schema, context, expression)
}

const renderObjectFields = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
): string[] => {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])

  return Object.entries(properties).map(([name, propertySchema]) => {
    const expression = render(propertySchema, context)
    const wrapped = required.has(name) ? expression : `Schema.optional(${expression})`

    return `${quoteKey(name)}: ${wrapped}`
  })
}

const combineExpressions = (expressions: string[]): string | undefined =>
  Match.value(expressions.length).pipe(
    Match.when(0, () => undefined),
    Match.when(1, () => expressions[0]),
    Match.orElse(() => `Schema.Union([${expressions.join(", ")}])`)
  )

const renderPatternProperties = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
): string | undefined => {
  if (!schema.patternProperties) return undefined

  const expressions = Object.values(schema.patternProperties).map((patternSchema) =>
    render(patternSchema, context)
  )

  if (expressions.length === 0) return undefined

  context.warnings.push(
    "patternProperties are approximated as additionalProperties without key pattern enforcement."
  )

  return combineExpressions(expressions)
}

const renderAdditionalProperties = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
) => {
  const value =
    schema.additionalProperties !== undefined
      ? schema.additionalProperties
      : schema.unevaluatedProperties

  if (schema.unevaluatedProperties !== undefined) {
    context.warnings.push("unevaluatedProperties is approximated as additionalProperties.")
  }

  if (value === true) return { value, expression: "Schema.Unknown" }

  if (value === false || value === undefined) return { value, expression: undefined }

  return { value, expression: render(value, context) }
}

const resolveRecordValue = (expressions: string[]): string | undefined => {
  if (expressions.includes("Schema.Unknown")) return "Schema.Unknown"

  return combineExpressions(expressions)
}

const isObjectSchema = (schema: OpenApiSchema): boolean =>
  schema.type === "object" ||
  schema.properties !== undefined ||
  schema.additionalProperties !== undefined ||
  schema.patternProperties !== undefined ||
  schema.propertyNames !== undefined

const renderObjectKeySchema = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer,
  hasProperties: boolean
): string => {
  if (schema.propertyNames && hasProperties) {
    context.warnings.push(
      "propertyNames is only enforced for additional properties in this generator."
    )
  }

  return schema.propertyNames ? render(schema.propertyNames, context) : "Schema.String"
}

const renderObjectRecordValue = (
  schema: OpenApiSchema,
  context: SchemaContext,
  render: SchemaRenderer
): string | undefined => {
  const patternExpression = renderPatternProperties(schema, context, render)
  const additional = renderAdditionalProperties(schema, context, render)

  const expressions = [additional.expression, patternExpression].filter(
    (expression): expression is string => expression !== undefined
  )

  if (expressions.length === 0 && additional.value === undefined) {
    expressions.push("Schema.Unknown")
  }

  return resolveRecordValue(expressions)
}

const renderObjectSchema: SchemaHandler = (schema, context, render) => {
  if (!isObjectSchema(schema)) return undefined

  const fields = renderObjectFields(schema, context, render)
  const hasProperties = fields.length > 0
  const keySchema = renderObjectKeySchema(schema, context, render, hasProperties)
  const recordValue = renderObjectRecordValue(schema, context, render)

  if (!hasProperties && recordValue) {
    return withFormatWarning(schema, context, `Schema.Record(${keySchema}, ${recordValue})`)
  }

  const recordExpression = recordValue ? `Schema.Record(${keySchema}, ${recordValue})` : undefined

  return withFormatWarning(schema, context, formatStruct(fields, recordExpression))
}

const renderNull: SchemaHandler = (schema) => (schema.type === "null" ? "Schema.Null" : undefined)

const schemaHandlers: SchemaHandler[] = [
  renderReference,
  renderConst,
  renderEnum,
  renderOneOf,
  renderAnyOf,
  renderAllOf,
  renderConditional,
  renderTypeArray,
  renderMappedFormat,
  renderPrimitive,
  renderArraySchema,
  renderObjectSchema,
  renderNull
]

export const schemaToExpression: SchemaRenderer = (schema, context) => {
  if (!schema) return "Schema.Unknown"

  for (const handler of schemaHandlers) {
    const expression = handler(schema, context, schemaToExpression)

    if (expression !== undefined) return expression
  }

  return "Schema.Unknown"
}

export const buildParamStruct = (
  params: { name: string; required: boolean; schema?: OpenApiSchema }[],
  context: SchemaContext
): string | undefined => {
  if (params.length === 0) return undefined

  const fields = params.map((param) => {
    const expression = schemaToExpression(param.schema, context)
    const wrapped = param.required ? expression : `Schema.optional(${expression})`

    return `${quoteKey(param.name)}: ${wrapped}`
  })

  return formatStruct(fields)
}

export const inferResponseKind = (contentType?: string, schema?: OpenApiSchema) => {
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

  if (normalized.includes("application/json") || normalized.endsWith("+json")) {
    return "json" as const
  }

  if (normalized.startsWith("text/")) return "text" as const

  return "json" as const
}

const getItemSchemas = (
  items: OpenApiSchema | OpenApiSchema[] | boolean | undefined
): OpenApiSchema[] => {
  if (items === undefined || items === true || items === false) return []

  return Array.isArray(items) ? items : [items]
}

const getAdditionalSchemas = (
  candidates: Array<boolean | OpenApiSchema | undefined>
): OpenApiSchema[] => {
  const schemas: OpenApiSchema[] = []

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== true && candidate !== false) {
      schemas.push(candidate)
    }
  }

  return schemas
}

const getNestedSchemas = (schema: OpenApiSchema): OpenApiSchema[] => {
  const conditionalSchemas = [schema.propertyNames, schema.if, schema.then, schema.else].filter(
    (candidate): candidate is OpenApiSchema => candidate !== undefined
  )

  return [
    ...getItemSchemas(schema.items),
    ...(schema.prefixItems ?? []),
    ...Object.values(schema.properties ?? {}),
    ...Object.values(schema.patternProperties ?? {}),
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
    ...conditionalSchemas,
    ...getAdditionalSchemas([schema.additionalProperties, schema.unevaluatedProperties])
  ]
}

const collectRefName = (ref: string, refs: Set<string>): void => {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/)

  if (match?.[1] !== undefined) refs.add(match[1])
}

const collectComponentRefs = (schema: OpenApiSchema, refs: Set<string>): void => {
  if (schema.$ref) collectRefName(schema.$ref, refs)

  for (const child of getNestedSchemas(schema)) collectComponentRefs(child, refs)
}

const buildComponentDependencies = (
  components: Record<string, OpenApiSchema>
): Map<string, Set<string>> => {
  const dependencies = new Map<string, Set<string>>()

  for (const [name, schema] of Object.entries(components)) {
    const refs = new Set<string>()
    collectComponentRefs(schema, refs)
    dependencies.set(name, refs)
  }

  return dependencies
}

const markRecursiveCycle = (
  name: string,
  recursive: Set<string>,
  visiting: Map<string, number>,
  stack: string[]
): boolean => {
  const cycleStart = visiting.get(name)

  if (cycleStart === undefined) return false

  for (const cycleName of stack.slice(cycleStart)) recursive.add(cycleName)

  return true
}

const visitComponent = (
  name: string,
  components: Record<string, OpenApiSchema>,
  dependencies: Map<string, Set<string>>,
  recursive: Set<string>,
  visited: Set<string>,
  visiting: Map<string, number>,
  stack: string[]
): void => {
  if (markRecursiveCycle(name, recursive, visiting, stack)) return

  if (visited.has(name)) return
  visiting.set(name, stack.length)
  stack.push(name)

  for (const dependency of dependencies.get(name) ?? []) {
    if (components[dependency] !== undefined) {
      visitComponent(dependency, components, dependencies, recursive, visited, visiting, stack)
    }
  }

  stack.pop()
  visiting.delete(name)
  visited.add(name)
}

export const findRecursiveComponents = (components: Record<string, OpenApiSchema>): Set<string> => {
  const dependencies = buildComponentDependencies(components)
  const recursive = new Set<string>()
  const visited = new Set<string>()
  const visiting = new Map<string, number>()
  const stack: string[] = []

  for (const name of Object.keys(components)) {
    visitComponent(name, components, dependencies, recursive, visited, visiting, stack)
  }

  return recursive
}
