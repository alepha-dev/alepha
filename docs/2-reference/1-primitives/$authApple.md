# $authApple

## Import

```typescript
import { $authApple } from "alepha/server/auth";
```

## Overview

Already configured Apple authentication primitive.

Uses OpenID Connect (OIDC) to authenticate users via their Apple accounts.
Upon successful authentication, it links the Apple account to a user session.

Apple-specific behavior:
- Uses `response_mode=form_post` (required by Apple for email/name scopes).
- Scopes: `name email` (Apple does not support the standard `profile` scope).
- User's name is only provided on the first authorization. Subsequent logins
  only return `sub` and `email` in the ID token.
- The client secret must be a signed ES256 JWT generated from your Apple private key.

Environment Variables:
- `APPLE_CLIENT_ID`: The Service ID obtained from the Apple Developer Console.
- `APPLE_CLIENT_SECRET`: The signed JWT client secret generated from your Apple private key.

