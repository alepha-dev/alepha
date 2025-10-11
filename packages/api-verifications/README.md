# Alepha Api Verifications

Verification management API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides verification management API endpoints for Alepha applications.

This module includes verification code management for multifactor authentication and other verification flows.
- Create and send verification codes via email or SMS.
- Validate verification codes submitted by users.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiVerifications } from "alepha/api/verifications";

const alepha = Alepha.create()
	.with(AlephaApiVerifications);

run(alepha);
```
