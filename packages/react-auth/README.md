# Alepha React Auth

Simplifies user authentication flows in React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

The ReactAuthModule provides authentication services for React applications.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";

const alepha = Alepha.create()
	.with(AlephaReactAuth);

run(alepha);
```
