# useClient

## Import

```typescript
import { useClient } from "alepha/react";
```

## Overview

Hook to get a virtual client for the specified scope.

It's the React-hook version of `$client()`, from `AlephaServerLinks` module.

A `hostname` on the scope reaches a remote Alepha app instead of this one,
resolving against that app's own registry. Such a client offers actions
only: a remote `$sse` would leave as a plain fetch, which answers with a
response rather than a stream, so it is not offered.
