# MemoryFileStorageProvider

## Import

```typescript
import { MemoryFileStorageProvider } from "alepha/bucket";
```

## Overview

In-memory blob storage, bound automatically under test. The `files` map is
public so specs can assert on what was stored without round-tripping.

