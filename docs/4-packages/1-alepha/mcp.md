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

- [`$prompt`](/docs/reference-primitives-$prompt) — Creates an MCP prompt primitive for defining reusable prompt templates.
- [`$resource`](/docs/reference-primitives-$resource) — Creates an MCP resource primitive for exposing read-only data.
- [`$tool`](/docs/reference-primitives-$tool) — Creates an MCP tool primitive for defining callable functions.

### Providers

- [`McpServerProvider`](/docs/reference-providers-mcpserverprovider) — Core MCP server provider that handles protocol messages.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MCP_SSE_PATH` | text | /mcp | Path for MCP SSE endpoint |
