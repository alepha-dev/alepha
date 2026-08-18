# ProtobufSchemaCodec

## Import

```typescript
import { ProtobufSchemaCodec } from "alepha";
```

## Overview

ProtobufSchemaCodec handles encoding/decoding for Protobuf format.

Key differences from the JSON codec:
- Binary data (Uint8Array) is kept as-is
- Text output is base64, since protobuf is not text-safe
- Proto3 default values are applied when decoding (to handle omitted fields)

