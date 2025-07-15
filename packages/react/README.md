# Alepha React

Build server-side rendered (SSR) or single-page React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaReact } from "alepha/react";

const alepha = Alepha.create()
  .with(AlephaReact);

run(alepha);
```

Alepha React Module

Alepha React Module contains a router for client-side navigation and server-side rendering.
Routes can be defined using the `$page` descriptor.

## API Reference

### Descriptors

#### $page()

Main descriptor for defining a React route in the application.
