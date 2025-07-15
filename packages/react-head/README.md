# Alepha React Head

Manages the document <head> for SEO and metadata.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react-head
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaReactHead } from "alepha/react/head";

const alepha = Alepha.create()
  .with(AlephaReactHead);

run(alepha);
```

Alepha React Head Module

## API Reference
