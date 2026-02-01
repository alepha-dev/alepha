# Alepha - Server Helmet

## Installation

Part of the `alepha` package. Import from `alepha/server/helmet`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.15.0 | node, bun, workerd|

HTTP security headers.

**Features:**
- X-Frame-Options
- X-Content-Type-Options
- Content-Security-Policy
- Other security headers

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ServerHelmetProvider

Provides a configurable way to apply essential HTTP security headers
to every server response, without external dependencies.
