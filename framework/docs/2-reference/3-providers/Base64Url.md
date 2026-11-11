# Base64Url

## Import

```typescript
import { Base64Url } from "alepha/security";
```

## Overview

Base64url (RFC 4648 section 5, no padding) to bytes and back, with `atob`
and `btoa` only: the same code on Node, Bun, workerd and the browser, with
no `Buffer`.

Decoding is strict: a character outside the url-safe alphabet, padding,
or a length no encoding produces is refused with a `WebAuthnError`
of reason `encoding`.
