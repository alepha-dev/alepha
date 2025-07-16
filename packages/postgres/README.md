# Alepha Postgres

A type-safe SQL query builder and ORM using Drizzle.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/postgres
```
## Module

Provides PostgreSQL and SQLite database integration with type-safe ORM capabilities through Drizzle.

The postgres module enables declarative database operations using descriptors like `$entity`, `$repository`,
and `$db` on class properties. It offers automatic schema generation, type-safe queries, transactions,
and database migrations with support for both PostgreSQL and SQLite backends.

**Key Features:**
- Declarative entity definition with `$entity` descriptor
- Type-safe repository pattern with `$repository` descriptor
- Database connection management with `$db` descriptor
- Automatic schema migrations and type generation
- Transaction support with `$transaction` descriptor
- Sequence management with `$sequence` descriptor
- Full TypeScript integration with compile-time type checking

**Basic Usage:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaPostgres, $entity, $repository, pg } from "alepha/postgres";

// Define database entities
const user = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    createdAt: pg.createdAt(),
    name: t.string(),
    email: t.string(),
    age: t.optional(t.integer()),
  }),
});

const post = $entity({
  name: "posts",
  schema: t.object({
    id: pg.primaryKey(),
    createdAt: pg.createdAt(),
    title: t.string(),
    content: t.string(),
    authorId: pg.references(t.uint(), () => user.id),
  }),
});

class Database {
  users = $repository(user);
  posts = $repository(post);
}

const alepha = Alepha.create()
  .with(AlephaPostgres)
  .with(Database);

run(alepha);
```

**Repository Operations:**
```ts
class UserService {
  users = $repository(user);

  async createUser(userData: { name: string; email: string }) {
    return await this.users.create(userData);
  }

  async findUserByEmail(email: string) {
    return await this.users.findFirst({
      where: { email },
    });
  }

  async getUsersWithPosts() {
    return await this.users.find({
      with: { posts: true },
      limit: 10,
    });
  }

  async updateUser(id: number, updates: Partial<{ name: string; age: number }>) {
    return await this.users.update(id, updates);
  }
}
```

**Advanced Database Operations:**
```ts
import { $db, $transaction } from "alepha/postgres";

class AdvancedDatabase {
  db = $db({
    entities: { user, post },
  });

  createUserWithPost = $transaction(async () => {
    const newUser = await this.db.users.create({
      name: "John Doe",
      email: "john@example.com",
    });

    const newPost = await this.db.posts.create({
      title: "My First Post",
      content: "Hello world!",
      authorId: newUser.id,
    });

    return { user: newUser, post: newPost };
  });

  async rawQuery() {
    // Execute raw SQL queries
    return await this.db.execute(sql`
      SELECT users.name, COUNT(posts.id) as post_count
      FROM users
      LEFT JOIN posts ON users.id = posts.author_id
      GROUP BY users.id, users.name
    `);
  }
}
```

## API Reference

### Descriptors

#### $db()



#### $entity()

Creates a table descriptor for drizzle-orm.

#### $repository()



#### $transaction()


