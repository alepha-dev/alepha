import type { TObject } from "@alepha/core";
import type { TableConfig } from "drizzle-orm";
import type {
	PgColumnBuilderBase,
	PgTableWithColumns,
} from "drizzle-orm/pg-core";
import type { PG_SCHEMA } from "../constants/PG_SCHEMA.ts";
import { PG_MANY, PG_PRIMARY_KEY, PG_REF } from "../constants/PG_SYMBOLS.ts";
import type { TInsertObject } from "../interfaces/TInsertObject.ts";
import { mapFieldToColumn } from "./mapFieldToColumn.ts";

/**
 * Convert a schema to columns.
 *
 * @param schema
 */
export const schemaToColumns = <T extends TObject>(
	schema: T,
): FromSchema<T> => {
	return Object.entries(schema.properties)
		.filter(([, value]) => !(PG_MANY in value))
		.reduce<Partial<FromSchema<T>>>((columns, [key, value]) => {
			let col = mapFieldToColumn(key, value);

			if (value.default != null) {
				col = col.default(value.default);
			}

			if (PG_PRIMARY_KEY in value) {
				col = col.primaryKey();
			}

			if (PG_REF in value) {
				const config = value[PG_REF] as any;
				col = col.references(config.ref, config.actions);
			}

			if (schema.required?.includes(key)) {
				col = col.notNull();
			}

			return {
				...columns,
				[key]: col,
			};
		}, {}) as FromSchema<T>;
};

/**
 * Convert a schema to columns.
 */
export type FromSchema<T extends TObject> = {
	[key in keyof T["properties"]]: PgColumnBuilderBase;
};

/**
 * The symbol for the schema.
 */

/**
 * A table with columns and schema.
 */
export type PgTableWithColumnsAndSchema<
	T extends TableConfig,
	R extends TObject,
> = PgTableWithColumns<T> & {
	[PG_SCHEMA]: R;
	get $schema(): R;
	get $insertSchema(): TInsertObject<R>;
};
