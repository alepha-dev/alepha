# Alepha Server Security

Add security layer to the Alepha server.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin for Alepha Server that provides security features. Based on the Alepha Security module.

By default, all $action will be guarded by a permission check.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerSecurity } from "alepha/server/security";

const alepha = Alepha.create()
	.with(AlephaServerSecurity);

run(alepha);
```
