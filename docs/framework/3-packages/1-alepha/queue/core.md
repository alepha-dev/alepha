# Alepha - Queue

## Installation

Part of the `alepha` package. Import from `alepha/queue`.

```bash
npm install alepha
```

## Overview

Message transport used under `$job`. **Not an application-facing API.**

There is no queue primitive. Declare background work with
`$job` (`alepha/api/jobs`) and add `AlephaApiJobsQueue` when you want
dispatch to travel through a broker instead of running in-process.

Delivery at this layer is **at-most-once**: a message is popped from the
backend before the handler runs, so a handler error or a process crash
loses it. There is no retry and no dead-letter queue here - `$job` supplies
those with a DB-backed outbox and a reconciliation sweep. (Cloudflare
Queues adds broker-level retry/DLQ, configured on the binding.)

**Features:**
- Consumers registered imperatively via `WorkerProvider.register`
- Polling worker loop with configurable concurrency and backoff
- Batch send where the backend supports it (`QueueProvider.pushMany`)
- Providers: Memory (dev), Redis (production), Cloudflare Queues

## API Reference

### Providers

- [`CloudflareQueueProvider`](/docs/reference-providers-cloudflarequeueprovider) - Cloudflare Queue provider.
- [`QueueCodec`](/docs/reference-providers-queuecodec) - Owns the on-the-wire shape of a queue message.
- [`QueueProvider`](/docs/reference-providers-queueprovider) - Minimalist Queue interface.
- [`WorkerdWorkerProvider`](/docs/reference-providers-workerdworkerprovider) - Cloudflare Workers queue consumer provider.
