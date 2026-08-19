# $repositories

## Import

```typescript
import { $repositories } from "alepha/orm";
```

## Overview

One relation-aware repository per entity, in a single binding.

`$repository(relations, "campaigns")` is the explicit form for one entity;
this is the ergonomic one for a service that touches several. Plural name,
plural result - `$repository` always hands back exactly one repository.

It also removes a footgun: binding every entity at once means each one is
registered with the database provider before any schema is built, so a
foreign key can never point at a table that has not been registered yet.
With per-entity bindings that ordering is the caller's problem.

## Examples

```ts
class CampaignService {
  db = $repositories(relations);

  async members(id: number) {
    return await this.db.characters.findMany({
      where: { campaignId: { eq: id } },
      include: { user: true },
    });
  }
}
```

