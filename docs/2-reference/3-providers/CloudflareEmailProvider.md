# CloudflareEmailProvider

## Import

```typescript
import { CloudflareEmailProvider } from "alepha/email/cloudflare";
```

## Overview

Email provider using Cloudflare's Email Sending API via a Workers binding.

Requires the Workers Paid plan and a verified sender address on the
`EMAIL_FROM` domain.

**Required Cloudflare binding:**
- `SEND_EMAIL` — an Email Sending binding in wrangler configuration

Configuration is provided via environment variables:
- `EMAIL_FROM`: Default sender email address

