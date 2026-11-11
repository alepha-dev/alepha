# WebhookVerifier

## Import

```typescript
import { WebhookVerifier } from "alepha/security";
```

## Overview

Verifies a Standard Webhooks request (https://www.standardwebhooks.com),
from an Alepha app or from any sender that follows the specification.

Built on `WebhookSigner`, so the scheme is written once, and with no
dependency on the webhooks module: an app that only receives imports
`alepha/security` alone. Not registered by any module: inject it.

- The three `webhook-*` headers must be present.
- The timestamp must be within the tolerance (five minutes, both ways),
  against `DateTimeProvider`'s clock.
- The HMAC is recomputed and compared in constant time against EVERY
  `v1,` signature of the header (a rotation sends two), under every
  secret given. Signature versions it does not know are ignored.

A failure throws `InvalidWebhookSignatureError` (401) with a
`reason` for the log.
