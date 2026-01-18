# Database Access

Alepha supports **Postgres** and **SQLite**. Pick your poison.

Under the hood, we use **Drizzle ORM** — it's fast, typesafe, and doesn't try to be clever.

But you won't interact with Drizzle directly. We wrap everything in Alepha primitives so you can focus on your data, not your ORM.

> **Not locked in**
>
> `alepha/orm` is our recommended approach, but it's not mandatory. You can use Drizzle directly, Prisma, or whatever else you prefer. We just don't document those paths.

## Defining Entities

Instead of writing SQL or complex class mappers, you define an `$entity`.
This acts as the source of truth for both your TypeScript types and your database table structure.

```typescript
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

// src/entities/User.ts
export const userEntity = $entity({
  name: "users", // The table name
  schema: t.object({
    // db.primaryKey() handles UUID/Integer/BigInt generation automatically
    id: db.primaryKey(),

    // Standard TypeBox types
    email: t.email(),
    name: t.text(),

    // Automatic timestamp management
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  // Simple index definition
  indexes: ["email"],
});
```

> **Module-level primitive**
>
> Unlike most primitives (`$action`, `$repository`, `$queue`...), `$entity` lives at the module level, not inside a class. This is intentional — entities are shared definitions, not instance behavior.

## Using Repositories

Two ways to get a repository. Pick based on your needs.

### Quick: `$repository`

Inline, minimal, gets the job done.

```typescript
import { $repository } from "alepha/orm";
import { userEntity } from "./entities/User.ts";

class UserService {
  repo = $repository(userEntity);
}
```

### Class-based: `extends Repository.of()`

More explicit, and lets you add custom methods.

```typescript
import { Repository } from "alepha/orm";
import { userEntity } from "./entities/User.ts";

export class UserRepository extends Repository.of(userEntity) {
  // Add your custom methods here
  async findByEmail(email: string) {
    return this.findOne({ where: { email: { eq: email } } });
  }

  async findActiveUsers() {
    return this.findMany({ where: { status: { eq: "active" } } });
  }
}

// Then inject it like any other service
class UserService {
  repo = $inject(UserRepository);
}
```

## Reading Data

### Find Many

The workhorse. Returns an array (possibly empty).

```typescript
// Get all users
const users = await this.repo.findMany();

// With filters
const admins = await this.repo.findMany({
  where: { role: { eq: "admin" } },
  orderBy: "-createdAt", // Descending
  limit: 10,
});
```

### Find One

Returns exactly one entity. **Throws `DbEntityNotFoundError` if nothing matches.**

This is intentional. If you're looking for something specific and it doesn't exist, that's usually a problem. No more `if (!user) throw...` everywhere.

```typescript
// This WILL throw if user doesn't exist
const user = await this.repo.findOne({
  where: { email: { eq: "john@example.com" } }
});

// Want to handle "not found" yourself? Use findMany with limit: 1
const [maybeUser] = await this.repo.findMany({
  where: { email: { eq: "john@example.com" } },
  limit: 1,
});
if (!maybeUser) {
  // Handle it your way
}
```

### Find By ID

Shortcut for `findOne` with the primary key. Also **throws if not found**.

```typescript
const user = await this.repo.findById("550e8400-e29b-41d4-a716-446655440000");
```

### Pagination

Built-in pagination with metadata. No more manual offset math.

```typescript
const page = await this.repo.paginate(
  { page: 0, size: 20, sort: "-createdAt" },
  { where: { status: { eq: "active" } } },
  { count: true } // Optional: get total count (extra query)
);

// Returns:
// {
//   content: User[],
//   page: {
//     size: 20,
//     number: 0,
//     totalElements: 142,  // Only if count: true
//     totalPages: 8,       // Only if count: true
//     hasNext: true,
//   }
// }
```

## Creating Data

### Create

Creates one entity. Returns the created entity with all database-generated fields (ID, timestamps, etc.).

```typescript
const user = await this.repo.create({
  email: "new@example.com",
  name: "New User",
});
// user.id is now set
// user.createdAt is now set
```

### Create Many

Batch insert. Automatically chunks into batches of 1000 to avoid database limits.

```typescript
const users = await this.repo.createMany([
  { email: "a@example.com", name: "A" },
  { email: "b@example.com", name: "B" },
  // ... even 10,000 items, we handle it
]);
```

## Updating Data

### Update One

Finds and updates a single entity. **Throws `DbEntityNotFoundError` if nothing matches.**

```typescript
const updated = await this.repo.updateOne(
  { email: { eq: "old@example.com" } },
  { email: "new@example.com" }
);
```

### Update By ID

Shortcut. Also **throws if not found**.

```typescript
const updated = await this.repo.updateById(userId, {
  name: "New Name",
});
```

### Update Many

Updates all matching entities. Returns array of updated IDs. Does **not** throw if nothing matches (just returns empty array).

```typescript
const updatedIds = await this.repo.updateMany(
  { status: { eq: "pending" } },
  { status: "expired" }
);
```

### Save (with Optimistic Locking)

For when you fetch an entity, modify it, and save it back. If you have a `db.version()` field, Alepha checks that nobody else modified it in the meantime.

