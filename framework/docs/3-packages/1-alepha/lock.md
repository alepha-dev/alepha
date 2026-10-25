# Alepha - Lock

## Installation

Part of the `alepha` package. Import from `alepha/lock`.

```bash
npm install alepha
```

## Overview

Resource locking for distributed systems.

**Features:**

- Distributed locks with timeout
- Time-based lock expiration
- Automatic release on scope exit
- Distributed coordination via Redis
- Providers: Redis when `REDIS_URL` is set, Memory otherwise

Set `REDIS_URL` and a lock held on one instance is held for all of them:
each `$job` cron tick runs on one instance. Leave it unset and locks only
exclude callers inside this process. An app's own `LockProvider` or
`LockTopicProvider` substitution wins over both.

## API Reference

### Primitives

- [`$lock`](/docs/reference-primitives-$lock) - Distributed lock middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.

### Providers

- [`LockProvider`](/docs/reference-providers-lockprovider) - Store Provider Interface
- [`MemoryLockProvider`](/docs/reference-providers-memorylockprovider) - A simple in-memory store provider.
- [`RedisLockProvider`](/docs/reference-providers-redislockprovider) - Locks over Redis `SET NX PX`.
