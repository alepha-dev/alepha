# Alepha - Api Clients

## Installation

Part of the `alepha` package. Import from `alepha/api/clients`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 2 - experimental | 0.17.0 | node, bun|

OAuth2 Authorization Server module.

**Features:**
- Authorization code + PKCE (OAuth 2.1)
- Client credentials grant
- Refresh token grant
- Token introspection (RFC 7662)
- Token revocation (RFC 7009)
- Authorization Server metadata (RFC 8414)
- Protected Resource metadata (RFC 9728)
- MCP-compatible OAuth2 flow

**Integration:**
Enable via `$realm({ features: { clients: true } })`:

```ts
class MyApp {
  realm = $realm({
    features: { clients: true },
    identities: { credentials: true },
  });
}
```

