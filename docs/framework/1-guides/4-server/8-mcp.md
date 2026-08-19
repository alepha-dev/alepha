# MCP Server

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) lets AI assistants call your application's tools, read its resources, and use its prompt templates over a standard JSON-RPC protocol.

Alepha ships with first-class MCP support. You define tools, resources, and prompts with the same primitive pattern you already use for routes and actions. The framework handles protocol negotiation, schema validation, and transport.

## Quick Start

```typescript
import { Alepha, z, run } from "alepha";
import { AlephaMcp, StreamableHttpMcpTransport, $tool, $resource } from "alepha/mcp";
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
    .with(StreamableHttpMcpTransport)
    .with(MyMcp),
);
```

Your MCP server is now available at `POST /mcp` (Streamable HTTP, JSON-RPC). Transports are opt-in - `AlephaMcp` provides the server; wiring `StreamableHttpMcpTransport` exposes it over HTTP.

## Three Primitives

MCP defines three types of capabilities. Each maps to an Alepha primitive.

### $tool: Callable Functions

Tools let an AI assistant perform actions: query a database, create records, call external APIs.

```typescript
import { $tool } from "alepha/mcp";

class TaskTools {
  // a plain service with its own list() contract - to expose an existing
  // $action instead, call it with { query: { ... } } and map its page shape
  protected readonly tasks = $inject(TaskService);

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
| `schema.params` | `ZObject` | Zod schema for input parameters. |
| `schema.result` | `ZType` | Zod schema for the return value. |
| `handler` | `function` | Receives `{ params, context }`. Returns the result. |
| `name` | `string` | Override the tool name. Defaults to the property key. |

Parameters and results are validated automatically. If validation fails, the client receives a JSON-RPC error.

**Returning images or binary content:** when a tool needs to hand the client a screenshot, a chart, or any non-JSON payload, omit `schema.result` and return raw MCP content blocks instead - `{ content: [...] }`, where each block is `{ type: "text", text }`, `{ type: "image", data, mimeType }` (base64), `{ type: "audio", data, mimeType }`, or a resource link. The blocks are passed through to the client verbatim, so an image block renders inline in clients that support it.

```typescript
screenshot = $tool({
  description: "Capture the current page as a PNG.",
  // No `schema.result` - the handler returns content blocks directly.
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

### $resource: Read-Only Data

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

### $resourceTemplate: Parameterized Resources

`$resource` addresses one thing at a fixed URI. `$resourceTemplate` addresses a
*family* of them, so an AI can read `folio://1/86` without you registering every
folio up front:

```typescript
import { $resourceTemplate } from "alepha/mcp";

class FolioResources {
  folio = $resourceTemplate({
    uriTemplate: "folio://{projectId}/{shortId}",
    description: "A folio, by project and short id.",
    mimeType: "text/markdown",
    variables: z.object({
      projectId: z.text(),
      shortId: z.text(),
    }),
    handler: async ({ variables }) => {
      const folio = await this.folios.find(variables.projectId, variables.shortId);
      // `undefined` means "well-formed URI, nothing there" -> not found.
      return folio ? { text: folio.content } : undefined;
    },
  });
}
```

Templates are advertised on `resources/templates/list`, and `resources/read`
falls through to them when no fixed resource matches the URI exactly. A concrete
`$resource` always wins over a template that also matches - registering
`db://users/me` alongside `db://users/{id}` does what you would expect.

**URI templates.** Two RFC 6570 forms are supported:

| Form | Matches | Use for |
|------|---------|---------|
| `{var}` | one segment, never spanning `/`; percent-decoded | ids, slugs |
| `{+var}` | greedy, `/` included; not decoded | trailing paths (`file:///{+path}`) |

Any other operator (`{?query}`, `{#frag}`, `{/path*}`) throws when the container
wires the primitive up, rather than compiling into a pattern that silently never
matches.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `uriTemplate` | `string` | Required. The RFC 6570 pattern. |
| `variables` | `ZObject` | Validates the extracted values. A failure is `-32602`, so a malformed URI never reaches the handler. |
| `handler` | `function` | Receives `{ variables, uri, context }`. Returns `{ text }`, `{ blob }`, or `undefined` for not found. |
| `description` | `string` | What this family of resources contains. |
| `mimeType` | `string` | Content type. Defaults to `text/plain`. |
| `name` | `string` | Display name. Defaults to the property key. |

### $prompt: Message Templates

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
| `args` | `ZObject` | Zod schema for template arguments. |
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
    .with(StreamableHttpMcpTransport)
    .with(TaskTools)
    .with(Resources)
    .with(Prompts),
);
```

Primitives auto-register with the MCP server when instantiated - only the transport needs explicit wiring.

For larger apps, group MCP classes into a module:

```typescript
import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";

export const MyAppMcp = $module({
  name: "myapp.mcp",
  services: [StreamableHttpMcpTransport, TaskTools, ProjectTools, Resources],
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

1. **Runtime validation**: params are validated before your handler runs, results are validated before being sent back
2. **JSON Schema generation**: the MCP protocol advertises your tool's input schema so AI clients know what to send

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

`context.data` carries whatever the transport put there. By default that is the
authenticated user (`request.user`), so a tool can read the caller without
resolving it again:

```typescript
task_list = $tool({
  description: "List the caller's tasks.",
  handler: async ({ context }) => {
    const user = context?.data as UserAccountToken | undefined;
    if (!user) {
      throw new McpUnauthorizedError("Authentication required.");
    }
    return this.tasks.findMany({ where: { ownerId: user.id } });
  },
});
```

To carry anything else - a tenant, a project scope, a request id - override
`buildContext` on the transport and register the subclass:

```typescript
import { StreamableHttpMcpTransport } from "alepha/mcp";

class MyMcpTransport extends StreamableHttpMcpTransport {
  protected buildContext(request: any) {
    return {
      ...super.buildContext(request),
      data: { user: request.user, tenant: request.headers.host },
    };
  }
}

alepha.with({ provide: StreamableHttpMcpTransport, use: MyMcpTransport });
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

An ordinary `Error` becomes a **tool execution error** (`isError: true` with the
message as text) so the model can read it and self-correct. An `McpError`
subclass is a **JSON-RPC protocol error** instead, carrying its code - use one
when the caller cannot fix the problem by changing its arguments.

Available error classes:

| Error | Code | When to use |
|-------|------|-------------|
| `McpUnauthorizedError` | -32001 | Missing or invalid credentials |
| `McpForbiddenError` | -32003 | Authenticated but not allowed |
| `McpToolNotFoundError` | -32602 | Unknown tool name |
| `McpResourceNotFoundError` | -32602 | Unknown resource URI |
| `McpPromptNotFoundError` | -32602 | Unknown prompt name |
| `McpInvalidParamsError` | -32602 | Bad parameters |
| `McpToolOutputError` | -32603 | A tool returned a value violating its own `schema.result` (server raised, not thrown by you) |

Unknown names are `-32602 Invalid params`, not `-32601 Method not found`:
`-32601` says the *method* `tools/call` does not exist, which a client can read
as "this server has no tools at all".

Input validation stays a tool execution error - the model sent bad arguments and
can retry. Output validation does not: a handler that breaks its own
`schema.result` is a server bug, so it is logged and returned as `-32603`,
never as a validation error pointing at an input path the caller never sent.

## Transport

Transports are opt-in: wire the one you need.

### Streamable HTTP

**Streamable HTTP** (MCP spec 2025-03-26+), a single endpoint:

- `POST /mcp`: JSON-RPC endpoint; single responses return `application/json`
- `GET /mcp`: returns `405 Method Not Allowed` (the legacy two-endpoint SSE pattern is deliberately not served)

The path is configurable (keep it outside `/api`, which belongs to the `$action` dispatcher):

```typescript
import { mcpStreamableHttpOptions } from "alepha/mcp";

alepha.store.mut(mcpStreamableHttpOptions, (o) => ({ ...o, path: "/my-mcp" }));
```

### stdio: local servers

Claude Desktop, Claude Code and every other *local* client launch the server as
a subprocess and speak newline-delimited JSON-RPC over its pipes:

```typescript
import { Alepha, run } from "alepha";
import { AlephaMcp, StdioMcpTransport } from "alepha/mcp";

run(Alepha.create().with(AlephaMcp).with(StdioMcpTransport).with(MyTools));
```

Then point the client at the built binary:

```json
{
  "mcpServers": {
    "my-app": {
      "command": "node",
      "args": ["/path/to/my-app/dist/main.js"],
      "env": { "DATABASE_URL": "..." }
    }
  }
}
```

**stdout belongs to the protocol.** A single stray `console.log` - yours,
Alepha's, or a dependency's - lands inside a JSON-RPC message and corrupts the
stream permanently. While this transport runs it redirects `process.stdout` to
stderr and keeps the real stdout for protocol messages only, so your logs still
appear (on stderr, where the spec wants them) and cannot break the stream.

A stdio server takes credentials from its environment rather than the HTTP
authorization framework, so `requireAuth` has no meaning there - whoever
launched the process is the caller.

### Progress on long calls

When a client attaches a `_meta.progressToken` to a request, the HTTP response
upgrades to `text/event-stream`: progress notifications as they happen, then the
final response. Without a token, nothing changes - the response is plain JSON.

```typescript
index_repo = $tool({
  description: "Index every file in the repository.",
  handler: async ({ context }) => {
    const files = await this.files.list();
    for (const [i, file] of files.entries()) {
      await this.index(file);
      context?.reportProgress?.(i + 1, files.length, `Indexed ${file.name}`);
    }
    return { indexed: files.length };
  },
});
```

`reportProgress` is absent when the client did not ask for progress, so call it
through `?.`. The same context carries a `signal` that aborts when the client
cancels - pass it to `fetch`, DB queries and anything else that accepts one,
or a tool nobody is waiting for keeps running to completion.

### Paginated lists

`tools/list`, `resources/list`, `resources/templates/list` and `prompts/list`
page through an opaque cursor. The default page size is 100; lower it when the
descriptor blob is what you are trying to keep out of the model's context:

```typescript
alepha.inject(McpServerProvider).pageSize = 25;
```

## Naming Convention

Use `entity_action` for tool names (snake_case with underscore separator):

```txt
project_list, project_info
task_create, task_update, task_complete
chapter_start, chapter_close, chapter_changelog
```

This groups related tools together and reads naturally in AI conversations.

## Project Structure

For apps with multiple MCP tools, organize by domain:

```txt
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
