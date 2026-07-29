# Resource Authorization

`$secure` answers *what kind of user is this?* — issuer, roles, permissions. It cannot answer *does this user own row 42?*, because ownership is a property of the data, not of the token.

```typescript check
import { $inject } from "alepha";
import { $action } from "alepha/server";
import { $owns, $secure, OwnedResourceProvider } from "alepha/security";
```

## The problem

Without a resource gate, ownership checks live inside handlers:

```typescript
// Works, but nothing enforces it.
read = $action({
  path: "/campaigns/:id",
  use: [$secure({ permissions: ["campaign:read"] })],
  handler: async ({ params, user }) => {
    const campaign = await this.campaigns.getOne({ where: { id: { eq: params.id } } });
    if (campaign.createdBy !== user.id) {
      throw new ForbiddenError("Not yours");
    }
    return campaign;
  },
});
```

The check is correct. The problem is that it is *invisible*: no test fails if the next endpoint forgets it, no tooling can see that this route is owner-scoped, and the rule gets copy-pasted into every handler that touches the resource.

## `$owns`

Move the rule into the middleware chain, where its absence is visible:

```typescript
class CampaignController {
  protected readonly campaigns = $repository(campaigns);
  protected readonly owned = $inject(OwnedResourceProvider);

  read = $action({
    path: "/campaigns/:id",
    use: [
      $secure({ permissions: ["campaign:read"] }),
      $owns({
        repository: () => this.campaigns,
        param: "id",
        owner: "createdBy",
        cast: Number,
      }),
    ],
    handler: async () => this.owned.get<Campaign>(),
  });
}
```

`cast` coerces the route param before querying — route params are always strings, so integer primary keys need `Number`.

`repository` is a thunk rather than the repository itself. `$owns()` runs during class-field initialization, so a `$repository()` field declared *after* it would not exist yet; deferring the lookup to request time makes field order irrelevant.

## The loaded row is handed to you

`$owns` has to read the row to make its decision, so it publishes it rather than throwing it away. Inject `OwnedResourceProvider` and read it back — no second query:

```typescript
handler: async () => {
  const campaign = this.owned.get<Campaign>();   // already loaded by the gate
  return this.present(campaign);
}
```

`get()` throws if no `$owns` ran, because that is a wiring mistake rather than a runtime condition. Use `find()` when a handler is legitimately reachable both with and without the gate.

## Membership

Shared resources are rarely owner-only. Point `via` at the join entity:

```typescript
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
})
```

Checks run in order: owner first, then membership. When you supply the `message` option, it's used for **both** denials on purpose — a different message per branch tells an attacker whether the resource exists and who owns it. (Without a custom `message`, the defaults differ; set one for endpoints where that distinction matters.)

## Privileged identities

A caller with `ownership === false` bypasses both checks. That is the same `ownership` flag `$secure` sets from the permission registry: `false` means an admin whose grant is *not* narrowed to their own rows.

This is deliberately strict — `undefined` does **not** bypass. `undefined` only means no permission check ran, which is not the same as "this caller is privileged". If you are migrating hand-written authz that treated `!user.ownership` as the bypass, note that `undefined` used to pass and now does not.

## Raw guards

For rules that are not owner- or membership-shaped, `$secure`'s `guard` sees the whole request:

```typescript
$secure({
  guard: async ({ user, params, body, alepha }) => {
    const invite = await alepha.inject(InviteService).find(params.token);
    return invite?.email === user.email;
  },
})
```

Guards may be async and run after all other `$secure` checks. `params`, `query`, and `body` come from the action request when there is one, falling back to the raw HTTP request — so the same guard works over HTTP, over `action.run()`, and over MCP.

## Browser behaviour

On the client, `$secure` returns `undefined` instead of throwing, and the guard sees empty `params`. A guard that reads request data therefore denies in the browser and is re-evaluated for real on the server. (`$owns` is server-only — it isn't exported from the browser entry.)

That is the safe direction: the UI hides the action, and the API is what actually enforces it. Never treat a client-side pass as authorization.
