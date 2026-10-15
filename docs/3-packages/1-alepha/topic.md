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
- Providers: Redis when `REDIS_URL` is set, Memory otherwise

Set `REDIS_URL` and a message published on one instance reaches every
instance: WebSocket broadcasts, `parameter:sync` and `lock:end` included.
Leave it unset and topics stay inside this process. An app's own
`TopicProvider` substitution wins over both.

## API Reference

### Primitives

- [`$subscriber`](/docs/reference-primitives-$subscriber) - Creates a subscriber primitive to listen for messages from a specific topic.
- [`$topic`](/docs/reference-primitives-$topic) - Creates a topic primitive for publish/subscribe messaging and event-driven architecture.

### Providers

- [`RedisTopicProvider`](/docs/reference-providers-redistopicprovider) - Topics over Redis pub/sub.
- [`TopicProvider`](/docs/reference-providers-topicprovider) - Base class for topic providers.
