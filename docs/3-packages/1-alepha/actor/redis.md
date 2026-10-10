# Alepha - Actor Redis

## Installation

Part of the `alepha` package. Import from `alepha/actor/redis`.

```bash
npm install alepha
```

## Overview

Explicit Redis actor selection for Node and Bun. Requires a nonempty
ALEPHA_ACTOR_NAMESPACE before connecting. Durability depends on Redis
persistence, eviction and failover configuration, without exactly-once claims.
REDIS_URL alone does not select this provider. Start the container before use.
Only definite compare-and-set conflicts retry pure reducers; transport failures
propagate without replay because a commit can have succeeded before the error.

## API Reference

### Providers

- [`ActorRedisConnection`](/docs/reference-providers-actorredisconnection) - Injection token for an existing runtime Redis provider's get/eval seam.
- [`BunActorRedisProvider`](/docs/reference-providers-bunactorredisprovider) - Existing Bun Redis operations with offline command replay disabled.
- [`NodeActorRedisProvider`](/docs/reference-providers-nodeactorredisprovider) - Existing Node Redis operations with offline command replay disabled.
- [`RedisActorProvider`](/docs/reference-providers-redisactorprovider) - One-key exact-byte CAS of validated actor envelopes using Redis eval.
