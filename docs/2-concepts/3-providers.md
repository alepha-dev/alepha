## Providers

Take a look at the following code snippet:

```ts
// this is a service
class UserNotificationService {
  // it's a simple method which sends a notification
  notifyUser(to: string, message: string) {
    // email.send(to, message);
  }
}
```

The class `NotificationService` inside the Alepha container is called a **service**. It's a stateless singleton.

In order to send our email, we need to create a provider that will handle the email sending logic.
Providers are classes that encapsulate specific functionality and can be injected into services or other providers.

```ts
import { $hook, $env, t, $inject } from "alepha";
import { createTransport } from "nodemailer";

class EmailProvider {
  // configure provider with environment variables
  env = $env(t.object({
    SMTP_HOST: t.text(),
  }));

  transporter = createTransport({
    host: this.env.SMTP_HOST,
  });

  send(to: string, message: string) {
    return this.transporter.sendMail({
      from: to,
      text: message,
    });
  }
}

class UserNotificationService {
  emailProvider = $inject(EmailProvider);

  notifyUser(to: string, message: string) {
    return this.emailProvider.send(to, message);
  }
}
```

Voila! Now we have a `UserNotificationService` that can send notifications using the `EmailProvider`.
The `EmailProvider` is configured with environment variables and can be injected into any service that needs to send emails.

All Alepha packages contains a set of providers that can be used in your application.
For example, the `alepha/queue` package provides a `QueueProvider` that can be used to send messages to a queue.

### Polymorphic Providers

Sometimes, you may want to use different implementations of a provider based on the environment or configuration.

For example, `QueueProvider` may vary based on the queue system you use (e.g., Redis, RabbitMQ, etc.).
In this case, you can use polymorphic providers.

```ts
import { $env, t, $inject, alepha } from "alepha";
import { QueueProvider, MemoryQueueProvider } from "alepha/queue";
import { RedisQueueProvider } from "alepha/queue-redis";

class TransactionService {
  // Inject the QueueProvider, which can be either Redis or Memory based on the environment
  queue = $inject(QueueProvider);
}

const alepha = Alepha.create().with(TransactionService);

if (alepha.isProduction()) {
  // In production, use a Redis queue provider
  alepha.with({ provide: QueueProvider, use: RedisQueueProvider });
} else {
  // In development, use a memory queue provider
  alepha.with({ provide: QueueProvider, use: MemoryQueueProvider });
}

run(alepha);
```
