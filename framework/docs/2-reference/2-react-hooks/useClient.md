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

The client is rebuilt whenever the `scope` object changes, so pass a
stable one (a module constant, or a `useMemo`): a scope written inline is
a new client on every render, and churns every dependency list it sits in.
