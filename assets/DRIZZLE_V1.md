# Drizzle ORM v1 Migration Plan

> Written April 2026. Drizzle v1 is in beta (`v1.0.0-beta.20`, March 2025). No GA date announced.
> Alepha is currently on `drizzle-orm@0.45.2` (stable).
> **Action: wait for v1 GA, then bigbang upgrade.**

## Why

Alepha wraps Drizzle at the wrong layer. The `Repository` uses the low-level SQL builder (`db.select().from().leftJoin()`) and re-implements join handling manually via `PgRelationManager`. Drizzle's real power — the relational query API — is completely bypassed.

Drizzle v1 Relations v2 solves every limitation of Alepha's current join system:

| Current limitation | Drizzle v1 solution |
|---|---|
| No one-to-many joins | `r.many()` with lateral join + `json_agg` under the hood |
| No many-to-many | `through()` hides junction tables from results |
| No per-relation `where`/`orderBy`/`limit` | First-class in `db.query.table.findMany({ with: { posts: { where, orderBy, limit } } })` |
| No `columns` on joined tables | `with: { posts: { columns: { id: true, title: true } } }` |
| No computed fields on relations | `extras: { fullName: sql\`...\` }` |
| Manual `.alias()` for self-joins | Handled by relation definition (`alias` param) |
| `NodeSqliteProvider` shims `better-sqlite3` | Official `drizzle-orm/node-sqlite` driver |

## What Alepha adds (keep)

These are the genuine value-add layers that justify the Repository pattern. None of this exists in raw Drizzle:

- **Soft deletes** — automatic `deletedAt IS NULL` injection, transparent to all queries
- **Multi-tenancy** — automatic org scoping via `currentUserAtom`
- **Optimistic locking** — `save()` with version checking, `DbVersionMismatchError`
- **Typed error hierarchy** — `DbConflictError`, `DbForeignKeyError`, `DbDeadlockError`, etc.
- **Pagination** — `paginate()` with count, metadata, sort string parsing
- **Aggregate API** — type-safe `aggregate()` with GROUP BY, HAVING, dot-notation ordering
- **Transaction propagation** — implicit via `alepha.store`, no manual `{ tx }` drilling
- **Query caching** — per-table TTL cache with auto-invalidation on writes
- **Lifecycle events** — `repository:create:before/after`, `repository:read:before/after`, etc.
- **Codec integration** — Dayjs, custom types auto-encoded in WHERE clauses
- **Schema transforms** — `insertSchema` / `updateSchema` — auto-exclude generated cols, handle defaults
- **DI integration** — `$repository()`, `$inject()`, service substitution for tests
- **JSON query DSL** — `{ where: { age: { gt: 18 } } }` — composable, serializable, loggable

## What Alepha blocks (remove/refactor)

Features Drizzle offers that the current wrapper prevents access to:

| Blocked feature | Impact |
|---|---|
| Relational query API (`db.query.table.findMany({ with })`) | Critical — one-to-many, per-relation filtering/ordering/limiting |
| Lateral joins (`leftJoinLateral`) | High — top-N-per-group patterns |
| CTEs (`$with` / `with`) | High — recursive queries, complex analytics |
| Per-relation `where`/`orderBy`/`limit` | High |
| `columns` on relations | Medium |
| `extras` / computed fields | Medium |
| Set operators (`union`, `intersect`, `except`) | Medium |
| UPDATE with FROM/JOINs | Medium — join-based batch updates |
| INSERT from SELECT | Medium |
| `onConflictDoNothing` | Low-medium |
| `selectDistinctOn` | Low-medium |

## Drizzle v1 feature list

### Relations v2

```typescript
const relations = defineRelations({ users, posts, comments }, (r) => ({
  users: {
    posts: r.many.posts(),                    // one-to-many
    groups: r.many.groups({                   // many-to-many via junction
      from: r.users.id.through(r.usersToGroups.userId),
      to: r.groups.id.through(r.usersToGroups.groupId),
    }),
  },
  posts: {
    author: r.one.users({                     // many-to-one
      from: r.posts.authorId,
      to: r.users.id,
    }),
    comments: r.many.comments(),
  },
  comments: {
    post: r.one.posts({
      from: r.comments.postId,
      to: r.posts.id,
    }),
  },
}));
```

