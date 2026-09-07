# RankResourceProvider

## Import

```typescript
import { RankResourceProvider } from "alepha/api/ranks";
```

## Overview

The registry of `$rankResource` declarations, keyed by type.

Separate from `RankService` for the reason
`InvitationResourceProvider` is separate from `InvitationService`: the
primitive registers into it at field-initialisation time, and everything
the service pulls in must not have to be constructed that early.
