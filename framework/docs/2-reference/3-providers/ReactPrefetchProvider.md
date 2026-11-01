# ReactPrefetchProvider

## Import

```typescript
import { ReactPrefetchProvider } from "alepha/react/router";
```

## Overview

Fetches a page's code before it is clicked: the `lazy` chunks of the page and
of its layouts, nothing else.

The attribute is the API, on the model of the anchor interceptor: a delegated
listener reads `data-prefetch`, so a plain `<a>` works as well as a `Link`,
and no element holds a listener of its own.

⚠️ A failure is swallowed here, never handed to the chunk-error reload of
`ReactPageProvider`: an orphaned chunk after a deploy must not reload the
page under a hover. The navigation, if it comes, meets the failure itself.
