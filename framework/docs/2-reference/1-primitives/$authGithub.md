# $authGithub

## Import

```typescript
import { $authGithub } from "alepha/server/auth";
```

## Overview

Already configured GitHub authentication primitive.

Uses OAuth2 to authenticate users via their GitHub accounts.
Upon successful authentication, it links the GitHub account to a user session.

Environment Variables:

- `GITHUB_CLIENT_ID`: The client ID obtained from the GitHub Developer Settings.
- `GITHUB_CLIENT_SECRET`: The client secret obtained from the GitHub Developer Settings.
