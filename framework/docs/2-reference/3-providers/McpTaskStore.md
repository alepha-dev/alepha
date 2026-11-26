# McpTaskStore

## Import

```typescript
import { McpTaskStore } from "alepha/mcp";
```

## Overview

Where the Tasks extension (`io.modelcontextprotocol/tasks`) keeps a task:
a `tools/call` answered later, polled with `tasks/get`.

`alepha/mcp` defines the contract and provides no implementation: a task
must outlive the request and the process that created it, which an
in-memory map cannot promise. Bind one explicitly, the `$job`-backed
`JobMcpTaskStore` of `alepha/api/jobs` being the one the framework ships:

```ts
alepha.with({ provide: McpTaskStore, use: JobMcpTaskStore });
```

With none bound, the server does not declare the extension and every
tool answers plainly.
