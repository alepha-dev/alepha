# Alepha - Api Notifications

## Installation

Part of the `alepha` package. Import from `alepha/api/notifications`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.10.0 | node, bun, workerd|

User notification management.

**Features:**
- Notification definitions
- Email/SMS notification sending
- Status tracking
- User preferences
- Queue integration

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $notification()

Creates a notification primitive for managing email/SMS notification templates.

Provides type-safe, reusable notification templates with multi-language support,
variable substitution, and categorization for different notification channels.

```ts
class NotificationTemplates {
  welcomeEmail = $notification({
    name: "welcome-email",
    category: "onboarding",
    schema: t.object({ username: t.text(), activationLink: t.text() }),
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
