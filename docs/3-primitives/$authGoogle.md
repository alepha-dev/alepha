# $authGoogle

> Already configured Google authentication primitive.

## Import

```typescript
import { $authGoogle } from "alepha/server/auth";
```

## Overview

Already configured Google authentication primitive.

Uses OpenID Connect (OIDC) to authenticate users via their Google accounts.
Upon successful authentication, it links the Google account to a user session.

Environment Variables:
- `GOOGLE_CLIENT_ID`: The client ID obtained from the Google Developer Console.
- `GOOGLE_CLIENT_SECRET`: The client secret obtained from the Google Developer Console.

