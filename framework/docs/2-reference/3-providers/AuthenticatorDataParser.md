# AuthenticatorDataParser

## Import

```typescript
import { AuthenticatorDataParser } from "alepha/security";
```

## Overview

Parses authenticator data: RP ID hash (32 bytes), flags (1), sign counter
(4, big-endian), then the attested credential data when AT is set (AAGUID
16, credential id length 2, credential id, COSE public key) and the
extensions when ED is set. Bytes left over, or a flag announcing data that
is not there, are refused with reason `authenticatorData`.
