# Alepha - Mcp

## Installation

Part of the `alepha` package. Import from `alepha/mcp`.

```bash
npm install alepha
```

## Overview

Model Context Protocol for AI tool integration.

**Features:**

- MCP resource definitions (fixed URIs and RFC 6570 templates)
- MCP tool definitions
- MCP prompt definitions
- JSON-RPC protocol
- Streamable HTTP transport (spec 2025-03-26+)
- stdio transport (local servers: Claude Desktop, Claude Code)

## API Reference

### Primitives

- [`$prompt`](/docs/reference-primitives-$prompt) - Creates an MCP prompt primitive for defining reusable prompt templates.
- [`$resource`](/docs/reference-primitives-$resource) - Creates an MCP resource primitive for exposing read-only data.
- [`$resourceTemplate`](/docs/reference-primitives-$resourcetemplate) - Creates an MCP resource template - a resource addressed by a _pattern_
- [`$tool`](/docs/reference-primitives-$tool) - Creates an MCP tool primitive for defining callable functions.

### Providers

- [`McpServerProvider`](/docs/reference-providers-mcpserverprovider) - Core MCP server provider that handles protocol messages.
