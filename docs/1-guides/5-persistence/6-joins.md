# Joins

Relations between tables are not declared on `$entity`. Instead, use the `with` option in repository query methods to perform joins at query time.

```typescript
import { z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
```

## Defining Related Entities

Use `db.ref()` to create foreign key columns that reference another entity:

```typescript
const teams = $entity({
  name: "teams",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    country: z.text(),
  }),
});

const players = $entity({
  name: "players",
  schema: z.object({
    id: db.primaryKey(),
    teamId: db.ref(z.integer().optional(), () => teams.cols.id),
    name: z.text(),
    position: z.text(),
  }),
});
```

See [Special Columns](./2-special-columns.md) for `db.ref()` options like `onDelete` and `onUpdate`.

## Basic Join

Use the `with` option on `getOne`, `findOne`, `findMany`, or `paginate` to join related tables. The result includes the joined data as a nested object.

```typescript
class PlayerService {
  players = $repository(players);

  async getPlayerWithTeam(playerId: number) {
    return await this.players.getOne({
      where: { id: { eq: playerId } },
      with: {
        team: {
          join: teams,
          on: ["teamId", teams.cols.id],
        },
      },
    });
    // result.name     → "Messi"
    // result.team.name → "FC Barcelona"
  }
}
```

The `on` tuple maps `[localColumn, foreignEntity.cols.foreignColumn]`.

### By primary key — `findById` / `getById`

For detail views, `findById(id, { with })` and `getById(id, { with })` are
the shortest path: they take an optional `with` map and skip the
`where: { id: { eq: id } }` boilerplate.

```typescript
async getPlayerWithTeam(playerId: number) {
  return await this.players.getById(playerId, {
    with: {
      team: { join: teams, on: ["teamId", teams.cols.id] },
    },
  });
}
```

`findById` returns `undefined` on miss; `getById` throws
`DbEntityNotFoundError`. The return type widens with `team` on it just
like `getOne`.

### Reusing a relation map

When the same join lands on several queries, extract it as a `const` and
reuse:

```typescript
const withTeam = {
  team: { join: teams, on: ["teamId", teams.cols.id] as const },
} as const;

const player = await this.players.getById(id, { with: withTeam });
const page = await this.players.paginate({ page: 0 }, { with: withTeam });
```

`as const` is fine on the `on` tuple — the relation map type accepts
readonly tuples.

## Join Types

Three join types are supported. The default is `"left"`.

```typescript
with: {
  team: {
    type: "left",   // default — include rows even if no match (team will be undefined)
    join: teams,
    on: ["teamId", teams.cols.id],
  },
}
```

```typescript
with: {
  team: {
    type: "inner",  // exclude rows that have no matching team
    join: teams,
    on: ["teamId", teams.cols.id],
  },
}
```

```typescript
with: {
  team: {
    type: "right",  // include all teams, even if no player references them
    join: teams,
    on: ["teamId", teams.cols.id],
  },
}
```

With a left join, if the foreign key is `NULL` or there is no matching row, the joined field is `undefined`:

```typescript
const freeAgent = await this.players.getOne({
  where: { name: { eq: "Free Agent" } },
  with: {
    team: { join: teams, on: ["teamId", teams.cols.id] },
  },
});
// freeAgent.team → undefined
```

With an inner join, that row would be excluded entirely.

## Filtering on Joined Tables

Use the join alias in the `where` clause to filter by columns from the joined table:

```typescript
const spanishPlayers = await this.players.findMany({
  with: {
    team: {
      join: teams,
      on: ["teamId", teams.cols.id],
    },
  },
  where: {
    team: {
      country: { eq: "Spain" },
    },
  },
});
```

Combine base and joined table filters with `and` / `or`:

```typescript
const results = await this.players.findMany({
  with: {
    team: {
      join: teams,
      on: ["teamId", teams.cols.id],
    },
  },
  where: {
    and: [
      { position: { eq: "Forward" } },
      { team: { country: { eq: "Spain" } } },
    ],
  },
});
```

```typescript
const results = await this.players.findMany({
  with: {
    team: {
      join: teams,
      on: ["teamId", teams.cols.id],
    },
  },
  where: {
    or: [
      { goals: { gte: 200 } },
      { team: { country: { eq: "France" } } },
    ],
  },
});
```

