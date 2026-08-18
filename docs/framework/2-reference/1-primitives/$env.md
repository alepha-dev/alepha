# $env

## Import

```typescript
import { $env } from "alepha";
```

## Overview

Get typed values from environment variables.

## Examples

```ts
const alepha = Alepha.create({
  env: {
    // Alepha.create() will also use process.env when running on Node.js
    HELLO: "world",
  }
});

class App {
  log = $logger();

  // program expect a var env "HELLO" as string to works
  env = $env(z.object({
    HELLO: z.text()
  }));

  sayHello = () => this.log.info("Hello ${this.env.HELLO}")
}

run(alepha.with(App));
```

