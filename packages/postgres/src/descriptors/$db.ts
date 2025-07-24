import { $cursor } from "@alepha/core";
import type { TableLike } from "../helpers/schemaToPgColumns.ts";
import { AlephaPostgres } from "../index.ts";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";
import { Repository } from "../services/Repository.ts";

/**
 * @experimental
 */
export const $db = <
	T extends {
		[key: string]: TableLike;
	},
>(
	options: DbDescriptorOptions<T> = {},
): DbDescriptor<T> => {
	const { context: alepha } = $cursor();
	const provider = alepha.with(AlephaPostgres).inject(PostgresProvider);

	const entities: Record<string, Repository<any, any>> = {};
	for (const [key, entity] of Object.entries(options.entities ?? {})) {
		entities[key] = new Repository({
			table: (entity as any).$table as any,
			schema: entity.$schema,
		});
	}

	return {
		...entities,
		execute: provider.execute.bind(provider),
	} as DbDescriptor<T>;
};

export type DbDescriptorOptions<
	T extends {
		[key: string]: TableLike;
	},
> = {
	entities?: T;
};

export type DbDescriptor<
	T extends {
		[key: string]: TableLike;
	},
> = {
	[key in keyof T]: Repository<any, T[key]["$schema"]>;
} & Pick<PostgresProvider, "execute">;
