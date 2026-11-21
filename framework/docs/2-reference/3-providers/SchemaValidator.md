# SchemaValidator

## Import

```typescript
import { SchemaValidator } from "alepha";
```

## Overview

Validates + coerces a value against a zod schema.

Trimming / lowercasing / defaults / unknown-key stripping all live in the
schema itself (zod), so this is a thin wrapper over `schema.safeParse`.
Nothing is compiled here; `z.object` compiles its own parser where the
runtime allows `new Function`, and interprets on Cloudflare Workers and
in the browser.
