# alepha/server

```ts
import { Alepha } from "alepha";
import { $route } from "alepha/server";

class App {
  index = $route({
    handler: () => "Hello, World!",
  });
}

run(App);
```
