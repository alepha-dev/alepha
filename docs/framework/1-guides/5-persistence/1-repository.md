# Repository

Alepha ORM is built on top of [Drizzle ORM](https://orm.drizzle.team/) and Drizzle Kit.

`$entity` defines a database table. `$repository` creates a type-safe data access layer for that table.

Alepha's main target is PostgreSQL, but SQLite is also supported.

The API is mostly database-agnostic, but some features (e.g. certain column types or operators) may be database-specific.

```typescript check
import { z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
```

## Defining an Entity

An entity maps directly to a database table. The schema uses Alepha's Zod schema layer (`z`) combined with `db` helpers for database-specific column types.

```typescript check
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

const product = $entity({
  name: "products",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    sku: z.text(),
    name: z.text(),
    price: z.number(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { column: "name", unique: true },
  ],
});
```

The `name` field sets the database table name. The `schema` field defines columns using Zod schemas. The `indexes` field configures database indexes for query optimization.

### Index Options

Indexes accept several forms:

```typescript
indexes: [
  "name",                                    // simple index on one column
  { column: "email", unique: true },         // unique index on one column
  { columns: ["tenantId", "name"], unique: true }, // composite unique index
  { column: "status", name: "idx_status" },  // index with custom name
],
```

### Constraints

Entities support unique constraints and check constraints at the table level:

```typescript
import { $entity, db, sql } from "alepha/orm";

const user = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    tenantId: z.uuid(),
    username: z.text(),
    age: z.integer(),
  }),
  constraints: [
    { columns: ["tenantId", "username"], unique: true },
    { columns: ["age"], check: sql`age >= 0 AND age <= 150` },
  ],
});
```

### Foreign Keys

Explicit foreign key constraints can be declared at the entity level:

```typescript
foreignKeys: [
  {
    columns: ["authorId"],
    foreignColumns: [() => user.cols.id],
  },
],
```

For single-column foreign keys, prefer `db.ref()` on the column itself (see [Special Columns](/docs/guides-persistence-special-columns)).

## Creating a Repository

Use `$repository` as a class property to get a fully typed repository:

```typescript
class ProductService {
  repo = $repository(product);
}
```

Relations between tables are NOT handled by `$entity`. Declare them separately with `$relations` and read them with `include` - see [Relations](/docs/guides-persistence-relations). For a one-off SQL join written per query, the `with` option is still there; see [Joins](/docs/guides-persistence-joins).

## Query Methods

### findMany

Find multiple records. Supports where, limit, offset, orderBy, groupBy, distinct, columns, and with (joins).

```typescript
const items = await this.repo.findMany({
  where: { price: { gte: 10 } },
  orderBy: { column: "name", direction: "asc" },
  limit: 20,
  offset: 0,
});
```

### findOne

Find a single record. Returns `undefined` if not found.

```typescript
const item = await this.repo.findOne({
  where: { name: { eq: "Widget" } },
});
```

### getOne

Find a single record. Throws `DbEntityNotFoundError` if not found.

```typescript
const item = await this.repo.getOne({
  where: { name: { eq: "Widget" } },
});
```

### findById / getById

Look up a record by primary key. `findById` returns `undefined` if not found, `getById` throws `DbEntityNotFoundError`.

```typescript
const item = await this.repo.findById("some-uuid");
const item = await this.repo.getById("some-uuid"); // throws if missing
```

### paginate

Returns paginated results with metadata.

```typescript
const page = await this.repo.paginate(
  { page: 0, size: 10, sort: "name" },
  { where: { price: { gt: 0 } } },
  { count: true },
);

// page.content     -> T[]
// page.page.size   -> number
// page.page.totalElements -> number (when count: true)
// page.page.totalPages    -> number (when count: true)
```

The `sort` string is a comma-separated column list; prefix a column with `-` for descending order: `"name"`, `"-createdAt"`, `"role,-name"`.

### count

Count matching records.

```typescript
const total = await this.repo.count({ status: { eq: "active" } });
```

### query

Execute raw SQL using Drizzle's `sql` tagged template. Returns decoded entities.

```typescript
import { sql } from "alepha/orm";

const results = await this.repo.query(
  (table) => sql`SELECT * FROM ${table} WHERE ${table.price} > ${100}`,
);
```

### aggregate

Grouped aggregations (`sum`, `avg`, `min`, `max`, count) without writing raw SQL -
see [Joins](/docs/guides-persistence-joins) for the aggregation pipeline it powers.

## Create Methods

### create

Create a single entity. Returns the full created entity.

```typescript
const created = await this.repo.create({
  name: "Widget",
  price: 9.99,
});
```

### createMany

Batch-create entities. Inserts are batched in chunks of 1000 by default.

```typescript
const items = await this.repo.createMany(
  [{ name: "A", price: 1 }, { name: "B", price: 2 }],
  { batchSize: 500 },
);
```

### upsert

Insert a new entity or update an existing one if a conflict is detected. Works on both PostgreSQL and SQLite.

```typescript
// Simple upsert on primary key
const product = await this.repo.upsert({
  id: "some-uuid",
  name: "Widget",
  price: 9.99,
});

// Upsert on a unique column
const product = await this.repo.upsert(
  { id: "some-uuid", sku: "WIDGET-1", name: "Widget", price: 9.99 },
  { target: ["sku"] },
);

// Upsert with custom update fields (only update price on conflict)
const product = await this.repo.upsert(
  { id: "some-uuid", sku: "WIDGET-1", name: "Widget", price: 19.99 },
  { target: ["sku"], set: { price: 19.99 } },
);
```

- `target`: column(s) to detect conflicts on. Defaults to the primary key.
- `set`: fields to update on conflict. Defaults to the insert data minus the target and primary key columns.

If the entity has an `updatedAt` column, it is automatically set on conflict.

### upsertMany

Batch upsert. Same options as `upsert`, with two batch-only rules: every row must
resolve to the same conflict target, and a counter-style `set` must read from
`excluded` (the incoming row) rather than the table, or every row after the first
sees stale values.

## Update Methods

### updateOne

Find a single entity by where clause and update it. Throws `DbEntityNotFoundError` if not found. Returns the updated entity.

```typescript
const updated = await this.repo.updateOne(
  { name: { eq: "Widget" } },
  { price: 12.99 },
);
```

### updateById

Update by primary key. Returns the updated entity.

```typescript
const updated = await this.repo.updateById("some-uuid", { price: 12.99 });
```

### updateMany

Update multiple records matching a where clause. Returns an array of updated entity IDs.

```typescript
const ids = await this.repo.updateMany(
  { status: { eq: "draft" } },
  { status: "published" },
);
```

### save

Save a previously fetched entity. Uses optimistic locking when a `version` column is present. Unlike `updateOne`/`updateById`, `save` expects the full entity object and sets `undefined` fields to `null`.

```typescript
const entity = await this.repo.getById("some-uuid"); // getById throws if missing
entity.name = "Updated Name";
await this.repo.save(entity);
```

If the version has changed since the entity was fetched, `save` throws `DbVersionMismatchError`.

## Delete Methods

### deleteOne

Delete a single entity matching the where clause. Returns an array of deleted IDs.

```typescript
await this.repo.deleteOne({ name: { eq: "Widget" } });
```

### deleteById

Delete by primary key. Throws `DbEntityNotFoundError` if not found.

```typescript
await this.repo.deleteById("some-uuid");
```

### deleteMany

Delete multiple records matching a where clause. Returns an array of deleted IDs.

```typescript
const ids = await this.repo.deleteMany({ status: { eq: "archived" } });
```

### destroy

Delete a previously fetched entity by its primary key.

```typescript
const entity = await this.repo.getById("some-uuid");
await this.repo.destroy(entity);
```

### clear

Delete all records in the table.

```typescript
await this.repo.clear();
```

### Soft Delete

If the entity schema includes a `db.deletedAt()` column, all delete operations automatically perform a soft delete by setting the `deletedAt` timestamp instead of removing the row. All query operations automatically filter out soft-deleted records.

To perform a hard delete on a soft-deletable entity, pass `{ force: true }`:

```typescript
await this.repo.deleteById("some-uuid", { force: true });
```

To include soft-deleted records in queries, also use `{ force: true }`:

```typescript
const all = await this.repo.findMany({}, { force: true });
```

## Where Clause Operators

Where clauses accept either a direct value (shorthand for `eq`) or an object with filter operators:

```typescript
// Direct value (shorthand for eq)
{ status: "active" }

// Explicit operator
{ status: { eq: "active" } }
```

**Never pass `undefined` into a where-filter.** `where: { col: undefined }` throws
`AlephaError` - it used to be dropped silently, which produced a query with no
`WHERE` clause at all. For optional filters, omit the key entirely:

```typescript
const where: Record<string, unknown> = {};
if (status) where.status = status;
```

### Comparison Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equal |
| `ne` | Not equal |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |

### Array Operators

| Operator | Description |
|----------|-------------|
| `inArray` | Value in list |
| `notInArray` | Value not in list |

### Null Operators

| Operator | Description |
|----------|-------------|
| `isNull` | Value is NULL |
| `isNotNull` | Value is not NULL |

### Range Operators

| Operator | Description |
|----------|-------------|
| `between` | Value in range (inclusive). Accepts `[min, max]` |
| `notBetween` | Value outside range. Accepts `[min, max]` |

### String Operators

| Operator | Description |
|----------|-------------|
| `like` | Pattern match (case-sensitive) |
| `notLike` | Negated pattern match (case-sensitive) |
| `ilike` | Pattern match (case-insensitive) |
| `notIlike` | Negated pattern match (case-insensitive) |
| `eqInsensitive` | Case-insensitive equality |
| `contains` | Case-insensitive substring match. Equivalent to `ilike: '%value%'` |
| `startsWith` | Case-insensitive prefix match. Equivalent to `ilike: 'value%'` |
| `endsWith` | Case-insensitive suffix match. Equivalent to `ilike: '%value'` |

### PostgreSQL Array Operators

| Operator | Description |
|----------|-------------|
| `arrayContains` | Column contains all elements of the given array |
| `arrayContained` | Given array contains all elements of the column |
| `arrayOverlaps` | Column shares any element with the given array |

### Logical Operators

Combine conditions with `and`, `or`, or negate with `not`:

```typescript
{
  and: [
    { status: { eq: "active" } },
    { or: [
      { role: { eq: "admin" } },
      { role: { eq: "moderator" } },
    ]},
  ],
}
```

Where clauses also support `exists` / `notExists` subquery conditions at the top level, and you can pass a raw Drizzle `SQLWrapper` as the where clause for full SQL control.

## Transactions

Use the `transaction` method to execute multiple operations atomically:

```typescript
await this.repo.transaction(async (tx) => {
  const user = await this.users.create({ name: "Alice" }, { tx });
  await this.orders.create({ userId: user.id, total: 50 }, { tx });
});
```

All repository methods accept `{ tx }` in their options parameter to participate in the transaction. Beyond `tx`, that options parameter also takes `force` (skip optimistic locking), `for` (row locks, e.g. `{ for: "update" }`), `now` (override the timestamp used for `updatedAt`), and `cache` (per-statement cache control).

On drivers without interactive transaction support - Cloudflare D1 - `transaction()` throws and tells you to use `$transactional()` instead.

To wrap a whole handler in a transaction without drilling `{ tx }` through every call, use the `$transactional` middleware:

```typescript
import { $action } from "alepha/server";
import { $transactional } from "alepha/orm";

class OrderService {
  processOrder = $action({
    use: [$transactional()],
    handler: async ({ body }) => {
      await this.orders.create(body);       // auto-uses the transaction
      await this.audit.create({ ... });     // auto-uses the transaction
      // throw → rollback, return → commit
    },
  });
}
```

Every repository operation inside the handler automatically participates in the transaction. Nesting is safe - a nested `$transactional` reuses the outer transaction.

Concurrency is safe too: each `transactional()` call runs in its own context, so two blocks started at the same time - `Promise.all`, two requests, a job racing a handler - never read or write through each other's transaction.

### After the commit

Side effects that must only happen once the data is durable - emitting a domain event, sending an email - do not belong inside the transaction: subscribers would read uncommitted rows and every lock the transaction holds stays held while they run. Register them with `DatabaseProvider.afterCommit()` instead:

```typescript
import { $inject } from "alepha";
import { DatabaseProvider } from "alepha/orm";

class OrderService {
  protected readonly db = $inject(DatabaseProvider);

  async markPaid(id: string) {
    return this.db.transactional(async () => {
      const order = await this.orders.updateById(id, { status: "paid" });

      await this.db.afterCommit(() =>
        this.alepha.events.emit("commerce:order:paid", { orderId: order.id }),
      );

      return order;
    });
  }
}
```

Because nested `transactional()` blocks join the outermost transaction, the callback waits for the *outermost* commit - even when the method is called from inside someone else's transaction. Callbacks run in registration order and are discarded if the transaction rolls back. Outside any transaction, `afterCommit` runs its callback immediately.

## Repository.of

For inline repository creation without a separate entity variable:

```typescript
import { $inject } from "alepha";
import { Repository } from "alepha/orm";

class App {
  users = $inject(Repository.of(user)); // user: the $entity from above
}
```

This creates a Repository subclass bound to the given entity, suitable for use with `$inject`.

## Events

Repository operations emit lifecycle events:

| Event | Payload |
|-------|---------|
| `repository:create:before` | `{ tableName, data }` |
| `repository:create:after` | `{ tableName, data, entity }` |
| `repository:update:before` | `{ tableName, where, data }` |
| `repository:update:after` | `{ tableName, where, data, entities }` |
| `repository:delete:before` | `{ tableName, where }` |
| `repository:delete:after` | `{ tableName, where, ids }` |
| `repository:read:before` | `{ tableName, query }` |
| `repository:read:after` | `{ tableName, query, entities }` |

## Error Types

| Error | Thrown When |
|-------|------------|
| `DbEntityNotFoundError` | `getOne`, `getById`, `updateOne`, `deleteById` find no match |
| `DbVersionMismatchError` | `save` detects a version conflict (optimistic locking) |
| `DbConflictError` | Unique constraint violation |
| `DbForeignKeyError` | Foreign key constraint violation |
| `DbNotNullError` | NOT NULL constraint violation |
| `DbDeadlockError` | Database deadlock detected |
| `DbTableNotFoundError` | Referenced table does not exist |
| `DbColumnNotFoundError` | Referenced column does not exist |
| `DbConnectionError` | The database cannot be reached |
| `DbMigrationError` | A migration fails to apply |
