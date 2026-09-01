# InvitationResourceProvider

## Import

```typescript
import { InvitationResourceProvider } from "alepha/api/invitations";
```

## Overview

The registry of `$invitationResource` declarations, keyed by
`resourceType`.

Separate from `InvitationService` so the primitive can register into it
without the service, and everything the service pulls in, having to be
constructed at field-initialisation time.
