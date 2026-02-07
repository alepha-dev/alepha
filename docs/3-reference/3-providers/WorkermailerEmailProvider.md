# WorkermailerEmailProvider

## Import

```typescript
import { WorkermailerEmailProvider } from "alepha/email";
```

## Overview

Email provider using worker-mailer for Cloudflare Workers.

This provider uses Cloudflare's TCP Sockets API to send emails via SMTP,
making it suitable for edge runtime environments.

Configuration is provided via environment variables:
- EMAIL_HOST: SMTP server host
- EMAIL_PORT: SMTP server port (default: 587, note: port 25 is blocked)
- EMAIL_USER: SMTP authentication username
- EMAIL_PASS: SMTP authentication password
- EMAIL_FROM: Default from email address
- EMAIL_FROM_NAME: Default from name (optional)
- EMAIL_SECURE: Use secure connection (default: true)
- EMAIL_AUTH_TYPE: Authentication type - plain, login, or cram-md5 (default: plain)

