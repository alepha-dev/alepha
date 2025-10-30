import { mkdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { $env, $hook, $inject, AlephaError, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { PgError } from "../../errors/PgError.ts";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

const envSchema = t.object({
  DATABASE_URL: t.optional(t.text()),
});

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
 * Add a fake support for SQLite in Node.js based on Postgres interfaces.
 *
 * This is NOT a real SQLite provider, it's a workaround to use SQLite with Drizzle ORM.
 * This is NOT recommended for production use.
 */
export class NodeSqliteProvider extends DatabaseProvider {
  public readonly dialect = "sqlite";

  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(SqliteModelBuilder);

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

  public async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
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
      return data ? [{ ...data }] : [];
    }

    return statement.all(...(params as any[]));
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

    if (method === "values") {
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

      try {
        await this.kit.synchronize(this);
      } catch (error) {
        throw new PgError(
          "Failed to synchronize SQLite database schema",
          error as Error,
        );
      }

      this.log.info(`Using SQLite database at ${filepath}`);
    },
  });
}
