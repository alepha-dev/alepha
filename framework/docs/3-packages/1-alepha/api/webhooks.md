# Alepha - Api Webhooks

## Installation

Part of the `alepha` package. Import from `alepha/api/webhooks`.

```bash
npm install alepha
```

## Overview

Outbound webhooks: signed, retried deliveries on the jobs outbox.

**Features:**

- `$webhook` declares an event (name, description, schema); `send`
  writes one delivery per subscribed endpoint and pushes its job
- Endpoints are rows (`webhook_endpoints`), never source: URL, subscribed
  events, a secret encrypted with `APP_SECRET`, an optional tenancy
  `scope`
- A delivery log (`webhook_deliveries`): the envelope, the receiver's
  status and an excerpt of its answer, per delivery
- Inside a transaction, `send` is a true outbox on Postgres and SQLite

Not registered, nothing exists: no table, no job, no route.

## API Reference

### Primitives

- [`$webhook`](/docs/reference-primitives-$webhook) - Declares an outbound webhook event: its name, what it means to a
