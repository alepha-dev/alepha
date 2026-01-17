# Alepha - Redis

## Installation

Part of the `alepha` package. Import from `alepha/redis`.

```bash
npm install alepha
```

## Overview

Redis client provider for Alepha applications.

Automatically selects the appropriate provider based on runtime:
- Bun: Uses `BunRedisProvider` with Bun's native Redis client (7.9x faster than ioredis)
- Node.js: Uses `NodeRedisProvider` with `@redis/client`

```ts
// Inject the abstract provider - runtime selects the implementation
const redis = alepha.inject(RedisProvider);

// Use common operations
await redis.set("key", "value");
const value = await redis.get("key");

// For pub/sub
const subscriber = alepha.inject(RedisSubscriberProvider);
await subscriber.subscribe("channel", (message, channel) => {
  console.log(`Received: ${message} on ${channel}`);
});
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BunRedisProvider

Bun Redis client provider using Bun's native Redis client.

This provider uses Bun's built-in `RedisClient` class for Redis connections,
which provides excellent performance (7.9x faster than ioredis) on the Bun runtime.

```ts
// Set REDIS_URL environment variable
// REDIS_URL=redis://localhost:6379

// Or configure via REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

// Or configure programmatically
alepha.with({
  provide: RedisProvider,
  use: BunRedisProvider,
});
```

#### BunRedisSubscriberProvider

Bun Redis subscriber provider for pub/sub operations.

This provider creates a dedicated Redis connection for subscriptions,
as Redis requires separate connections for pub/sub operations.

```ts
const subscriber = alepha.inject(RedisSubscriberProvider);
await subscriber.subscribe("channel", (message, channel) => {
  console.log(`Received: ${message} on ${channel}`);
});
```

#### NodeRedisProvider

Node.js Redis client provider using `@redis/client`.

This provider uses the official Redis client for Node.js runtime.

```ts
// Set REDIS_URL environment variable
// REDIS_URL=redis://localhost:6379

// Or configure via REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

// Or configure programmatically
alepha.with({
  provide: RedisProvider,
  use: NodeRedisProvider,
});
```

#### NodeRedisSubscriberProvider

Node.js Redis subscriber provider using `@redis/client`.

This provider creates a dedicated Redis connection for subscriptions,
as Redis requires separate connections for pub/sub operations.

```ts
const subscriber = alepha.inject(RedisSubscriberProvider);
await subscriber.subscribe("channel", (message, channel) => {
  console.log(`Received: ${message} on ${channel}`);
});
```

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_HOST` | text | localhost |  |
| `REDIS_PASSWORD` | text | - |  |
| `REDIS_PORT` | integer | 6379 |  |
| `REDIS_URL` | text | - |  |
