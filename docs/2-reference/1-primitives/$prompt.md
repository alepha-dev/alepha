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

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | The name of the prompt |
| `description` | `string` | No | Description of what this prompt does |
| `args` | `T` | No | TypeBox schema defining the prompt arguments |
| `handler` | `Object` | Yes | Handler function that generates the prompt messages |

## Examples

```ts
class Prompts {
  greeting = $prompt({
    description: "Generate a personalized greeting",
    args: t.object({
      name: t.text({ description: "Name of the person to greet" }),
      style: t.optional(t.enum(["formal", "casual"])),
    }),
    handler: async ({ args }) => [
      {
        role: "user",
        content: args.style === "formal"
          ? `Please greet ${args.name} in a formal manner.`
          : `Say hi to ${args.name}!`,
      },
    ],
  });

  codeReview = $prompt({
    description: "Request a code review",
    args: t.object({
      code: t.text({ description: "The code to review" }),
      language: t.text({ description: "Programming language" }),
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

