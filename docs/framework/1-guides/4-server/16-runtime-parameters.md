# Runtime Parameters

`$parameter` is configuration that lives in the database instead of the
environment: a named, schema-validated value you can change while the app is
running, from the admin UI or from code, with every change recorded and every
previous value still there to roll back to.

```typescript check
import { $parameter } from "alepha/api/parameters";
```

It needs an ORM connection and ships an admin controller, so it lives under
`alepha/api/` and is registered as a module:

```typescript
import { AlephaApiParameters } from "alepha/api/parameters";

alepha.with(AlephaApiParameters);
```

## Which one do you want

Three things in Alepha look like configuration and are not interchangeable.

| Primitive    | Lives in        | Changes                       | Audited | Use it for                                   |
| ------------ | --------------- | ----------------------------- | ------- | -------------------------------------------- |
| `$env`       | the environment | at boot, by a deploy          | no      | secrets, connection strings, per-host wiring |
| `$atom`      | process memory  | at runtime, per process       | no      | in-process state, module options             |
| `$parameter` | the database    | at runtime, for every process | yes     | numbers a human decides and later regrets    |

The dividing line is who changes the value and how often. A database URL is an
`$env`: it changes when the deployment changes, and nobody edits it at 4pm on a
Friday. A free-shipping threshold is a `$parameter`: somebody in the business
decides it, changes it without a deploy, and will want to know who set it to
zero.

## Declaring one

```typescript check
import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

class Checkout {
  pricing = $parameter({
    name: "checkout.pricing",
    description: "Thresholds the pricing team owns.",
    schema: z.object({
      freeShippingAbove: z.number(),
      maxDiscountPercent: z.number(),
    }),
    default: { freeShippingAbove: 50, maxDiscountPercent: 30 },
  });
}
```

`schema` must be a `z.object()`. `default` is what the parameter is worth before
anyone has ever set it, so an app boots and behaves correctly against an empty
`parameters` table: there is no "unconfigured" state to handle.

`name` uses dot notation, and the admin UI renders it as a tree, so
`checkout.pricing` and `checkout.limits` group under one `checkout` node. Omit
it and the name is derived as `<ClassName>.<propertyKey>`, which is fine for one
app and a poor idea the moment you rename the class.

## Reading it

```typescript check
import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

class Checkout {
  pricing = $parameter({
    name: "checkout.pricing",
    schema: z.object({ freeShippingAbove: z.number() }),
    default: { freeShippingAbove: 50 },
  });

  async shippingCost(total: number) {
    const { freeShippingAbove } = await this.pricing.get();
    return total >= freeShippingAbove ? 0 : 4.9;
  }
}
```

`get()` is async, and it is async for a reason that is not "it hits the
database on every call". The first call loads the row and caches it; later calls
are served from memory. Being async is what lets that first load happen lazily,
which is what makes the primitive work on Cloudflare Workers, where there is no
boot phase in which to preload anything.

Two synchronous accessors exist for code that cannot await:

- `cachedCurrentContent` returns the cached value, falling back to the default.
- `isUsingDefault` tells you whether anything has ever been stored.

Neither triggers a load. In a request handler, `await get()`.

## Changing it

```typescript check
import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";
import type { UserAccount } from "alepha/security";

class Checkout {
  pricing = $parameter({
    name: "checkout.pricing",
    schema: z.object({ freeShippingAbove: z.number() }),
    default: { freeShippingAbove: 50 },
  });

  async raiseThreshold(user: UserAccount) {
    await this.pricing.set(
      { freeShippingAbove: 75 },
      {
        user,
        changeDescription: "Q4 margin protection",
        tags: ["pricing"],
      },
    );
  }
}
```

Every `set()` writes a new version rather than updating a row. `user` is what
puts a name on it, and `changeDescription` is what makes the history readable six
months later. Both are optional and both are the difference between an audit
trail and a list of timestamps.

### Scheduling a change

`activationDate` in the future stores the version without making it current:

```typescript
await this.pricing.set(
  { freeShippingAbove: 0 },
  {
    activationDate: new Date("2026-11-27T00:00:00Z"),
    changeDescription: "Black Friday",
  },
);
```

