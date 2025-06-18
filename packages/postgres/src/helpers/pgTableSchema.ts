import type { TObject } from "@sinclair/typebox";
import type { BuildColumns } from "drizzle-orm";
import type { BuildExtraConfigColumns } from "drizzle-orm/column-builder";
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { pg } from "../providers/PostgresTypeProvider.ts";
import type {
	FromSchema,
	PgTableWithColumnsAndSchema,
} from "./schemaToColumns.ts";
import { schemaToColumns } from "./schemaToColumns.ts";

/**
 * Create a table with a json schema.
 *
 * @param name The name of the table.
 * @param schema The json schema of the table.
 * @param extraConfig Extra configuration for the table.
 */
export const pgTableSchema = <
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
		schemaToColumns(schema) as TColumnsMap,
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
		get: () => pg.insert(schema),
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
