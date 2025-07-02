import { randomUUID } from "node:crypto";
import type { Static } from "@alepha/core";
import { type TObject, type TSchema, TypeGuard } from "@alepha/core";
import { Value } from "@sinclair/typebox/value";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/sqlite-core";
import {
	PG_CREATED_AT,
	PG_IDENTITY,
	PG_MANY,
	PG_PRIMARY_KEY,
	PG_REF,
	PG_SERIAL,
	PG_UPDATED_AT,
} from "../constants/PG_SYMBOLS.ts";
import { camelToSnakeCase, type FromSchema } from "./schemaToPgColumns.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Proof of concept. Nothing serious.
 */

// ---------------------------------------------------------------------------------------------------------------------

export const schemaToSqliteColumns = <T extends TObject>(
	schema: T,
): FromSchema<T> => {
	return Object.entries(schema.properties)
		.filter(([, value]) => !(PG_MANY in value))
		.reduce<Partial<FromSchema<T>>>((columns, [key, value]) => {
			let col = mapFieldToSqliteColumn(key, value);

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
 * Map a Typebox field to a PG column.
 *
 * @param name The key of the field.
 * @param value The value of the field.
 * @returns The PG column.
 */
export const mapFieldToSqliteColumn = (name: string, value: TSchema) => {
	const key = camelToSnakeCase(name);

	if (
		// is nullish ?
		value.anyOf?.length === 2 &&
		value.anyOf.some((it: TSchema) => it.type === "null")
	) {
		// then, remove nullish
		value = value.anyOf.find((it: TSchema) => it.type !== "null")!;
	}

	if (TypeGuard.IsInteger(value)) {
		if (PG_SERIAL in value || PG_IDENTITY in value) {
			return pg
				.integer(key, { mode: "number" })
				.primaryKey({ autoIncrement: true });
		}

		return pg.integer(key);
	}

	if (TypeGuard.IsNumber(value)) {
		if (PG_IDENTITY in value) {
			return pg
				.integer(key, { mode: "number" })
				.primaryKey({ autoIncrement: true });
		}

		return pg.numeric(key);
	}

	if (TypeGuard.IsDate(value)) {
		return pg.integer(key, { mode: "timestamp" });
	}

	if (TypeGuard.IsString(value)) {
		return mapStringToSqliteColumn(key, value);
	}

	if (TypeGuard.IsBoolean(value)) {
		return sqliteBool(key, value);
	}

	if (TypeGuard.IsObject(value)) {
		return sqliteJson(key, value);
	}

	if (TypeGuard.IsRecord(value)) {
		return sqliteJson(key, value);
	}

	if (TypeGuard.IsArray(value)) {
		if (TypeGuard.IsObject(value.items)) {
			return sqliteJson(key, value);
		}
		if (TypeGuard.IsRecord(value.items)) {
			return sqliteJson(key, value);
		}
		if (TypeGuard.IsString(value.items)) {
			return sqliteJson(key, value);
		}
		if (TypeGuard.IsInteger(value.items)) {
			return sqliteJson(key, value);
		}
		if (TypeGuard.IsNumber(value.items)) {
			return sqliteJson(key, value);
		}
		if (TypeGuard.IsBoolean(value.items)) {
			return sqliteJson(key, value);
		}
	}

	if (TypeGuard.IsUnsafe(value)) {
		if (value.type === "string") {
			// t.enum()
			return mapStringToSqliteColumn(key, value);
		}
	}

	throw new Error(
		`Unsupported schema type for ${name} as ${JSON.stringify(value)}`,
	);
};

/**
 * Map a string to a PG column.
 *
 * @param key The key of the field.
 * @param value The value of the field.
 */
export const mapStringToSqliteColumn = (key: string, value: TSchema) => {
	if (value.format === "uuid") {
		if (PG_PRIMARY_KEY in value) {
			return pg
				.text(key)
				.primaryKey()
				.$defaultFn(() => randomUUID());
		}

		return pg.text(key);
	}

	if (value.format === "byte") {
		return sqliteJson(key, value);
	}

	if (value.format === "date-time") {
		if (PG_CREATED_AT in value) {
			return sqliteDateTime(key, {}).default(sql`(unixepoch('subsec') * 1000)`);
		}
		if (PG_UPDATED_AT in value) {
			return sqliteDateTime(key, {}).default(sql`(unixepoch('subsec') * 1000)`);
		}
		return sqliteDateTime(key, {});
	}

	if (value.format === "date") {
		return sqliteDate(key, {});
	}

	return pg.text(key);
};

export const sqliteJson = <TDocument extends TSchema>(
	name: string,
	document: TDocument,
) =>
	pg
		.customType<{
			data: Static<TDocument>;
			driverData: string;
			config: { document: TDocument };
			configRequired: true;
		}>({
			dataType: () => "text",
			toDriver: (value) => JSON.stringify(Value.Encode(document, value)),
			fromDriver: (value: TDocument | string) => {
				return Value.Decode(
					document,
					Value.Cast(
						document,
						value && typeof value === "string" ? JSON.parse(value) : value,
					),
				);
			},
		})(name, { document })
		.$type<Static<TDocument>>();

export const sqliteDateTime = pg.customType<{
	data: string;
	driverData: number;
	configRequired: true;
}>({
	dataType: () => "integer",
	toDriver: (value) => new Date(value).getTime(),
	fromDriver: (value) => {
		return new Date(value).toISOString();
	},
});

export const sqliteDate = pg.customType<{
	data: string;
	driverData: number;
	configRequired: true;
}>({
	dataType: () => "integer",
	toDriver: (value) => new Date(value).getTime(),
	fromDriver: (value) => {
		return new Date(value).toISOString().split("T")[0];
	},
});

export const sqliteBool = pg.customType<{
	data: boolean;
	driverData: number;
	configRequired: true;
}>({
	dataType: () => "integer",
	toDriver: (value) => (value ? 1 : 0),
	fromDriver: (value) => value === 1,
});
