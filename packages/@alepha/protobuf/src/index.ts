import { $module } from "alepha";
import { ProtobufProvider } from "./providers/ProtobufProvider.ts";
import { ProtobufSchemaCodec } from "./providers/ProtobufSchemaCodec.ts";

export * from "./providers/ProtobufProvider.ts";
export * from "./providers/ProtobufSchemaCodec.ts";

/**
 * Protocol Buffers support.
 *
 * **Features:**
 * - Message serialization/deserialization
 * - TypeBox integration
 * - Compression support
 *
 * @module alepha.protobuf
 */
export const AlephaProtobuf = $module({
  name: "alepha.protobuf",
  services: [ProtobufProvider, ProtobufSchemaCodec],
  register: (alepha) => {
    alepha.with(ProtobufProvider);
    alepha.codec.register({
      name: "protobuf",
      codec: alepha.inject(ProtobufSchemaCodec),
    });
  },
});
