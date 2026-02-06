# Alepha - Mcp

## Installation

Part of the `alepha` package. Import from `alepha/mcp`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.18.0 | node, bun|

Model Context Protocol for AI tool integration.

**Features:**
- MCP resource definitions
- MCP tool definitions
- MCP prompt definitions
- JSON-RPC protocol
- SSE and Stdio transports

## API Reference

### Primitives

- [`$prompt`](/docs/primitives-$prompt) — Creates an MCP prompt primitive for defining reusable prompt templates.
- [`$resource`](/docs/primitives-$resource) — Creates an MCP resource primitive for exposing read-only data.
- [`$tool`](/docs/primitives-$tool) — Creates an MCP tool primitive for defining callable functions.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### McpServerProvider

Core MCP server provider that handles protocol messages.

This provider maintains registries of tools, resources, and prompts,
and routes incoming JSON-RPC requests to the appropriate handlers.

It is transport-agnostic - actual communication is handled by
transport providers like StdioMcpTransport or SseMcpTransport.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MCP_SSE_PATH` | text | /mcp | Path for MCP SSE endpoint |
