# $tool

> Creates an MCP tool primitive for defining callable functions.

## Import

```typescript
import { $tool } from "alepha/mcp";
```

## Overview

Creates an MCP tool primitive for defining callable functions.

Tools are the primary way for LLMs to interact with external systems through MCP.
Each tool has a name, description, typed parameters, and a handler function.

**Key Features**
- Full TypeScript inference for parameters and results
- Automatic schema validation using TypeBox
- JSON Schema generation for MCP protocol
- Integration with MCP server provider

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | The name of the tool |
| `description` | `string` | Yes | A human-readable description of what the tool does |
| `schema` | `T` | No | TypeBox schema defining the tool's parameters and result type |
| `handler` | `Object` | Yes | The handler function that executes when the tool is called |

## Examples

```ts
class CalculatorTools {
  add = $tool({
    description: "Add two numbers together",
    schema: {
      params: t.object({
        a: t.number(),
        b: t.number(),
      }),
      result: t.number(),
    },
    handler: async ({ params }) => {
      return params.a + params.b;
    },
  });

  greet = $tool({
    description: "Generate a greeting message",
    schema: {
      params: t.object({
        name: t.text(),
      }),
      result: t.text(),
    },
    handler: async ({ params }) => {
      return `Hello, ${params.name}!`;
    },
  });
}
```

