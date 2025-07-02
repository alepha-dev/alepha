import { __bind, $inject, type Alepha, type Module, t } from "@alepha/core";
import * as drizzle from "drizzle-orm";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { drizzle };
export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SCHEMA.ts";
export * from "./constants/PG_SYMBOLS.ts";
export * from "./descriptors/$entity.ts";
export * from "./descriptors/$repository.ts";
export * from "./descriptors/$sequence.ts";
export * from "./descriptors/$transaction.ts";
export * from "./errors/EntityNotFoundError.ts";
export * from "./helpers/nullToUndefined.ts";
export * from "./helpers/schemaToPgColumns.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./interfaces/TInsertObject.ts";
export * from "./providers/DrizzleKitProvider.ts";
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/drivers/PostgresProvider.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./providers/RepositoryDescriptorProvider.ts";
export * from "./schemas/entitySchema.ts";
export * from "./schemas/pageQuerySchema.ts";
export * from "./schemas/pageSchema.ts";
export * from "./services/Repository.ts";
export * from "./types/schema.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	DATABASE_URL: t.optional(t.string()),
});

export class AlephaPostgres implements Module {
	public readonly name = "alepha.postgres";
	public readonly env = $inject(envSchema);

	public readonly $services = (alepha: Alepha) => {
		alepha.with(RepositoryDescriptorProvider);

		if (this.env.DATABASE_URL?.includes(":memory:")) {
			alepha.with({
				optional: true,
				provide: PostgresProvider,
				use: NodeSqliteProvider,
			});
		} else {
			alepha.with({
				optional: true,
				provide: PostgresProvider,
				use: NodePostgresProvider,
			});
		}

		alepha.with(SequenceProvider);
	};
}

__bind($repository, AlephaPostgres);
__bind($sequence, AlephaPostgres);
