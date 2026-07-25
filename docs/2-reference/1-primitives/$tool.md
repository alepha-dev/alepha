# $tool

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
- Automatic schema validation using Zod
- JSON Schema generation for MCP protocol
- Integration with MCP server provider

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | The name of the tool |
| `title` | `string` | No | Human-friendly display title (spec 2025-11-25) |
| `description` | `string` | Yes | A human-readable description of what the tool does |
| `annotations` | `McpToolAnnotations` | No | Behavior hints (spec 2025-03-26+) |
| `icons` | `McpIcon[]` | No | Icons surfaced in client tool palettes / picker UIs (spec 2025-11-25). |
| `schema` | `T` | No | Zod schema defining the tool's parameters and result type |
| `handler` | `Object` | Yes | The handler function that executes when the tool is called |

## Examples

```ts
class CalculatorTools {
  add = $tool({
    description: "Add two numbers together",
    schema: {
      params: z.object({
        a: z.number(),
        b: z.number(),
      }),
      result: z.number(),
    },
    handler: async ({ params }) => {
      return params.a + params.b;
    },
  });

  greet = $tool({
    description: "Generate a greeting message",
    schema: {
      params: z.object({
        name: z.text(),
      }),
      result: z.text(),
    },
    handler: async ({ params }) => {
      return `Hello, ${params.name}!`;
    },
  });
}
```

