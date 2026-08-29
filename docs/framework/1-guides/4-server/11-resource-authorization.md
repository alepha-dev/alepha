# Resource Authorization

`$secure` answers _what kind of user is this?_ - issuer, roles, permissions. It cannot answer _does this user own row 42?_, because ownership is a property of the data, not of the token.

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
    const campaign = await this.campaigns.getOne({
      where: { id: { eq: params.id } },
    });
    if (campaign.createdBy !== user.id) {
      throw new ForbiddenError("Not yours");
    }
    return campaign;
  },
});
```

The check is correct. The problem is that it is _invisible_: no test fails if the next endpoint forgets it, no tooling can see that this route is owner-scoped, and the rule gets copy-pasted into every handler that touches the resource.

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

`cast` coerces the value before querying. It is rarer than it looks: the guard runs after request validation, so a param declared `z.integer()` arrives already decoded to a number, and `findById` coerces whatever is left to the primary key's declared type. Reach for it when the value needs a transformation the schema cannot express - an undeclared param, or a slug to decode.

`repository` is a thunk rather than the repository itself. `$owns()` runs during class-field initialization, so a `$repository()` field declared _after_ it would not exist yet; deferring the lookup to request time makes field order irrelevant.

## The loaded row is handed to you

`$owns` has to read the row to make its decision, so it publishes it rather than throwing it away. Inject `OwnedResourceProvider` and read it back - no second query:

```typescript
handler: async () => {
  const campaign = this.owned.get<Campaign>(); // already loaded by the gate
  return this.present(campaign);
};
```

`get()` throws if no `$owns` ran, because that is a wiring mistake rather than a runtime condition. Use `find()` when a handler is legitimately reachable both with and without the gate.

## Membership: `via`

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
});
```

Checks run in order: owner first, then membership. When you supply the `message` option, it's used for **both** denials on purpose - a different message per branch tells an attacker whether the resource exists and who owns it. (Without a custom `message`, the defaults differ; set one for endpoints where that distinction matters.)

## The second hop: `through`

`via` only works when the route param names **the thing being shared**. It usually doesn't. Membership lives on a campaign; the route names a quest that belongs to one. There is no join to make, and `via` cannot express the rule at all.

`through` says the authority row is one hop away:

```typescript
$owns({
  repository: () => this.quests, // the row the param names
  param: "id",
  through: { column: "campaignId", repository: () => this.campaigns },
  owner: "createdBy", // read off the CAMPAIGN
  via: {
    repository: () => this.characters,
    resource: "campaignId",
    user: "userId",
  },
});
```

**Picking the wrong one of the two is silent**, so it is worth stating the distinction plainly:

| The route param names…              | Use                   |
| ----------------------------------- | --------------------- |
| the row that carries the membership | `via` alone           |
| a row that _belongs_ to that row    | `via` **+ `through`** |

`owner` and `via` keep their meaning; `through` only says which row they apply to. `via.resource` is matched against the resolved foreign key, so a membership in a _different_ campaign does not accidentally match.

A **null or absent foreign key denies**. An orphan row must not become world-readable, and falling through would refuse it only by accident.

Pass an array to chain, when the resource does not carry the foreign key itself and neither does the next row:

```typescript
through: [
  { column: "questId", repository: () => this.quests },
  { column: "campaignId", repository: () => this.campaigns },
];
```

Only the last link is the authority. Keep chains short: each link is a query, and a rule that needs four of them is usually a missing column rather than a missing feature.

### Reading the authority row back

`OwnedResourceProvider.get()` always returns the row the param named. `authority()` returns the row the decision was made against - the same row without `through`, the hopped-to row with it:

```typescript
handler: async () => {
  const quest = this.owned.get<Quest>();
  const campaign = this.owned.authority<Campaign>();
  return { quest, ownerId: campaign.createdBy };
};
```

Both are published **before** the access decision, so a handler reads them identically on the owner, member and privileged paths.

## Where the id comes from: `from`

By default the id is a route param. An endpoint that takes it in the query string or the request body sets `from`:

```typescript
$owns({
  repository: () => this.campaigns,
  param: "campaignId",
  from: "query", // "params" (default) | "query" | "body"
  owner: "createdBy",
});
```

A body value is caller-controlled in a way a path segment is not. That widens nothing: it is still just an id handed to `findById`, and the gate is what decides access - a caller naming somebody else's row gets a 403 for it.

## Caching the authority read

`cache` is passed straight through to the authority read - the row the gate decides against, which is the resource itself when there is no `through`:

```typescript
$owns({
  repository: () => this.campaigns,
  param: "id",
  owner: "createdBy",
  cache: { ttl: 30_000 },
});
```

Deliberately **not** applied to the membership read. A membership row _is_ the grant, so caching it caches an authorization decision and revocation stops taking effect on the next request.

Independently of `cache`, `$owns` memoizes its reads **for the lifetime of one request**. A page that loads seven things at once sends one batched request, and every entry gates independently; without the memo the same `(user, resource)` pair is resolved seven times over. The two are not the same mechanism: the memo is deterministic (every gate in one request shares one query, warm process or cold) and never outlives the request, so it preserves revocation semantics exactly; `cache` is opportunistic across requests and trades a staleness window for the saving.

## Privileged identities

A caller with `ownership === false` bypasses both checks. That is the same `ownership` flag `$secure` sets from the permission registry: `false` means an admin whose grant is _not_ narrowed to their own rows.

This is deliberately strict - `undefined` does **not** bypass. `undefined` only means no permission check ran, which is not the same as "this caller is privileged". If you are migrating hand-written authz that treated `!user.ownership` as the bypass, note that `undefined` used to pass and now does not.

## Raw guards

For rules that are not owner- or membership-shaped, `$secure`'s `guard` sees the whole request:

```typescript
$secure({
  guard: async ({ user, params, body, alepha }) => {
    const invite = await alepha.inject(InviteService).find(params.token);
    return invite?.email === user.email;
  },
});
```

Guards may be async and run after all other `$secure` checks. `params`, `query`, and `body` come from the action request when there is one, falling back to the raw HTTP request - so the same guard works over HTTP, over `action.run()`, and over MCP.

## Browser Behavior

On the client, `$secure` returns `undefined` instead of throwing, and the guard sees empty `params`. A guard that reads request data therefore denies in the browser and is re-evaluated for real on the server. `$owns` goes further: ownership lives in database rows the browser can't load, so its browser variant always returns `undefined` - the server-side gate is what actually enforces it.

That is the safe direction: the UI hides the action, and the API is what actually enforces it. Never treat a client-side pass as authorization.
