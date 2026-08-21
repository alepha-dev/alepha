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
