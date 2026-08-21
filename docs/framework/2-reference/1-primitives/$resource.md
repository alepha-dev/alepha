# $resource

## Import

```typescript
import { $resource } from "alepha/mcp";
```

## Overview

Creates an MCP resource primitive for exposing read-only data.

Resources represent any kind of data that an LLM might want to read,
such as files, database records, API responses, or computed data.

**Key Features**

- URI-based identification for resources
- Support for text and binary content
- MIME type specification
- Lazy loading via handler function

## Options

| Option        | Type                            | Required | Description                                                                       |
| ------------- | ------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `uri`         | `string`                        | Yes      | The URI that identifies this resource                                             |
| `name`        | `string`                        | No       | Human-readable name for the resource                                              |
| `title`       | `string`                        | No       | Human-friendly display title (spec 2025-11-25)                                    |
| `icons`       | `McpIcon[]`                     | No       | Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973).                |
| `description` | `string`                        | No       | Description of what this resource contains                                        |
| `mimeType`    | `string`                        | No       | MIME type of the resource content                                                 |
| `annotations` | `McpAnnotations`                | No       | Audience / priority / `lastModified` hints (spec 2025-03-26+)                     |
| `_meta`       | `Record&lt;string, unknown&gt;` | No       | Arbitrary metadata passed through to clients on the descriptor (spec 2025-06-18+) |
| `handler`     | `ResourceHandler`               | Yes      | Handler function that returns the resource content                                |

## Examples

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
