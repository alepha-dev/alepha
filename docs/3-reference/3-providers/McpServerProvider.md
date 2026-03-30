# McpServerProvider

## Import

```typescript
import { McpServerProvider } from "alepha/mcp";
```

## Overview

Core MCP server provider that handles protocol messages.

This provider maintains registries of tools, resources, and prompts,
and routes incoming JSON-RPC requests to the appropriate handlers.

It is transport-agnostic - actual communication is handled by
transport providers like StdioMcpTransport or SseMcpTransport.

