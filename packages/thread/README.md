# Alepha Thread

Run worker threads in Node.js with a simple API.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/thread
```

## Module

Simple interface for managing worker threads in Alepha.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaThread } from "alepha/thread";

const alepha = Alepha.create()
	.with(AlephaThread);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $thread()


