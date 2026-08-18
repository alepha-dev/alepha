# Alepha - Redis

## Installation

Part of the `alepha` package. Import from `alepha/redis`.

```bash
npm install alepha
```

## Overview

Redis client wrapper.

**Features:**
- Single managed client connection with automatic reconnection
- Pub/sub support
- Node and Bun client implementations

## API Reference

### Providers

- [`BunRedisProvider`](/docs/reference-providers-bunredisprovider) — Bun Redis client provider using Bun's native Redis client.
- [`BunRedisSubscriberProvider`](/docs/reference-providers-bunredissubscriberprovider) — Bun Redis subscriber provider for pub/sub operations.
- [`NodeRedisProvider`](/docs/reference-providers-noderedisprovider) — Node.js Redis client provider using `@redis/client`.
- [`NodeRedisSubscriberProvider`](/docs/reference-providers-noderedissubscriberprovider) — Node.js Redis subscriber provider using `@redis/client`.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_URL` | text | redis://localhost:6379 | Redis connection URL |
