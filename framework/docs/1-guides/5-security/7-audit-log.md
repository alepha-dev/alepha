# Audit Log

`$audit` records who did what, in a database table you can filter and search. A
service declares a type of event with the actions it allows, and logs them as they
happen. Retention, an admin API and a page in `@alepha/ui` come with it.

```typescript check
import { $audit } from "alepha/api/audits";
```

It needs an ORM connection, because every event is a row in the `audits` table.
Declaring a `$audit` registers the `AlephaApiAudits` module. Register it yourself
for the admin API in an app that declares no type of its own:

```typescript
import { AlephaApiAudits } from "alepha/api/audits";

alepha.with(AlephaApiAudits);
```

## Declaring a type

```typescript check
import { $audit } from "alepha/api/audits";

class OrderAudits {
  order = $audit({
    type: "order",
    description: "Order management events",
    actions: ["create", "cancel", "refund"],
  });

  async cancelled(orderId: string, reason: string) {
    await this.order.logSuccess("cancel", {
      resourceType: "order",
      resourceId: orderId,
      description: `Order cancelled: ${reason}`,
    });
  }

  async refundFailed(orderId: string, error: string) {
    await this.order.logFailure("refund", error, {
      resourceType: "order",
      resourceId: orderId,
    });
  }
}
```

| Option          | What it does                                                             |
| --------------- | ------------------------------------------------------------------------ |
| `type`          | The event type, such as `order`.                                         |
| `actions`       | The actions this type allows.                                            |
| `description`   | What the type covers.                                                    |
| `retentionDays` | How long to keep this type, see [Retention](#retention).                 |
| `coalesce`      | Which actions merge into one row, see [Merging bursts](#merging-bursts). |

## Logging an event

| Method                                       | Records                                 |
| -------------------------------------------- | --------------------------------------- |
| `.log(action, options)`                      | An event, with whatever `options` says. |
| `.logSuccess(action, options)`               | A success.                              |
| `.logFailure(action, errorMessage, options)` | A failure, with its message.            |

⚠️ An action the type does not declare throws. The admin filters are built from
that list, so a typo would otherwise be recorded and never found.

During a request, the event fills in what it can by itself, unless you pass it:

| Field                                 | From the request    |
| ------------------------------------- | ------------------- |
| `userId`, `userEmail`, `userRealm`    | The signed-in user. |
| `ipAddress`, `userAgent`, `requestId` | The request.        |

`options` also takes `resourceType`, `resourceId`, `description` and `metadata`
(a JSON object). `description`, `errorMessage`, `ipAddress`, `userAgent` and `requestId`
are cut to fit their columns rather than failing the write.

**Severity** is `info`, `warning` or `critical`. Left out, it is `info` for a
success and `warning` for a failure.

## Scopes

An event belongs to one of two layers. An **app-layer** event, a sign-in for
instance, belongs to the deployment. A **scoped** event happened inside one tenant:

```typescript
await this.order.logSuccess("create", {
  scopeType: "shop",
  scopeId: shop.id,
  resourceType: "order",
  resourceId: order.id,
});
```

⚠️ Set `scopeType` and `scopeId` together. The indexes lead on the pair, and a
`scopeId` alone is missed by every query that names a `scopeType`.

## Merging bursts

Ten edits of one document in twenty minutes are ten true events and ten
near-identical rows. `coalesce` folds them into one row with a count:

```typescript check
import { $audit } from "alepha/api/audits";

class DocumentAudits {
  document = $audit({
    type: "document",
    actions: ["create", "update", "delete"],
    coalesce: { actions: ["update"], window: "5m" },
  });
}
```

- `actions` must be declared by the type, and `window` is `<n>s`, `<n>m` or `<n>h`.
  Anything else fails when the type registers, not at the first write.
- Events merge when their scope, type, action, user and resource are the same.
- Failures never merge.
- The row keeps `eventCount`, and `updatedAt` holds when the last event landed.
- The window runs from the row's `createdAt`, not from its last event, so a long
  burst becomes several rows.

## Reading the log

`AuditService` answers from code:

| Method                     | Answers                                |
| -------------------------- | -------------------------------------- |
| `find(query)`              | A filtered, paginated page.            |
| `findByUser(userId)`       | One user's events.                     |
| `findByResource(type, id)` | One resource's events.                 |
| `getById(id)`              | One event.                             |
| `getStats()`               | Counts for a period.                   |
| `getRegisteredTypes()`     | Every type registered in this process. |

`find` filters on `type` and `action` (comma-separated for several), `severity`,
`scopeType`, `scopeId`, `layer` (`app` or `scoped`), `userId`, `userRealm`,
`resourceType`, `resourceId`, `success`, and a date range.

## The admin API

`AdminAuditController` serves the same reads under `/api/audits`, with `/stats`,
`/types`, `/actions` and `/filters`, plus a create and a delete.

| Permission           | Allows            |
| -------------------- | ----------------- |
| `admin:audit:read`   | Every read.       |
| `admin:audit:create` | Writing an entry. |
| `admin:audit:delete` | Deleting entries. |

`AdminAudits` in `@alepha/ui/admin` is the page on top of it.

## Retention

A daily job at 03:00 deletes what has outlived its window.

- **The default** is 90 days, from `retentionDays` on the `auditOptions` atom. `0`
  keeps every type without a window of its own.
- **`retentionDays` on a `$audit`** overrides it for that type. `0` keeps that type
  forever, whatever the default says.

The job reads these from the types registered in its own process. A type whose
class is not loaded there falls under the default.

```typescript check
import { $audit } from "alepha/api/audits";

class ComplianceAudits {
  compliance = $audit({
    type: "compliance",
    actions: ["export"],
    retentionDays: 730,
  });
}
```

## Built-in types

These modules declare their own types:

| Type               | Declared by             | Covers                                 | Active                               |
| ------------------ | ----------------------- | -------------------------------------- | ------------------------------------ |
| `auth`, `security` | `alepha/api/users`      | Sign-ins, tokens, MFA, blocked access. | With a `$realm`.                     |
| `user`             | `alepha/api/users`      | Accounts.                              | With a `$realm`.                     |
| `api-key`          | `alepha/api/keys`       | API keys.                              | With the module.                     |
| `parameter`        | `alepha/api/parameters` | Runtime parameter changes.             | With `alepha.with(ParameterAudits)`. |
