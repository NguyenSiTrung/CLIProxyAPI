<!-- Refreshed: 2026-04-17T00:23:00Z -->
# Tech Stack: CLI Proxy API

## Language & Runtime

| Component | Version | Purpose |
|-----------|---------|---------|
| Go | 1.24 | Primary language |

## Core Dependencies

### Web & Networking
| Package | Version | Purpose |
|---------|---------|---------|
| github.com/gin-gonic/gin | v1.10.1 | HTTP web framework |
| github.com/gorilla/websocket | v1.5.3 | WebSocket support |
| golang.org/x/net | v0.47.0 | HTTP/2, networking utilities |
| golang.org/x/oauth2 | v0.30.0 | OAuth 2.0 client |

### Configuration & Logging
| Package | Version | Purpose |
|---------|---------|---------|
| gopkg.in/yaml.v3 | v3.0.1 | YAML configuration parsing |
| github.com/sirupsen/logrus | v1.9.3 | Structured logging |
| gopkg.in/natefinch/lumberjack.v2 | v2.2.1 | Log file rotation |
| github.com/joho/godotenv | v1.5.1 | Environment variable loading |
| github.com/fsnotify/fsnotify | v1.9.0 | File system watching |

### JSON Processing
| Package | Version | Purpose |
|---------|---------|---------|
| github.com/tidwall/gjson | v1.18.0 | JSON path queries |
| github.com/tidwall/sjson | v1.2.5 | JSON path mutations |

### Compression
| Package | Version | Purpose |
|---------|---------|---------|
| github.com/andybalholm/brotli | v1.0.6 | Brotli compression |
| github.com/klauspost/compress | v1.17.4 | General compression |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| github.com/google/uuid | v1.6.0 | UUID generation |
| github.com/tiktoken-go/tokenizer | v0.7.0 | Token counting |
| github.com/skratchdot/open-golang | v0.0.0 | Open URLs in browser |
| github.com/go-git/go-git/v6 | v6.0.0 | Git operations |
| golang.org/x/crypto | v0.45.0 | Cryptography |
| golang.org/x/text | v0.31.0 | Text processing |

### Optional Integrations
| Package | Version | Purpose |
|---------|---------|---------|
| github.com/jackc/pgx/v5 | v5.7.6 | PostgreSQL driver |
| github.com/minio/minio-go/v7 | v7.0.66 | S3-compatible storage |

## Build & Deployment

| Tool | Purpose |
|------|---------|
| goreleaser | Cross-platform binary releases |
| Docker | Container deployment |
| docker-compose | Local development orchestration |

## Project Structure

```
CLIProxyAPI/
├── cmd/server/        # Application entrypoint
├── internal/          # Private application code
│   ├── api/           # HTTP handlers
│   ├── auth/          # Authentication logic
│   ├── config/        # Configuration management
│   ├── registry/      # Provider registry
│   ├── translator/    # Request/response translation
│   └── ...
├── sdk/               # Reusable public SDK
│   ├── api/           # SDK API layer
│   ├── auth/          # SDK auth helpers
│   ├── cliproxy/      # Main SDK package
│   └── ...
├── auths/             # Authentication file storage
├── static/            # Static assets
├── docs/              # Documentation
└── examples/          # Example implementations
```

## Constraints

- Maintain OpenAI/Gemini/Claude API compatibility
- Support both streaming (SSE) and non-streaming responses
- Keep SDK separate from internal implementation
- Docker image must be self-contained
