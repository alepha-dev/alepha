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
- Dynamic Client Registration (RFC 7591), deduplicated
- Authorization server metadata discovery (RFC 8414)
- Stateless authorization codes (short-lived signed JWTs)
- Single-use code enforcement
- Refresh tokens bound to the client they were issued to
- Device authorization grant (RFC 8628), with the page a human approves a
  device on

**The device grant ships both halves.** `POST /oauth/device_authorization`
and the `device_code` token grant are the device's; `/oauth/device` is the
human's, and it is the `verification_uri` a device is told to print. It is
server-rendered HTML like the consent screen, sends a signed-out visitor to
`loginPath?redirect_uri=` and back, and refuses an answer posted from
another origin - see `OAuthController.deviceDecision` for why that check
matters more here than on the consent POST.

**Registration is deduplicated, and that is what makes a "connected app"
a thing.** A client that registers again with the same name, the same
redirect_uris and no secret is handed the row it already has instead of a
new one. Some clients - claude.ai among them - run DCR on every connect
and never reuse an id, which grew a table of near-identical rows and, worse,
made one application look like four to anything grouping by `client_id`.
Reuse is refused for a confidential client, a revoked one, another realm,
a different redirect_uri set, and for any registration that named its own
`client_id` - see `OAuthClientService.register`.

`oauth_clients.lastUsedAt` is written on every successful grant, and
`OAuthJobs.purgeAbandonedClients` collects DCR rows older than a day that
no session references. Register it the way `$realm` does; a job that
mounted itself would run in every application that imports this module.

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
