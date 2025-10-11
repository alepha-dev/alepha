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

**Entity with custom Drizzle configuration:**
```ts
const Order = $entity({
  name: "orders",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    orderNumber: t.text(),
    customerId: t.text({ format: "uuid" }),
    status: t.enum(["pending", "processing", "shipped", "delivered"]),
    totalAmount: t.number({ minimum: 0 }),
    currency: t.text({ default: "USD" }),
    notes: t.optional(t.text()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    version: pg.version()
  }),
  indexes: [
    { column: "orderNumber", unique: true },
    "customerId",
    "status",
    "createdAt",
    { columns: ["customerId", "status"] }
  ],
  // Advanced Drizzle ORM configuration
  config: (table) => [
    // Custom index with specific options
    index("idx_orders_amount_status")
      .on(table.totalAmount, table.status)
      .where(sql`status != 'cancelled'`), // Partial index

    // Full-text search index (PostgreSQL specific)
    index("idx_orders_search")
      .using("gin", table.notes)
  ]
});
```

#### $repository()

Creates a repository descriptor for database operations on a defined entity.

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

**Use Cases**

Essential for all database-driven applications:
- User management and authentication systems
- E-commerce product and order management
- Content management and blogging platforms
- Financial and accounting applications
- Any application requiring persistent data storage

**Basic repository with CRUD operations:**
```ts
import { $entity, $repository } from "alepha/postgres";
import { pg, t } from "alepha";

// First, define the entity
const User = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    email: t.text({ format: "email" }),
    firstName: t.text(),
    lastName: t.text(),
    isActive: t.boolean({ default: true }),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt()
  }),
  indexes: [{ column: "email", unique: true }]
});

class UserService {
  users = $repository({ table: User });

  async createUser(userData: { email: string; firstName: string; lastName: string }) {
    return await this.users.create({
      id: generateUUID(),
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      isActive: true
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

**Advanced querying and filtering:**
```ts
const Product = $entity({
  name: "products",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    name: t.text(),
    price: t.number({ minimum: 0 }),
    categoryId: t.text({ format: "uuid" }),
    inStock: t.boolean(),
    tags: t.optional(t.array(t.text())),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt()
  }),
  indexes: ["categoryId", "inStock", "price"]
});

class ProductService {
  products = $repository({ table: Product });

  async searchProducts(filters: {
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    inStock?: boolean;
    searchTerm?: string;
  }, page: number = 0, size: number = 20) {
    const query = this.products.createQuery({
      where: {
        and: [
          filters.categoryId ? { categoryId: filters.categoryId } : {},
          filters.inStock !== undefined ? { inStock: filters.inStock } : {},
          filters.minPrice ? { price: { gte: filters.minPrice } } : {},
          filters.maxPrice ? { price: { lte: filters.maxPrice } } : {},
          filters.searchTerm ? { name: { ilike: `%${filters.searchTerm}%` } } : {}
        ]
      },
      orderBy: [{ column: "createdAt", direction: "desc" }]
    });

    return await this.products.paginate({ page, size }, query, { count: true });
  }

  async getTopSellingProducts(limit: number = 10) {
    // Custom SQL query for complex analytics
    return await this.products.query(
      (table, db) => db
        .select({
          id: table.id,
          name: table.name,
          price: table.price,
          salesCount: sql<number>`COALESCE(sales.count, 0)`
        })
        .from(table)
        .leftJoin(
          sql`(
            SELECT product_id, COUNT(*) as count
            FROM order_items
            WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY product_id
          ) sales`,
          sql`sales.product_id = ${table.id}`
        )
        .orderBy(sql`sales.count DESC NULLS LAST`)
        .limit(limit)
    );
  }
}
```

**Transaction handling and data consistency:**
```ts
class OrderService {
  orders = $repository({ table: Order });
  orderItems = $repository({ table: OrderItem });
  products = $repository({ table: Product });

