import type { Static, TObject } from "@sinclair/typebox";
import type { BuildExtraConfigColumns } from "drizzle-orm";
import {
	index,
	type PgTableExtraConfigValue,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { type PgTableConfig, pgTableSchema } from "../helpers/pgTableSchema.ts";
import type {
	FromSchema,
	PgTableWithColumnsAndSchema,
} from "../helpers/schemaToColumns.ts";

export interface EntityDescriptorOptions<
	TTableName extends string,
	T extends TObject,
	Keys = keyof Static<T>,
> {
	/**
	 * The name of the table. This is the name that will be used in the database.
	 * @example
	 * name: "user"
	 */
	name: TTableName;

	/**
	 * The schema of the table. This is a TypeBox schema that describes the columns and their types.
	 * @example
	 * schema: t.object({
	 *   id: t.uuid(),
	 *   name: t.string(),
	 *   email: t.string(),
	 *   phoneNumber: t.string(),
	 * })
	 */
	schema: T;

	/**
	 * The indexes to create for the table. This can be a string or an object with the column name and options.
	 * @example
	 * indexes: ["name", { column: "email", unique: true }]
	 */
	indexes?: (
		| Keys
		| {
				column: Keys;
				unique?: boolean;
				name?: string;
		  }
	)[];

	relations?: Record<
		string,
		{
			type: "one" | "many";
			table: () => any;
			foreignColumn?: keyof Static<T>;
		}
	>;

	// foreignKeys?: Array<{
	// 	name?: string;
	// 	columns: Array<keyof Static<T>>;
	// 	foreignColumns: Array<AnyPgColumn>;
	// }>;
	//
	// constraints?: Array<{
	// 	columns: Array<keyof Static<T>>;
	// 	name?: string;
	// 	unique?: boolean | {} /* options */;
	// 	check?: SQL;
	// }>;

	/**
	 * Extra configuration for the table. See drizzle-orm documentation for more details.
	 *
	 * @param self The table descriptor.
	 * @returns The extra configuration for the table.
	 */
	config?: (
		self: BuildExtraConfigColumns<string, FromSchema<T>, "pg">,
	) => PgTableExtraConfigValue[];
}

/**
 * Creates a table descriptor for drizzle-orm.
 */
export const $entity = <
	TTableName extends string,
	TSchema extends TObject,
	TColumnsMap extends FromSchema<TSchema>,
>(
	options: EntityDescriptorOptions<TTableName, TSchema>,
): PgTableWithColumnsAndSchema<
	PgTableConfig<TTableName, TSchema, TColumnsMap>,
	TSchema
> => {
	return pgTableSchema<TTableName, TSchema, TColumnsMap>(
		options.name,
		options.schema,
		(t) => {
			const config: PgTableExtraConfigValue[] = [];

			if (options.config) {
				config.push(...options.config(t));
			}

			if (options.indexes) {
				for (const idx of options.indexes) {
					if (typeof idx === "string") {
						const name = `${options.name}_${idx}_idx`;
						config.push(index(name).on(t[idx]));
					} else if (typeof idx === "object") {
						const name =
							idx.name ?? `${options.name}_${String(idx.column)}_idx`;
						config.push(
							(idx.unique ? uniqueIndex(name) : index(name)).on(t[idx.column]),
						);
					}
				}
			}

			return config;
		},
	);
};
