# Alepha - Queue

## Installation

Part of the `alepha` package. Import from `alepha/queue`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.6.0 | node, bun|

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

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `QUEUE_WORKER_CONCURRENCY` | integer | 1 |  |
| `QUEUE_WORKER_INTERVAL` | integer | 1000 |  |
| `QUEUE_WORKER_MAX_INTERVAL` | integer | 32000 |  |
