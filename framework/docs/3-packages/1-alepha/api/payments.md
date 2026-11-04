# Alepha - Api Payments

## Installation

Part of the `alepha` package. Import from `alepha/api/payments`.

```bash
npm install alepha
```

## Overview

Provider-agnostic payments: intents, checkout sessions, capture, refunds,
webhooks, and admin operations. `MemoryPaymentProvider` is registered by
default; plug a PSP with `@alepha/payments-stripe`.

## API Reference

### Providers

- [`DatabaseMemoryPaymentProvider`](/docs/reference-providers-databasememorypaymentprovider) - `MemoryPaymentProvider` whose state lives in the `cache_entries` table
- [`MemoryPaymentProvider`](/docs/reference-providers-memorypaymentprovider) - A payment provider that never moves money: every checkout is paid, every
