import { __bind, type Alepha, type Module } from "@alepha/core";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";

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
export * from "./helpers/pgTableSchema.ts";
export * from "./helpers/schemaToColumns.ts";
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

export class AlephaPostgresModule implements Module {
	public readonly name = "alepha.orm.postgres";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with(RepositoryDescriptorProvider)
			.with({
				optional: true,
				provide: PostgresProvider,
				use: NodePostgresProvider,
			})
			.with(SequenceProvider);
}

__bind($repository, AlephaPostgresModule);
__bind($sequence, AlephaPostgresModule);
