# Alepha - Api Parameters

## Installation

Part of the `alepha` package. Import from `alepha/api/parameters`.

```bash
npm install alepha
```

## Overview

Provides versioned configuration management for Alepha applications.

Features:
- Type-safe, versioned configuration with `$config` primitive
- Schema validation with auto-migration detection
- Scheduled activation (FUTURE, NEXT, CURRENT, EXPIRED statuses)
- PostgreSQL persistence with full version history
- Cross-instance synchronization via topic
- Tree view support via dot-notation naming
- REST API for configuration management
- Automatic activation scheduler

```ts
import { Alepha } from "alepha";
import { AlephaApiParameters } from "alepha/api/parameters";

const alepha = Alepha.create();
alepha.with(AlephaApiParameters);

// Then use $config in your services:
class AppConfig {
  features = $config({
    name: "app.features.flags",
    schema: t.object({
      enableBeta: t.boolean(),
      maxUploadSize: t.number()
    }),
    default: { enableBeta: false, maxUploadSize: 10485760 }
  });
}
```

