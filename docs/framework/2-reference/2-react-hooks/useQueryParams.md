# useQueryParams

## Import

```typescript
import { useQueryParams } from "alepha/react/router";
```

## Overview

Hook to manage query parameters in the URL using a defined schema.

Two storage formats are supported via `UseQueryParamsHookOptions.format`:
- `"base64"` (default) packs the whole object into a single opaque param
  (named by `key`, default `q`) - e.g. `?q=eyJ0YWIiOiJzZWN1cml0eSJ9`.
- `"querystring"` spreads each schema field across its own readable param -
  e.g. `?tab=security`. In this mode `key` is ignored.

By default the URL is updated with `replaceState` (no new history entry).
Pass `push: true` to add a history entry instead, so the browser back
button steps back through previous values.

## Examples

const [params, setParams] = useQueryParams(
  z.object({ tab: z.string().optional() }),
  { format: "querystring" },
);
// params.tab reads from `?tab=…`; setParams({ tab: "security" }) writes it.

