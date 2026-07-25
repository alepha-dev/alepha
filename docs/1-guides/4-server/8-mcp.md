# MCP Server

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) lets AI assistants call your application's tools, read its resources, and use its prompt templates over a standard JSON-RPC protocol.

Alepha ships with first-class MCP support. You define tools, resources, and prompts with the same primitive pattern you already use for routes and actions. The framework handles protocol negotiation, schema validation, and transport.

## Quick Start

```typescript
import { z, run } from "alepha";
import { AlephaMcp, $tool, $resource } from "alepha/mcp";
import { AlephaServer } from "alepha/server";

class MyMcp {
  add = $tool({
    description: "Add two numbers",
    schema: {
      params: z.object({
        a: z.number(),
        b: z.number(),
      }),
      result: z.number(),
    },
    handler: async ({ params }) => params.a + params.b,
  });

  readme = $resource({
    uri: "docs://readme",
    description: "Project README",
    mimeType: "text/markdown",
    handler: async () => ({
      text: "# My App\nWelcome to my application.",
    }),
  });
}

run(
  Alepha.create()
    .with(AlephaServer)
    .with(AlephaMcp)
    .with(MyMcp),
);
```

Your MCP server is now available at `GET /mcp` (SSE) and `POST /mcp` (JSON-RPC).

## Three Primitives

MCP defines three types of capabilities. Each maps to an Alepha primitive.

### $tool -- Callable Functions

Tools let an AI assistant perform actions: query a database, create records, call external APIs.

```typescript
import { $tool } from "alepha/mcp";

class TaskTools {
  protected readonly tasks = $inject(TaskController);

  task_list = $tool({
    description: "List tasks. Filter by status or search by title.",
    schema: {
      params: z.object({
        status: z.enum(["new", "accepted", "completed"]).optional(),
        search: z.text({ description: "Search by title" }).optional(),
        limit: z.integer().min(1).max(100).optional(),
      }),
      result: z.object({
        tasks: z.array(z.object({
          id: z.integer(),
          title: z.text(),
          status: z.text(),
        })),
        total: z.integer(),
      }),
    },
    handler: async ({ params }) => {
      const result = await this.tasks.list({
        status: params.status,
        search: params.search,
        limit: params.limit ?? 20,
      });
      return { tasks: result.items, total: result.total };
    },
  });

  task_create = $tool({
    description: "Create a new task.",
    schema: {
      params: z.object({
        title: z.text(),
        description: z.text().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
      }),
      result: z.object({
        id: z.integer(),
        title: z.text(),
      }),
    },
    handler: async ({ params }) => {
      return await this.tasks.create(params);
    },
  });
}
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `description` | `string` | Required. Tells the AI what the tool does. |
| `schema.params` | `TObject` | Zod schema for input parameters. |
| `schema.result` | `TSchema` | Zod schema for the return value. |
| `handler` | `function` | Receives `{ params, context }`. Returns the result. |
| `name` | `string` | Override the tool name. Defaults to the property key. |

Parameters and results are validated automatically. If validation fails, the client receives a JSON-RPC error.

**Returning images or binary content:** when a tool needs to hand the client a screenshot, a chart, or any non-JSON payload, omit `schema.result` and return raw MCP content blocks instead — `{ content: [...] }`, where each block is `{ type: "text", text }`, `{ type: "image", data, mimeType }` (base64), `{ type: "audio", data, mimeType }`, or a resource link. The blocks are passed through to the client verbatim, so an image block renders inline in clients that support it.

```typescript
screenshot = $tool({
  description: "Capture the current page as a PNG.",
  // No `schema.result` — the handler returns content blocks directly.
  handler: async ({ params }) => {
    const png = await this.capture(params.url); // Buffer
    return {
      content: [
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ],
    };
  },
});
```

A tool that declares `schema.result` always goes through the structured/JSON path, so a JSON result that happens to contain a `content` array is never mistaken for raw content.

### $resource -- Read-Only Data

Resources expose data that an AI can read but not modify: configuration, documentation, database snapshots.

```typescript
import { $resource } from "alepha/mcp";

class Resources {
  projectList = $resource({
    uri: "app://projects",
    description: "All projects the user has access to.",
    mimeType: "application/json",
    handler: async () => {
      const projects = await this.projectController.list();
      return {
        text: JSON.stringify(projects, null, 2),
      };
    },
  });

  logo = $resource({
    uri: "app://logo",
    mimeType: "image/png",
    handler: async () => ({
      blob: await fs.readFile("logo.png"),
    }),
  });
}
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `uri` | `string` | Required. Unique identifier (e.g. `app://projects`, `file:///readme`). |
| `description` | `string` | What this resource contains. |
| `mimeType` | `string` | Content type. Defaults to `text/plain`. |
| `handler` | `function` | Returns `{ text }` for text content or `{ blob }` for binary. |
| `name` | `string` | Display name. Defaults to the property key. |

### $prompt -- Message Templates

Prompts define reusable conversation templates with typed arguments.

```typescript
import { $prompt } from "alepha/mcp";

class Prompts {
  codeReview = $prompt({
    description: "Request a code review",
    args: z.object({
      code: z.text({ description: "The code to review" }),
      language: z.text({ description: "Programming language" }),
    }),
    handler: async ({ args }) => [
      {
        role: "user",
        content: `Review this ${args.language} code:\n\n\`\`\`${args.language}\n${args.code}\n\`\`\``,
      },
    ],
  });
}
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `description` | `string` | What this prompt does. |
| `args` | `TObject` | Zod schema for template arguments. |
| `handler` | `function` | Returns an array of `{ role, content }` messages. |
| `name` | `string` | Override the prompt name. Defaults to the property key. |

