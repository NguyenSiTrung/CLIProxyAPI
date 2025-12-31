# Go Code Style Guide

## Formatting

- Use `gofmt` or `goimports` for all Go files
- Run `go fmt ./...` before committing
- Maximum line length: 120 characters (soft limit)

## Naming Conventions

### Packages
- Short, lowercase, single-word names
- Avoid underscores or mixedCaps
- Examples: `auth`, `config`, `translator`, `registry`

### Variables & Functions
- CamelCase for exported identifiers: `NewProxyServer`, `HandleRequest`
- camelCase for unexported identifiers: `parseConfig`, `validateToken`
- Acronyms stay uppercase: `HTTPClient`, `APIKey`, `OAuth`

### Interfaces
- Single-method interfaces use method name + "er": `Reader`, `Handler`
- Avoid "I" prefix: use `Translator` not `ITranslator`

### Constants
- CamelCase, not SCREAMING_SNAKE_CASE
- Group related constants with `const` block

## Project Structure

```
internal/          # Private implementation
  └── feature/
      ├── feature.go       # Main implementation
      ├── feature_test.go  # Tests
      └── types.go         # Types/interfaces (if needed)

sdk/               # Public reusable code
  └── package/
      ├── package.go
      └── package_test.go
```

## Error Handling

- Return errors, don't panic (except truly unrecoverable)
- Wrap errors with context: `fmt.Errorf("failed to parse config: %w", err)`
- Check errors immediately after function calls
- Use custom error types for programmatic handling when needed

## Comments

- Write doc comments for all exported identifiers
- Start with the identifier name: `// NewServer creates a new proxy server`
- Avoid redundant comments that repeat the code

## Testing

- Table-driven tests for multiple cases
- Use `t.Run()` for subtests
- Test file naming: `*_test.go` in same package
- Use testify/assert sparingly - prefer standard library

## Dependencies

- Prefer standard library when possible
- Vendor or use go.mod for reproducible builds
- Keep external dependencies minimal

## Concurrency

- Use channels for communication, mutexes for state
- Document goroutine ownership and lifecycle
- Use `context.Context` for cancellation
- Avoid goroutine leaks - ensure cleanup paths

## Gin-Specific

- Use middleware for cross-cutting concerns
- Group related routes with `gin.RouterGroup`
- Return JSON with `c.JSON()` for API responses
- Use `c.AbortWithStatusJSON()` for error responses

## Logging (Logrus)

- Use structured fields: `log.WithField("key", value).Info("message")`
- Log at appropriate levels: DEBUG, INFO, WARN, ERROR
- Include request IDs for traceability
- Avoid logging sensitive data (tokens, keys)
