# $notification

## Import

```typescript
import { $notification } from "alepha/api/notifications";
```

## Overview

Creates a notification primitive for managing email/SMS notification templates.

Provides type-safe, reusable notification templates with multi-language support,
variable substitution, and categorization for different notification channels.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No |  |
| `description` | `string` | No |  |
| `category` | `string` | No |  |
| `critical` | `boolean` | No |  |
| `sensitive` | `boolean` | No | Marks the template's rendered `variables` as personal data |
| `translations` | `Object` | No |  |
| `schema` | `T` | Yes |  |

## Examples

```ts
class NotificationTemplates {
  welcomeEmail = $notification({
    name: "welcome-email",
    category: "onboarding",
    schema: z.object({ username: z.text(), activationLink: z.text() }),
    email: {
      subject: "Welcome to our platform!",
      body: (vars) => `Hello ${vars.username}, click: ${vars.activationLink}`
    }
  });

  async sendWelcome(user: User) {
    await this.welcomeEmail.push({
      variables: { username: user.name, activationLink: generateLink() },
      contact: user.email
    });
  }
}
```

