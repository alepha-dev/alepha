# $context

## Import

```typescript
import { $context } from "alepha";
```

## Overview

Get Alepha instance and current service from the current context.

It can only be used inside $primitive functions.

```ts
import { $context, Alepha } from "alepha";

const $hello = () => {
  const { alepha, service, module } = $context();

  // alepha - alepha instance
  // service - class which is creating this primitive, this is NOT the instance but the service definition
  // module - module definition, if any

  return {};
};

class MyService {
  hello = $hello();
}

const alepha = new Alepha().with(MyService);
```
