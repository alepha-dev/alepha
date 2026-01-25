# Alepha - Api Keys

## Installation

Part of the `alepha` package. Import from `alepha/api/keys`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|--------------|
| backend | good | experimental |

API key management module for programmatic access.

**Features:**
- Create API keys with role snapshots
- List and revoke API keys
- 15-minute validation caching
- Query param (?api_key=) and Bearer header support

**Integration:**
To enable API key authentication for an issuer, register the resolver:

```ts
class MyApp {
  apiKeyService = $inject(ApiKeyService);
  issuer = $issuer({
    secret: env.APP_SECRET,
    resolvers: [this.apiKeyService.createResolver()],
  });
}
```

