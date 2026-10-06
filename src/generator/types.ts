export type GenerateResult = {
  schemas: string
  client: string
  warnings: string[]
}

export type GenerateOptions = {
  formatMap?: Record<string, string>
  warnOnUnknownFormat?: boolean
}

export type SchemaContext = {
  componentNames: Map<string, string>
  refPrefix: string
  warnings: string[]
  formatMap: Record<string, string>
  warnOnUnknownFormat: boolean
}

export type ResponseKind = "json" | "text" | "empty" | "binary" | "stream"
