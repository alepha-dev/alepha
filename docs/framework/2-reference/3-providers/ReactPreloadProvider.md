# ReactPreloadProvider

## Import

```typescript
import { ReactPreloadProvider } from "alepha/react/router";
```

## Overview

Adds HTTP Link headers for preloading entry assets.

Benefits:

- Early Hints (103): Servers can send preload hints before the full response
- CDN optimization: Many CDNs use Link headers to optimize asset delivery
- Browser prefetching: Browsers can start fetching resources earlier

The Link header is computed once at first request and cached for reuse.