Key features:
- `r.one` / `r.many` — declarative relation types
- `through()` — many-to-many, junction table hidden from query results
- `optional: true` — nullable relations (type-level)
- `alias` — disambiguate multiple relations between same tables
- `where` — predefined filters on target table (polymorphic relations)
- `defineRelationsPart()` — modules define their own relations independently, then merge

### Relational Query Builder v2

```typescript
const result = await db.query.users.findMany({
  columns: { id: true, name: true },
  where: { verified: true, age: { gt: 18 } },
  orderBy: { name: "asc" },
  limit: 10,
  offset: 20,
  extras: {
    postCount: (users) => db.$count(posts, eq(posts.authorId, users.id)),
  },
  with: {
    posts: {
      columns: { id: true, title: true },
      where: { publishedAt: { isNotNull: true } },
      orderBy: { publishedAt: "desc" },
      limit: 5,
      with: {
        comments: {
          limit: 3,
          orderBy: { createdAt: "desc" },
        },
      },
    },
  },
});
```

Under the hood — lateral joins with `json_agg` (single SQL statement):

```sql
SELECT ...
FROM "users" AS "d0"
LEFT JOIN LATERAL (
  SELECT coalesce(json_agg(row_to_json("t".*)), '[]') AS "r"
  FROM (
    SELECT ... FROM "posts" AS "d1"
    WHERE "d0"."id" = "d1"."author_id"
      AND "d1"."published_at" IS NOT NULL
    ORDER BY "d1"."published_at" DESC
    LIMIT 5
  ) AS "t"
) AS "posts" ON true
```

Where syntax operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `ilike`, `notLike`, `notIlike`, `isNull`, `isNotNull`, `arrayOverlaps`, `arrayContained`, `arrayContains`, `OR`, `AND`, `NOT`, `RAW`.

### Official `node:sqlite` driver

```typescript
import { drizzle } from 'drizzle-orm/node-sqlite';

// Simple — just a path
const db = drizzle("sqlite.db");

// Advanced — pass existing DatabaseSync
import { DatabaseSync } from 'node:sqlite';
const sqlite = new DatabaseSync('sqlite.db');
const db = drizzle({ client: sqlite });
```

No more `better-sqlite3` shim, no `aliasSelectColumns` SQL rewriting.

### Other v1 features

- **MSSQL support** — full dialect with drizzle-orm, drizzle-kit, drizzle-seed
- **CockroachDB support** — new dialect
- **Migration folders v3** — no `journal.json`, grouped folders, less Git conflicts
- **`drizzle-kit` rewrite** — DDL snapshots, 10x faster introspection
- **Validator consolidation** — `drizzle-zod` → `drizzle-orm/zod`, `drizzle-typebox` → `drizzle-orm/typebox`
- **Alternation engine** — advanced query branching (beta)
- **Commutativity checks** (`drizzle-kit check`) — detect migration collisions in teams
- **Column `.as()` alias** — direct column aliasing
- **Subqueries in select fields** — computed columns inline
- **RLS** — moved to `pgTable.withRLS()`
- **Prepared statements** — work inside relational queries with `sql.placeholder()`
- **PostgreSQL type fixes** — arrays of intervals, timestamps, dates now map correctly

## Breaking changes to handle

| Breaking change | Alepha impact |
|---|---|
| Migration folder restructure | Run `drizzle-kit up` once. Update `DrizzleKitProvider`. |
| Relations v1 → v2 | Alepha doesn't use Drizzle relations today — adopt v2 fresh. |
| PostgreSQL array/timestamp type fixes | Audit `db.createdAt()`, `db.updatedAt()` column mappings. |
| Database/session/migrator gain 2 new generics | Update `DatabaseProvider` types. |
| `DrizzleConfig` gains `TRelations` generic + `relations` field | Pass relations to `drizzle()` constructor. |
| Validator packages moved into `drizzle-orm/*` | Low impact — Alepha uses TypeBox directly. |
| `.enableRLS()` → `pgTable.withRLS()` | Check if Alepha uses RLS anywhere. |

## Migration steps

### 1. Upgrade dependencies

```bash
yarn add drizzle-orm@^1.0.0
yarn add -D drizzle-kit@^1.0.0
```

