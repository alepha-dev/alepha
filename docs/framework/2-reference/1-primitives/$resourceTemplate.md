# $resourceTemplate

## Import

```typescript
import { $resourceTemplate } from "alepha/mcp";
```

## Overview

Creates an MCP resource template — a resource addressed by a *pattern*
rather than a fixed URI.

{@link $resource} covers data that lives at one known address. A template
covers a family of them: every folio, every user, every file under a root.
Without it, parameterized data can only be exposed as a tool call, and the
client loses the ability to address it by URI or embed it as a
`resource_link`.

**URI templates (RFC 6570)**

Two forms are supported, which is what MCP servers use in practice:

- `{var}` — simple expansion. Matches one segment; will not span `/`.
  The captured value is percent-decoded.
- `{+var}` — reserved expansion. Matches greedily, `/` included. Use it for
  trailing paths (`file:///{+path}`).

Any other operator (`#`, `.`, `/`, `;`, `?`, `&`) or modifier (`*`, `:3`)
throws at registration rather than compiling into a pattern that quietly
never matches.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `uriTemplate` | `string` | Yes | The RFC 6570 URI template this resource answers for. |
| `name` | `string` | No | Human-readable name |
| `title` | `string` | No | Human-friendly display title (spec 2025-11-25) |
| `description` | `string` | No | Description of what this family of resources contains. |
| `mimeType` | `string` | No | MIME type of the resource content. |
| `icons` | `McpIcon[]` | No | Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973). |
| `annotations` | `McpAnnotations` | No | Audience / priority / `lastModified` hints (spec 2025-03-26+). |
| `_meta` | `Record&lt;string, unknown&gt;` | No | Arbitrary metadata passed through to clients on the descriptor (spec 2025-06-18+). |
| `variables` | `T` | No | Zod schema validating the variables extracted from a concrete URI |
| `handler` | `Object` | Yes | Handler returning the content for one concrete URI. |
| `complete` | `CompletionHandler` | No | Optional autocompletion for the template's URI variables, served over `completion/complete` |

## Examples

```ts
class FolioResources {
  folio = $resourceTemplate({
    uriTemplate: "folio://{projectId}/{shortId}",
    description: "A folio, by project and short id",
    mimeType: "text/markdown",
    variables: z.object({
      projectId: z.text(),
      shortId: z.text(),
    }),
    handler: async ({ variables }) => ({
      text: await this.folios.read(variables.projectId, variables.shortId),
    }),
  });
}
```

