# OAuth Authorization Server

A realm can act as an OAuth 2.1 authorization server, which is what an MCP client such as claude.ai or Claude Code signs in through. Turn it on with the realm's `oauth` feature:

```typescript
import { $realm } from "alepha/api/users";

class App {
  realm = $realm({ features: { oauth: true } });
}
```

That mounts the discovery documents (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/.well-known/openid-configuration`), dynamic client registration (`POST /oauth/register`), the authorization endpoint with its consent screen (`/oauth/authorize`), the token endpoint (`POST /oauth/token`, with PKCE S256 and refresh), and the device grant (`/oauth/device_authorization`, `/oauth/device`). It also turns on the MCP transport's `requireAuth`, so an unauthenticated call to the MCP endpoint gets the `401` challenge a client starts its discovery from.

The `oauthOptions` atom configures it: `resource` (the protected endpoint's path, `/mcp` by default), `loginPath`, `productName` and `connectionsPath` for the consent screen, and `scopes`, which declares what each scope means and which permissions a token granted it may use.

## Tokens Are Bound to the Resource

An access token is bound to the resource it was issued for (RFC 8707), as MCP authorization requires: a server must refuse a token that was not issued for it.

- **The audience.** A token minted through `/oauth/token` carries `aud: [realm, resource]`, where `resource` is the canonical URL of the protected endpoint (for example `https://lore.example.com/mcp`, the same URL the protected-resource metadata publishes). Every verifier checking for the realm still passes, since the realm is still in the audience.
- **One resource.** The server protects a single resource, `oauthOptions.resource`. A grant that names no `resource` is bound to it anyway; one that names it is accepted after normalisation (lowercase scheme and host, default port dropped, no trailing slash); one that names anything else is refused with `invalid_target`, at `/oauth/authorize` (as a redirect to the client), at `/oauth/token` and at `/oauth/device_authorization`.
- **Across refresh.** The resource is stored on the session (`sessions.resource`) and signed back into every refreshed token, at `/oauth/token` and at `/_auth/refresh` alike.
- **At the endpoint.** The MCP transport compares a token's resource with its own canonical URL and answers a mismatch with the same `401` and `resource_metadata` challenge as a missing token, so the client authorizes again for the right resource.

A token bound to no resource passes: a first-party login, and OAuth sessions created before binding existed, which keep working until they age out. A bound token still reaches the rest of the application's API, which checks the realm, not the resource: a CLI signed in through the device grant is bound to the MCP endpoint and keeps calling everything else. Applications that own the `sessions` table need the migration that adds its `resource` column.

## How Clients Register

MCP 2026-07-28 orders the ways a client gets a `client_id`: pre-registration, then a Client ID Metadata Document, then Dynamic Client Registration (deprecated, still served).

### Client ID Metadata Documents

A client may use an https URL as its `client_id`, pointing at a JSON document that describes it. The server advertises it (`client_id_metadata_document_supported: true` in both discovery documents), and the first time the client authorizes, fetches the document and registers the client from it, as a public client with `source: "cimd"`. Consent, Connected apps and revocation then treat it like any other client; the consent screen shows the host the document was published by, and Connected apps names it `Client Name (host)`.

```json
{
  "client_id": "https://app.example.com/oauth/client.json",
  "client_name": "Example App",
  "redirect_uris": ["https://app.example.com/callback"],
  "application_type": "web"
}
```

- **Validated.** `client_id` must equal the URL it was fetched from, `client_name` and `redirect_uris` are required, the redirect URIs follow the `application_type` rules below (no wildcard), and a `token_endpoint_auth_method` other than `none` is refused. At authorize, the redirect must match the document.
- **Fetched carefully.** https only, the default port only, and never a host that is an IP literal, `localhost`, or a `.localhost`, `.local` or `.internal` name (workerd resolves no DNS, so the host name is what is checked). No redirect is followed, the fetch times out after 5 s, and the body must be JSON of at most 5 KiB.
- **Cached on the row.** The response's `max-age`, clamped to between 5 minutes and 24 hours, decides when the document is fetched again. A refetch that fails falls back to the stored copy for at most 24 hours past its expiry.
- **On by default.** Dynamic registration is already open to anyone, so accepting a self-hosted document widens no trust. `oauthOptions.clientIdMetadataDocuments: false` turns it off: a URL client id is then an ordinary lookup.

A client id is up to 512 characters, in `oauth_clients.clientId`, `sessions.clientId` and the request schemas: a longer URL is an unknown client.

### Dynamic Client Registration and `application_type`

`POST /oauth/register` (RFC 7591) accepts `application_type` (SEP-837), stores it and applies its redirect rules:

| `application_type` | Redirect URIs accepted                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `web`              | https only                                                                                                 |
| `native`           | https, http to the loopback (any port at authorize), and private-use schemes such as `com.example.app:/cb` |
| absent             | https, or http to the loopback: the rule from before the field, so older native clients keep registering   |
