# example-relations

Proof of concept for `$relations` — declared relations with a fully inferred
`include`, built on Drizzle v1.

```bash
yarn vitest run apps/example-relations   # 14 tests
cd apps/example-relations && tsc --noEmit # proves the type assertions
```

Both pass. The typecheck is the more interesting one: the spec contains six
`@ts-expect-error` directives, and TypeScript treats an *unused* one as an
error — so a green `tsc` is proof that every negative case really is rejected.

---

## The API

Entities are unchanged. Relations go in one separate statement:

```ts
export const schema = { users, campaigns, characters, quests };

export const relations = $relations(schema, (r) => ({
  campaigns: {
    owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
  },
  quests: {
    author: r.one.users({ from: r.quests.createdBy, to: r.users.id }),
    blockedBy: r.one.quests({ from: r.quests.dependsOn, to: r.quests.id }),
  },
}));
```

Then bind and query:

```ts
class CampaignController {
  campaigns = $repository(relations, "campaigns");
}

const campaign = await this.campaigns.findOne({
  where: { id: { eq: 1 } },
  include: { owner: true, characters: { include: { user: true } } },
});

campaign?.owner?.email;              // string | undefined
campaign?.characters[0]?.user?.name; // string | undefined
```

Both sides of every join are typed. Swapping `r.campaigns.id` for
`r.campaigns.title` stops compiling, because a `string` column cannot pair
with `characters.campaignId`.

---

## What it removes from Lore

`CampaignController.ts:255-262` today:

```ts
const campaignCharacters = await this.characters.findMany({
  where: { campaignId: { eq: params.id } },
});
const userIds = campaignCharacters.map((it) => it.userId);
const members = await this.users.findMany({
  where: { id: { inArray: userIds } },
});
// ...and a Map to stitch them back together, at every call site
```

With relations:

```ts
const members = await this.characters.findMany({
  where: { campaignId: { eq: params.id } },
  include: { user: true },
});
```

Lore has **30 `inArray` fetches paired with 29 `new Map()` lookups**. They are
all this shape.

---

## Design decisions, and why

**Relations are a separate statement.** Not a style choice. Threading a foreign
key's target through the column type makes `quests.dependsOn -> quests.id` — a
self reference Lore actually has — fail with `TS7022: 'quests' implicitly has
type 'any' because it is referenced directly or indirectly in its own
initializer`. Same for any mutual reference. The `() => any` in `db.ref` is
load-bearing: that `any` is what breaks the cycle. Drizzle's `defineRelations`
and Prisma's codegen both land here for the same reason. The spec proves the
self relation works (`quests.blockedBy`).

**Resolution is batched, not joined.** One query for the parents, then one per
included relation, regardless of row count — the spec asserts exactly 3 queries
for a two-level include. A SQL join multiplies parent rows by their children,
so the parent has to be de-duplicated back out, and on a `limit`ed query the
multiplication truncates the wrong thing. Two tests pin the cases a join gets
wrong: an empty relation stays `[]` rather than dropping the parent, and
`limit: 1` returns one parent with both its children.

It also behaves identically on every dialect, including D1, where a lateral
join isn't available. That matters here — Lore runs on D1.

**Shaped after `defineRelations` deliberately.** The declaration mirrors
Drizzle's API closely enough that the resolver behind it could be swapped for
Drizzle's relational query builder without touching a single call site. This
PoC does not use RQB v2 yet: it needs a static schema object, and Alepha builds
its tables at runtime from Zod. That bridge is real work and is the main open
question — see below.

---

## What works

- to-one, to-many, self relations
- arbitrary nesting (`include: { characters: { include: { user: true } } }`)
- `include` narrows the result to exactly what was asked for — a relation you
  did not include is **absent from the type**, not `undefined`
- an undeclared relation is a compile error, and still a named runtime error
  for untyped callers
- `where` / `limit` / `offset` / `orderBy` pass through untouched
- `.base` exposes the plain repository, so `create`, `upsert`, `aggregate` and
  raw `query` all still work

## What does not, yet

- **Drizzle RQB v2 as the executor.** Batching works and is dialect-portable,
  but a single round trip would be better where the dialect supports it. The
  blocker is the runtime-tables to static-types bridge.
- **Filtering or ordering *on* a relation** — `include: { quests: { where: … } }`
  is not implemented. This is the most likely next thing Lore would want.
- **Selecting columns on an included relation.** Related to the existing
  `columns:` gap, where projection narrows the runtime row but not the type.
- **Many-to-many** (`through`). Lore has no junction tables today, so it was
  not worth guessing at.
- **Write-side nesting** (Prisma's nested `create`). Deliberately out of scope.

## Known rough edges

- Entities must be bound in dependency order within a class — a foreign key is
  resolved against tables registered before it. Pre-existing, not introduced
  here, but relations make it easier to hit.
- `$repository(relations, "campaigns")` addresses the entity by key rather than
  by the entity object. Necessary: nested includes follow that key to find the
  target's relations, and a structural lookup would misfire the moment two
  entities shared a shape. A `$client(relations).campaigns` form would read
  more like Prisma but fights Alepha's per-controller DI.
