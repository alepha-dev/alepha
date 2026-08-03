# Special Columns

The `db` object from `alepha/orm` provides helper methods for database-specific column types. These extend the base `t` type system with attributes that control how columns behave at the database level.

```typescript check
import { z } from "alepha";
import { $entity, db } from "alepha/orm";
```

The `db` object is an instance of `DatabaseTypeProvider`.

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

## Organization (Multi-Tenancy)

`db.organization()` marks the column that scopes a row to a tenant. The repository then filters every read by the resolved tenant and stamps it on every write — you never write the predicate yourself.

```typescript
const invoice = $entity({
  name: "invoices",
  schema: z.object({
    id: db.primaryKey(),
    organizationId: db.organization(),
    total: z.integer(),
  }),
});
```

The tenant is resolved from `currentTenantAtom` first, then from the authenticated user's `organization`. An app-level middleware typically writes the atom from the request `Host`.

### Declare whether the app is multi-tenant

Scoping only protects you if an *unresolved* tenant is an error rather than a wildcard. That is an application-wide decision, so it lives in an atom rather than on each entity:

```typescript
import { tenancyAtom } from "alepha/security";

// main.server.ts
alepha.set(tenancyAtom, { mode: "multi" });
```

| Mode | Behaviour with no resolved tenant |
|------|-----------------------------------|
| `"single"` (default) | No predicate — every row is visible. Correct when the app has one tenant, or none. |
| `"multi"` | **Throws.** Reads and writes are refused rather than run unscoped, and rows with a `NULL` organization are hidden from a scoped tenant. |

Set it once, at the composition root. Without it, a `$job` or an admin script that forgets to resolve a tenant reads and writes across all of them — including on the framework's own tables (`users`, `files`, `audits`, `parameters`, API keys, payments).

### Overriding per entity

`strict` overrides the mode in both directions, for the rare entity that is genuinely special:

```typescript
// Always fail closed, even in a single-tenant app.
organizationId: db.organization({ strict: true }),

// Never fail closed, even in "multi" — a shared reference table.
organizationId: db.organization({ strict: false }),
```

Leave it out unless you mean it: an entity that says nothing follows the application, which is where the decision belongs.

::: warning `strict` and `nullable` are different questions
`nullable` is a schema fact — it is written into your migration. `mode` is a runtime policy and never changes generated SQL. An entity that fails closed *because the app is in `multi` mode* still has a nullable column; only an explicit `strict: true` implies `NOT NULL`, because such a table has no "global row" concept.
:::

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
// Produces: { content: User[], page: { size, totalElements, totalPages, ... } }
```

This is used internally by `Repository.paginate()` and can be used in action response schemas.
