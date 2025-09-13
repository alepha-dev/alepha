## Modules

Small applications can be built with a single file, but as your application grows, you will want to organize your code into modules.

Modules are a way to group related services, providers, and descriptors together.

```ts
import { Alepha, run, $module } from "alepha";

const MyUserModule = $module({
  name: "com.example.user",
  services: [UserController],
});

const MyNotificationModule = $module({
  name: "com.example.notification",
  services: [NotificationController],
});

const alepha = Alepha
  .create()
  .with(MyUserModule)
  .with(MyNotificationModule);

run(alepha);
```

Modules are not mandatory, but they help to organize your code and make it more maintainable.

### Don't $inject across modules

When using modules, it's important to avoid injecting services from one module into another.

Instead, use the `$client` descriptor to communicate between modules with `$action`.
This ensures that your modules remain decoupled and can be reused independently.

```ts
import { $client } from "alepha/server/links";
import type { NotificationController } from "@mycompany/api-notifications";

class UserController {
  notificationCtrl = $client<NotificationController>();

  createUser = $action({
    handler: async () => {
      // ...
      await this.notificationCtrl.sendNotification( /* ... */ );
      // ...
    },
  });
}

// now, modules can run in the same process (monolith)
// or in different processes (microservices), does not matter
```

Check out the [alepha/server/links](/docs/alepha-server-links) package for more details on how to use `$client` and communicate between modules.



