# $owns

## Import

```typescript
import { $owns } from "alepha/security";
```

## Overview

Resource-scoped authorization gate.

Roles and permissions answer "what kind of user is this?". They cannot
answer "does this user own row 42?", so that check ends up inline in every
handler - where nothing enforces its presence and a forgotten call is a
silent authorization hole.

`$owns` loads the row named by a route param, checks the caller against it,
and publishes it via `OwnedResourceProvider` so the handler does not
re-fetch what the gate already read.

Two checks, applied in order:

1. **Owner**: `row[owner] === user.id`.
2. **Membership**: when `via` is set, a row in the join entity links the
   caller to this resource.

Both are read off the row the param names, unless `through` says ownership
lives one hop away - on the project a quest belongs to, say. The resource
is still published to `OwnedResourceProvider.get()`; the row the decision
was actually made against is published to `authority()`.

A privileged identity (`user.ownership === false`) bypasses both, matching
the `ownership` semantics `$secure` already applies: an admin whose grant is
not narrowed to rows they own. Note this is deliberately strict - an
`undefined` ownership does **not** bypass, because `undefined` only means
"no permission check ran", not "this caller is privileged".

```typescript
class CampaignController {
  read = $action({
    path: "/campaigns/:id",
    use: [
      $secure(),
      $owns({
        repository: () => this.campaigns,
        param: "id",
        owner: "createdBy",
        cast: Number,
        via: {
          repository: () => this.characters,
          resource: "campaignId",
          user: "userId",
        },
      }),
    ],
    handler: async () => this.owned.get<Campaign>(),
  });
}
```

## Options

| Option       | Type                                 | Required | Description                                                                                                                         |
| ------------ | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `repository` | `Object`                             | Yes      | Repository the guarded resource is loaded from, as a thunk                                                                          |
| `param`      | `string`                             | Yes      | Key holding the resource id, in whichever source `OwnsOptions.from` names                                                           |
| `from`       | `"params" \| "query" \| "body"`      | No       | Where to read `OwnsOptions.param` from                                                                                              |
| `through`    | `OwnsHop \| OwnsHop[]`               | No       | The second hop: say that ownership is not held by the row the param names, but by a row it belongs to                               |
| `owner`      | `string`                             | Yes      | Column holding the owner's user id, on the row the decision is made against - the resource itself, or the row `through` lands on.   |
| `via`        | `Object`                             | No       | Membership fallback: a join entity linking users to the row the decision is made against                                            |
| `cast`       | `Object`                             | No       | Coerce the raw value before querying                                                                                                |
| `cache`      | `StatementOptions["cache"]`          | No       | Cache window for the **authority read** - the row the gate decides against, which is the resource itself when there is no `through` |
| `message`    | `string`                             | No       | Message used for both the owner and the membership denial                                                                           |
| `secure`     | `Omit&lt;SecureOptions, "guard"&gt;` | No       | Additional `$secure` checks layered on top - roles, permissions, issuers.                                                           |
