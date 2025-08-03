import { $module, type Alepha, t } from "@alepha/core";
import * as drizzle from "drizzle-orm";
import { $entity } from "./descriptors/$entity.ts";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";
import { RepositoryDescriptorProvider } from "./providers/RepositoryDescriptorProvider.ts";

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
export * from "./errors/PgEntityNotFoundError.ts";
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
export * from "./types/schema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides PostgreSQL (and SQLite!) database integration with type-safe ORM capabilities through Drizzle.
 *
 * The postgres module enables declarative database operations using descriptors like `$entity`, `$repository`.
 * It offers automatic schema generation, type-safe queries, transactions,
 * and database migrations with support for PostgreSQLs.
 *
 * @see {@link $entity}
 * @see {@link $repository}
 * @see {@link $transaction}
 * @module alepha.postgres
 */
export const AlephaPostgres = $module({
	name: "alepha.postgres",
	descriptors: [$repository, $sequence, $entity],
	services: [
		RepositoryDescriptorProvider,
		PostgresProvider,
		NodePostgresProvider,
		NodeSqliteProvider,
		DrizzleKitProvider,
	],
	register: (alepha: Alepha) => {
		const env = alepha.parseEnv(
			t.object({
				DATABASE_URL: t.string({
					default: ":memory:",
				}),
			}),
		);

		alepha.with(RepositoryDescriptorProvider);

		const memory = env.DATABASE_URL.includes(":memory:");
		const sqlite = env.DATABASE_URL.startsWith("sqlite://");

		if (sqlite || memory) {
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
	},
});
