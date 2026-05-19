# Alepha - Api Oauth

## Installation

Part of the `alepha` package. Import from `alepha/api/oauth`.

```bash
npm install alepha
```

## Overview

OAuth 2.1 authorization server module for MCP.

**Features:**
- OAuth 2.1 authorization code flow with PKCE (RFC 7636)
- Dynamic Client Registration (RFC 7591)
- Authorization server metadata discovery (RFC 8414)
- Stateless authorization codes (short-lived signed JWTs)
- Single-use code enforcement

**Integration:**
Register the module and configure the realm + protected resource path:

```ts
const app = Alepha.create()
  .with(AlephaOAuth)
  .set(oauthOptions, { realm: "users", resource: "/mcp" });
```

