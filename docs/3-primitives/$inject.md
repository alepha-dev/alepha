# $inject

> Get the instance of the specified type from the context.

## Import

```typescript
import { $inject } from "alepha";
```

## Overview

Get the instance of the specified type from the context.

```ts
class A { }
class B {
  a = $inject(A);
}
```