  async createOrderWithItems(orderData: {
    customerId: string;
    items: Array<{ productId: string; quantity: number; price: number }>;
  }) {
    return await this.orders.transaction(async (tx) => {
      // Create the order
      const order = await this.orders.create({
        id: generateUUID(),
        customerId: orderData.customerId,
        status: 'pending',
        totalAmount: orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
      }, { tx });

      // Create order items and update product inventory
      for (const itemData of orderData.items) {
        await this.orderItems.create({
          id: generateUUID(),
          orderId: order.id,
          productId: itemData.productId,
          quantity: itemData.quantity,
          unitPrice: itemData.price
        }, { tx });

        // Update product inventory using optimistic locking
        const product = await this.products.findById(itemData.productId, { tx });
        if (product.stockQuantity < itemData.quantity) {
          throw new Error(`Insufficient stock for product ${itemData.productId}`);
        }

        await this.products.save({
          ...product,
          stockQuantity: product.stockQuantity - itemData.quantity
        }, { tx });
      }

      return order;
    });
  }
}
```

**Soft delete and audit trail:**
```ts
const Document = $entity({
  name: "documents",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    title: t.text(),
    content: t.text(),
    authorId: t.text({ format: "uuid" }),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt()  // Enables soft delete
  })
});

class DocumentService {
  documents = $repository({ table: Document });

  async updateDocument(id: string, updates: { title?: string; content?: string }) {
    // This uses optimistic locking via the version field
    const document = await this.documents.findById(id);
    return await this.documents.save({
      ...document,
      ...updates  // updatedAt will be set automatically
    });
  }

  async softDeleteDocument(id: string) {
    // Soft delete - sets deletedAt timestamp
    await this.documents.deleteById(id);
  }

  async permanentDeleteDocument(id: string) {
    // Hard delete - actually removes from database
    await this.documents.deleteById(id, { force: true });
  }

  async getActiveDocuments() {
    // Automatically excludes soft-deleted records
    return await this.documents.find({
      where: { authorId: { isNotNull: true } },
      orderBy: [{ column: "updatedAt", direction: "desc" }]
    });
  }

  async getAllDocumentsIncludingDeleted() {
    // Include soft-deleted records
    return await this.documents.find({}, { force: true });
  }
}
```

**Complex filtering and aggregation:**
```ts
class AnalyticsService {
  users = $repository({ table: User });
  orders = $repository({ table: Order });

  async getUserStatistics(filters: {
    startDate?: string;
    endDate?: string;
    isActive?: boolean;
  }) {
    const whereConditions = [];

    if (filters.startDate) {
      whereConditions.push({ createdAt: { gte: filters.startDate } });
    }
    if (filters.endDate) {
      whereConditions.push({ createdAt: { lte: filters.endDate } });
    }
    if (filters.isActive !== undefined) {
      whereConditions.push({ isActive: filters.isActive });
    }

    const totalUsers = await this.users.count({
      and: whereConditions
    });

    const activeUsers = await this.users.count({
      and: [...whereConditions, { isActive: true }]
    });

    // Complex aggregation query
    const recentActivity = await this.users.query(
      sql`
        SELECT
          DATE_TRUNC('day', created_at) as date,
          COUNT(*) as new_users,
          COUNT(*) FILTER (WHERE is_active = true) as active_users
        FROM users
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date DESC
      `
    );

    return {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      recentActivity
    };
  }
}
```

#### $sequence()

Creates a PostgreSQL sequence descriptor for generating unique numeric values.

This descriptor provides a type-safe interface to PostgreSQL sequences, which are
database objects that generate unique numeric identifiers. Sequences are commonly
used for primary keys, order numbers, invoice numbers, and other cases where
guaranteed unique, incrementing values are needed across concurrent operations.

**Key Features**

- **Thread-Safe**: PostgreSQL sequences are inherently thread-safe and handle concurrency
- **Configurable Parameters**: Start value, increment, min/max bounds, and cycling behavior
- **Automatic Creation**: Sequences are created automatically when first used
- **Type Safety**: Full TypeScript support with numeric return types
- **Performance**: Optimized for high-throughput ID generation
- **Schema Support**: Works with PostgreSQL schemas for organization

**Use Cases**

Perfect for generating unique identifiers in concurrent environments:
- Primary key generation (alternative to UUIDs)
- Order numbers and invoice sequences
- Ticket numbers and reference IDs
- Version numbers and revision tracking
- Batch numbers for processing workflows
- Any scenario requiring guaranteed unique incrementing numbers

**Basic sequence for order numbers:**
```ts
import { $sequence } from "alepha/postgres";

class OrderService {
  orderNumbers = $sequence({
    name: "order_numbers",
    start: 1000,      // Start from order #1000
    increment: 1      // Increment by 1 each time
  });

