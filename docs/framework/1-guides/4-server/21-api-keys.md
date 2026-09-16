# API keys

`alepha/api/keys` gives a user long-lived tokens for scripts, CI and other
machines. A key authenticates as the user who made it, through the same issuer
as their sessions, and never as more than they are.

```typescript check
import { AlephaApiKeys } from "alepha/api/keys";
```

A realm turns it on with one feature flag, which registers the module, the
key resolver on the realm's issuer, and the account and admin surfaces:

```typescript
import { $realm } from "alepha/api/users";

class Realm {
  users = $realm({
    features: { apiKeys: true },
  });
}
```

Without a realm, register the module and hand the resolver to a plain
`$issuer`:

```typescript
import { $inject } from "alepha";
import { ApiKeyService } from "alepha/api/keys";
import { $issuer } from "alepha/security";

class App {
  apiKeyService = $inject(ApiKeyService);
  issuer = $issuer({
    secret: "change-me",
    resolvers: [this.apiKeyService.createResolver()],
  });
}
```

A key is sent as `Authorization: Bearer ak_...` or as `?api_key=ak_...`. The
token is shown once, at creation or rotation; the database keeps a hash.

## The lifecycle

| Endpoint                          | Needs                       | What                                                  |
| --------------------------------- | --------------------------- | ----------------------------------------------------- |
| `POST /api/api-keys`              | `api-key:create`, a session | create a key, returns the token once                  |
| `GET /api/api-keys/options`       | `api-key:create`            | expiry presets, the default, the cap, grantable scope |
| `GET /api/api-keys`               | `api-key:read`              | the caller's keys, dead ones included                 |
| `POST /api/api-keys/:id/rotate`   | `api-key:create`, a session | a new secret on the same key, returns it once         |
| `DELETE /api/api-keys/:id`        | `api-key:delete`, a session | revoke                                                |
| `GET /api/admin/api-keys`         | `admin:api-key:read`        | every key, filtered by `status` and `userId`          |
| `DELETE /api/admin/api-keys/:id`  | `admin:api-key:delete`      | revoke anyone's key; there is no admin rotate         |
| `POST /api/admin/api-keys/revoke` | `admin:api-key:delete`      | revoke several                                        |

