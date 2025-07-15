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

```ts
import { Alepha, run } from "alepha";
import { AlephaServerStatic } from "alepha/server/static";

const alepha = Alepha.create()
  .with(AlephaServerStatic);

run(alepha);
```

Alepha Server Static Module

## API Reference

### Descriptors

#### $serve()

Create a new static file handler.
