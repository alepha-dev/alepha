# useNavCrumbs

## Import

```typescript
import { useNavCrumbs } from "@alepha/ui/shell";
```

## Overview

Replace a detail page's breadcrumb with crumbs of its own.

While the page is mounted, route `route`'s crumb becomes `crumbs`:
`Admin > Users > Ada Lovelace` instead of `Admin > User`. The last crumb
is the open page and renders as a label.

`undefined` leaves the route's own crumb, which is what a page shows
while what it names is still loading.
