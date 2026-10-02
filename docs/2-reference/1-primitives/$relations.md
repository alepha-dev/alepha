# $relations

## Import

```typescript
import { $relations } from "alepha/orm";
```

## Overview

Declares how entities relate to one another.

Relations live in their own statement, after the entities they connect.
They cannot be attached to `$entity`, and they cannot be derived from
`db.ref()`. That is a hard TypeScript limitation, not a style choice:
threading a foreign key's target through the column type makes
`quests.dependsOn -> quests.id` (a self reference) and every mutual
reference fail with

TS7022: 'quests' implicitly has type 'any' because it is referenced
directly or indirectly in its own initializer

The `() => any` in `db.ref` is load-bearing - that `any` is what breaks the
cycle. Declaring relations separately, once every entity's type has already
resolved, is the only shape that preserves full inference. Drizzle's
`defineRelations` and Prisma's codegen both land here for the same reason.

The shape deliberately mirrors `defineRelations` so the resolver behind it
can later be swapped for Drizzle's relational query builder without moving
a single call site.

## Examples

```ts
const schema = { users, campaigns, characters, usersToGroups, groups };

export const relations = $relations(schema, (r) => ({
  campaigns: {
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
  },
  users: {
    // many-to-many, through a junction table
    groups: r.many.groups({
      from: r.users.id.through(r.usersToGroups.userId),
      to: r.groups.id.through(r.usersToGroups.groupId),
    }),
  },
}));
```
