# WebhookSigner

## Import

```typescript
import { WebhookSigner } from "alepha/security";
```

## Overview

Signs webhook requests the Standard Webhooks way
(https://www.standardwebhooks.com), so a receiver in any language can use
an existing verifier.

- The signed content is `${id}.${timestamp}.${body}`, where `body` is the
  exact bytes sent: serialise once, sign that string, send that string.
- The key is the secret's BYTES: the base64 that follows `whsec_`,
  decoded.
- HMAC-SHA256, base64 output, sent as `webhook-signature: v1,<base64>`.
  Several secrets (a rotation's overlap) give several space-separated
  signatures.

Built on WebCrypto (`crypto.subtle`), so it runs unchanged on Node, Bun
and workerd. Not registered by any module: inject it where it is needed,
a receiver included, without the webhooks module.
