# Alepha Postgres

A type-safe SQL query builder and ORM using Drizzle.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Postgres client based on Drizzle ORM, Alepha type-safe friendly.

```ts
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
    email: t.text(),
  }),
});

class Db {
  users = $repository(users);
}

const db = alepha.inject(Db);
const user = await db.users.one({ name: { eq: "John Doe" } });
```

This is not a full ORM, but rather a set of tools to work with Postgres databases in a type-safe way.

It provides:
- A type-safe way to define entities and repositories. (via `$entity` and `$repository`)
- Custom query builders and filters.
- Built-in special columns like `createdAt`, `updatedAt`, `deletedAt`, `version`.
- Automatic JSONB support.
- Automatic synchronization of entities with the database schema (for testing and development).
- Fallback to raw SQL via Drizzle ORM `sql` function.

Migrations are supported via Drizzle ORM, you need to use the `drizzle-kit` CLI tool to generate and run migrations.

Relations are **NOT SUPPORTED** yet. If you need relations, please use the `drizzle-orm` package directly.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaPostgres } from "alepha/postgres";

const alepha = Alepha.create()
	.with(AlephaPostgres);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $entity()

Creates a database entity descriptor that defines table structure using TypeBox schemas.

This descriptor provides a type-safe way to define database tables using JSON Schema
syntax while generating the necessary database metadata for migrations and operations.
It integrates with Drizzle ORM under the hood and works seamlessly with the $repository
descriptor for complete database functionality.

**Key Features**

- **Type-Safe Schema Definition**: Uses TypeBox for full TypeScript type inference
- **Automatic Table Generation**: Creates Drizzle ORM table structures automatically
- **Index Management**: Supports single-column, multi-column, and unique indexes
- **Constraint Support**: Foreign keys, unique constraints, and check constraints
- **Audit Fields**: Built-in support for created_at, updated_at, deleted_at, and version fields
- **Schema Validation**: Automatic insert/update schema generation with validation

**Important Note**:
This descriptor only defines the table structure - it does not create the physical
database table. Use it with $repository to perform actual database operations,
and run migrations to create the tables in your database.

**Use Cases**

Essential for defining database schema in type-safe applications:
- User management and authentication tables
- Business domain entities (products, orders, customers)
- Audit and logging tables
- Junction tables for many-to-many relationships
- Configuration and settings tables

**Basic entity with indexes:**
```ts
import { $entity } from "alepha/postgres";
import { pg, t } from "alepha";

const User = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    email: t.text({ format: "email" }),
    username: t.text({ minLength: 3, maxLength: 30 }),
    firstName: t.text(),
    lastName: t.text(),
    isActive: t.boolean({ default: true }),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt()
  }),
  indexes: [
    "email",              // Simple index on email
    "username",           // Simple index on username
    { column: "email", unique: true },  // Unique constraint on email
    { columns: ["firstName", "lastName"] } // Composite index
  ]
});
```

**E-commerce product entity with relationships:**
```ts
const Product = $entity({
  name: "products",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    sku: t.text({ minLength: 3 }),
    name: t.text({ minLength: 1, maxLength: 200 }),
    description: t.optional(t.text()),
    price: t.number({ minimum: 0 }),
    categoryId: t.text({ format: "uuid" }),
    inStock: t.boolean({ default: true }),
    stockQuantity: t.integer({ minimum: 0, default: 0 }),
    tags: t.optional(t.array(t.text())), // PostgreSQL array column
    metadata: t.optional(t.record(t.text(), t.any())), // JSONB column
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt()
  }),
  indexes: [
    { column: "sku", unique: true },        // Unique SKU
    "categoryId",                           // Foreign key index
    "inStock",                             // Filter frequently by stock status
    { columns: ["categoryId", "inStock"] }, // Composite for category + stock queries
    "createdAt"                            // For date-based queries
  ],
  foreignKeys: [
    {
      name: "fk_product_category",
      columns: ["categoryId"],
      foreignColumns: [Category.id] // Reference to Category entity
    }
  ]
});
```

