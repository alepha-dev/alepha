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

**`$tool` or `$action({ mcp: true })`?** A feature that already is an
`$action` becomes an MCP tool with its `mcp` option, its input then being
`{ params, query, body }`. Keep a `$tool` for a tool with no HTTP surface,
a flat input an agent writes naturally, raw MCP content, or a handler that
reads `context` (elicitation, progress).

A `$tool` can also be offered to the in-app assistant as it is:
`$ai({ tools: [this.tools.add] })` (`alepha/ai`). The model sees its
description and `schema.params`, the call runs as the turn's user, and it
waits for the user's confirmation unless `annotations.readOnlyHint` is
true.

## Options

| Option        | Type                      | Required | Description                                                                       |
| ------------- | ------------------------- | -------- | --------------------------------------------------------------------------------- |
| `name`        | `string`                  | No       | The name of the tool                                                              |
| `title`       | `string`                  | No       | Human-friendly display title (spec 2025-11-25)                                    |
| `description` | `string`                  | Yes      | A human-readable description of what the tool does                                |
| `annotations` | `McpToolAnnotations`      | No       | Behavior hints (spec 2025-03-26+)                                                 |
| `icons`       | `McpIcon[]`               | No       | Icons surfaced in client tool palettes / picker UIs (spec 2025-11-25).            |
| `_meta`       | `Record<string, unknown>` | No       | Arbitrary metadata passed through to clients on the descriptor (spec 2025-06-18+) |
| `schema`      | `T`                       | No       | Zod schema defining the tool's parameters and result type                         |
| `use`         | `TUse`                    | No       | Middlewares run on every call, outermost first, before the handler                |
| `timeout`     | `DurationLike \| false`   | No       | How long a call may run, middlewares and handler, before it fails                 |
| `handler`     | `Object`                  | Yes      | The handler function that executes when the tool is called                        |

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
