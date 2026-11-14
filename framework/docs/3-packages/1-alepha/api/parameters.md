# Alepha - Api Parameters

## Installation

Part of the `alepha` package. Import from `alepha/api/parameters`.

```bash
npm install alepha
```

## Overview

Application parameter management.

**Features:**

- Versioned parameter definitions
- Status derived from activationDate at query time
- Schema validation with migration detection
- Cross-instance notification via pub/sub
- Async `.get()` with lazy loading (works in Node and Cloudflare Workers)
- The admin dashboard's layout (`admin.dashboard.layout`), read by any admin
  and saved with a version check (`AdminDashboardLayoutController`)

## API Reference

### Primitives

- [`$parameter`](/docs/reference-primitives-$parameter) - Declares a named, schema-validated runtime parameter - configuration that
