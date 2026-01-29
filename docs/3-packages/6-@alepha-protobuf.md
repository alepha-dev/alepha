# @alepha/protobuf - Protobuf

## Installation

```bash
npm install @alepha/protobuf
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Protocol Buffers support.

**Features:**
- Message serialization/deserialization
- TypeBox integration
- Compression support

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ProtobufSchemaCodec

ProtobufSchemaCodec handles encoding/decoding for Protobuf format.

Key differences from JSON codec:
- BigInt values are kept as BigInt (not converted to string)
- Date values are converted to ISO strings for protobuf compatibility
- Binary data (Uint8Array) is kept as-is
- Proto3 default values are applied when decoding (to handle omitted fields)
