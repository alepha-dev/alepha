# Alepha Topic

A publish-subscribe (pub/sub) messaging interface for eventing.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/topic
```

## Module

Generic interface for pub/sub messaging.
Gives you the ability to create topics and subscribers.
This module provides only a memory implementation of the topic provider.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaTopic } from "alepha/topic";

const alepha = Alepha.create()
	.with(AlephaTopic);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $subscriber()

Subscribe to a $topic.

#### $topic()

Create a new topic.
