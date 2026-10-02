# OwnedResourceProvider

## Import

```typescript
import { OwnedResourceProvider } from "alepha/security";
```

## Overview

Reads the resource resolved by `$owns` for the current request.

`$owns` already loads the row to make its access decision, so the handler
should not fetch it a second time. Inject this provider to read it back:

```typescript
class CampaignController {
  protected readonly owned = $inject(OwnedResourceProvider);

  read = $action({
    path: "/campaigns/:id",
    use: [
      $secure(),
      $owns({
        repository: () => this.campaigns,
        param: "id",
        owner: "createdBy",
      }),
    ],
    handler: async () => this.owned.get<Campaign>(),
  });
}
```

Two rows, not one, once a gate declares `through`:

- `get()` is the row the route param named (a quest).
- `authority()` is the row the decision was made against (its project) -
  the same row as `get()` when there is no hop, so a handler reads it the
  same way whether its endpoint hops or not.

`find()` / `findAuthority()` are the non-throwing forms, for a handler
legitimately reachable both with and without the gate.
