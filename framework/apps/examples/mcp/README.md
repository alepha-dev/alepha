# mcp-example

An MCP server with one MCP Apps view. `sales_report` answers every client in
text and JSON; a host that supports `io.modelcontextprotocol/ui` also renders
`src/views/SalesChart.tsx` in an iframe, which follows the host's theme and
calls the tool back for another quarter.

The view is declared next to its tool:

```ts
sales_report = $tool({
  description: "Sales per region for a quarter of 2026",
  ui: { view: () => import("./views/SalesChart.tsx") },
  handler: async ({ params }) => this.report(params.quarter),
});
```

and reads the call with `useMcpApp()` from `alepha/mcp/view`.

## Run it

```bash
yarn w mcp-example dev      # MCP endpoint at http://localhost:3317/mcp
yarn w mcp-example build    # dist/, a node and a workerd slice
```

`alepha build` builds the view into one HTML document and embeds it in each
server slice, so the server bundle holds neither React nor the component.
Under `alepha dev` the view loads its modules from the dev server.

`src/__tests__/build.spec.ts` builds the app and checks both.
