# Alepha React Auth

Simplifies user authentication flows in React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react-auth
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";

const alepha = Alepha.create()
  .with(AlephaReactAuth);

run(alepha);
```

Alepha React Authentication Module

The ReactAuthModule provides authentication services for React applications.

## API Reference

### Descriptors

#### $auth()


