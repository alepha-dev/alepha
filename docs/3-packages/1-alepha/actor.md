# Alepha - Actor

## Installation

Part of the `alepha` package. Import from `alepha/actor`.

```bash
npm install alepha
```

## Overview

Pure synchronous JSON reducers with independent default/keyed snapshots.

On Node and Bun, `REDIS_URL` selects Redis: every instance shares actor
state, and every `$rateLimit` becomes cross-instance. Without it, state is
volatile per-container Memory, one instance. An app's own `ActorProvider`
substitution wins over both.

With Redis, every actor identity carries `alepha.name` (APP_NAME, else the
build's app name, else "app"), so two apps on one Redis never share actor
state. Durability depends on Redis persistence, eviction and failover
configuration, without exactly-once claims. Only definite compare-and-set
conflicts retry pure reducers; transport failures propagate without replay
because a commit can have succeeded before the error.

## API Reference

### Primitives

- [`$actor`](/docs/reference-primitives-$actor) - Declare independent default and keyed actor state from an atom descriptor.

### Providers

- [`ActorCodec`](/docs/reference-providers-actorcodec) - Lossless JSON snapshots and protocol-v1 validation shared by actor providers.
- [`ActorHost`](/docs/reference-providers-actorhost) - One instance's serialized protocol KV snapshots on SQLite-backed storage.
- [`ActorHostRegistry`](/docs/reference-providers-actorhostregistry) - Runtime-neutral native-host declarations, visible without starting the app.
- [`ActorHostRuntime`](/docs/reference-providers-actorhostruntime) - Common app/environment resolution, namespace lookup and specialized startup.
- [`ActorProvider`](/docs/reference-providers-actorprovider) - Actor snapshot transport. Browser and native execution is unsupported.
- [`ActorRedisConnection`](/docs/reference-providers-actorredisconnection) - Injection token for an existing runtime Redis provider's get/eval seam.
- [`ActorRegistry`](/docs/reference-providers-actorregistry) - Per-container declaration allowlist, independent of the local atom store.
- [`AlephaActorDurableObject`](/docs/reference-providers-alephaactordurableobject) - Native workerd-only adapter for the shared actor host.
- [`BunActorRedisProvider`](/docs/reference-providers-bunactorredisprovider) - Existing Bun Redis operations with offline command replay disabled.
- [`CloudflareActorProvider`](/docs/reference-providers-cloudflareactorprovider) - Routes independent encoded actor identities to the shared native host.
- [`MemoryActorProvider`](/docs/reference-providers-memoryactorprovider) - Volatile actor snapshots scoped to one container, serialized per identity.
- [`NodeActorRedisProvider`](/docs/reference-providers-nodeactorredisprovider) - Existing Node Redis operations with offline command replay disabled.
- [`RedisActorProvider`](/docs/reference-providers-redisactorprovider) - One-key exact-byte CAS of validated actor envelopes using Redis eval.
