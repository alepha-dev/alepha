# Signing In Through an External Identity Provider

An app in front of an identity provider it does not run (Keycloak, Auth0,
Entra ID) and an API it does not run either needs a login backend: something
that runs the OAuth exchange, keeps the tokens away from the browser, and
attaches them to the API calls. Alepha is that backend. It keeps no user
table: the provider owns the users, and the app reads the person from the
provider's tokens on every request.

This is the backend-for-frontend pattern that RFC 10017 (OAuth 2.0 for
Browser-Based Applications) recommends for business applications, section
6.1. The page goes through it piece by piece, then checks the session cookie
against the RFC line by line.

The code is the example app
[`apps/examples/oidc`](https://github.com/alepha-dev/alepha/tree/main/framework/apps/examples/oidc):
sign in, a page only a signed-in person sees, sign out. Its `compose.yml`
runs Keycloak with a realm imported (`yarn keycloak`, then `yarn dev`, and
sign in as `ada` / `ada`); its end-to-end test runs against the mock provider
of `alepha/testing/oidc` instead.

## The provider, with no user table

```typescript check
import { $env, z } from "alepha";
import { $issuer } from "alepha/security";
import { $auth } from "alepha/server/auth";

const env = z.object({
  OIDC_ISSUER: z.text({ default: "http://localhost:8080/realms/acme" }),
  OIDC_CLIENT_ID: z.text({ default: "acme-web" }),
});

export class Auth {
  protected readonly env = $env(env);

  public readonly keycloak = $auth({
    oidc: {
      issuer: this.env.OIDC_ISSUER,
      clientId: this.env.OIDC_CLIENT_ID,
      backchannelLogout: true,
    },
  });

  public readonly issuer = $issuer({
    name: "keycloak",
    oidc: () => this.keycloak,
  });
}
```

`$auth({ oidc })` with no `issuer` of its own is the relying party. It runs
discovery on first use (never at boot, so the app starts while the provider is
down), the authorization-code flow with PKCE on the server, the refresh, and
the logout. A public client needs no `clientSecret`; a confidential one passes
it.

After a sign-in, the provider's own tokens (access, refresh and id token) are
the session. They go into one `tokens` cookie: `HttpOnly`, encrypted with
AES-256-GCM under `APP_SECRET`, compressed, and split into chunks when it
passes what one cookie holds. The browser never reads a token. On each
request the cookie becomes an `Authorization: Bearer` header before any
handler runs, refreshed first when the access token has expired.

The browser side starts the flow with a navigation, never a fetch: the sign-in
is a chain of redirects through the provider.

```typescript
const { login, logout } = useAuth();
login("keycloak", { redirect: "/profile" });
```

## Verifying the provider's tokens

The `$issuer` verifies the access token on every request, whether it came
from the cookie or as a bearer token. Its `oidc` form reads everything from
the provider's discovery, on the first token: the signing keys, the issuer,
and the client id.

A token passes when it is signed by those keys, not expired, its `iss` is the
discovered issuer, and its `aud` names the client, or, failing that, its `azp`
does. Keycloak's default access token says `aud: "account"` and
`azp: "acme-web"`, so `azp` is what matches there. On a shared realm every
client's tokens are signed with the same keys: without the client check, a
token minted for another application of the realm would sign its holder in
here.

`issuer` or `audience` beside `oidc` replaces the discovered value, for a
provider that puts an API identifier in `aud`.

## Roles and `$secure`

`$secure` on a page or a route works as it does with any issuer. Roles come
from the token: `realm_access.roles` (Keycloak's realm roles), else a `roles`
claim. Only the names the issuer declares as roles are kept, so the app
decides what a role grants:

```typescript check
import { $issuer } from "alepha/security";
import { $auth } from "alepha/server/auth";

export class Auth {
  keycloak = $auth({
    oidc: {
      issuer: "https://idp.example.com/realms/acme",
      clientId: "acme-web",
    },
  });

  issuer = $issuer({
    name: "keycloak",
    oidc: () => this.keycloak,
    roles: [
      { name: "admin", permissions: [{ name: "*" }] },
      { name: "user", permissions: [{ name: "orders:read" }] },
    ],
  });
}
```

A role the token carries and the issuer does not declare is dropped. Anything
else, Keycloak's client roles in `resource_access` or another provider's own
claim, goes through `profile`, which maps the payload to the account:

```typescript check
import { $issuer } from "alepha/security";
import { $auth } from "alepha/server/auth";

export class Auth {
  keycloak = $auth({
    oidc: {
      issuer: "https://idp.example.com/realms/acme",
      clientId: "acme-web",
    },
  });

  issuer = $issuer({
    name: "keycloak",
    oidc: () => this.keycloak,
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
    profile: (payload) => ({
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      roles: payload.resource_access?.["acme-web"]?.roles ?? [],
    }),
  });
}
```

## The upstream API, through `$proxy`

The browser calls the app; the app calls the API. A `$proxy` sends
**neither `Cookie` nor `Authorization`** upstream unless it says so, and that
default matters twice here: the session cookie must not leave, and neither
must the access token, which the app writes into `Authorization` before any
handler runs. Without a line of its own, the upstream receives an anonymous
request.

A backend-for-frontend attaches the bearer itself, in one declared line:

```typescript check
import { $proxy } from "alepha/server/proxy";

export class Gateway {
  api = $proxy({
    path: "/upstream/*",
    target: "https://api.example.com",
    rewrite: (url) => {
      url.pathname = url.pathname.replace("/upstream", "");
    },
    forward: ["authorization"],
  });
}
```

The cookie stays home and the access token goes up, which is what RFC 10017
section 6.1.1 describes: "the BFF removes the cookie from the request,
attaches the user's access token". The token is refreshed before the proxy
runs, by the same hook that turns the cookie into a header, so the upstream
never sees an expired one.

- `forward: ["cookie", "authorization"]` is for a service of your own that
  reads the session cookie itself, not for a third-party API.
- Not with `useIdToken`, which puts the id token in `Authorization` instead
  of the access token, and would send it upstream.
- The upstream's `Set-Cookie` headers still reach the browser.

The [third-party API guide](/docs/guides-server-third-party-api) covers typed
calls to the same API from the server.

## Logout

`POST /oauth/logout` (what `useAuth().logout()` sends) deletes the session
cookie and ends the session at the provider in two ways:

- **Revocation.** When discovery advertises a `revocation_endpoint`, the
  refresh token is revoked (RFC 7009) before any redirect. That holds when the
  provider has no end-session endpoint, when `oidc.logoutUri` replaces it, and
  when the browser never completes the redirect. A failure is logged and never
  blocks the logout.
- **RP-initiated logout.** The browser is redirected to the provider's
  end-session endpoint with `id_token_hint`, and comes back to the app.

Against Keycloak the revocation already ends the provider's session, so the
end-session redirect that follows logs a `LOGOUT_ERROR` event with
`session_expired` there. The browser still comes back to the app.

**Back-channel logout** (OpenID Connect Back-Channel Logout 1.0) covers the
other direction: a session ended at the provider, by an administrator or by a
sign-out of another app of the realm. With `oidc.backchannelLogout: true` the
provider posts a signed logout token to
`/oauth/backchannel-logout?provider=<name>`. It is checked (signature, `iss`,
`aud` naming the client, `iat`, the logout event, a `sid` or a `sub`, no
`nonce`) and recorded; the session cookie it names is deleted on its next
request, before any refresh, and that request goes on anonymous. A logout by
`sub` ends every session of the person, and a sign-in made after it passes.

Register the URL with the provider. In Keycloak it is the client's
"Backchannel logout URL", with "Backchannel logout session required" on.
Without the option the route answers 404.

## The session cookie against RFC 10017

Section 6.1.3.2 lists what the session cookie of a backend-for-frontend
should carry:

| The RFC asks for          | Alepha                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `Secure`                  | Over https, when `secure` is on, which is the default in production                          |
| `HttpOnly`                | Yes                                                                                          |
| `Path=/`                  | Yes                                                                                          |
| No `Domain`               | Yes                                                                                          |
| The `__Host-Http-` prefix | On every response that carries `Secure`: `__Host-Http-<app>.tokens`; otherwise the bare name |
| Encryption                | AES-256-GCM, keyed from `APP_SECRET`                                                         |
| `SameSite=Strict`         | `Lax`, see below                                                                             |

`SameSite` is `Lax` where the RFC says `Strict` should be used. A strict
cookie is not sent on a top-level navigation that comes from another site,
and the return from the provider after a sign-in is exactly that: the
session would look missing on the first page after every login. What
`Strict` would add, refusing the cookie on a cross-site write, is done by
the app instead: the cookie becomes a bearer token only for a request from
the app's own origin, or for a method that writes nothing. A form posted from
another site, or from a sibling subdomain that `Lax` lets through, stays
anonymous and gets a 401.

## Limits

- **The cookie's size.** Every chunk of the session goes back on every
  request, and request headers are capped (16 KB on Node, 8 KB for `Cookie`
  on a default nginx). A provider with many claims can pass that. Ask it for
  fewer, or turn on the [session store](/docs/guides-security-authentication#the-session-store),
  which keeps the tokens on the server with only an id in the cookie.
- **A copied bearer token.** Logout and back-channel logout end the cookie
  session. An access token copied out of the app works until its `exp`, as
  any JWT does.
- **Where a back-channel logout reaches.** The record is a `$cache` entry:
  with the memory cache it reaches one process, two instances need
  `REDIS_URL`. On Cloudflare without a database cache it is KV, eventually
  consistent, so a logout can take up to a minute to reach every location.
- **Refresh-token rotation.** A provider that rotates refresh tokens with
  reuse detection can end the session when two requests refresh at the same
  time: the second one presents a token the first already spent.

## What does not apply

Without `$realm` there is no user table, so what lives in it is absent: the
`$realm` sign-up and password flows, two-factor authentication, organizations
and API keys. The provider handles its own second factor and its own users;
`$secure`, roles and permissions work as everywhere else.
