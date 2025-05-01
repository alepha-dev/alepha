import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres bytea type.
 */
export const byte = customType<{
	data: Buffer;
}>({
	dataType: () => "bytea",
});