## Wiring It Up

Register the `AlephaMcp` module and your tool/resource/prompt classes:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServer } from "alepha/server";
import { AlephaMcp } from "alepha/mcp";

run(
  Alepha.create()
    .with(AlephaServer)
    .with(AlephaMcp)
    .with(TaskTools)
    .with(Resources)
    .with(Prompts),
);
```

Primitives auto-register with the MCP server when instantiated. No manual wiring needed.

For larger apps, group MCP classes into a module:

```typescript
import { $module } from "alepha";
import { SseMcpTransport } from "alepha/mcp";

export const MyAppMcp = $module({
  name: "myapp.mcp",
  services: [SseMcpTransport, TaskTools, ProjectTools, Resources],
});
```

Then register the module alongside your other modules:

```typescript
run(
  Alepha.create()
    .with(AlephaServer)
    .with(MyAppApi)
    .with(MyAppMcp),
);
```

## Using DI in Tools

Tools, resources, and prompts are regular Alepha classes. Use `$inject()` to access any service:

```typescript
class PostTools {
  protected posts = $repository(postEntity);
  protected markdown = $inject(MarkdownProvider);

  post_create = $tool({
    description: "Create a new blog post.",
    schema: {
      params: z.object({
        title: z.text(),
        content: z.text({ description: "Markdown content" }),
        tags: z.array(z.text()).optional(),
      }),
    },
    handler: async ({ params }) => {
      const html = this.markdown.render(params.content);
      return await this.posts.create({
        title: params.title,
        content: params.content,
        contentHtml: html,
        tags: params.tags ?? [],
      });
    },
  });
}
```

## Schemas

Zod schemas on tools serve double duty:

1. **Runtime validation** -- params are validated before your handler runs, results are validated before being sent back
2. **JSON Schema generation** -- the MCP protocol advertises your tool's input schema so AI clients know what to send

Add `description` to individual fields to help the AI understand what each parameter does:

```typescript
schema: {
  params: z.object({
    project: z.integer().describe("Project ID").optional(),
    project_name: z.text({ description: "Case-insensitive project name" }).optional(),
    limit: z.integer()
      .min(1)
      .max(100)
      .describe("Max results to return (default: 20)")
      .optional(),
  }),
}
```

Extract shared schemas to keep tool definitions clean:

```typescript
// schemas/common.ts
export const projectParamsSchema = z.object({
  project: z.integer().describe("Project ID").optional(),
  project_name: z.text({ description: "Project name (case-insensitive)" }).optional(),
});

// tools/TaskTools.ts
import { projectParamsSchema } from "../schemas/common.ts";

task_list = $tool({
  description: "List tasks for a project.",
  schema: {
    params: projectParamsSchema.extend({
      status: z.enum(["new", "accepted", "completed"]).optional(),
    }),
  },
  handler: async ({ params }) => { /* ... */ },
});
```

## Context

Every handler receives an optional `context` with HTTP headers and custom data. Use it for authentication or multi-tenancy:

```typescript
task_list = $tool({
  description: "List user tasks.",
  handler: async ({ params, context }) => {
    const auth = context?.headers?.authorization;
    if (!auth?.toString().startsWith("Bearer ")) {
      throw new McpUnauthorizedError("Missing authentication");
    }
    // ...
  },
});
```

## Error Handling

Throw errors in handlers and they are returned as tool results the AI can read:

```typescript
import { McpUnauthorizedError, McpForbiddenError } from "alepha/mcp";

handler: async ({ params, context }) => {
  if (!context?.headers?.authorization) {
    throw new McpUnauthorizedError("Missing token");
  }
  const project = await this.projects.findById(params.id);
  if (!project) {
    throw new NotFoundError(`Project ${params.id} not found`);
  }
  return project;
}
```

Available error classes:

| Error | Code | When to use |
|-------|------|-------------|
| `McpUnauthorizedError` | -32001 | Missing or invalid credentials |
| `McpForbiddenError` | -32003 | Authenticated but not allowed |
| `McpToolNotFoundError` | -32601 | Unknown tool name |
| `McpResourceNotFoundError` | -32601 | Unknown resource URI |
| `McpPromptNotFoundError` | -32601 | Unknown prompt name |
| `McpInvalidParamsError` | -32602 | Bad parameters |

## Transport

The default transport uses **Server-Sent Events** (SSE):

- `GET /mcp` -- SSE stream for server-to-client messages
- `POST /mcp` -- JSON-RPC endpoint for client-to-server requests

The SSE path is configurable:

```typescript
import { mcpSseOptions } from "alepha/mcp";

alepha.store.set(mcpSseOptions, { path: "/api/mcp" });
```

## Naming Convention

Use `entity_action` for tool names (snake_case with underscore separator):

```
project_list, project_info
task_create, task_update, task_complete
chapter_start, chapter_close, chapter_changelog
```

This groups related tools together and reads naturally in AI conversations.

## Project Structure

For apps with multiple MCP tools, organize by domain:

```
src/
  mcp/
    index.ts              # $module definition
    schemas/
      common.ts           # Shared schemas (pagination, project params)
      taskSchemas.ts
      projectSchemas.ts
    tools/
      TaskTools.ts
      ProjectTools.ts
    resources/
      ProjectResources.ts
```
