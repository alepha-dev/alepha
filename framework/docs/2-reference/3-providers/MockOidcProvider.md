# MockOidcProvider

## Import

```typescript
import { MockOidcProvider } from "alepha/testing/oidc";
```

## Overview

An OpenID Connect provider for tests: discovery, authorize, token, JWKS,
end-session, revocation and back-channel logout, laid out as Keycloak lays
them out (`/realms/<realm>/protocol/openid-connect/...`), so an app points
at it with the same configuration it uses for a real Keycloak.

It approves every authorization request at once, as the configured user,
and checks what a real provider checks on the way: the client, the redirect
URI, the PKCE verifier, the refresh token. A spec chooses the claims, the
token lifetime and which endpoints discovery advertises through
`MockOidcProvider.options`, and reads what reached the provider
through `MockOidcProvider.calls`.

It is served by `MockOidcServer`, which gives it a real HTTP port:
`openid-client` runs discovery and the token exchange over `fetch`.
