const wordPattern = /[^a-zA-Z0-9]+/g

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

const toWords = (value: string) => value.split(wordPattern).filter(Boolean)

export const toPascalCase = (value: string) => {
  const words = toWords(value)
  if (words.length === 0) return "Unnamed"
  return words.map(capitalize).join("")
}

export const toCamelCase = (value: string) => {
  const pascal = toPascalCase(value)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export const toIdentifier = (value: string) => {
  let id = value.replace(/[^a-zA-Z0-9_]/g, "_")
  if (!/^[A-Za-z_]/.test(id)) {
    id = `_${id}`
  }
  return id
}

export const toPascalIdentifier = (value: string) => toIdentifier(toPascalCase(value))

export const toCamelIdentifier = (value: string) => toIdentifier(toCamelCase(value))

export const isValidIdentifier = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)

export const quoteKey = (value: string) =>
  isValidIdentifier(value) ? value : JSON.stringify(value)
