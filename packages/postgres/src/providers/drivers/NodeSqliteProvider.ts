import { DatabaseSync } from "node:sqlite";
import { $hook, $inject, $logger } from "@alepha/core";
import type { Static, TObject } from "@sinclair/typebox";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { PostgresProvider, type SQLLike } from "./PostgresProvider.ts";

export class NodeSqliteProvider extends PostgresProvider {
	protected readonly kit = $inject(DrizzleKitProvider);
	protected readonly log = $logger();

	public readonly dialect = "sqlite";
	public readonly schema = "public";

	public async execute<T extends TObject = any>(
		query: SQLLike,
		schema?: T,
	): Promise<Array<T extends TObject ? Static<T> : any>> {
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
			return this.mapResult(data ? [{ ...data }] : []);
		}

		const rows = statement.all(...(params as any[]));
		return this.mapResult(rows, schema);
	}

	public sqlite!: DatabaseSync;

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

		throw new Error(`Unsupported method: ${method}`);
	}) as unknown as PgDatabase<any>;

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			const { DatabaseSync} = await import("node:sqlite");
			this.sqlite = new DatabaseSync(":memory:");
		},
	});

	protected readonly start = $hook({
		on: "start",
		handler: async () => {
			await this.kit.synchronizeSqlite(this);
			this.log.info("Sqlite OK");
		},
	});
}
