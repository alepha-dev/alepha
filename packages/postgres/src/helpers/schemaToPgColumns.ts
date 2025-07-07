import { type TObject, type TSchema, TypeGuard } from "@alepha/core";
import type { TableConfig } from "drizzle-orm";
import type {
	PgColumnBuilderBase,
	PgTableWithColumns,
} from "drizzle-orm/pg-core";
import * as pg from "drizzle-orm/pg-core";
import {
	PG_CREATED_AT,
	PG_IDENTITY,
	PG_MANY,
	PG_PRIMARY_KEY,
	PG_REF,
	PG_SERIAL,
	PG_UPDATED_AT,
	type PgIdentityOptions,
} from "../constants/PG_SYMBOLS.ts";
import type { TInsertObject } from "../interfaces/TInsertObject.ts";
import { byte } from "../types/byte.ts";
import { schema } from "../types/schema.ts";

/**
 * Convert a Typebox Schema to Drizzle ORM Postgres columns (yes)
 */
export const schemaToPgColumns = <T extends TObject>(
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
 * Map a Typebox field to a PG column.
 *
 * @param name The key of the field.
 * @param value The value of the field.
 * @returns The PG column.
 */
export const mapFieldToColumn = (name: string, value: TSchema) => {
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
		if (PG_SERIAL in value) {
			return pg.serial(key);
		}

		if (PG_IDENTITY in value) {
			return pg
				.integer()
				.generatedAlwaysAsIdentity(value[PG_IDENTITY] as PgIdentityOptions);
		}

		return pg.integer(key);
	}

	if (TypeGuard.IsNumber(value)) {
		if (PG_IDENTITY in value) {
			return pg
				.bigint({ mode: "number" })
				.generatedAlwaysAsIdentity(value[PG_IDENTITY] as PgIdentityOptions);
		}

		return pg.numeric(key);
	}

	if (TypeGuard.IsDate(value)) {
		return pg.timestamp(key);
	}

	if (TypeGuard.IsString(value)) {
		return mapStringToColumn(key, value);
	}

	if (TypeGuard.IsBoolean(value)) {
		return pg.boolean(key);
	}

	if (TypeGuard.IsObject(value)) {
		return schema(key, value);
	}

	if (TypeGuard.IsRecord(value)) {
		return schema(key, value);
	}

	if (TypeGuard.IsArray(value)) {
		if (TypeGuard.IsObject(value.items)) {
			return schema(key, value);
		}
		if (TypeGuard.IsRecord(value.items)) {
			return schema(key, value);
		}
		if (TypeGuard.IsString(value.items)) {
			return pg.text(key).array();
		}
		if (TypeGuard.IsInteger(value.items)) {
			return pg.integer(key).array();
		}
		if (TypeGuard.IsNumber(value.items)) {
			return pg.numeric(key).array();
		}
		if (TypeGuard.IsBoolean(value.items)) {
			return pg.boolean(key).array();
		}
	}

	if (TypeGuard.IsUnsafe(value)) {
		if (value.type === "string") {
			// t.enum()
			return mapStringToColumn(key, value);
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
export const mapStringToColumn = (key: string, value: TSchema) => {
	if (value.format === "uuid") {
		if (PG_PRIMARY_KEY in value) {
			return pg.uuid(key).defaultRandom();
		}

		return pg.uuid(key);
	}

	if (value.format === "byte") {
		return byte(key);
	}

	if (value.format === "date-time") {
		if (PG_CREATED_AT in value) {
			return pg
				.timestamp(key, { mode: "string", withTimezone: true })
				.defaultNow();
		}
		if (PG_UPDATED_AT in value) {
			return pg
				.timestamp(key, { mode: "string", withTimezone: true })
				.defaultNow();
		}
		return pg.timestamp(key, { mode: "string", withTimezone: true });
	}

	if (value.format === "date") {
		return pg.date(key, { mode: "string" });
	}

	return pg.text(key);
};

export const camelToSnakeCase = (str: string) => {
	return (
		str[0].toLowerCase() +
		str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
	);
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Convert a schema to columns.
 */
export type FromSchema<T extends TObject> = {
	[key in keyof T["properties"]]: PgColumnBuilderBase;
};

/**
 * A table with columns and schema.
 */
export type PgTableWithColumnsAndSchema<
	T extends TableConfig,
	R extends TObject,
> = PgTableWithColumns<T> & {
	get $table(): PgTableWithColumns<T>;
	get $schema(): R;
	get $insertSchema(): TInsertObject<R>;
};

export interface TableLike<T extends TObject = TObject> {
	$schema: T;
}
