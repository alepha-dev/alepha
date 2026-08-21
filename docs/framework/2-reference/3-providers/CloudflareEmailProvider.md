# CloudflareEmailProvider

## Import

```typescript
import { CloudflareEmailProvider } from "alepha/email/cloudflare";
```

## Overview

Email provider using Cloudflare's Email Sending API.

Requires the Workers Paid plan and a verified sender address on the
`EMAIL_FROM` domain.

Two transports, picked automatically:

- **Workers binding** (`SEND_EMAIL`) when running on Workers. Preferred -
  no egress and no token to rotate.
- **REST API** otherwise, so the same provider keeps working on Node
  (`yarn start`, a container, a cron box). Needs
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`.

Configuration is provided via environment variables:

- `EMAIL_FROM`: Default sender email address
- `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`: REST fallback only