**Audit log entity with constraints:**
```ts
const AuditLog = $entity({
  name: "audit_logs",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    tableName: t.text(),
    recordId: t.text(),
    action: t.enum(["CREATE", "UPDATE", "DELETE"]),
    userId: t.optional(t.text({ format: "uuid" })),
    oldValues: t.optional(t.record(t.text(), t.any())),
    newValues: t.optional(t.record(t.text(), t.any())),
    timestamp: pg.createdAt(),
    ipAddress: t.optional(t.text()),
    userAgent: t.optional(t.text())
  }),
  indexes: [
    "tableName",
    "recordId",
    "userId",
    "action",
    { columns: ["tableName", "recordId"] }, // Find all changes to a record
    { columns: ["userId", "timestamp"] },   // User activity timeline
    "timestamp"  // Time-based queries
  ],
  constraints: [
    {
      name: "valid_action_values",
      columns: ["action"],
      check: sql`action IN ('CREATE', 'UPDATE', 'DELETE')`
    }
  ]
});
```

**Many-to-many junction table:**
```ts
const UserRole = $entity({
  name: "user_roles",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    userId: t.text({ format: "uuid" }),
    roleId: t.text({ format: "uuid" }),
    assignedBy: t.text({ format: "uuid" }),
    assignedAt: pg.createdAt(),
    expiresAt: t.optional(t.datetime())
  }),
  indexes: [
    "userId",
    "roleId",
    "assignedBy",
    { columns: ["userId", "roleId"], unique: true }, // Prevent duplicate assignments
    "expiresAt" // For cleanup of expired roles
  ],
  foreignKeys: [
    {
      columns: ["userId"],
      foreignColumns: [User.id]
    },
    {
      columns: ["roleId"],
      foreignColumns: [Role.id]
    },
    {
      columns: ["assignedBy"],
      foreignColumns: [User.id]
    }
  ]
});
```

#### $repository()

Creates a repository for database operations on a defined entity.

This descriptor provides a comprehensive, type-safe interface for performing all
database operations on entities defined with $entity. It offers a rich set of
CRUD operations, advanced querying capabilities, pagination, transactions, and
built-in support for audit trails and soft deletes.

**Key Features**

- **Complete CRUD Operations**: Create, read, update, delete with full type safety
- **Advanced Querying**: Complex WHERE conditions, sorting, pagination, and aggregations
- **Transaction Support**: Database transactions for consistency and atomicity
- **Soft Delete Support**: Built-in soft delete functionality with `pg.deletedAt()` fields
- **Optimistic Locking**: Version-based conflict resolution with `pg.version()` fields
- **Audit Trail Integration**: Automatic handling of `createdAt`, `updatedAt` timestamps
- **Raw SQL Support**: Execute custom SQL queries when needed
- **Pagination**: Built-in pagination with metadata and navigation

**Important Requirements**
- Must be used with an entity created by $entity
- Entity schema must include exactly one primary key field
- Database tables must be created via migrations before use

**Basic repository with CRUD operations:**
```ts
import { $entity, $repository } from "alepha/postgres";
import { pg, t } from "alepha";

// First, define the entity
const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    email: t.text({ format: "email" }),
    firstName: t.text(),
    lastName: t.text(),
    isActive: pg.default(t.boolean(), true),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt()
  }),
  indexes: [{ column: "email", unique: true }]
});

class UserService {
  users = $repository(users);

  async createUser(userData: { email: string; firstName: string; lastName: string }) {
    return await this.users.create({
      id: generateUUID(),
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName
    });
  }

  async getUserByEmail(email: string) {
    return await this.users.findOne({ email });
  }

  async updateUser(id: string, updates: { firstName?: string; lastName?: string }) {
    return await this.users.updateById(id, updates);
  }

  async deactivateUser(id: string) {
    return await this.users.updateById(id, { isActive: false });
  }
}
```

#### $sequence()

Creates a PostgreSQL sequence descriptor for generating unique numeric values.

#### $transaction()

Creates a transaction descriptor for database operations requiring atomicity and consistency.

This descriptor provides a convenient way to wrap database operations in PostgreSQL
transactions, ensuring ACID properties and automatic retry logic for version conflicts.
It integrates seamlessly with the repository pattern and provides built-in handling
for optimistic locking scenarios with automatic retry on version mismatches.

**Important Notes**:
- All operations within the transaction handler are atomic
- Automatic retry on `PgVersionMismatchError` for optimistic locking
- Pass `{ tx }` option to all repository operations within the transaction
- Transactions are automatically rolled back on any unhandled error
- Use appropriate isolation levels based on your consistency requirements
