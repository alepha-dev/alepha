# ReactDomServerProvider

## Import

```typescript
import { ReactDomServerProvider } from "alepha/react/router";
```

## Overview

The renderer half of React, loaded only once something actually renders.

`react-dom/server` is ~196KB minified - on workerd that is ~12% of the
bytes parsed before a handler runs, and it was being parsed on every cold
start regardless of what the request wanted. Most invocations of a typical
Alepha app render no HTML at all: they answer an API route, a webhook or a
telemetry POST. Those paid for the renderer and never called it.

Loading it through this provider keeps it out of the eager module graph, so
it becomes an async chunk the runtime fetches on the first render and never
again. `react` itself (~8KB) stays eagerly imported, which is what it should
be - every component module needs `jsx` and the hooks.

⚠️ **A static `import … from "react-dom/server"` anywhere in the server graph
undoes this completely.** One eager edge pulls the whole module back onto the
cold-start path and nothing about this provider will report that it happened.
`REACT_SSR_ENABLED=false` does not help either: it is read at runtime, long
after the module graph has been decided.
