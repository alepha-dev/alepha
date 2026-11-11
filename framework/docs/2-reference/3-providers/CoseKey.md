# CoseKey

## Import

```typescript
import { CoseKey } from "alepha/security";
```

## Overview

COSE public keys (RFC 9052, 9053) to JWK, and signature checks with that
JWK on `crypto.subtle`.

Accepted: EC2 on P-256 with ES256 (-7), RSA with RS256 (-257), and OKP on
Ed25519 with EdDSA (-8). Any other algorithm, key type or curve is an
`UnsupportedCoseAlgorithmError`, as is EdDSA on a runtime whose
WebCrypto has no Ed25519.
