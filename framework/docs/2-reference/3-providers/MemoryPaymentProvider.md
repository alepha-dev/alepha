# MemoryPaymentProvider

## Import

```typescript
import { MemoryPaymentProvider } from "alepha/api/payments";
```

## Overview

A payment provider that never moves money: every checkout is paid, every
card is a Visa 4242. For tests and local development.

Its state lives in in-process Maps, so it only holds within one process.
Every read and write goes through `read`, `write` and
`remove`, which a subclass overrides to keep the state elsewhere: see
`DatabaseMemoryPaymentProvider`, for a deployment whose requests may each
run in a fresh isolate (Cloudflare Workers).
