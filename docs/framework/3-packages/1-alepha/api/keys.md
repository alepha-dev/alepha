# Alepha - Api Keys

## Installation

Part of the `alepha` package. Import from `alepha/api/keys`.

```bash
npm install alepha
```

## Overview

API key management module for programmatic access.

**Features:**

- Create API keys with role snapshots, capped at every request by the roles
  the owner holds now
- Expiry presets (`7d` to `1y`, or `never`) under a server-side policy
  (`apiKeyOptions`: default, cap, warning window), exposed to clients by
  `GET /api-keys/options`
- A derived status (`active`, `expiring`, `expired`, `revoked`) on every
  read, and the same rule as a query for filtering
- Rotation: a new secret on the same key, the old token dead at once
- Revocation that frees the key's name; a list that keeps dead keys until
  the daily purge job deletes them past their retention window
- A one-time expiry notice to the owner (with a realm's notifications)
- A permission scope per key, within what its creator may grant
- A per-key IP allowlist, set at creation (only as trustworthy as
  `TRUST_PROXY`)
- Throttled, approximate usage tracking (`lastUsedAt`, `usageCount`)
- An `api-key` audit trail: create, rotate, revoke, purge
- A key is a machine credential, not a session: routes declared
  `$secure({ sessionOnly: true })` refuse it, which includes creating,
  rotating and revoking keys
- 15-minute validation caching, and query param (`?api_key=`) and Bearer
  header support

See the API keys guide (`docs/framework/1-guides/4-server/21-api-keys.md`).

**Integration:**
A realm registers all of it with `features: { apiKeys: true }`. To enable
API key authentication for a plain issuer, register the resolver:

```ts
class MyApp {
  apiKeyService = $inject(ApiKeyService);
  issuer = $issuer({
    secret: env.APP_SECRET,
    resolvers: [this.apiKeyService.createResolver()],
  });
}
```