"A session" is not a figure of speech: see
[a key is not a session](#a-key-is-not-a-session).

### Expiry

A key is created with `expiresIn`, one of `7d`, `30d`, `60d`, `90d`, `180d`,
`1y` or `never`, or with an exact `expiresAt`, never both. With neither, the key
does not expire, as every key did before expiry existed. The policy lives in
the server-only `apiKeyOptions` atom:

| Option                      | Default | Meaning                                                                 |
| --------------------------- | ------- | ----------------------------------------------------------------------- |
| `defaultExpiresIn`          | `90d`   | the duration a client preselects, and a rotation's when it names none   |
| `maxExpiryDays`             | `0`     | the longest a key may live; `0` is unlimited                            |
| `expiryWarningDays`         | `7`     | a key this close to expiry reads `expiring`, and its owner is told once |
| `purgeExpiredAfterDays`     | `90`    | days an expired key stays listed before the daily purge deletes it      |
| `purgeRevokedAfterDays`     | `90`    | the same for a revoked key                                              |
| `usageWriteIntervalMinutes` | `5`     | minutes between two usage writes for one key                            |

The cap applies whichever way the expiry was asked for, and under a cap `never`
and an omitted expiry are refused too. A request over it is refused with a
message naming the cap, never silently clamped, and the create
dialog reads the presets from `GET /api/api-keys/options` so it never offers
one the server refuses.

### Status

Every key read carries a derived `status`: `active`, `expiring`, `expired` or
`revoked` (revoked wins over expired). It is never stored, so it cannot go
stale, and `ApiKeyService.statusWhere()` is the same rule as a query: the admin
filter and the badge cannot disagree about a key an hour from its warning
window.

### Rotation

Rotating replaces the secret and keeps the key: its name, roles, permission
scope, IP allowlist and audit history stay, while the token, the expiry and the
usage counters start again. The old token stops authenticating at once, not
after the 15-minute validation cache. An expired key can be rotated, which is
how it is renewed; a revoked one cannot.

### Revocation, names and retention

A name is unique per user among keys that are not revoked. Revoking frees the
name immediately, so a leaked "CI pipeline" is replaced by a new "CI pipeline"
without waiting. An expired key keeps its name: rotating it renews the key under
that name, and only the purge frees it.

Two daily jobs run wherever the module is registered: `system.keys.purge-expired`
(03:00) deletes keys past their retention window, in bounded batches, and
`system.keys.notify-expiring` (09:00) sends each owner of an `expiring` key one
security notification per expiry, when the realm has notifications.

Creation, rotation, revocation and purges are written to the audit log under
the `api-key` type.

### Usage tracking is approximate

`lastUsedAt`, `lastUsedIp` and `usageCount` are written at most once per key
per `usageWriteIntervalMinutes`, in each isolate. They answer "is this key
still in use" to within that interval. `usageCount` is a lower bound on
requests, not a count. Do not build billing or an audit on these columns; set
the interval to `0` to write on every request, at the cost of a database write
per authenticated call.

## Permission scope

By default a key may do everything its owner's roles allow. A key created with
`permissions` is narrowed to them:

```json
{ "name": "Metrics", "expiresIn": "1y", "permissions": ["project:read"] }
```

- Entries are registered permission names, never patterns.
- Each must be one the caller may grant, meaning within its own roles and its
  own scope, or creation is refused naming it.
- The key is capped twice at every request: its stored roles are intersected
  with what the owner holds now (a demoted owner's keys lose the role), and
  its `permissions` become the identity's `permissionScope`.

What a scope binds, and what it does not, is a rule of `alepha/security` rather
than of this module: see [Permission scope](/docs/guides-server-authentication#permission-scope-and-machine-credentials).

## A key is not a session

A key authenticates as its owner, but it is a machine credential: the resolved
identity carries a `credential` marker, and every route declared
`$secure({ sessionOnly: true })` refuses it with a 403.

In the framework, that is every route that mints or revokes credentials or
changes the account: creating, rotating and revoking keys, approving an OAuth
consent or a device code, and every non-GET route under `/users/me`. A key
still reads, and still calls the permission-checked actions its roles and
scope allow. A script that rotated its own key, or changed the account, now
has to be a person in a signed-in session.

## IP allowlist

A key can be restricted to the client addresses it may be used from. The list
is set when the key is created, through the API only, and cannot be edited
afterwards:

```http
POST /api/api-keys
Content-Type: application/json

{
  "name": "CI pipeline",
  "expiresIn": "90d",
  "ipAllowlist": ["203.0.113.4", "198.51.100.0/24", "2001:db8::/32"]
}
```

- Entries are bare IPv4 or IPv6 addresses and CIDR ranges. A malformed entry
  refuses the creation and the error names it: a bad entry discovered only at
  validation time would be a key that silently never works.
- An empty or absent list means the key works from anywhere, which is what
  every key created before the allowlist existed has.
- The check runs inside `ApiKeyService.validate()`, before the owner lookup
  and before any usage is recorded. A refused request answers `401`, and the
  refusal is logged with the address that was observed.
- A restricted key whose request address is unknown is refused. Calling
  `validate(token)` from code without passing the IP fails closed.
- An IPv4 entry matches the IPv4-mapped form a dual-stack server reports
  (`::ffff:203.0.113.4`).
- The account panel and the admin table show the list read-only, so a key
  that stopped working from a new address can be diagnosed on screen.
- Rotating a key keeps its allowlist. To change the list, revoke the key and
  create a new one: revoking frees the name, so the new key can take it.

### ⚠️ The allowlist is only as good as `TRUST_PROXY`

The address checked is the one the server resolves for the request, and
`TRUST_PROXY` defaults to `true`. With it on, the address comes from
`cf-connecting-ip`, then `X-Forwarded-For` (the entry `TRUST_PROXY_HOPS` places
from the right), then `X-Real-IP`, and only then the socket.

- **Behind a proxy that sets those headers itself**, such as Cloudflare or a
  load balancer that overwrites them, the resolved address is the real client
  and the allowlist means what it says.
- **On a server that accepts connections directly**, those headers come from
  the client. Anyone holding the key can send `X-Real-IP: 203.0.113.4` and
  pass an allowlist that names that address. Such a deployment must set
  `TRUST_PROXY=false` for the allowlist to restrict anything.

## Upgrading: what changed

These are the behaviour changes of API key v2, each of which can break
something that worked before.

1. **`GET /api/api-keys` returns expired and revoked keys**, each with its
   `status`. Code that read the length of the response as a count of usable
   keys now counts dead ones: filter on `status`. The admin listing keeps
   hiding revoked keys unless asked (`status`, or the deprecated
   `includeRevoked`).
2. **`SecurityProvider` has a scope rule.** `permissionScope: undefined` is
   unrestricted, and every existing identity is on that branch. `[]` is a
   denial that reads like a no-op. A scope binds permission-checked routes
   only: a bare `$secure()` still admits a scoped credential.
3. **Usage columns are approximate** to `usageWriteIntervalMinutes`, as above.
4. **An API key is not a session, and neither is an OAuth access token.**
   Neither can create, rotate or revoke keys, approve an OAuth consent or
   device code, or call a non-GET route under `/users/me`. Both still read and
   call permission-checked actions. Automations that managed their own keys,
   and connected apps that changed account settings, need a signed-in session
   instead.
5. **An OAuth grant's scopes narrow its token once the app declares them.** A
   scope's `permissions` become the access token's `permissionScope`, and a
   grant reaches the union of its scopes. A scope declared without
   `permissions` leaves the whole grant unrestricted, as before, and the
   server warns at boot; `permissions: []` (for `openid`) reaches nothing.
6. **Revoking a key frees its name**; an expired key keeps it until it is
   purged, and rotating it renews it under the same name.
7. **The IP allowlist is API-only**, set at creation, shown read-only, and
   worth only what `TRUST_PROXY` makes it worth.
8. **Two tables change shape, so every affected application needs a
   migration.** `api_keys` gains `permissions`, `ip_allowlist`, `rotated_at`
   and `expiry_notice_sent_at`, and its `(user_id, name)` unique index becomes
   partial (`WHERE revoked_at IS NULL`): any realm with `apiKeys: true`,
   including every project scaffolded by `alepha init --preset=saas`. `sessions`
   gains `scopes`: every application with a realm. Run
   `alepha db migrations create` and read the generated SQL before deploying.
