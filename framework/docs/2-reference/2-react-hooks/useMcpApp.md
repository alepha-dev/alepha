# useMcpApp

## Import

```typescript
import { useMcpApp } from "alepha/mcp/view";
```

## Overview

The MCP Apps call this view shows: the tool's input and result as the host
sends them, its theme, and the requests a view may make back.

```tsx
const SalesChart = () => {
  const app = useMcpApp();
  const total = app.result?.structuredContent?.total;
  return (
    <button onClick={() => app.callTool("refresh_sales")}>
      {total ?? "Loading"}
    </button>
  );
};
export default SalesChart;
```

Only inside a view mounted by `McpView.mount`, which `alepha build` and
`alepha dev` do for a `$tool({ ui: { view } })`, or under an explicit
`bridge`.