  async createOrder(orderData: OrderData) {
    const orderNumber = await this.orderNumbers.next();

    return await this.orders.create({
      id: generateUUID(),
      orderNumber,
      ...orderData
    });
  }

  async getCurrentOrderNumber() {
    // Get the last generated number without incrementing
    return await this.orderNumbers.current();
  }
}
```

**Invoice numbering with yearly reset:**
```ts
class InvoiceService {
  // Separate sequence for each year
  getInvoiceSequence(year: number) {
    return $sequence({
      name: `invoice_numbers_${year}`,
      start: 1,
      increment: 1
    });
  }

  async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const sequence = this.getInvoiceSequence(year);
    const number = await sequence.next();

    // Format as INV-2024-001, INV-2024-002, etc.
    return `INV-${year}-${number.toString().padStart(3, '0')}`;
  }
}
```

**High-performance ID generation with custom increments:**
```ts
class TicketService {
  // Generate ticket numbers in increments of 10 for better distribution
  ticketSequence = $sequence({
    name: "ticket_numbers",
    start: 1000,
    increment: 10,
    min: 1000,
    max: 999999,
    cycle: false  // Don't cycle when max is reached
  });

  priorityTicketSequence = $sequence({
    name: "priority_ticket_numbers",
    start: 1,
    increment: 1,
    min: 1,
    max: 999,
    cycle: true   // Cycle when reaching max
  });

  async generateTicketNumber(isPriority: boolean = false): Promise<number> {
    if (isPriority) {
      return await this.priorityTicketSequence.next();
    }
    return await this.ticketSequence.next();
  }

  async getSequenceStatus() {
    return {
      currentTicketNumber: await this.ticketSequence.current(),
      currentPriorityNumber: await this.priorityTicketSequence.current()
    };
  }
}
```

**Batch processing with sequence-based coordination:**
```ts
class BatchProcessor {
  batchSequence = $sequence({
    name: "batch_numbers",
    start: 1,
    increment: 1
  });

  async processBatch(items: any[]) {
    const batchNumber = await this.batchSequence.next();

    console.log(`Starting batch processing #${batchNumber} with ${items.length} items`);

    try {
      // Process items with batch number for tracking
      for (const item of items) {
        await this.processItem(item, batchNumber);
      }

      await this.auditLogger.log({
        event: 'batch_completed',
        batchNumber,
        itemCount: items.length,
        timestamp: new Date()
      });

      return { batchNumber, processedCount: items.length };

    } catch (error) {
      await this.auditLogger.log({
        event: 'batch_failed',
        batchNumber,
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  async processItem(item: any, batchNumber: number) {
    // Associate item processing with batch number
    await this.items.update(item.id, {
      ...item.updates,
      batchNumber,
      processedAt: new Date()
    });
  }
}
```

**Multi-tenant sequence management:**
```ts
class TenantSequenceService {
  // Create tenant-specific sequences
  getTenantSequence(tenantId: string, sequenceType: string) {
    return $sequence({
      name: `${tenantId}_${sequenceType}_seq`,
      start: 1,
      increment: 1
    });
  }

  async generateTenantOrderNumber(tenantId: string): Promise<string> {
    const sequence = this.getTenantSequence(tenantId, 'orders');
    const number = await sequence.next();

    return `${tenantId.toUpperCase()}-ORD-${number.toString().padStart(6, '0')}`;
  }

  async generateTenantInvoiceNumber(tenantId: string): Promise<string> {
    const sequence = this.getTenantSequence(tenantId, 'invoices');
    const number = await sequence.next();

    return `${tenantId.toUpperCase()}-INV-${number.toString().padStart(6, '0')}`;
  }

  async getTenantSequenceStatus(tenantId: string) {
    const orderSeq = this.getTenantSequence(tenantId, 'orders');
    const invoiceSeq = this.getTenantSequence(tenantId, 'invoices');

    return {
      tenant: tenantId,
      sequences: {
        orders: {
          current: await orderSeq.current(),
          next: await orderSeq.next()
        },
        invoices: {
          current: await invoiceSeq.current()
        }
      }
    };
  }
}
```

**Important Notes**:
- Sequences are created automatically when first used
- PostgreSQL sequences are atomic and handle high concurrency
- Sequence values are not rolled back in failed transactions
- Consider the impact of max values and cycling behavior
- Sequences are schema-scoped in PostgreSQL

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
