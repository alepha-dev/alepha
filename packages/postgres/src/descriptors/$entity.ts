import { KIND } from "@alepha/core";
import type { Static, TObject } from "@sinclair/typebox";
import type { BuildColumns, BuildExtraConfigColumns, SQL } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	type PgTableExtraConfigValue,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import {
	type FromSchema,
	type PgTableWithColumnsAndSchema,
	schemaToPgColumns,
} from "../helpers/schemaToPgColumns.ts";
import { insertSchema } from "../schemas/insertSchema.ts";
import { updateSchema } from "../schemas/updateSchema.ts";

/**
 * Declare a new entity in the database.
 * This descriptor alone does not create the table, it only describes it.
 * It must be used with `$repository` to create the table and perform operations on it.
 *
 * This is a convenience function to create a table with a json schema.
 * For now, it creates a drizzle-orm table under the hood.
 * ```ts
 * import { $entity } from "@alepha/postgres";
 *
 * const User = $entity({
 *   name: "user",
 *   schema: t.object({
 *     id: pg.primaryKey(t.uuid()),
 *     name: t.string(),
 *     email: t.string(),
 *   }),
 *   indexes: ["email"],
 * });
 * ```
 *
 * @stability 2
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
						if ("columns" in idx) {
							const columnsName = idx.columns.join("_");
							const columns = idx.columns.map((col) => t[col]);
							const name = idx.name ?? `${options.name}_${columnsName}_idx`;
							config.push(
								(idx.unique ? uniqueIndex(name) : index(name)).on(
									columns[0],
									...columns.slice(1), // nice one, drizzle
								),
							);
						} else {
							const name =
								idx.name ?? `${options.name}_${String(idx.column)}_idx`;
							config.push(
								(idx.unique ? uniqueIndex(name) : index(name)).on(
									t[idx.column],
								),
							);
						}
					}
				}
			}

			return config;
		},
	);
};

$entity[KIND] = "entity";

// ---------------------------------------------------------------------------------------------------------------------

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
		| {
				columns: Keys[];
				unique?: boolean;
				name?: string;
		  }
	)[];

	// relations?: Record<
	// 	string,
	// 	{
	// 		type: "one" | "many";
	// 		table: () => any;
	// 		foreignColumn?: keyof Static<T>;
	// 	}
	// >;

	foreignKeys?: Array<{
		name?: string;
		columns: Array<keyof Static<T>>;
		foreignColumns: Array<AnyPgColumn>;
	}>;

	constraints?: Array<{
		columns: Array<keyof Static<T>>;
		name?: string;
		unique?: boolean | {} /* options */;
		check?: SQL;
	}>;

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

export type Entity<T extends TObject> = PgTableWithColumnsAndSchema<
	PgTableConfig<string, T, FromSchema<T>>,
	T
>;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create a table with a json schema.
 *
 * @param name The name of the table.
 * @param schema The json schema of the table.
 * @param extraConfig Extra configuration for the table.
 */
const pgTableSchema = <
	TTableName extends string,
	TSchema extends TObject,
	TColumnsMap extends FromSchema<TSchema>,
>(
	name: TTableName,
	schema: TSchema,
	extraConfig?: (
		self: BuildExtraConfigColumns<TTableName, TColumnsMap, "pg">,
	) => PgTableExtraConfigValue[],
): PgTableWithColumnsAndSchema<
	PgTableConfig<TTableName, TSchema, TColumnsMap>,
	TSchema
> => {
	const table = pgTable(
		name,
		schemaToPgColumns(schema) as TColumnsMap,
		extraConfig,
	) as PgTableWithColumnsAndSchema<
		PgTableConfig<TTableName, TSchema, TColumnsMap>,
		TSchema
	>;

	Object.defineProperty(table, "$table", {
		get: () => table,
	});
	Object.defineProperty(table, "$schema", {
		get: () => schema,
	});
	Object.defineProperty(table, "$insertSchema", {
		get: () => insertSchema(schema),
	});
	Object.defineProperty(table, "$updateSchema", {
		get: () => updateSchema(schema),
	});

	return table;
};

export type PgTableConfig<
	TTableName extends string,
	TSchema extends TObject,
	TColumnsMap extends FromSchema<TSchema>,
> = {
	name: TTableName;
	schema: any;
	columns: BuildColumns<TTableName, TColumnsMap, "pg">;
	dialect: "pg";
};
