# useDetailTab

## Import

```typescript
import { useDetailTab } from "@alepha/ui/shell";
```

## Overview

Binds a detail page's selected tab to `?tab=<key>`.

`useQueryParams` writes with `replaceState` (its default in every format),
so clicking through four tabs does not bury the page the operator arrived
from under four history entries. `format: "querystring"` keeps the tab a
readable `?tab=<key>`, and the URL still carrying it is what makes a deep
link to "that user's sessions" shareable.

The generic is the union of valid keys, so a caller gets `"overview" |
"stock"` back rather than `string`. An unknown `?tab=` value in the URL is
not validated here: it falls through to whatever the page renders for an
unmatched key, the same way a hand-edited query param always could.
