# Alepha Email

Email sending interface with multiple provider implementations (memory, local file, nodemailer).

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/email
```

## Module

Provides email sending capabilities for Alepha applications with multiple provider backends.

The email module enables declarative email sending through the `$email` descriptor, allowing you to send
emails through different providers: memory (for testing), local file system, or SMTP via Nodemailer.
It supports HTML email content and automatic provider selection based on environment configuration.

## API Reference

### Descriptors

#### $email()

Create an email descriptor for sending templated emails.

```ts
import { $email } from "@alepha/email";
import { Type } from "@alepha/core";

class App {
  welcome = $email({
    subject: "Welcome {{name}}!",
    body: "<h1>Welcome {{name}}!</h1><p>Your role is {{role}}.</p>",
    schema: t.object({
      name: t.string(),
      role: t.string()
    })
  });

  async sendWelcome(userEmail: string, name: string, role: string) {
    await this.welcome.send(userEmail, { name, role });
  }
}
```
