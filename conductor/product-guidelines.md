# Product Guidelines: CLI Proxy API

## Documentation Style

### Tone
- **Technical and precise** - Code-focused with minimal prose
- Direct and actionable - Get users to working solutions quickly
- Assume developer familiarity with APIs, proxies, and CLI tools

### Structure
- Lead with examples and code snippets
- Use YAML/JSON for configuration examples
- Include comments in config examples explaining each option
- Provide copy-paste ready commands

### Language
- Use active voice ("Configure the port" not "The port can be configured")
- Prefer short sentences
- Avoid jargon unless industry-standard (OAuth, API, SDK are fine)

## Error Messages

### Format
- Clear, actionable error messages
- Include the specific cause when known
- Suggest resolution steps when possible

### Examples
```
✗ Authentication failed: OAuth token expired
  → Run `cli-proxy-api login gemini` to re-authenticate

✗ Connection refused to upstream: https://api.anthropic.com
  → Check network connectivity and proxy-url configuration
```

## Naming Conventions

### Configuration Keys
- Use kebab-case for YAML keys: `api-keys`, `proxy-url`, `auth-dir`
- Group related settings under parent keys: `remote-management.allow-remote`

### API Endpoints
- Follow OpenAI/provider conventions for compatibility
- Use versioned paths: `/v1/chat/completions`, `/v0/management`

### Internal Code
- Follow Go conventions: CamelCase for exports, camelCase for private
- Use descriptive package names: `translator`, `registry`, `watcher`

## Visual Identity

### Logging
- Use structured logging with logrus
- Include request IDs for tracing
- Log levels: DEBUG for development, INFO for production

### CLI Output
- Minimal color usage - works in all terminals
- Progress indicators for long operations
- Clear success/failure indicators

## Versioning

- Semantic versioning (MAJOR.MINOR.PATCH)
- Breaking changes increment MAJOR
- Module path includes major version: `github.com/router-for-me/CLIProxyAPI/v6`
