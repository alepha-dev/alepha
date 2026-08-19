# $sms

## Import

```typescript
import { $sms } from "alepha/sms";
```

## Overview

Declares an SMS channel for sending text messages through the configured
provider - the in-memory provider under test, a real gateway in production.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No |  |
| `provider` | `InstantiableClass&lt;SmsProvider&gt; \| "memory"` | No |  |

## Examples

```typescript
class VerificationService {
  sms = $sms();

  async sendCode(to: string, code: string) {
    await this.sms.send({ to, message: `Your code: ${code}` });
  }
}
```