There is no stored status field and no job that flips one. A version's status is
derived from its `activationDate` every time it is queried, so "pending" becomes
"current" because the clock moved, not because a process was running at the
right moment. An app that was switched off over the weekend comes back with the
correct value.

## Reacting to a change

Other processes do not poll. A `set()` publishes on a topic, and every instance
reloads:

```typescript
const unsubscribe = this.pricing.sub((value) => {
  this.log.info("pricing changed", { value });
});
```

`sub()` returns its own unsubscribe function. The callback runs on every
instance, so treat it as a cache invalidation signal rather than a place to do
work once.

### How long a change takes to land everywhere

The topic rides the queue provider, which is in-memory by default. On a single
long-lived Node process that is instant and this section does not apply. On a
serverless runtime it does not apply either, for the opposite reason: many
isolates serve the same app, and a `set()` handled by one of them never reaches
the others.

So the cache also expires. `get()` re-reads the row once the cached value is
older than `PARAMETERS_CACHE_TTL_MS`, which defaults to **30 seconds on
serverless** and to `0` (never revalidate) elsewhere. A flip therefore reaches
every isolate within about half a minute, and an operator who reloads the page
one second after saving may still see the old behaviour.

Say so wherever an admin flips something that a human will immediately go and
test. A switch that appears not to have worked gets flipped again.

## History, and the version that was in force

```typescript
const history = await this.pricing.getHistory({ limit: 20 });
const v3 = await this.pricing.getVersion(3);
await this.pricing.rollback(3, { user, changeDescription: "revert bad edit" });
```

`rollback()` does not delete anything. It copies the target version's content
into a new version at the head, so the mistake and the reversal are both in the
history.

`getVersionAt()` is the one worth knowing about:

```typescript
const rules = await this.pricing.getVersionAt(capture.recordedAt);
```

Use it when a decision belongs to the time of an **event** rather than the time
of the read. An offline capture uploaded three days late must be evaluated
against the values that were live when it happened, not today's. It returns
`null` when the timestamp predates version 1.

## Changing the schema

The schema is hashed and the hash is stored with each version, so the provider
knows when the code's shape has moved away from the database's. On the next
load it runs a cascade, and takes the first step that produces a value the new
schema accepts:

1. your `migrate(old)` function, if you wrote one
2. the stored value with unknown keys stripped
3. the stored value shallow-merged over `default`
4. `default`

Steps 2 to 4 handle the ordinary cases for free: a field you removed is dropped,
a field you added arrives with its default. Write `migrate` only when a value has
to be _transformed_, such as a rename or a unit change:

```typescript check
import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

class Checkout {
  pricing = $parameter({
    name: "checkout.pricing",
    schema: z.object({ freeShippingAboveCents: z.number() }),
    default: { freeShippingAboveCents: 5000 },
    migrate: (old) => ({
      freeShippingAboveCents:
        ((old as { freeShippingAbove?: number }).freeShippingAbove ?? 50) * 100,
    }),
  });
}
```

A `migrate` that throws, or that returns something the schema rejects, is
logged and the cascade falls through to step 2. It cannot break a boot, which
also means it can fail quietly: check the logs after deploying one.

The migration itself is written as a new version, with a description saying
which step produced it, so a value that silently reset to defaults is visible in
the history rather than inferred from behaviour.

## The admin API

`AlephaApiParameters` registers a controller under `/parameters`, gated by five
permissions:

| Permission                 | Grants                                         |
| -------------------------- | ---------------------------------------------- |
| `admin:parameter:read`     | the tree, the list, one parameter, its history |
| `admin:parameter:create`   | writing a new version                          |
| `admin:parameter:rollback` | rolling back to an earlier version             |
| `admin:parameter:activate` | activating a pending version immediately       |
| `admin:parameter:delete`   | deleting a parameter and all its versions      |

Split deliberately: the people who should be able to read a threshold are not
always the people who should be able to change it, and the person who can change
it is rarely the person who should be able to delete its history.

## See also

- [Configurations](/docs/guides-core-configurations) for `$env` and `$atom`
- [Caching](/docs/guides-persistence-caching) for values you want fast rather
  than governed
