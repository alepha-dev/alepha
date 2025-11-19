# Alepha Protobuf

Protocol Buffers (Protobuf) codec support for Alepha framework.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](https://feunard.github.io/alepha/).

#### ProtobufSchemaCodec

ProtobufSchemaCodec handles encoding/decoding for Protobuf format.

Key differences from JSON codec:
- BigInt values are kept as BigInt (not converted to string)
- Date values are converted to ISO strings for protobuf compatibility
- Binary data (Uint8Array) is kept as-is
- Proto3 default values are applied when decoding (to handle omitted fields)
