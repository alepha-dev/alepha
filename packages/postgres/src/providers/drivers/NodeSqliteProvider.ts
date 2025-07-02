import { DatabaseSync } from "node:sqlite";
import { $hook, $inject, $logger } from "@alepha/core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DrizzleKitProvider } from "../DrizzleKitProvider";
import type { PostgresProvider } from "./PostgresProvider";

export class NodeSqliteProvider implements PostgresProvider {
	protected readonly kit = $inject(DrizzleKitProvider);
	protected readonly log = $logger();

	public readonly dialect = "sqlite";
	public readonly schema = "public";

	public async execute(query: string): Promise<any[]> {
		return [];
	}

	public readonly sqlite = new DatabaseSync(":memory:");

	public readonly db = drizzle(async (sql, params, method) => {
		const statement = this.sqlite.prepare(sql);

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

	protected readonly start = $hook({
		name: "start",
		handler: async () => {
			await this.kit.synchronizeSqlite(this);
			this.log.info("Sqlite OK");
		},
	});
}
