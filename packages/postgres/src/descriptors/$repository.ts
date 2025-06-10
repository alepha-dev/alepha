import { __descriptor, KIND, OPTIONS, type TObject } from "@alepha/core";
import type { TableConfig } from "drizzle-orm";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToColumns.ts";
import type { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";
import type { Repository } from "../services/Repository.ts";

const KEY = "REPOSITORY";

export interface RepositoryDescriptorOptions<
	TEntity extends TableConfig,
	TSchema extends TObject,
> {
	/**
	 * The table to create the repository for.
	 */
	table: PgTableWithColumnsAndSchema<TEntity, TSchema>;

	/**
	 * Override default provider.
	 */
	provider?: () => PostgresProvider;
}

/**
 * @param optionsOrTable
 */
export const $repository = <
	TEntity extends TableConfig,
	TSchema extends TObject,
>(
	optionsOrTable:
		| RepositoryDescriptorOptions<TEntity, TSchema>
		| PgTableWithColumnsAndSchema<TEntity, TSchema>,
): Repository<PgTableWithColumnsAndSchema<TEntity, TSchema>, TSchema> => {
	__descriptor(KEY);

	const options =
		"table" in optionsOrTable ? optionsOrTable : { table: optionsOrTable };
	const table = options.table as PgTableWithColumnsAndSchema<TEntity, TSchema>;
	const schema = table.$schema as TSchema;

	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		table,
		schema,
	} as any;
};

$repository[KIND] = KEY;
