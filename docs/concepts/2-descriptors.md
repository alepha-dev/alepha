## Descriptors

Alepha Framework provides factory functions called **descriptors** that allow you to define various aspects of your application in a declarative way. These descriptors are used to create routes, services, and other components without the need for complex boilerplate code.

```ts
import { $action } from "alepha/server";
import { run, Alepha, $logger } from "alepha";
import { $queue } from "alepha/queue";
import { $scheduler } from "alepha/scheduler";

class UserController {
  log = $logger();
  findUsers = $action({
    handler: () => "List of users",
  });
  sendEmail = $queue();
  purgeItems = $scheduler({
    cron: "0 0 * * *",
    handler: () => this.log.info("Purging items..."),
  })
  // etc ...
}

const alepha = Alepha
  .create()
  .with(UserController);

run(alepha);
```

### Collection of Descriptors

There are more than 30 descriptors available in Alepha, each serving a specific purpose. Here are some of the most commonly used ones:

- **$action**: The primary way to build type-safe APIs. Creates a full-featured API endpoint with automatic validation for request parameters, query, and body, along with response serialization.
- **$repository**: The main interface for database interaction. Provides a fully-typed repository for a database entity, offering a complete set of CRUD and querying methods (find, create, update, delete, paginate).
- **$inject**: The core dependency injection mechanism. Allows a class to easily access instances of other services managed by the Alepha container, acting as the glue that connects the framework.
- **$page**: The cornerstone of the React integration. Defines a server-side rendered (SSR) or statically-generated web page, handling its route, data fetching (resolve), and component rendering.
- **$cache**: Creates a high-performance cache for functions or arbitrary data. It can wrap a function to automatically cache its results with a defined TTL, improving application speed.
- ...


