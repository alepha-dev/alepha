# $authFranceConnect

## Import

```typescript
import { $authFranceConnect } from "alepha/server/auth";
```

## Overview

Creates an authentication provider primitive for France Connect.

Uses OpenID Connect (OIDC) to authenticate users via France Connect,
the French government's identity federation system. It provides verified
identity data (name, email, birthdate) sourced directly from government
databases.

**France Connect-specific behaviour**:
- Scopes use individual claim names (`given_name`, `family_name`) rather
  than the standard grouped `profile` scope.
- The `acr_values=eidas1` authorization parameter is mandatory and is
  included automatically.
- Logout is mandatory in France Connect integrations. Store the `id_token`
  returned at login and pass it to the logout endpoint when the session ends.

**Environment Variables** (obtain from partenaires.franceconnect.gouv.fr):
- `FRANCECONNECT_CLIENT_ID`: OAuth 2.0 client ID for your France Connect service provider.
- `FRANCECONNECT_CLIENT_SECRET`: OAuth 2.0 client secret for your France Connect service provider.

## Examples

```ts
class AuthProviders {
  franceconnect = $authFranceConnect(this.userRealm);
}
```

