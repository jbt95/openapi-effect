# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-30

### Added
- Initial release
- OpenAPI 3.0.x and 3.1.x support
- Generate Effect Schema from OpenAPI schemas
- Generate Effect-based HTTP clients with typed inputs/outputs
- Support for authentication (bearer, basic, apiKey)
- Request/response interceptors
- Retries and timeouts
- Typed HTTP errors for non-2xx responses
- Multipart/form-data request encoding
- Streaming response support (SSE, binary)
- JSON Schema extensions (patternProperties, propertyNames, contentEncoding, contentMediaType)
- Tag-based client grouping
- Server URL resolution (global, path-level, operation-level)
- Per-operation security handling
- CLI tool for code generation
