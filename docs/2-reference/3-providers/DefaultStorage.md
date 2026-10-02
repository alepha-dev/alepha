# DefaultStorage

## Import

```typescript
import { DefaultStorage } from "alepha/api/files";
```

## Overview

The `default` storage.

Exists so `POST /api/files` works without a `bucket` field, and so
`FileService.storage()` always resolves something. Applications are
expected to declare their own named `$storage` instances rather than
pile everything in here.
