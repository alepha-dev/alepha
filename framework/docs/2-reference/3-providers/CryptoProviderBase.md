# CryptoProviderBase

## Import

```typescript
import { CryptoProviderBase } from "alepha/crypto";
```

## Overview

One public crypto contract. Cryptographic transformations return promises
on every runtime; random generation and comparisons remain synchronous.
Password hashing is server-only and rejects in the browser.
