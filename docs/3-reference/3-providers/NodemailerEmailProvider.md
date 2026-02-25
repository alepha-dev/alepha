# NodemailerEmailProvider

## Import

```typescript
import { NodemailerEmailProvider } from "alepha/email/smtp";
```

## Overview

Email provider using Nodemailer for SMTP transport.

Configuration is provided via environment variables:
- EMAIL_HOST: SMTP server host
- EMAIL_PORT: SMTP server port (default: 587)
- EMAIL_USER: SMTP authentication username
- EMAIL_PASS: SMTP authentication password
- EMAIL_FROM: Default from email address
- EMAIL_SECURE: Use secure connection (default: false)

Advanced pooling/rate limiting options can be configured via atom:

