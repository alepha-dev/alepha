# usePasskey

## Import

```typescript
import { usePasskey } from "@alepha/ui/auth";
```

## Overview

Passkeys from React: add one, remove one, prove with one, sign in with
one. Each verb returns a `RunResult`, `reason: "cancelled"` when the user
dismissed the browser's prompt (quiet: no toast, nothing written).

The browser API is `PasskeyClient`'s, so a spec substitutes it;
the routes are `MyPasskeyController`'s and `useAuth().loginPasskey`.
