# Alepha - Lock

## Installation

Part of the `alepha` package. Import from `alepha/lock`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.8.0 | node, bun, workerd|

Resource locking for distributed systems.

**Features:**
- Distributed locks with timeout
- Time-based lock expiration
- Automatic release on scope exit
- Distributed coordination via Redis
- Providers: Memory (dev), Redis (production)

## API Reference

### Primitives

- [`$lock`](/docs/reference-primitives-$lock) — Distributed lock middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.

### Providers

- [`MemoryLockProvider`](/docs/reference-providers-memorylockprovider) — A simple in-memory store provider.
