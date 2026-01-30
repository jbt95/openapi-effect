# AGENTS.md - Agentic Coding Guide

## Build/Test/Lint Commands

```bash
# Install dependencies
pnpm install

# Type-check (no emit)
pnpm check

# Build to dist/
pnpm build

# Run all tests
pnpm test

# Run single test file
pnpm vitest run test/generator.unit.test.ts

# Run tests in watch mode
pnpm test:watch

# Format code with Prettier
pnpm format
```

## Code Style Guidelines

### TypeScript Configuration

- Target: ES2022 with DOM lib
- Module: NodeNext (requires `.js` extensions on imports)
- Strict mode enabled
- Declaration files and source maps generated

### Formatting (Prettier)

- No semicolons
- Double quotes
- No trailing commas
- Print width: 100
- Run `pnpm format` before committing

### Import Conventions

- Always use `.js` extension for local imports: `import { foo } from "./bar.js"`
- Use `type` prefix for type imports: `import type { Foo } from "./bar.js"`
- Group imports: external libs first, then internal modules
- Example:
  ```ts
  import { Effect, Schema } from "effect"
  import type { GenerateOptions } from "./generator.js"
  import { toCamelIdentifier } from "./utils.js"
  ```

### Naming Conventions

- **Types/Interfaces**: PascalCase (e.g., `GenerateResult`, `OpenApiSchema`)
- **Functions/Variables**: camelCase (e.g., `generateFromSpec`, `schemaToExpression`)
- **Type aliases**: Descriptive with `Type` suffix for schema types (e.g., `SchemaType`)
- **Constants**: camelCase for local, no SCREAMING_SNAKE_CASE

### Type Guidelines

- Prefer `type` over `interface` for object shapes
- Use explicit return types on exported functions
- Use `unknown` instead of `any` for error values
- Leverage Effect's `Effect<A, E, R>` type for async operations
- Use branded types via Schema (e.g., `Schema.UUID`) over raw primitives

### Error Handling

- Use Effect's error channel for recoverable errors
- Return typed errors with `_tag` discriminator
- Collect warnings during generation rather than throwing
- Use `Effect.mapError` to transform errors at boundaries

### Code Organization

- Keep functions small and focused (<50 lines)
- Group related functions with consistent prefixes
- Export public API from `src/index.ts`
- Place tests adjacent to functionality in `test/` directory

### Testing

- Use Vitest with `describe`/`it` blocks
- Import from `../src/index.js` in tests
- Assert on generated code strings for codegen tests
- Test warning messages for edge cases
- Run full test suite before submitting changes

## Project Structure

```
src/           TypeScript source files
test/          Test files (Vitest)
dist/          Compiled output (gitignored)
fixtures/      OpenAPI test fixtures
```

## Key Dependencies

- `effect`: Core functional programming library
- `ts-morph`: TypeScript AST manipulation for codegen
- `@apidevtools/swagger-parser`: OpenAPI parsing
- `vitest`: Testing framework
