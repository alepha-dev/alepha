# @alepha/server

## Installation

```bash
npm install @alepha/server
```

## Usage

```ts
import { Alepha, $route } from "@alepha/server";

class App {
  index = $route({
    handler: () => "Hello, World!",
  });
}

Alepha
  .create({
    SERVER_PORT: 3000,
    SERVER_OPENAPI_ENABLED: true,
    SERVER_SECURITY_ENABLED: true,
  })
  .with(App)
  .start();
```
