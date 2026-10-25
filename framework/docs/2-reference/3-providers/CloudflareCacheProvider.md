# CloudflareCacheProvider

## Import

```typescript
import { CloudflareCacheProvider } from "alepha/cache";
```

## Overview

Cloudflare cache provider: the database cache when the app has one, else KV.

This is the `CacheProvider` a Cloudflare Worker gets by default.

## Why the default moved off KV

For an app with a database, KV was the wrong default on every axis
(feedback #Q2151, folio #F1273). Reads are $0.50 per million keys against
$0.001 per million rows on D1, a 500x difference; writes are $5.00 against
$1.00; KV is eventually consistent where D1 is strongly consistent; KV
clamps every TTL to a 60 second floor.

And KV is the only one of the four providers that cannot implement `incr`
atomically. `CloudflareKVProvider.incr` documents that against itself:
two isolates incrementing concurrently can lose an update, which is not
sufficient for a rate limiter that must never over-admit. That is why five
`$cache` call sites across `api/users` and `api/oauth` used to pin
`provider: DatabaseCacheProvider` by hand; this class is what let those
hardcodes go.

The latency argument for KV does not survive either: D1 has read
replication, `CloudflareD1Provider.openSession()` implements it, Cloudflare
creates the replicas at no cost, and `DATABASE_D1_MODE=sessions` turns it
on. A config flag, not an architecture.

## Why a delegator rather than a branch at registration time

Two simpler mechanisms were tried on paper first and both fail:

- **Branch `AlephaCache`'s `register()` on `DATABASE_URL`.** It cannot name
  `DatabaseCacheProvider` (the cycle above), and `DATABASE_URL` is the
  wrong question anyway: an app can set it and register no ORM.
- **Let `alepha/cache/database` bind `CacheProvider` itself.** ⚠️ This one
  looks right and is silently order-dependent. A substitution is recorded
  only `if (!this.has(entry.provide))`, so the FIRST binding wins and every
  later `optional: true` one is dropped without a word. `AlephaCache` is
  registered as a plain service by `alepha/server/etag`, which
  `alepha/server/swagger` pulls in, so KV would usually be bound long
  before anything reached the database module.

Resolving at `start` sidesteps the ordering entirely: by then every module
has registered and the question has one answer.

## The signal is the module, not the environment

"This container has a `DatabaseCacheProvider`" is narrower and more honest
than "`DATABASE_URL` is set". It is true exactly when something registered
`alepha/cache/database`, which is what puts `cache_entries` in the
migration snapshot - so the provider this picks can never be one whose
table does not exist.

⚠️ **Resolved once, at `start`.** A cache read must not pay a container
lookup, and the container is locked by then, so the answer cannot change
underneath it.
