# SchemaValidator

## Import

```typescript
import { SchemaValidator } from "alepha";
```

## Overview

Validates + coerces a value against a zod schema.

Trimming / lowercasing / defaults / unknown-key stripping all live in the
schema itself now (zod), so this is a thin wrapper over `schema.parse`.
No compile step, no `eval` — safe inside Cloudflare Workers.

