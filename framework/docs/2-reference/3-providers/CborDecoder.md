# CborDecoder

## Import

```typescript
import { CborDecoder } from "alepha/security";
```

## Overview

Decodes the CBOR subset WebAuthn uses (RFC 8949): unsigned and negative
integers, byte and text strings, arrays, maps, and the simple values
`false`, `true`, `null` and `undefined`.

Everything else is refused with `CborDecodeError`: indefinite
lengths, tags, floats, map keys that are neither integers nor text,
duplicate map keys, integers past `Number.MAX_SAFE_INTEGER`, a truncated
item, and (in `decode`) trailing bytes. Nothing WebAuthn sends needs
any of them, and each is a way for two parsers to read the same bytes
differently.