```typescript
const user = await this.repo.findById(userId);
user.name = "Updated Name";
await this.repo.save(user);
// If someone else updated the user between findById and save,
// throws DbVersionMismatchError
```

> **When to use `save()` vs `updateById()`?**
>
> Use `updateById()` for quick, targeted updates. Use `save()` when you've loaded the entity, done some logic, and want to persist changes with version checking.

## Deleting Data

### Soft Delete (The Default)

If your entity has a `db.deletedAt()` field, deletes are **soft by default**. The record stays in the database with a timestamp.

```typescript
// src/entities/User.ts
export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    deletedAt: db.deletedAt(), // This enables soft delete
  }),
});

// This sets deletedAt, doesn't actually delete
await this.repo.deleteById(userId);

// Future queries automatically filter out soft-deleted records
const users = await this.repo.findMany(); // Won't include deleted users
```

### Hard Delete

Need to actually remove data? Use `force: true`.

```typescript
// Actually removes the row from the database
await this.repo.deleteById(userId, { force: true });

// Or query including soft-deleted records
const allUsers = await this.repo.findMany({}, { force: true });
```

### Delete Methods

```typescript
// By ID - throws if not found
await this.repo.deleteById(userId);

// By condition - does not throw if nothing matches
await this.repo.deleteMany({ status: { eq: "expired" } });

// Delete a fetched entity
const user = await this.repo.findById(userId);
await this.repo.destroy(user);

// Nuclear option: delete everything
await this.repo.clear();
```

## Error Handling

Alepha throws specific errors so you can handle them properly.

```typescript
import {
  DbEntityNotFoundError,
  DbConflictError,
  DbVersionMismatchError,
} from "alepha/orm";

try {
  await this.repo.create({ email: "duplicate@example.com" });
} catch (error) {
  if (error instanceof DbConflictError) {
    // Unique constraint violation (duplicate email)
  }
  if (error instanceof DbEntityNotFoundError) {
    // Entity not found (from findOne, findById, updateById, deleteById)
  }
  if (error instanceof DbVersionMismatchError) {
    // Optimistic lock failed (someone else modified the entity)
  }
}
```

## Migrations

"But how do I create the table?"

Alepha integrates with Drizzle Kit. You don't need to manually write migration files for every little change during development.

1.  **Dev Mode:** When you run `alepha dev`, we check your `$entity` definitions against the database. If they differ, we (safely) suggest or apply changes to your development DB.
2.  **Production:** You generate migration files.

```bash
# Check what changed
alepha db generate

# Apply changes
alepha db migrate
```

## Transactions

Use `$transaction` when you need atomicity.

```typescript
import { $transaction } from "alepha/orm";

class BillingService {
  process = $transaction({
    handler: async (tx, userId: string, amount: number) => {
      // Pass { tx } to repository methods to use the transaction scope
      await this.userRepo.updateById(userId, { status: "paid" }, { tx });
      await this.invoiceRepo.create({ userId, amount }, { tx });
      // If anything throws, both operations are rolled back
    }
  });
}
```

## Raw SQL

Sometimes the ORM isn't enough. Drop down to raw SQL while keeping some type safety.

```typescript
import { sql } from "alepha/orm";

// Simple query
const adults = await this.repo.query(
  sql`SELECT * FROM users WHERE age > 18`
);

// Using the table reference (safer)
const adults = await this.repo.query((users) =>
  sql`SELECT * FROM ${users} WHERE ${users.age} > ${18}`
);
```

### Aggregations with Custom Schema

For complex queries that don't match your entity schema, pass a custom schema as the second argument.

```typescript
import { $inject, t } from "alepha";
import { DatabaseProvider, sql } from "alepha/orm";

class StatsService {
  tasks = $repository(taskEntity);

  async getOverview(projectId: number) {
    const [stats] = await this.tasks.query(
      table =>
      sql`
        SELECT
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as completed,
          AVG(complexity) as avg_complexity
        FROM ${table}
        WHERE project_id = ${projectId}
      `,
      // Custom schema
      // note: TypeBox auto-casts strings to numbers
      t.object({
        total_tasks: t.integer(),
        completed: t.integer(),
        avg_complexity: t.number(),
      }),
    );

    return stats;
  }
}
```

## Where Clause Operators

The `where` object supports these operators:

```typescript
await this.repo.findMany({
  where: {
    // Equality
    status: { eq: "active" },

    // Comparison
    age: { gt: 18 },        // greater than
    age: { gte: 18 },       // greater than or equal
    age: { lt: 65 },        // less than
    age: { lte: 65 },       // less than or equal

    // Null checks
    deletedAt: { isNull: true },
    email: { isNotNull: true },

    // Lists
    role: { in: ["admin", "moderator"] },
    status: { notIn: ["banned", "deleted"] },

    // Text search
    name: { like: "%john%" },
    email: { ilike: "%@GMAIL.COM" }, // Case-insensitive

    // Logical operators
    and: [
      { status: { eq: "active" } },
      { role: { eq: "admin" } },
    ],
    or: [
      { email: { like: "%@company.com" } },
      { role: { eq: "admin" } },
    ],
  },
});
```
