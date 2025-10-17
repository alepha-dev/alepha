import { mkdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import {
	$env,
	$hook,
	$inject,
	AlephaError,
	type Static,
	type TObject,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { PostgresProvider, type SQLLike } from "./PostgresProvider.ts";

export interface NodeSqliteProviderOptions {
	/**
	 * Sqlite database file path.
	 * Set to `:memory:` to use an in-memory database.
	 *
	 * @default this.env.DATABASE_URL || ":memory:"
	 */
	path: string;
}

/**
 * Add a fake support for SQLite in Node.js based on PostgresProvider (yes)
 *
 * This is NOT a real SQLite provider, it's a workaround to use SQLite with Drizzle ORM.
 * This is NOT recommended for production use.
 */
export class NodeSqliteProvider extends PostgresProvider {
	public readonly dialect = "sqlite";

	protected readonly kit = $inject(DrizzleKitProvider);
	protected readonly log = $logger();
	protected readonly env = $env(
		t.object({
			DATABASE_URL: t.optional(t.text()),
		}),
	);

	public sqlite!: DatabaseSync;
	public options: NodeSqliteProviderOptions = {
		path: this.getDatabasePath(),
	};

	protected getDatabasePath(): string {
		let path = this.env.DATABASE_URL;
		if (!path) {
			if (this.alepha.isTest()) {
				path = ":memory:";
			} else {
				path = "node_modules/sqlite.db";
			}
		}
		return path;
	}

	public async execute<T extends TObject | undefined = undefined>(
		query: SQLLike,
		schema?: T,
	): Promise<Array<T extends TObject ? Static<T> : any[]>> {
		const all = (this.db as unknown as SqliteRemoteDatabase).all(query);
		const { sql, params, method } = all.getQuery();
		this.log.trace(`${sql}`, params);

		const statement = this.sqlite.prepare(sql);
		if (method === "run") {
			statement.run(...(params as any[]));
			return [];
		}

		if (method === "get") {
			const data = statement.get(...(params as any[]));
			return this.mapResult(data ? [{ ...data }] : [], schema);
		}

		const rows = statement.all(...(params as any[]));
		return this.mapResult(rows, schema);
	}

	public readonly db = drizzle(async (sql, params, method) => {
		const statement = this.sqlite.prepare(sql);
		this.log.trace(`${sql}`, params);

		if (method === "get") {
			const data = statement.get(...params);
			return { rows: data ? [{ ...data }] : [] };
		}

		if (method === "run") {
			statement.run(...params);
			return { rows: [] };
		}

		if (method === "all") {
			const rows = statement.all(...params);
			return {
				rows: rows.map((row) => Object.values(row)),
			};
		}

		throw new AlephaError(`Unsupported method: ${method}`);
	}) as unknown as PgDatabase<any>;

	protected readonly configure = $hook({
		on: "start",
		handler: async () => {
			const { DatabaseSync } = await import("node:sqlite");
			const filepath = this.options.path.replace("sqlite://", "");

			if (filepath !== ":memory:" && filepath !== "") {
				const dirname = filepath.split("/").slice(0, -1).join("/");
				if (dirname) {
					await mkdir(dirname, { recursive: true });
				}
			}

			this.sqlite = new DatabaseSync(filepath);

			await this.kit.synchronizeSqlite(this);

			this.log.info(`Using SQLite database at ${filepath}`);
		},
	});

	protected mapResult<T extends TObject | undefined = undefined>(
		result: Array<any>,
		schema?: T,
	): Array<T extends TObject ? Static<T> : any> {
		if (!schema) {
			return result;
		}

		return result.map((row) => this.alepha.parse(schema, row)) as Array<any>;
	}
}
