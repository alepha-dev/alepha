import { createRequire } from "node:module";
import { $inject, $logger, Alepha } from "@alepha/core";
import type * as DrizzleKit from "drizzle-kit/api";
import { Table, sql } from "drizzle-orm";
import { RepositoryDescriptorProvider } from "./RepositoryDescriptorProvider.ts";
import type { PostgresProvider } from "./drivers/PostgresProvider.ts";

export class DrizzleKitProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly repositoryDescriptorProvider = $inject(
		RepositoryDescriptorProvider,
	);

	/**
	 * Try to generate migrations from scratch based on the models.
	 * Then, execute the migrations.
	 *
	 * This is useful for testing or development purposes.
	 *
	 * Do not use in production.
	 *
	 * @param provider - The Postgres provider to use.
	 * @param schema - The schema to use.
	 * @returns A promise that resolves once the migrations have been executed.
	 */
	public async synchronize(
		provider: PostgresProvider,
		schema?: string,
	): Promise<void> {
		const now = Date.now();

		const repositories =
			this.repositoryDescriptorProvider.getRepositories(provider);

		if (schema) {
			await this.prepareSchema(schema, provider, repositories);
		}

		const tables: Record<string, any> = repositories.map((it) => it.table);

		if (Object.keys(tables).length > 0) {
			const kit = this.importDrizzleKit();

			if (this.alepha.isTest()) {
				// testing area, generate migrations from scratch - no need to push schema
				const prev = await kit.generateDrizzleJson({});
				const curr = await kit.generateDrizzleJson(tables);
				const statements = await kit.generateMigration(prev, curr);

				for (const statement of statements) {
					await provider.db.execute(
						sql.raw(
							schema
								? // TODO: improve this
									statement.replaceAll('"public"', `"${schema}"`)
								: statement,
						),
					);
				}
			} else if (!this.alepha.isProduction()) {
				// development area, push schema directly using Drizzle Kit API
				const resp = await kit.pushSchema(tables, provider.db);

				for (const warning of resp.warnings) {
					this.log.warn(warning);
				}

				await resp.apply();
			}
		}

		this.log.info(`Synchronization executed in ${Date.now() - now}ms`);
	}

	protected async prepareSchema(
		schemaName: string,
		provider: PostgresProvider,
		repositories: any[],
	) {
		const sqlSchema = sql.raw(schemaName);

		if (schemaName.startsWith("test_")) {
			await provider.execute(sql`DROP SCHEMA IF EXISTS ${sqlSchema} CASCADE`);
		}

		// create schema if not exists
		await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sqlSchema}`);

		for (const repository of repositories) {
			const table = (repository as any).options.table;
			table[(Table as any).Symbol.Schema] = schemaName; // set pgSchema manually
		}
	}

	/**
	 * Get the Drizzle Kit API.
	 *
	 * @protected
	 */
	protected importDrizzleKit(): typeof DrizzleKit {
		try {
			return createRequire(import.meta.url)("drizzle-kit/api");
		} catch (error) {
			throw new Error(
				"Drizzle Kit is not installed. Please install it with `npm i -D drizzle-kit`.",
			);
		}
	}
}
