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
- Refresh tokens bound to the client they were issued to

**The `refresh_token` grant requires `client_id`.** The client is looked up
and - when confidential - must present its secret, exactly as on the
`authorization_code` grant; the refresh token must then belong to a session
minted for that same client. A session with no recorded client (an ordinary
password login) is not an OAuth grant and cannot be refreshed here.

This makes the id_token `aud` trustworthy: it is the authenticated client,
not an unvalidated request field. Without the binding, any refresh-token
holder could name any `client_id` and receive an id_token minted for it,
which a relying party that forwards id_tokens as its Bearer would accept.

**Integration:**
Register the module and configure the realm + protected resource path:

```ts
const app = Alepha.create()
  .with(AlephaOAuth)
  .set(oauthOptions, { realm: "users", resource: "/mcp" });
```

