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

- `response_mode=form_post` (required by Apple when requesting `email`/`name`).
- Scope: `name email` (Apple does not support the standard `profile` scope).
- The user's name is only provided on the first authorization, as a `user`
  form field on the POST callback. The framework extracts it and injects
  `given_name` / `family_name` / `name` into the profile before linking.
  Subsequent logins only return `sub` and `email` in the ID token.
- `email_verified` and `is_private_email` are normalized from Apple's
  string ("true"/"false") representation to booleans.

Client secret:
Apple requires the client secret to be a signed ES256 JWT generated from
your Apple private key, team ID, and key ID. This JWT is valid for up to 6
months; you must rotate it before expiration. Generate it out of band and
set it via `APPLE_CLIENT_SECRET`.

See: https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret

Environment Variables:

- `APPLE_CLIENT_ID`: The Service ID obtained from the Apple Developer Console.
- `APPLE_CLIENT_SECRET`: The signed ES256 JWT client secret generated from your
  Apple private key.
