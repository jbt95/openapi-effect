export type OperationInfo = {
  opName: string
  tag: string
  hasInput: boolean
  inputSchemaName?: string
  successMapName: string
  errorMapName?: string
  responseTypeName: string
  effectBody: string
}
