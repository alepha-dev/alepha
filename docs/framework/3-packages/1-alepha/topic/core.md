# Alepha - Topic

## Installation

Part of the `alepha` package. Import from `alepha/topic`.

```bash
npm install alepha
```

## Overview

Publish/subscribe messaging for event-driven architectures.

**Features:**
- Pub/sub topics with type-safe messages
- Topic subscription handlers
- Multiple subscriber support
- Message filtering and routing
- Providers: Memory (dev), Redis (production)

## API Reference

### Primitives

- [`$subscriber`](/docs/reference-primitives-$subscriber) - Creates a subscriber primitive to listen for messages from a specific topic.
- [`$topic`](/docs/reference-primitives-$topic) - Creates a topic primitive for publish/subscribe messaging and event-driven architecture.

### Providers

- [`TopicProvider`](/docs/reference-providers-topicprovider) - Base class for topic providers.
