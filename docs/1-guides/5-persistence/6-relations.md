# Relations

Declare how entities relate to one another once, then read the graph with `include`. The whole tree arrives in one statement.

```typescript check
import { z } from "alepha";
import { $entity, $relations, $repositories, $repository, db } from "alepha/orm";
```

Relations are the layer above [joins](./7-joins.md). A join is a SQL join you write per query; a relation is a name you declare once and reuse. Relations also do what a join cannot: one-to-many without multiplying rows, many-to-many without exposing the junction, and arbitrary nesting.

## Declaring the graph

Relations live in their own statement, not on `$entity`:

```typescript
const teams = $entity({
  name: "teams",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
  }),
});

const players = $entity({
  name: "players",
  schema: z.object({
    id: db.primaryKey(),
    teamId: db.ref(z.uuid(), () => teams.cols.id),
    name: z.text(),
    mentorId: db.ref(z.uuid().optional(), () => players.cols.id),
  }),
});

const tournaments = $entity({
  name: "tournaments",
  schema: z.object({
    id: db.primaryKey(),
    title: z.text(),
  }),
});

/** Junction: which team entered which tournament. */
const entries = $entity({
  name: "entries",
  schema: z.object({
    id: db.primaryKey(),
    teamId: db.ref(z.uuid(), () => teams.cols.id),
    tournamentId: db.ref(z.uuid(), () => tournaments.cols.id),
  }),
  indexes: [{ columns: ["teamId", "tournamentId"], unique: true }],
});

export const schema = { teams, players, tournaments, entries };

export const relations = $relations(schema, (r) => ({
  teams: {
    players: r.many.players({ from: r.teams.id, to: r.players.teamId }),
  },
  players: {
    team: r.one.teams({ from: r.players.teamId, to: r.teams.id }),
    mentor: r.one.players({ from: r.players.mentorId, to: r.players.id }),
  },
}));
```

Both sides of every join are typed. Swap `r.teams.id` for `r.teams.name` in the `players` relation and it stops compiling, because a text column cannot pair with `players.teamId`.

### Why relations are a separate statement

They cannot be inferred from `db.ref`, and they cannot be nested inside `$entity`. `players.mentorId` is the reason: a self-reference makes the entity's own type depend on itself, and TypeScript gives up with `TS7022`. The `() => any` inside `db.ref` is what keeps that from happening, which also means the reference carries no type information for anything else to read.

Declaring relations separately sidesteps it entirely — by the time `$relations` runs, every entity is already a complete type.

### The graph can be partial

A `$relations` schema does not have to cover the application. Five entities out of twenty-three is a normal starting point: a relational repository and a plain one address the same tables and coexist, so one controller migrates while everything else stays as it was.

## Getting a repository

Two shapes, same object underneath.

```typescript
class TeamService {
  /** One binding for every entity in the schema. */
  db = $repositories(relations);

  /** ...or just the one this class needs. */
  teams = $repository(relations, "teams");
}
```

`$repository(entity)` — the plain form — is unchanged. The two-argument form takes the relations and the key of the entity within its schema.

## Reading

### include

```typescript
const team = await db.teams.findOne({
  where: { name: { eq: "Rovers" } },
  include: { players: true },
});

team?.players[0]?.name; // fully inferred
```

A `many` relation yields an array; a `one` yields `T | undefined`. A relation you did not include is absent from the type, so reading it is a compile error rather than `undefined` at runtime.

An empty to-many is `[]`, never `undefined` — which is the case a `LEFT JOIN` gets wrong.

### Nesting

```typescript
const team = await db.teams.findOne({
  where: { id: { eq: 1 } },
  include: { players: { include: { mentor: true } } },
});

team?.players[0]?.mentor?.name;
```

Depth costs columns, not round trips: each level becomes a subquery inside the same statement.

### Many-to-many

Both sides hop through the junction with `.through()`, and each names its own column on it:

```typescript
const relations = $relations(schema, (r) => ({
  teams: {
    tournaments: r.many.tournaments({
      from: r.teams.id.through(r.entries.teamId),
      to: r.tournaments.id.through(r.entries.tournamentId),
    }),
  },
  tournaments: {
    teams: r.many.teams({
      from: r.tournaments.id.through(r.entries.teamId),
      to: r.teams.id.through(r.entries.teamId),
    }),
  },
}));
```

The junction never appears in the result — a row reached through it is a plain target row, with no link columns bolted on. Hopping only one side throws at declaration time, because there would be nothing to match on the other.

> **A many-to-many de-duplicates only if the junction does.** `include` returns what the join returns. If a team could hold two `entries` rows for the same tournament, that tournament comes back twice and nothing in the response type would catch it. The unique index on `(teamId, tournamentId)` above is what makes the relation safe — worth a test of its own next to the endpoints that rely on it.

### Shaping a relation

A relation is a query, so it takes the same vocabulary as the root:

