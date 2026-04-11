# $authFacebook

## Import

```typescript
import { $authFacebook } from "alepha/server/auth";
```

## Overview

Already configured Facebook authentication primitive.

Uses OAuth2 to authenticate users via their Facebook accounts.
Upon successful authentication, it links the Facebook account to a user session.

Environment Variables:
- `FACEBOOK_CLIENT_ID`: The App ID obtained from the Meta Developer Console.
- `FACEBOOK_CLIENT_SECRET`: The App Secret obtained from the Meta Developer Console.

