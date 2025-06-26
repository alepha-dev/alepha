import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import { $lock } from "@alepha/lock";
import { sql } from "drizzle-orm";
import type { MigrationConfig } from "drizzle-orm/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import type { PostgresProvider, SQLLike } from "./PostgresProvider.ts";

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

const envSchema = t.object({
	PG_HOST: t.optional(t.string()),
	PG_USERNAME: t.optional(t.string()),
	PG_DATABASE: t.optional(t.string()),
	PG_PASSWORD: t.optional(t.string()),
	PG_PORT: t.optional(t.number()),

	/**
	 *
	 */
	DATABASE_URL: t.string({
		default: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
	}),

	/**
	 *
	 */
	DATABASE_MIGRATIONS_FOLDER: t.string({
		default: "drizzle",
	}),

	/**
	 * The schema to use.
	 * Accept a string.
	 */
	POSTGRES_SCHEMA: t.optional(t.string()),

	/**
	 * Synchronize the database schema with the models.
	 * Accept a boolean or a postgres schema name.
	 *
	 * @default false
	 */
	POSTGRES_SYNCHRONIZE: t.optional(t.boolean()),

	/**
	 * Push the schema to the database.
	 *
	 * @default false
	 */
	POSTGRES_PUSH_SCHEMA: t.optional(t.boolean()),

	/**
	 * Reject unauthorized SSL connections.
	 *
	 * @default false
	 */
	POSTGRES_REJECT_UNAUTHORIZED: t.boolean({ default: false }),
});

export interface NodePostgresProviderState {
	client: postgres.Sql;
	db: PostgresJsDatabase;
}

export class NodePostgresProvider implements PostgresProvider {
	public readonly dialect = "postgres";

	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly kit = $inject(DrizzleKitProvider);
	protected state?: NodePostgresProviderState;

	/**
	 * In testing mode, the schema name will be generated and deleted after the test.
	 */
	protected testingSchemaName?: string;

	public get db(): PostgresJsDatabase {
		if (!this.state?.db) {
			throw new Error("Database not initialized");
		}
		return this.state.db;
	}

	protected readonly configure = $hook({
		name: "start",
		handler: async () => {
			await this.connect();

			if (this.env.POSTGRES_PUSH_SCHEMA) {
				// push schema to the database
				await this.kit.push(this);
				return;
			}

			// never migrate in serverless mode (vercel, netlify, ...)
			const provider = this.alepha.isServerless();
			// except for vite
			if (!provider || provider === "vite") {
				await this.migrate();
			}
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			if (this.alepha.isTest() && this.testingSchemaName) {
				await this.execute(
					sql`DROP SCHEMA IF EXISTS "${sql.raw(this.testingSchemaName)}" CASCADE`,
				);
			}

			await this.close();
		},
	});

	/**
	 * Get Postgres schema.
	 */
	public get schema(): string {
		if (this.testingSchemaName) {
			return this.testingSchemaName;
		}

		if (this.env.POSTGRES_SCHEMA) {
			return this.env.POSTGRES_SCHEMA;
		}

		return "public";
	}

	public async execute(query: SQLLike): Promise<any[]> {
		return this.db.execute(query);
	}

	public async connect(): Promise<void> {
		this.log.debug("Connect ..");
		const state = this.createClient();
		await state.client`SELECT 1`; // test connection
		this.state = state;
		this.log.info("Connection OK");
	}

	public async close(): Promise<void> {
		if (this.state?.client) {
			this.log.debug("Close...");
			await this.state.client.end();
			this.state = undefined;
			this.log.info("Connection closed");
		}
	}

	protected migrate = $lock({
		handler: async () => {
			const schema = this.env.POSTGRES_SCHEMA;
			const migration = this.getMigrationOptions();

			if (!this.alepha.isProduction()) {
				// unit testing mode
				if (this.alepha.isTest()) {
					// when you are testing with a specific schema
					if (schema) {
						await this.kit.synchronize(this, schema);
						return;
					}

					// when you are testing without a specific schema, just create a random schema
					this.testingSchemaName = `test_${Date.now()}_${Math.floor(Math.random() * 100)}`;
					await this.kit.synchronize(this, this.testingSchemaName);
					return;
				}

				// development mode
				if (this.env.POSTGRES_SYNCHRONIZE !== false) {
					try {
						// silently run migrations
						await migrate(this.db, migration);
					} catch (_ignore) {
						// ignore errors
					}

					await this.kit.synchronize(this, schema ?? "public");
					return;
				}
			}

			this.log.debug(
				`Migrate from '${migration.migrationsFolder}' directory ...`,
			);

			await migrate(this.db, migration);

			this.log.info("Migration OK");
		},
	});

	protected createClient(): NodePostgresProviderState {
		const client = postgres(this.getClientOptions());
		const db = drizzle(client, {
			logger: {
				// forward logs
				logQuery: (query: string, params: unknown[]) => {
					this.log.trace({ params }, query);
				},
			},
		});

		return { client, db };
	}

	protected getMigrationOptions(): MigrationConfig {
		return {
			migrationsFolder: this.env.DATABASE_MIGRATIONS_FOLDER,
		};
	}

	protected getClientOptions(): postgres.Options<any> {
		let url: URL | undefined;
		if (this.env.DATABASE_URL) {
			url = new URL(this.env.DATABASE_URL);
		}

		return {
			host: url?.host ?? this.env.PG_HOST,
			user: url?.username ?? this.env.PG_USERNAME,
			database: url?.pathname.replace("/", "") ?? this.env.PG_DATABASE,
			password: url?.password ?? this.env.PG_PASSWORD,
			port: Number(url?.port ?? this.env.PG_PORT ?? 5432),
			ssl: this.env.POSTGRES_REJECT_UNAUTHORIZED
				? {
						rejectUnauthorized: false,
					}
				: undefined,
			onnotice: () => {
				// let drizzle handle logs
			},
		};
	}
}
