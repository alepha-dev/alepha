# RootComponentsProvider

## Import

```typescript
import { RootComponentsProvider } from "alepha/react/router";
```

## Overview

Extension point letting any module contribute root-level React nodes that
render on every page (siblings of the page view, inside AlephaContext).

A module pushes into `rootComponents` from its `register` hook; the array
is rendered by `ReactPageProvider.root()`. SSR-safe (same element feeds
server render + client hydrate).

