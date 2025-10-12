import { createRequire } from "node:module";
import { $inject, Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type * as DrizzleKit from "drizzle-kit/api";
import { sql, Table } from "drizzle-orm";
import type { PostgresProvider } from "./drivers/PostgresProvider.ts";
import { RepositoryProvider } from "./RepositoryProvider.ts";

export class DrizzleKitProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly repositoryProvider = $inject(RepositoryProvider);

	public async push(
		provider: PostgresProvider,
		schema: string = provider.schema,
	): Promise<void> {
		const kit = this.importDrizzleKit();
		const tables = await this.getTables(provider, schema);
		const result = await kit.pushSchema(tables, provider.db, [
			"public",
			schema,
		]);
		await this.executeStatements(
			result.statementsToExecute,
			provider,
			schema,
			false,
		);
	}

	public async setPgSchema(provider: PostgresProvider): Promise<void> {
		if (!provider.schema || provider.schema === "public") {
			return; // no need to set schema if it's public or not defined
		}
		const repositories = this.repositoryProvider.getRepositories(provider);

		for (const repository of repositories) {
			const table = (repository as any).options.table;
			table[(Table as any).Symbol.Schema] = provider.schema; // set pgSchema manually
		}
	}

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
		const tables = await this.getTables(provider, schema);

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

	/**
	 * Get all tables from the provider's repositories.
	 */
	protected async getTables(
		provider: PostgresProvider,
		schema?: string,
	): Promise<Record<string, any>> {
		const repositories = this.repositoryProvider.getRepositories(provider);

		if (schema && schema !== "public") {
			await this.prepareSchema(schema, provider, repositories);
		}

		return repositories.reduce<Record<string, any>>((tables, it) => {
			tables[it.tableName] = it.options.table;
			return tables;
		}, {});
	}

	protected async loadMigrationSnapshot(provider: PostgresProvider) {
		const app = this.alepha.env.APP_NAME ?? "app";
		await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
		await provider.execute(sql`
					CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_dev_migrations" (
						"id" SERIAL PRIMARY KEY,
						"name" TEXT NOT NULL,
						"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
						"snapshot" TEXT NOT NULL
					);
				`);

		const rows = await provider.execute(sql`
			SELECT * FROM "drizzle"."__drizzle_dev_migrations" WHERE "name" = ${app} LIMIT 1;
		`);

		return rows[0];
	}

	protected async saveMigrationSnapshot(
		provider: PostgresProvider,
		curr: Record<string, any>,
		entry?: { id: number; snapshot: string },
	) {
		const app = this.alepha.env.APP_NAME ?? "app";
		if (!entry) {
			await provider.execute(
				sql`INSERT INTO "drizzle"."__drizzle_dev_migrations" ("name", "snapshot") VALUES (${app}, ${JSON.stringify(curr)})`,
			);
		} else {
			const newSnapshot = JSON.stringify(curr);
			if (entry.snapshot !== newSnapshot) {
				await provider.execute(
					sql`UPDATE "drizzle"."__drizzle_dev_migrations" SET "snapshot" = ${newSnapshot} WHERE "id" = ${entry.id}`,
				);
			}
		}
	}

	protected async executeStatements(
		statements: string[],
		provider: PostgresProvider,
		_schema?: string,
		catchErrors = false,
	) {
		let nErrors = 0;
		for (const statement of statements) {
			if (statement.startsWith("DROP SCHEMA")) {
				continue; // skip dropping schema statements
			}
			try {
				await provider.db.execute(sql.raw(statement));
			} catch (error) {
				const errorMessage = `Error executing statement: ${statement}`;
				if (catchErrors) {
					nErrors++;
					this.log.trace(errorMessage);
				} else {
					throw new Error(errorMessage, {
						cause: error,
					});
				}
			}
		}
		if (nErrors > 0) {
			this.log.warn(
				`Executed ${statements.length} statements with ${nErrors} errors.`,
			);
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
	 * Try to load the official Drizzle Kit API.
	 * If not available, fallback to the local kit import.
	 */
	protected importDrizzleKit(): typeof DrizzleKit {
		try {
			return createRequire(import.meta.url)("drizzle-kit/api");
		} catch (_) {
			throw new Error(
				"Drizzle Kit is not installed. Please install it with `npm install -D drizzle-kit`.",
			);
		}
	}
}