### 2. Replace `NodeSqliteProvider`

Delete the `better-sqlite3` shim code:
- `shimDatabaseSync()` (~50 lines)
- `aliasSelectColumns()` (~60 lines)
- `initDrizzle()` manual session construction (~20 lines)

Replace with:

```typescript
import { drizzle } from 'drizzle-orm/node-sqlite';
this.drizzleDb = drizzle({ client: this.sqlite, relations });
```

### 3. Auto-generate `defineRelations()` from `db.ref()`

The FK info already exists in `$entity` schemas. `ModelBuilder` or a new `RelationBuilder` should walk all registered entities and produce:

```typescript
const relations = defineRelations(tables, (r) => ({
  players: {
    team: r.one.teams({
      from: r.players.teamId,
      to: r.teams.id,
    }),
  },
  teams: {
    players: r.many.players(),
  },
}));
```

This is derivable from the `db.ref()` declarations — each ref knows its source column and target `EntityColumn`.

### 4. Add `relationalQuery()` to Repository

New method that delegates to `db.query.table.findMany()` with Alepha concerns:

```typescript
public async relationalQuery<Config>(config: RelationalQueryConfig<T>) {
  // Inject soft-delete filter
  // Inject org scoping
  // Encode values via codec
  // Emit repository:read:before/after events
  // Handle caching
  return await db.query[this.tableName].findMany(config);
}
```

### 5. Deprecate `findMany({ with })` for joins

Keep it working (backward compat) but log a deprecation warning pointing to `relationalQuery()`.

### 6. Run `drizzle-kit up`

Migrate existing migration folders to v3 format.

### 7. Audit timestamp/array types

PostgreSQL type fixes may change runtime values for:
- `db.createdAt()` / `db.updatedAt()` — timestamp columns
- Any array columns

### 8. Pass relations to `drizzle()` constructor

Update `DatabaseProvider` subclasses to pass the auto-generated relations when creating the Drizzle instance.

## Files affected

### Delete / heavily simplify

| File | Lines | Reason |
|---|---|---|
| `core/services/PgRelationManager.ts` | 131 | Replaced entirely by Drizzle's relational query engine |
| `NodeSqliteProvider.ts` shim code | ~150 | `shimDatabaseSync()`, `aliasSelectColumns()` gone |
| `PgQuery.ts` join types (`PgRelation`, `PgRelationMap`, `PgStatic`) | ~40 | Drizzle handles relation types natively |
| `PgQueryWhere.ts` relation where types (`PgQueryWhereRelations`) | ~10 | Drizzle v2 where syntax handles this |

### Modify

| File | Change |
|---|---|
| `Repository.ts` | Add `relationalQuery()`, deprecate `findMany({ with })` joins |
| `DatabaseProvider.ts` | Accept and pass `relations` to Drizzle constructor |
| `ModelBuilder.ts` / new `RelationBuilder.ts` | Generate `defineRelations()` from `db.ref()` |
| `DrizzleKitProvider.ts` | Update for migration folder v3 |
| `PostgresModelBuilder.ts` | Audit timestamp/array type changes |
| `NodeSqliteProvider.ts` | Replace shim with official driver |
| `BunSqliteProvider.ts` | Check if similar simplification applies |

## Where syntax comparison

Alepha's current syntax maps almost 1:1 to Drizzle v2:

```
Alepha                          Drizzle v2
──────                          ──────────
{ age: { gt: 18 } }            { age: { gt: 18 } }
{ age: { gte: 18, lte: 65 } }  { age: { gte: 18, lte: 65 } }
{ name: { contains: "foo" } }  { name: { ilike: "%foo%" } }
{ status: { inArray: [...] } }  { status: { in: [...] } }
{ isNull: true }                { isNull: true }
{ and: [...] }                  { AND: [...] }
{ or: [...] }                   { OR: [...] }
{ not: {...} }                  { NOT: {...} }
```

Differences to bridge:
- `inArray` → `in`, `notInArray` → `notIn`
- `and`/`or`/`not` → `AND`/`OR`/`NOT` (capitalized)
- `contains`/`startsWith`/`endsWith` — Alepha sugar, no Drizzle equivalent (expand to `ilike`)
- Drizzle adds `RAW: (table) => sql\`...\`` for inline raw SQL in where
