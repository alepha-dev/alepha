# Alepha - Topic

## Installation

Part of the `alepha` package. Import from `alepha/topic`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.7.0 | node, bun|

Publish/subscribe messaging for event-driven architectures.

**Features:**
- Pub/sub topics with type-safe messages
- Topic subscription handlers
- Multiple subscriber support
- Message filtering and routing
- Providers: Memory (dev), Redis (production)

## API Reference

### Primitives

- [`$subscriber`](/docs/primitives-$subscriber) — Creates a subscriber primitive to listen for messages from a specific topic.
- [`$topic`](/docs/primitives-$topic) — Creates a topic primitive for publish/subscribe messaging and event-driven architecture.
