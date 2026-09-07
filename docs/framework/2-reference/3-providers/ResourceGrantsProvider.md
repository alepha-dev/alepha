# ResourceGrantsProvider

## Import

```typescript
import { ResourceGrantsProvider } from "alepha/security";
```

## Overview

The seam between `$owns` and whatever decides what a member may do
INSIDE the resource they belong to.

`$owns` answers a boolean: are you the owner of this row, or a member of it
through the join. That is the whole question for most applications, and for
those this provider is never replaced and never costs anything.

An application that gives its members different powers - a viewer, a
contributor, an administrator - needs a second answer, and it needs it from
the same gate: a rule split across a middleware and a hand-written check in
the handler is a rule with two versions of itself. `requires` on
`OwnsOptions` names the permission at the call site, and this provider
is what turns the rows the gate already read into an allow or a deny.

## Rows, never ids

`ResourceGrantsRequest` carries the **authority row** and the
**membership row** the gate loaded, not their ids. That is deliberate and it
is the whole performance contract: an implementation cannot go and query for
the assignment, because it was never handed anything to query with. The
assignment has to be a column on a row the gate already reads, so a plain
member costs zero extra reads per request.

## The default is today's behaviour

Allow. An application that never registers a replacement behaves exactly as
it did before `requires` existed, whether or not its call sites use the
option. Substitute it the way every other seam in this framework is
substituted:

```ts
alepha.with({ provide: ResourceGrantsProvider, use: RankGrantsProvider });
```
