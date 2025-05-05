import type { Static } from "@alepha/core";
import { $inject, Alepha, __bind, t } from "@alepha/core";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";

export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SCHEMA.ts";
export * from "./constants/PG_SYMBOLS.ts";
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
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/drivers/PostgresProvider.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./providers/RepositoryDescriptorProvider.ts";
export * from "./schemas/entitySchema.ts";
export * from "./schemas/pageQuerySchema.ts";
export * from "./schemas/pageSchema.ts";
export * from "./services/Repository.ts";
export * from "./types/schema.ts";

const envSchema = t.object({
	POSTGRES_PROVIDER: t.optional(t.enum(["pg"])),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class PostgresModule {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	constructor() {
		this.alepha.register(SequenceProvider);
		this.alepha.register(RepositoryDescriptorProvider);

		const name = this.getDefaultProviderName();

		this.alepha.register({
			default: true,
			provide: PostgresProvider,
			use: {
				pg: NodePostgresProvider,
			}[name],
		});
	}

	protected getDefaultProviderName() {
		if (this.env.POSTGRES_PROVIDER) {
			return this.env.POSTGRES_PROVIDER;
		}

		return "pg";
	}
}

__bind($repository, PostgresModule);
__bind($sequence, PostgresModule);
