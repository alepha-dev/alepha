# Alepha - Queue

## Installation

Part of the `alepha` package. Import from `alepha/queue`.

```bash
npm install alepha
```

## Overview

Asynchronous message processing with automatic worker management.

**Features:**
- Background job queues with type-safe payloads
- Queue consumer handlers
- Automatic worker threads for non-blocking processing
- Retry mechanisms with exponential backoff
- Dead letter queues for failed messages
- Batch processing support
- Configurable concurrency and worker pools
- Providers: Memory (dev), Redis (production)

## API Reference

### Primitives

- [`$consumer`](/docs/reference-primitives-$consumer) — Creates a consumer primitive to process messages from a specific queue.
- [`$queue`](/docs/reference-primitives-$queue) — Creates a queue primitive for asynchronous message processing with background workers.

### Providers

- [`CloudflareQueueProvider`](/docs/reference-providers-cloudflarequeueprovider) — Cloudflare Queue provider.
- [`WorkerdWorkerProvider`](/docs/reference-providers-workerdworkerprovider) — Cloudflare Workers queue consumer provider.
