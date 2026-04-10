# Repository

Alepha ORM is built on top of [Drizzle ORM](https://orm.drizzle.team/) and Drizzle Kit.

`$entity` defines a database table. `$repository` creates a type-safe data access layer for that table.

Alepha main target is PostgreSQL, but SQLite are also supported.

The API is mostly database-agnostic, but some features (e.g. certain column types or operators) may be database-specific.

```typescript
import { t } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
```

## Defining an Entity

An entity maps directly to a database table. The schema uses Alepha's `t` type system combined with `db` helpers for database-specific column types.

```typescript
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

const product = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    name: t.text(),
    price: t.number(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { column: "name", unique: true },
  ],
});
```

The `name` field sets the database table name. The `schema` field defines columns using TypeBox schemas. The `indexes` field configures database indexes for query optimization.

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
const user = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    tenantId: t.uuid(),
    username: t.text(),
    age: t.integer(),
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

For single-column foreign keys, prefer `db.ref()` on the column itself (see [Special Columns](./2-special-columns.md)).

## Creating a Repository

Use `$repository` as a class property to get a fully typed repository:

```typescript
class ProductService {
  repo = $repository(product);
}
```

Relations between tables are NOT handled by `$entity`. Instead, use the `with` option in repository query methods to perform joins. See [Joins](./6-joins.md) for full documentation.

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
  { page: 0, size: 10, sort: "name,asc" },
  { where: { price: { gt: 0 } } },
  { count: true },
);

// page.data        -> T[]
// page.page.size   -> number
// page.page.totalElements -> number (when count: true)
// page.page.totalPages    -> number (when count: true)
```

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

- `target` — column(s) to detect conflicts on. Defaults to the primary key.
- `set` — fields to update on conflict. Defaults to the insert data minus the target and primary key columns.

If the entity has an `updatedAt` column, it is automatically set on conflict.

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
const entity = await this.repo.findById("some-uuid");
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
const entity = await this.repo.findById("some-uuid");
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

You can also pass a raw Drizzle `SQLWrapper` as the where clause for full SQL control.

## Transactions

Use the `transaction` method to execute multiple operations atomically:

```typescript
await this.repo.transaction(async (tx) => {
  const user = await this.users.create({ name: "Alice" }, { tx });
  await this.orders.create({ userId: user.id, total: 50 }, { tx });
});
```

All repository methods accept `{ tx }` in their options parameter to participate in the transaction.

For transactions with built-in retry on version conflicts, use the `$transaction` primitive:

```typescript
import { $transaction } from "alepha/orm";

class OrderService {
  processOrder = $transaction({
    handler: async (tx, orderId: string) => {
      const order = await this.orders.getById(orderId, { tx });
      await this.orders.updateById(orderId, { status: "processed" }, { tx });
      return order;
    },
  });
}
```

`$transaction` automatically retries when a `DbVersionMismatchError` occurs.

## Repository.of

For inline repository creation without a separate entity variable:

```typescript
class App {
  users = $inject(Repository.of(userEntity));
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
