# Alepha - Api Parameters

## Installation

Part of the `alepha` package. Import from `alepha/api/parameters`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.9.0 | node, bun, workerd|

Application parameter management.

**Features:**
- Versioned parameter definitions
- Status derived from activationDate at query time
- Schema validation with migration detection
- Cross-instance notification via pub/sub
- Async `.get()` with lazy loading (works in Node and Cloudflare Workers)

