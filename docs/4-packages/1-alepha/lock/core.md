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

- [`$lock`](/docs/reference-primitives-$lock) — Creates a distributed lock primitive for ensuring single-instance execution across processes.

### Providers

- [`MemoryLockProvider`](/docs/reference-providers-memorylockprovider) — A simple in-memory store provider.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOCK_PREFIX_KEY` | text | lock |  |
