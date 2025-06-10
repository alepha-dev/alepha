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

		if (schema && schema !== "public") {
			await this.prepareSchema(schema, provider, repositories);
		}

		const tables: Record<string, any> = repositories.map((it) => it.table);

		if (Object.keys(tables).length > 0) {
			const kit = this.importDrizzleKit();

			if (this.alepha.isTest()) {
				// testing area, generate migrations from scratch - no need to push schema
				const prev = kit.generateDrizzleJson({});
				const curr = kit.generateDrizzleJson(tables);
				const statements = await kit.generateMigration(prev, curr);
				await this.executeStatements(statements, provider, schema);
			} else if (!this.alepha.isProduction()) {
				// development area, generate migrations based on the current state
				const entry = await this.loadMigrationSnapshot(provider);
				const prev = entry
					? JSON.parse(entry.snapshot)
					: kit.generateDrizzleJson({});
				const curr = kit.generateDrizzleJson(tables);
				const statements = await kit.generateMigration(prev, curr);
				await this.executeStatements(statements, provider, schema, true);
				await this.saveMigrationSnapshot(provider, curr, entry);
			}
		}

		this.log.info(`Synchronization executed in ${Date.now() - now}ms`);
	}

	protected async loadMigrationSnapshot(provider: PostgresProvider) {
		const app = this.alepha.env.APP_NAME ?? "app";
		await provider.execute(sql`
					CREATE SCHEMA IF NOT EXISTS alepha;
					CREATE TABLE IF NOT EXISTS alepha.migrations (
						"id" SERIAL PRIMARY KEY,
						"name" TEXT NOT NULL,
						"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"snapshot" TEXT NOT NULL
					);
				`);

		const [entry] = await provider.execute(sql`
			SELECT * FROM alepha.migrations WHERE "name" = ${app} LIMIT 1;
		`);

		return entry;
	}

	protected async saveMigrationSnapshot(
		provider: PostgresProvider,
		curr: Record<string, any>,
		entry?: { id: number; snapshot: string },
	) {
		const app = this.alepha.env.APP_NAME ?? "app";
		if (!entry) {
			await provider.execute(
				sql`INSERT INTO alepha.migrations ("name", "snapshot") VALUES (${app}, ${JSON.stringify(curr)})`,
			);
		} else {
			const newSnapshot = JSON.stringify(curr);
			if (entry.snapshot !== newSnapshot) {
				await provider.execute(
					sql`UPDATE alepha.migrations SET "snapshot" = ${newSnapshot} WHERE "id" = ${entry.id}`,
				);
			}
		}
	}

	protected async executeStatements(
		statements: string[],
		provider: PostgresProvider,
		schema?: string,
		catchErrors = false,
	) {
		for (const statement of statements) {
			try {
				await provider.db.execute(
					sql.raw(
						schema
							? // TODO: improve this
								statement.replaceAll('"public"', `"${schema}"`)
							: statement,
					),
				);
			} catch (error) {
				if (catchErrors) {
					this.log.warn(`Error executing statement: ${statement}`);
				} else {
					throw new Error(`Error executing statement: ${statement}`, {
						cause: error,
					});
				}
			}
		}
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
