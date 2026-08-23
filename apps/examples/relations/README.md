# example-relations

Proof of concept for `$relations` — declared relations with a fully inferred
`include`, built alongside Drizzle v1.

```bash
yarn vitest run apps/examples/relations    # 9 spec files
cd apps/examples/relations && tsc --noEmit # proves the type assertions
```

Both pass. The typecheck is the more interesting one: the specs contain ten
`@ts-expect-error` directives, and TypeScript treats an _unused_ one as an
error — so a green `tsc` is proof that every negative case really is rejected.

---

## The API

Entities are unchanged. Relations go in one separate statement:

```ts
export const schema = { users, campaigns, characters, quests, questWatchers };

export const relations = $relations(schema, (r) => ({
  campaigns: {
    owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
  },
  quests: {
    blockedBy: r.one.quests({ from: r.quests.dependsOn, to: r.quests.id }),
    watchers: r.many.users({
      from: r.quests.id.through(r.questWatchers.questId),
      to: r.users.id.through(r.questWatchers.userId),
    }),
  },
}));
```

Bind one entity, or all of them:

```ts
class CampaignService {
  db = $repositories(relations); // every entity
  campaigns = $repository(relations, "campaigns"); // or just one
}
```

Then query:

```ts
const campaign = await this.db.campaigns.findOne({
  where: { id: { eq: 1 } },
  select: ["id", "title"],
  include: {
    owner: { select: ["name"] },
    characters: {
      where: { level: { gte: 3 } },
      orderBy: { column: "level", direction: "desc" },
      limit: 5,
      include: { user: true },
    },
  },
});

campaign?.characters[0]?.user?.name; // string | undefined, fully inferred
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
const members = await this.db.characters.findMany({
  where: { campaignId: { eq: params.id } },
  include: { user: true },
});
```

Lore has **30 `inArray` fetches paired with 29 `new Map()` lookups**. They are
all this shape.

---

## Features

|                      |                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| to-one               | `include: { owner: true }` → `User \| undefined`                                                            |
| to-many              | `include: { characters: true }` → `Character[]`                                                             |
| self relations       | `quests.blockedBy` → `quests.dependsOn` → `quests.id`                                                       |
| many-to-many         | `.through(junction)` on both sides; junction never leaks                                                    |
| nesting              | arbitrary depth, `include` inside `include`                                                                 |
| filtering a relation | `include: { characters: { where: … } }`                                                                     |
| ordering a relation  | `include: { characters: { orderBy: … } }`                                                                   |
| limiting a relation  | `limit` is **per parent**, like Prisma's `take`                                                             |
| projection           | `select` on the root _and_ on any relation; narrows the type                                                |
| nested writes        | `create({ data: { …, characters: { create: [...] } } })`                                                    |
| reads                | `findMany` `findOne` `getOne` `findById` `getById` `paginate` `count`                                       |
| writes               | `create` `createMany` `update` `updateById` `updateMany` `upsert` `save` `delete` `deleteById` `deleteMany` |
| raw access           | `table` `id` `tableName` `query` `aggregate` `transaction`                                                  |
| escape hatch         | `.base` — the plain repository, still fully typed                                                           |

### Type safety, proven by `tsc`

- a relation you did not include is **absent from the type**, not `undefined`
- an undeclared relation in `include` is a compile error _and_ a named runtime error
- `select` narrows the row — reading an unselected column does not compile
- to-many is an array; to-one must be narrowed before use
- a join between mismatched column types does not compile

---

## Design decisions, and why

**Relations are a separate statement.** Not a style choice. Threading a foreign
key's target through the column type makes `quests.dependsOn -> quests.id` — a
self reference Lore actually has — fail with `TS7022: 'quests' implicitly has
type 'any' because it is referenced directly or indirectly in its own
initializer`. Same for any mutual reference. The `() => any` in `db.ref` is
load-bearing: that `any` is what breaks the cycle. Drizzle's `defineRelations`
and Prisma's codegen both land here for the same reason.

**Resolution runs on Drizzle's relational query builder.** Since 2026-07-29
(`RqbExecutor` in `packages/alepha/src/orm/core/services`) an `include` compiles
to one query: lateral joins on Postgres, correlated subqueries on SQLite and D1.
The shape the specs pin is unchanged: an empty relation stays `[]` rather than
dropping the parent, and `limit: 1` returns one parent with both its children.

It behaves identically on every dialect, including D1, where a lateral join
isn't available. That matters here — Lore runs on D1.

**Per-parent `limit` is pushed into the subquery.** RQB caps each group in SQL,
so there is no in-memory slice to pay for.

**Join columns are carried, then dropped.** `select` that omits the column a
relation is stitched on would otherwise silently resolve everything to
undefined. Those columns are fetched anyway and removed before the row is
returned, so the result matches the type. Two tests cover it — one at the root,
one on a relation.

**Writes take a single options object, like reads.** `create({ data, include })`,
`update({ where, data })`, `delete({ where })`. `where` is mandatory on update
and delete — an optional filter there would let a forgotten clause rewrite the
whole table. The by-id shortcuts (`updateById`, `deleteById`, `findById`) stay
positional because they carry no query. `save` stays positional too: it is a
read-modify-write over a row you already hold, not a query.

**Nested writes are ordered by where the foreign key lives.** A to-one related
row is created _before_ the row referencing it; a to-many child _after_. The
whole graph runs in one transaction — a test asserts a failing child rolls the
parent back.

---

## Known limitations

- **On Drizzle's RQB v2 since 2026-07-29.** The first version issued several
  small indexed queries instead (one per included relation); that was replaced
  by the relational query builder once the runtime-tables to static-types
  bridge existed. The declaration mirrors `defineRelations`, so the earlier
  batched strategy stays a possible fallback.

- **To-one foreign keys are optional in `CreateData`** whether or not you
  actually nest that relation — the type cannot see which keys the value will
  carry. Omitting one without nesting fails at the database, not the compiler.
- **`update` has no nested form.** Only `create` does. Nested updates need
  connect/disconnect/upsert semantics, which is a design question rather than
  an implementation gap.
- **No aggregate or `_count` on relations.** Prisma's `_count` is a common ask.
- **Ordering by a related column** (`orderBy: { owner: { name: "asc" } }`) is
  not possible under batching — the parent query cannot see the child. This is
  the strongest argument for a join-based executor.
