# Alepha - Mcp

## Installation

Part of the `alepha` package. Import from `alepha/mcp`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.18.0 | node, bun|

Model Context Protocol for AI tool integration.

**Features:**
- MCP resource definitions
- MCP tool definitions
- MCP prompt definitions
- JSON-RPC protocol
- SSE and Stdio transports

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $prompt()

Creates an MCP prompt primitive for defining reusable prompt templates.

Prompts allow you to define templated messages that can be filled in
with arguments at runtime. They're useful for creating consistent
interaction patterns.

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

#### $resource()

Creates an MCP resource primitive for exposing read-only data.

Resources represent any kind of data that an LLM might want to read,
such as files, database records, API responses, or computed data.

**Key Features**
- URI-based identification for resources
- Support for text and binary content
- MIME type specification
- Lazy loading via handler function

```ts
class ProjectResources {
  readme = $resource({
    uri: "file:///readme",
    description: "Project README file",
    mimeType: "text/markdown",
    handler: async () => ({
      text: await fs.readFile("README.md", "utf-8"),
    }),
  });

  config = $resource({
    uri: "config://app",
    name: "Application Configuration",
    mimeType: "application/json",
    handler: async () => ({
      text: JSON.stringify(this.configService.getConfig()),
    }),
  });
}
```

#### $tool()

Creates an MCP tool primitive for defining callable functions.

Tools are the primary way for LLMs to interact with external systems through MCP.
Each tool has a name, description, typed parameters, and a handler function.

**Key Features**
- Full TypeScript inference for parameters and results
- Automatic schema validation using TypeBox
- JSON Schema generation for MCP protocol
- Integration with MCP server provider

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

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### McpServerProvider

Core MCP server provider that handles protocol messages.

This provider maintains registries of tools, resources, and prompts,
and routes incoming JSON-RPC requests to the appropriate handlers.

It is transport-agnostic - actual communication is handled by
transport providers like StdioMcpTransport or SseMcpTransport.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MCP_SSE_PATH` | text | /mcp | Path for MCP SSE endpoint |
