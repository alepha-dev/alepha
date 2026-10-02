# $prompt

## Import

```typescript
import { $prompt } from "alepha/mcp";
```

## Overview

Creates an MCP prompt primitive for defining reusable prompt templates.

Prompts allow you to define templated messages that can be filled in
with arguments at runtime. They're useful for creating consistent
interaction patterns.

## Options

| Option        | Type                            | Required | Description                                                                       |
| ------------- | ------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `name`        | `string`                        | No       | The name of the prompt                                                            |
| `title`       | `string`                        | No       | Human-friendly display title (spec 2025-11-25)                                    |
| `description` | `string`                        | No       | Description of what this prompt does                                              |
| `icons`       | `McpIcon[]`                     | No       | Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973).                |
| `_meta`       | `Record&lt;string, unknown&gt;` | No       | Arbitrary metadata passed through to clients on the descriptor (spec 2025-06-18+) |
| `args`        | `T`                             | No       | Zod schema defining the prompt arguments                                          |
| `handler`     | `Object`                        | Yes      | Handler function that generates the prompt messages                               |
| `complete`    | `CompletionHandler`             | No       | Optional argument autocompletion, served over `completion/complete`               |

## Examples

```ts
class Prompts {
  greeting = $prompt({
    description: "Generate a personalized greeting",
    args: z.object({
      name: z.text({ description: "Name of the person to greet" }),
      style: z.enum(["formal", "casual"]).optional(),
    }),
    handler: async ({ args }) => [
      {
        role: "user",
        content:
          args.style === "formal"
            ? `Please greet ${args.name} in a formal manner.`
            : `Say hi to ${args.name}!`,
      },
    ],
  });

  codeReview = $prompt({
    description: "Request a code review",
    args: z.object({
      code: z.text({ description: "The code to review" }),
      language: z.text({ description: "Programming language" }),
    }),
    handler: async ({ args }) => [
      {
        role: "user",
        content: `Please review this ${args.language} code:\n\n${args.code}`,
      },
    ],
  });
}
```
