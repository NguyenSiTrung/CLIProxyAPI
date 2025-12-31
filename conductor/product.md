# Product Guide: CLI Proxy API

## Vision

CLI Proxy API enables developers and teams to use their existing AI subscriptions (Google, OpenAI, Anthropic, Alibaba) with any compatible AI coding tool, eliminating the need for separate API keys while providing centralized access control and load balancing.

## Problem Statement

- AI coding tools (Claude Code, Amp CLI, Gemini CLI) typically require separate API keys
- Users with OAuth-based subscriptions cannot easily use them with third-party tools
- Managing multiple accounts across team members is cumbersome
- No unified way to route requests across multiple AI providers

## Solution

A proxy server that:
1. Converts OAuth subscriptions into OpenAI/Gemini/Claude-compatible API endpoints
2. Provides multi-account load balancing with round-robin or fill-first strategies
3. Supports automatic failover when quotas are exceeded
4. Offers a reusable Go SDK for embedding the proxy

## Target Users

1. **Individual Developers** - Using AI coding assistants with personal subscriptions
2. **Development Teams** - Managing shared AI access across multiple accounts
3. **Organizations** - Needing centralized API access control and usage monitoring
4. **Tool Builders** - Embedding proxy functionality via the SDK

## Core Features

### Authentication & Access
- OAuth login flows for Gemini, Claude, Codex, Qwen, and iFlow
- API key authentication for direct access
- Management API with localhost-only security option

### Provider Support
- Gemini CLI / AI Studio / Vertex AI
- Claude Code / Anthropic API
- OpenAI Codex
- Qwen Code
- iFlow
- OpenAI-compatible upstream providers (OpenRouter, etc.)

### Request Handling
- Streaming and non-streaming responses
- Function calling / tools support
- Multimodal input (text and images)
- WebSocket API support
- Automatic retry with configurable attempts

### Load Balancing
- Multi-account round-robin or fill-first strategies
- Automatic project/model switching on quota exceeded
- Per-credential proxy URL overrides
- Model aliasing and exclusion patterns

### Integrations
- Amp CLI and IDE extension support with provider routing
- Model mapping for unavailable models
- Telegram bot for monitoring
- Reusable Go SDK

## Success Metrics

- Seamless request proxying with minimal latency overhead
- High availability through multi-account failover
- Simple configuration via YAML
- Docker-ready deployment
