# Alepha - Mcp View

## Installation

Part of the `alepha` package. Import from `alepha/mcp/view`.

```bash
npm install alepha
```

## Overview

The browser side of an MCP Apps view: what a `$tool({ ui: { view } })`
component runs inside the host's iframe.

**Features:**

- `useMcpApp()`: the tool's input and result as the host sends them, the
  host's theme, and `callTool`, `openLink`, `sendMessage`
- `McpAppBridge`: the `postMessage` JSON-RPC of `io.modelcontextprotocol/ui`
  (2026-01-26), usable without React
- `McpView.mount`: the entry `alepha build` and `alepha dev` generate
  for each view; follows the host's theme on `<html>` and reports the
  view's size

## API Reference

### React Hooks

- [`useMcpApp`](/docs/reference-react-hooks-usemcpapp) - The MCP Apps call this view shows: the tool's input and result as the host
