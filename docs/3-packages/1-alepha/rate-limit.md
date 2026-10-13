# Alepha - Rate Limit

## Installation

Part of the `alepha` package. Import from `alepha/rate/limit`.

```bash
npm install alepha
```

## Overview

Transport-agnostic, fail-closed rate limiting on `$actor`.

**Features:**

- `$rateLimit` limiters with `consume` and `refund(ticket)`
- Fixed windows anchored on the first hit, saturating without writes
- `deny` on store errors and contention by default
- Topology from the actor provider: Memory (one instance), Redis (several),
  Durable Objects (workerd)

## API Reference

### Primitives

- [`$rateLimit`](/docs/reference-primitives-$ratelimit) - Declare a transport-agnostic, fail-closed rate limiter.
