# Alepha - Thread

## Installation

Part of the `alepha` package. Import from `alepha/thread`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 1 - experimental | 0.15.0 | node|

Multi-threading support.

**Features:**
- Worker thread definitions
- Worker thread management
- Message passing
- Worker pools

## API Reference

### Primitives

- [`$thread`](/docs/primitives-$thread) — Creates a worker thread primitive for offloading CPU-intensive tasks to separate threads.
