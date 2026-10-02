# BrevoEmailProvider

## Import

```typescript
import { BrevoEmailProvider } from "alepha/email/brevo";
```

## Overview

Email provider using Brevo (formerly Sendinblue) transactional email API.

Sends emails via `POST https://api.brevo.com/v3/smtp/email`.

Configuration is provided via environment variables:

- `BREVO_API_KEY`: Brevo API key
- `EMAIL_FROM`: Default sender email address
