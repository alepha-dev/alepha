# ProtobufSchemaCodec

## Import

```typescript
import { ProtobufSchemaCodec } from "alepha";
```

## Overview

ProtobufSchemaCodec handles encoding/decoding for Protobuf format.

Key differences from JSON codec:
- BigInt values are kept as BigInt (not converted to string)
- Date values are converted to ISO strings for protobuf compatibility
- Binary data (Uint8Array) is kept as-is
- Proto3 default values are applied when decoding (to handle omitted fields)

