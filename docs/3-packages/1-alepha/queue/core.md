# Alepha - Queue

## Installation

Part of the `alepha` package. Import from `alepha/queue`.

```bash
npm install alepha
```

## Overview

Asynchronous message processing with automatic worker management.

Delivery is **at-most-once**: a message is popped from the backend before
the handler runs, so a handler error or a process crash loses it. There is
no retry, no dead-letter queue and no delivery guarantee at this layer.
**For work that must not be lost, use `$job` (alepha/api/jobs)** — it layers
a durable, DB-backed outbox over this transport.

**Features:**
- Background job queues with type-safe payloads
- Queue consumer handlers
- Automatic worker threads for non-blocking processing
- Configurable concurrency and worker pools
- Providers: Memory (dev), Redis (production), Cloudflare Queues

## API Reference

### Primitives

- [`$consumer`](/docs/reference-primitives-$consumer) — Creates a consumer primitive to process messages from a specific queue.
- [`$queue`](/docs/reference-primitives-$queue) — Creates a queue primitive for asynchronous message processing with background workers.

### Providers

- [`CloudflareQueueProvider`](/docs/reference-providers-cloudflarequeueprovider) — Cloudflare Queue provider.
- [`WorkerdWorkerProvider`](/docs/reference-providers-workerdworkerprovider) — Cloudflare Workers queue consumer provider.
