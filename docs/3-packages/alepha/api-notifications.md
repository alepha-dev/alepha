# Alepha - Api Notifications

## Installation

```bash
npm install alepha
```

## Overview

Provides notification management API endpoints for Alepha applications.

This module includes notification sending, retrieval, status tracking,
and user notification preferences management.

Requires `AlephaSms` module to be loaded for SMS notifications.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $notification()

Creates a notification descriptor for managing email/SMS notification templates.

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
