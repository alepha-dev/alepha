import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres bytea type, exchanged as base64.
 *
 * `z.binary()` is a **string** carrying `format: "binary"`, so that is the
 * contract every layer above the driver works with. Declaring `data: Buffer`
 * broke it in both directions: the row returned by an insert carried a Buffer
 * and failed schema validation in `Repository.clean()`, so a `z.binary()`
 * column could not be written at all on postgres.
 *
 * Bytes are still stored as real `bytea` — only the JS-side representation is
 * the base64 string the schema declares, which also matches what sqlite hands
 * back for the same entity.
 */
export const byte = customType<{
  data: string;
  driverData: Buffer;
}>({
  dataType: () => "bytea",
  toDriver: (value) =>
    Buffer.isBuffer(value) ? value : Buffer.from(String(value), "base64"),
  fromDriver: (value) =>
    Buffer.isBuffer(value) ? value.toString("base64") : (value as string),
});
