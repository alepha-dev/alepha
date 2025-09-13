# Alepha Server Static

Serves static files like HTML, CSS, and JavaScript.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-static
```

## Module

Create static file server with `$static()`.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerStatic } from "alepha/server/static";

const alepha = Alepha.create()
	.with(AlephaServerStatic);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $serve()

Create a new static file handler.
