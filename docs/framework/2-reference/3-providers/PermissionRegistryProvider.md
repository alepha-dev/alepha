# PermissionRegistryProvider

## Import

```typescript
import { PermissionRegistryProvider } from "alepha/security";
```

## Overview

Answers "does the caller hold this permission?" from the set the server sent
down with the API registry.

The server resolves a user's roles into concrete permission names before
sending them (`SecurityProvider.getPermissions`, where a `*` role expands to
the full list), so this side never has to resolve a role - it matches names
against an already-flat list. A wildcard is therefore only meaningful on the
*requirement* (`orders:*` = "anything in this group"), never on a grant.

## Why this reads the store instead of injecting `LinkProvider`

`LinkProvider.can()` answers the same question and is the canonical
implementation - but it lives in `alepha/server/links`, which already imports
types from `alepha/security`. A value import back would close the loop
`security -> server/links -> security`, which the build's module analyzer
rejects (it counts type-only imports as edges).

So this reads the same store key `LinkProvider` reads, and duplicates only
the matching rule - six lines, pinned against `LinkProvider` by
`server/links/__tests__/permission-matching-parity.spec.ts` so the two cannot
drift apart silently.

Nothing here enforces anything: the browser is not an enforcement point, and
the server re-checks every permission on the real request. This exists so the
UI agrees with the answer the server would give.

