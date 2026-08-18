# $email

## Import

```typescript
import { $email } from "alepha/email";
```

## Overview

Declares an email channel for sending mail through the configured provider.

The `name` identifies the channel in the `email:sending` / `email:sent`
hooks. `send()` takes the full message (`to`, `subject`, `html`, …); which
provider delivers it is a module decision (SMTP, Brevo, Cloudflare, or the
in-memory provider under test).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No |  |
| `provider` | `InstantiableClass&lt;EmailProvider&gt; \| "memory"` | No |  |

## Examples

```typescript
class NotificationService {
  email = $email({ name: "notifications" });

  async welcome(to: string) {
    await this.email.send({ to, subject: "Welcome!", html: "<p>Hello</p>" });
  }
}
```

