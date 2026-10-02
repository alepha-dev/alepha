# ProtobufProvider

## Import

```typescript
import { ProtobufProvider } from "alepha";
```

## Overview

Converts Alepha schemas to Protobuf definitions, and encodes/decodes against
them.

Schemas are walked as JSON Schema rather than through zod's internal
`_zod.def`. `z.toJSONSchema()` is the same conversion the OpenAPI generator
and `$tool` already rely on, so this provider tracks one public, documented
shape, and does not have to be rewritten whenever the schema layer
reorganises its internals.
