import type { TObject, TSchema } from "@alepha/core";
import type { PgSymbolKeys, PgSymbols } from "../constants/PG_SYMBOLS.ts";

/**
 * Decorates a schema with a Postgres attribute.
 * Don't use this function directly. Use tools from "pg.*" instead.
 *
 * @internal
 * @example
 * ```ts
 * import { t } from "@alepha/core";
 * import { PG_UPDATED_AT } from "../constants/PG_SYMBOLS";
 *
 * export const updatedAtSchema = pgAttr(
 *   t.datetime(), PG_UPDATED_AT,
 * );
 * ```
 */
export const pgAttr = <T extends TSchema, Attr extends PgSymbolKeys>(
	type: T,
	attr: Attr,
	value?: PgSymbols[Attr],
): PgAttr<T, Attr> => {
	Object.assign(type, { [attr]: value ?? {} });
	return type as PgAttr<T, Attr>;
};

export const getAttrFields = (
	schema: TObject,
	name: PgSymbolKeys,
): PgAttrField[] => {
	const fields: Array<PgAttrField> = [];

	for (const key of Object.keys(schema.properties)) {
		const value = schema.properties[key];
		if (name in value) {
			fields.push({
				type: value as TSchema,
				key: key,
				data: (value as any)[name],
			});
		}
	}

	return fields;
};

/**
 * Type representation.
 */
export type PgAttr<T extends TSchema, TAttr extends PgSymbolKeys> = T & {
	[K in TAttr]: PgSymbols[K];
};

export interface PgAttrField {
	key: string;
	type: TSchema;
	data: any;
	nested?: any[];
}
