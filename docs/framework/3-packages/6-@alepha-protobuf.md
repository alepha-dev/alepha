# @alepha/protobuf

Protocol Buffers (Protobuf) codec support for Alepha framework.

## Installation

```bash
npm install @alepha/protobuf
```

## Overview

Protocol Buffers support.

Registers a `protobuf` codec, so any Alepha schema can be encoded to the
binary wire format - or to base64, for text transports:

```ts
const schema = z.object({ name: z.text(), age: z.integer() });
const bytes = alepha.codec.encode(schema, value, {
  as: "binary",
  encoder: "protobuf",
});
const back = alepha.codec.decode(schema, bytes, { encoder: "protobuf" });
```

**Features:**
- Message serialization/deserialization
- Schemas are lowered through JSON Schema, so no zod internals are touched
- proto3 defaults are restored on decode, including enum zero values

## API Reference

### Providers

- [`ProtobufProvider`](/docs/reference-providers-protobufprovider) - Converts Alepha schemas to Protobuf definitions, and encodes/decodes against
- [`ProtobufSchemaCodec`](/docs/reference-providers-protobufschemacodec) - ProtobufSchemaCodec handles encoding/decoding for Protobuf format.