```typescript
const team = await db.teams.findOne({
  where: { id: { eq: 1 } },
  include: {
    players: {
      where: { name: { like: "A%" } },
      orderBy: { column: "name", direction: "asc" },
      limit: 5,
      select: ["id", "name"],
    },
  },
});
```

`limit` caps rows **per parent**, not across the result — which is the other thing a plain join cannot do without truncating children instead of parents.

### Projection

`select` narrows the row and its type:

```typescript
const teams = await db.teams.findMany({
  select: ["name"],
  include: { players: true },
});

teams[0]?.name;
// teams[0].id is a compile error — it was projected away
```

Projecting the parent does not break its relations: the join key is still read internally and does not resurface in the result.

## Filtering by a relation

A `where` key that names a declared relation takes a nested `where` describing the related rows, and compiles to `EXISTS`:

```typescript
// Teams that have a player called Ana.
const found = await db.teams.findMany({
  where: { players: { name: { eq: "Ana" } } },
});
```

Because it is an `EXISTS`, the root rows are not multiplied and nothing needs de-duplicating afterwards. Column filters and relation filters combine, and relation filters nest:

```typescript
await db.players.findMany({
  where: {
    name: { like: "A%" },
    team: { name: { eq: "Rovers" } },
  },
});

// Two levels deep.
await db.players.findMany({
  where: { team: { players: { name: { eq: "Ana" } } } },
});
```

`{}` is meaningful — the join condition alone is a presence check:

```typescript
// Teams with at least one player.
await db.teams.findMany({ where: { players: {} } });
```

Every operator works at any depth: `inArray`, `like`, `between`, all of them.

## Soft delete and tenancy

Both apply automatically, at every level of the tree, including a relation included with a bare `true`. The predicate is the one the repository itself would use — so an entity marked `db.organization({ strict: true })` still refuses a read with no resolved tenant, rather than returning every tenant's rows.

A relation filter inherits the same rule: a soft-deleted player does not make its team match.

### force

Some views want the history a soft delete hides — a crash inbox still shows reports from a source that has since been revoked. `force` is the same flag the plain repository takes:

```typescript
await db.teams.findMany({
  include: { players: { force: true } },
});
```

It applies to the level that asked for it, so a forced parent does not quietly un-hide everything hanging off it.

## Writing

`create` understands nested data and runs the whole graph in one transaction:

```typescript
const team = await db.teams.create({
  data: {
    name: "Rovers",
    players: {
      create: [{ name: "Ana" }, { name: "Bo" }],
    },
  },
  include: { players: true },
});
```

Ordering is forced by where each foreign key lives: a **to-one** related row is created first, because this row's key points at it; a **to-many** child is created after, because its key points back. A failure part-way through leaves no half-built graph behind.

`update` and `upsert` take `where` / `data` as an options object and accept `include` on the result:

```typescript
await db.teams.update({
  where: { id: { eq: 1 } },
  data: { name: "Rovers FC" },
  include: { players: true },
});
```

Everything else — `createMany`, `save`, `aggregate`, raw `query` — is reached through `.base`, which is the fully typed plain repository:

```typescript
await db.teams.base.aggregate({ select: { id: { count: true } } });
```

## What it costs

One statement, whatever the shape. Each included relation becomes a subquery, using the strategy the dialect is best at:

| Dialect | Strategy |
|---|---|
| PostgreSQL | `LEFT JOIN LATERAL` with `json_agg` |
| SQLite | correlated subqueries with `json_object` / `json_group_array` |
| Cloudflare D1 | the same, restricted to `json_*` — D1's SQLite has no `jsonb` |

`toSQL()` returns the statement without running it, which is how you get it in front of `EXPLAIN`:

```typescript
const { sql, params } = db.teams.toSQL({
  where: { id: { eq: 1 } },
  include: { players: true },
});
```

It needs a query with relations — without them the read goes through the plain repository and there is no gap to inspect.

Every table a read touched is announced on `repository:read:before`, root first, so a cache keyed per table sees the whole tree rather than only its root.

## Limitations

- **A relation filter cannot go inside `and` / `or` / `not`.** Those compile to one SQL expression, and an `EXISTS` cannot be folded into it. Lift the relation filter to the top level of the `where`; anything else is refused with an explanatory error rather than quietly matching nothing.
- **`count` cannot carry a relation filter.** There is no count on the relational engine, so the predicate cannot reach a `COUNT(*)`. It is refused rather than returning a number that ignored the filter. The same applies to `paginate(..., { count: true })`.
- **Only foreign keys are relations.** A `uuid[]` column of ids, or a polymorphic id column told apart by a discriminator, is not a foreign key — those lookups stay explicit.
- **No aggregates through relations.** Use `.base.aggregate()` or raw SQL.
- **`paginate` pages the root only.** Relations are resolved in full for the rows on that page, which is the point: page size bounds the work.
