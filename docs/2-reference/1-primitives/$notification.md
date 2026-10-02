# $notification

## Import

```typescript
import { $notification } from "alepha/api/notifications";
```

## Overview

Creates a notification primitive: a delivery template, pushed through a
durable outbox.

Provides type-safe, reusable notification templates with multi-language
support, variable substitution, and categorization.

**The channel set is open.** `email` and `sms` are the two the framework
ships, and each is one `NotificationChannel` service among however many the
container registers. A package outside the framework adds its own key by
declaration merging on `NotificationChannels`, and a template that
names a channel nothing provides refuses to boot rather than silently
sending nothing.

## Options

| Option         | Type      | Required | Description                                                |
| -------------- | --------- | -------- | ---------------------------------------------------------- |
| `name`         | `string`  | No       |                                                            |
| `description`  | `string`  | No       |                                                            |
| `category`     | `string`  | No       |                                                            |
| `critical`     | `boolean` | No       |                                                            |
| `sensitive`    | `boolean` | No       | Marks the template's rendered `variables` as personal data |
| `translations` | `Object`  | No       |                                                            |
| `schema`       | `T`       | Yes      |                                                            |

## Examples

```ts
class NotificationTemplates {
  welcomeEmail = $notification({
    name: "welcome-email",
    category: "onboarding",
    schema: z.object({ username: z.text(), activationLink: z.text() }),
    email: {
      subject: "Welcome to our platform!",
      body: (vars) => `Hello ${vars.username}, click: ${vars.activationLink}`,
    },
  });

  async sendWelcome(user: User) {
    await this.welcomeEmail.push({
      variables: { username: user.name, activationLink: generateLink() },
      contact: user.email,
    });
  }
}
```
