import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { $inject, $logger, Alepha } from "@alepha/core";
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
			const sqlSchema = sql.raw(schema);

			if (schema.startsWith("test_")) {
				await provider.execute(sql`DROP SCHEMA IF EXISTS ${sqlSchema} CASCADE`);
			}

			await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sqlSchema}`);

			for (const repository of repositories) {
				const table = (repository as any).options.table;
				table[(Table as any).Symbol.Schema] = schema;
			}
		}

		const tables = repositories.map((it) => it.table);

		if (Object.keys(tables).length > 0) {
			const kit = this.importDrizzleKit();
			const curr = kit.generateDrizzleJson(tables);

			const loadPrevious = async () => {
				if (this.alepha.isTest()) {
					return kit.generateDrizzleJson({});
				}

				try {
					return JSON.parse(
						await readFile(`node_modules/drizzle_${schema}.json`, "utf-8"),
					);
				} catch (e) {
					return kit.generateDrizzleJson({});
				}
			};

			const prev = await loadPrevious();

			const statements = await kit.generateMigration(prev, curr);

			for (const statement of statements) {
				try {
					await provider.db.execute(
						sql.raw(
							schema
								? statement.replaceAll('"public"', `"${schema}"`) // TODO: Fix this
								: statement,
						),
					);
				} catch (error) {
					this.log.warn(error, "Invalid statement");
				}
			}

			if (!this.alepha.isTest() && !this.alepha.isProduction()) {
				await writeFile(
					`node_modules/drizzle_${schema}.json`,
					JSON.stringify(curr, null, 2),
				);
			}
		}

		this.log.info(`Synchronization executed in ${Date.now() - now}ms`);
	}

	/**
	 * Get the Drizzle Kit API.
	 *
	 * @protected
	 */
	protected importDrizzleKit() {
		try {
			return createRequire(import.meta.url)("drizzle-kit/api");
		} catch (error) {
			throw new Error(
				"Drizzle Kit is not installed. Please install it with `npm i -D drizzle-kit`.",
			);
		}
	}
}
