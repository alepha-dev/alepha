import { $module } from "alepha";
import { ProtobufProvider } from "./providers/ProtobufProvider.ts";
import { ProtobufSchemaCodec } from "./providers/ProtobufSchemaCodec.ts";

export * from "./providers/ProtobufProvider.ts";
export * from "./providers/ProtobufSchemaCodec.ts";

/**
 * Protocol Buffers support.
 *
 * Registers a `protobuf` codec, so any Alepha schema can be encoded to the
 * binary wire format — or to base64, for text transports:
 *
 * ```ts
 * const schema = z.object({ name: z.text(), age: z.integer() });
 * const bytes = alepha.codec.encode(schema, value, {
 *   as: "binary",
 *   encoder: "protobuf",
 * });
 * const back = alepha.codec.decode(schema, bytes, { encoder: "protobuf" });
 * ```
 *
 * **Features:**
 * - Message serialization/deserialization
 * - Schemas are lowered through JSON Schema, so no zod internals are touched
 * - proto3 defaults are restored on decode, including enum zero values
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
