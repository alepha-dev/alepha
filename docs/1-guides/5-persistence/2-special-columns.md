# Special Columns

The `db` object from `alepha/orm` provides helper methods for database-specific column types. These extend the base `t` type system with attributes that control how columns behave at the database level.

```typescript check
import { z } from "alepha";
import { $entity, db } from "alepha/orm";
```

The `db` object is an instance of `DatabaseTypeProvider`. An older alias `pg` is deprecated in favor of `db`.

## Primary Key

`db.primaryKey()` creates an auto-generated primary key column.

```typescript
db.primaryKey()            // integer with identity (auto-increment) - default
db.primaryKey(z.uuid())    // UUID with auto-generated default
db.primaryKey(z.integer()) // integer with identity
db.primaryKey(z.bigint())  // bigint with identity
```

Calling `db.primaryKey()` with no argument creates an integer (identity) column. This is the default primary key type.

There are also explicit shortcut methods:

```typescript
db.identityPrimaryKey()    // integer with identity
db.bigIdentityPrimaryKey() // bigint with identity
db.uuidPrimaryKey()        // UUID
```

Every entity must have exactly one primary key. Multiple primary keys are not supported.

## Timestamps

### createdAt

`db.createdAt()` creates a datetime column that is automatically set to the current timestamp when a row is inserted.

```typescript
createdAt: db.createdAt(),
```

### updatedAt

`db.updatedAt()` creates a datetime column that is automatically set to the current timestamp on every update.

```typescript
updatedAt: db.updatedAt(),
```

### deletedAt

`db.deletedAt()` creates an optional datetime column for soft delete functionality. When present in an entity schema, all delete operations set this column to the current timestamp instead of removing the row. All query operations automatically filter out rows where `deletedAt` is not NULL.

```typescript
deletedAt: db.deletedAt(),
```

The column is nullable: `NULL` means the row is active, a timestamp means it has been soft-deleted.

Use `{ force: true }` in repository operations to bypass soft delete behavior.

## Version (Optimistic Locking)

`db.version()` creates an integer column for optimistic concurrency control. It defaults to `0` and is automatically incremented when the `save()` method is used on the repository.

```typescript
version: db.version(),
```

When `save()` is called, it includes the current version in the WHERE clause. If the version in the database has changed since the entity was fetched, a `DbVersionMismatchError` is thrown. This prevents lost updates in concurrent scenarios.

## Enum

`z.enum()` creates a native PostgreSQL ENUM type column by default.

```typescript
role: z.enum(["admin", "user", "moderator"]),
```

You can share an enum type across multiple tables by specifying a custom name:

```typescript
status: z.enum(["pending", "active", "archived"]).meta({ name: "status_enum" }),
```

To store as a TEXT column instead of a real PostgreSQL ENUM, use `mode: "text"`:

```typescript
status: z.enum(["pending", "active", "archived"]).meta({ mode: "text" }),
```

## Default Values

`db.default()` wraps a schema with a default value at the database level.

```typescript
isActive: db.default(z.boolean(), true),
score: db.default(z.integer(), 0),
```

When the column is omitted during insert, the database uses the default value.

## Foreign Key Reference

`db.ref()` creates a foreign key reference to another entity's column.

```typescript check
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

const team = $entity({
  name: "teams",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    name: z.text(),
  }),
});

const player = $entity({
  name: "players",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    name: z.text(),
    teamId: db.ref(z.uuid(), () => team.cols.id),
  }),
});
```

The second argument is a lazy function returning the target entity column. This handles circular references.

### onDelete / onUpdate Actions

By default, `db.ref()` infers the `onDelete` action from the column type:

- If the column is optional (`.optional()`), the default is `"set null"`.
- If the column is required, the default is `"cascade"`.

You can override this behavior with explicit actions:

```typescript
teamId: db.ref(z.uuid().optional(), () => team.cols.id, {
  onDelete: "set null",
  onUpdate: "cascade",
}),
```

Available actions: `"cascade"`, `"restrict"`, `"no action"`, `"set null"`, `"set default"`.

## Full Example

```typescript check
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

const user = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    email: z.email(),
    name: z.text(),
    role: z.enum(["admin", "user", "moderator"]),
    isActive: db.default(z.boolean(), true),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    version: db.version(),
  }),
  indexes: [
    { column: "email", unique: true },
  ],
});
```

## Page Schema

`db.page()` creates a page schema for use with paginated API responses. It wraps an entity schema with pagination metadata.

```typescript
const userPage = db.page(user.schema);
// Produces: { data: User[], page: { size, totalElements, totalPages } }
```

This is used internally by `Repository.paginate()` and can be used in action response schemas.