All standard [where clause operators](./1-repository.md#where-clause-operators) work on joined table columns.

## Multiple Joins

Join several tables at the same level:

```typescript
const result = await this.users.getOne({
  where: { id: { eq: userId } },
  with: {
    profile: {
      join: profiles,
      on: ["id", profiles.cols.userId],
    },
    city: {
      join: cities,
      on: ["cityId", cities.cols.id],
    },
  },
});
// result.profile.bio → "Tech lead"
// result.city.name   → "Toronto"
```

Each join can have a different type:

```typescript
with: {
  profile: {
    type: "inner", // must have a profile
    join: profiles,
    on: ["id", profiles.cols.userId],
  },
  city: {
    type: "left", // city is optional
    join: cities,
    on: ["cityId", cities.cols.id],
  },
},
```

## Nested Joins

Nest `with` inside a join to follow relationships deeper:

```typescript
// user → city → country
const result = await this.users.getOne({
  where: { id: { eq: userId } },
  with: {
    city: {
      join: cities,
      on: ["cityId", cities.cols.id],
      with: {
        country: {
          join: countries,
          on: ["countryId", countries.cols.id],
        },
      },
    },
  },
});
// result.city.name          → "Toronto"
// result.city.country.name  → "Canada"
```

Nesting works to arbitrary depth (3+ levels tested):

```typescript
// post → author → city → country
const post = await this.posts.getOne({
  where: { id: { eq: postId } },
  with: {
    author: {
      join: users,
      on: ["authorId", users.cols.id],
      with: {
        city: {
          join: cities,
          on: ["cityId", cities.cols.id],
          with: {
            country: {
              join: countries,
              on: ["countryId", countries.cols.id],
            },
          },
        },
      },
    },
  },
});
// post.author.city.country.code → "CA"
```

Filtering also works on nested joins:

```typescript
where: {
  city: {
    country: {
      code: { eq: "CA" },
    },
  },
},
```

## Self-Referencing Joins

When an entity references itself (e.g. a `managerId` pointing to the same `users` table), use `.alias()` to disambiguate:

```typescript
const users = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    name: z.text(),
    managerId: db.ref(z.integer().optional(), () => users.cols.id),
  }),
});

const manager = users.alias("manager");

const result = await this.users.getOne({
  where: { id: { eq: bobId } },
  with: {
    manager: {
      join: manager,
      on: ["managerId", manager.cols.id],
    },
  },
});
// result.manager.name → "Alice"
```

Aliases also work for nested self-references:

```typescript
const manager = users.alias("manager");
const managerManager = users.alias("manager_manager");

const result = await this.users.getOne({
  where: { id: { eq: dianaId } },
  with: {
    manager: {
      join: manager,
      on: ["managerId", manager.cols.id],
      with: {
        manager: {
          join: managerManager,
          on: ["managerId", managerManager.cols.id],
        },
      },
    },
  },
});
// result.manager.name          → "Bob"
// result.manager.manager.name  → "Alice"
```

More generally, whenever the same table appears more than once in a query (even through different join paths), use `.alias()` for each additional occurrence.

## SQL Join Conditions

For complex join conditions beyond simple column equality, pass a raw SQL expression instead of the tuple:

```typescript
import { sql } from "alepha/orm";

with: {
  profile: {
    join: profiles,
    on: sql`${users.cols.id} = ${profiles.cols.userId}`,
  },
},
```

Note: raw SQL join conditions are only supported on PostgreSQL. SQLite requires the tuple syntax.

## Joins with Pagination

`paginate` supports `with` just like `findMany`:

```typescript
const page = await this.players.paginate(
  { page: 0, size: 10 },
  {
    with: {
      team: {
        join: teams,
        on: ["teamId", teams.cols.id],
      },
    },
    orderBy: { column: "name", direction: "asc" },
  },
);
// page.content[0].team.name → "FC Barcelona"
```

## Limitations

- **No one-to-many joins.** The `with` option produces one-to-one joins (each row gets one joined object). For one-to-many relationships (e.g. a user's posts), run a separate query on the child table.
- **No `orderBy` on joined columns.** Sorting is limited to columns on the base table.
- **No `columns` selection on joined tables.** The full joined entity is always returned.
- **No aggregate queries with joins.** Use `repository.aggregate()` separately or raw SQL via `repository.query()`.
- **SQL join conditions require PostgreSQL.** SQLite only supports the tuple syntax `["localCol", entity.cols.foreignCol]`.
