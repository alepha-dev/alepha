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

```ts
import { Alepha, run } from "alepha";
import { AlephaTopic } from "alepha/topic";

const alepha = Alepha.create()
  .with(AlephaTopic);

run(alepha);
```

Alepha Topic Module

Generic interface for pub/sub messaging.
Gives you the ability to create topics and subscribers.
This module provides only a memory implementation of the topic provider.

## API Reference

### Descriptors

#### $subscriber()

Subscriber descriptor.

#### $topic()

Create a new topic.
