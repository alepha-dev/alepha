import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { $repository } from "./descriptors/$repository";
import { $sequence } from "./descriptors/$sequence";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider";
import { PostgresProvider } from "./providers/drivers/PostgresProvider";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider";
import { SequenceProvider } from "./providers/SequenceProvider";

export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SCHEMA";
export * from "./constants/PG_SYMBOLS";
export * from "./descriptors/$repository";
export * from "./descriptors/$sequence";
export * from "./descriptors/$transaction";
export * from "./errors/EntityNotFoundError";
export * from "./helpers/nullToUndefined";
export * from "./helpers/pgTableSchema";
export * from "./helpers/schemaToColumns";
export * from "./interfaces/FilterOperators";
export * from "./interfaces/PgQuery";
export * from "./interfaces/PgQueryWhere";
export * from "./providers/drivers/NodePostgresProvider";
export * from "./providers/drivers/PostgresProvider";
export * from "./providers/PostgresTypeProvider";
export * from "./providers/RepositoryDescriptorProvider";
export * from "./schemas/entitySchema";
export * from "./schemas/pageQuerySchema";
export * from "./schemas/pageSchema";
export * from "./services/Repository";
export * from "./types/schema";

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

autoInject($repository, PostgresModule);
autoInject($sequence, PostgresModule);
