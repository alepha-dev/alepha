# useSwaggerAccess

## Import

```typescript
import { useSwaggerAccess } from "@alepha/ui/swagger";
```

## Overview

Answers `SwaggerAccess` for each operation, against the current user.

Read from what the page already has, never a request per operation: the
signed-in user is `currentUserAtom`, and what they may call is the action
registry `LinkProvider` holds, the one `useAuth().has()` reads. The
registry lists only the actions the user's permissions reach, so an action
present in it is one they may call. A UI affordance, not a decision: the
server's `$secure` still answers every request.
