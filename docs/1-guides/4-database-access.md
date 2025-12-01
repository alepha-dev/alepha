# Database Access

We use **Postgres** (or SQLite for testing/local dev).
We use **Drizzle ORM** under the hood because it's fast and typesafe.
But we wrap it in Alepha primitives to make it seamless.

## Defining Entities

Instead of writing SQL or complex class mappers, you define an `$entity`.
This acts as the source of truth for both your TypeScript types and your Database table structure.

```typescript
import { t } from "alepha";
import { $entity, pg } from "alepha/orm";

// src/entities/User.ts
export const userEntity = $entity({
  name: "users", // The table name
  schema: t.object({
    // pg.primaryKey() handles UUID/Integer/BigInt generation automatically
    id: pg.primaryKey(),

    // Standard TypeBox types
    email: t.email(),
    name: t.text(),

    // Automatic timestamp management
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
  }),
  // Simple index definition
  indexes: ["email"],
});
```

## Using Repositories

To interact with the database, you inject a repository for that entity.

```typescript
import { $repository } from "alepha/orm";
import { userEntity } from "./entities/User";

class UserService {
  // This creates a type-safe repository for the userEntity
  repo = $repository(userEntity);

  async findByEmail(email: string) {
    // .findOne, .findMany, .create, .update, .delete...
    return await this.repo.findOne({
      where: {
        email: { eq: email }
      }
    });
  }

  async listRecent() {
    // Pagination is built-in
    return await this.repo.paginate({
      page: 0,
      size: 20,
      sort: "-createdAt" // Descending sort
    });
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
npx alepha db:generate

# Apply changes
npx alepha db:migrate
```

## Advanced: Queries & Transactions

Sometimes you need raw power.

### Transactions
Use the `$transaction` primitive to ensure atomicity.

```typescript
import { $transaction } from "alepha/orm";

class BillingService {
  process = $transaction({
    handler: async (tx, userId: string, amount: number) => {
      // Pass { tx } to repository methods to use the transaction scope
      await this.userRepo.updateById(userId, { status: 'paid' }, { tx });
      await this.invoiceRepo.create({ userId, amount }, { tx });
    }
  });
}
```

### Raw SQL
If the repository helper methods aren't enough, you can drop down to raw SQL while keeping some type safety.

```typescript
import { sql } from "alepha/orm";

await this.repo.query(sql`
  SELECT * FROM users WHERE age > 18
`);
```
